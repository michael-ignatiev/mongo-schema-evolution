import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { initConfig, loadConfig } from "../src/config/index.js";
import { validateMigration } from "../src/core/safety/index.js";

const tempDirs: string[] = [];

describe("migration validation", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("validation_test").dropDatabase();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, {
      force: true,
      recursive: true
    })));
  });

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  it("returns a structured passing validation result", async () => {
    const { config } = await createProjectConfig(server.getUri());
    await writeValidationMigration(config.migrationsPath);
    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-1", profile: { fullName: "Ada Lovelace" }, schemaVersion: 2 },
      { _id: "user-2", profile: { fullName: "Grace Hopper" }, schemaVersion: 2 }
    ]);

    const result = await validateMigration({
      config,
      db,
      migrationId: "20260511120000-validate-users"
    });

    expect(result).toEqual({
      migrationId: "20260511120000-validate-users",
      collection: "users",
      mode: "online",
      passed: true,
      checkedDocs: 2,
      validDocs: 2,
      invalidDocs: 0,
      errors: [],
      summary: "Validation passed: 2/2 users valid"
    });
  });

  it("surfaces invariant violations in a structured failing result", async () => {
    const { config } = await createProjectConfig(server.getUri());
    await writeValidationMigration(config.migrationsPath);
    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-1", profile: { fullName: "Ada Lovelace" }, schemaVersion: 2 },
      { _id: "user-2", name: "Grace Hopper", schemaVersion: 1 },
      { _id: "user-3", profile: {}, schemaVersion: 2 }
    ]);

    const result = await validateMigration({
      config,
      db,
      migrationId: "20260511120000-validate-users"
    });

    expect(result.passed).toBe(false);
    expect(result.checkedDocs).toBe(3);
    expect(result.validDocs).toBe(1);
    expect(result.invalidDocs).toBe(2);
    expect(result.errors).toEqual([
      {
        documentId: "user-2",
        message: "profile.fullName must exist"
      },
      {
        documentId: "user-2",
        message: "legacy name field must be absent"
      },
      {
        documentId: "user-2",
        message: "schemaVersion must be 2"
      },
      {
        documentId: "user-3",
        message: "profile.fullName must exist"
      }
    ]);
    expect(result.summary).toBe("Validation failed: 1/3 users valid");
  });
});

async function createProjectConfig(mongoUri: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-validation-"));
  tempDirs.push(cwd);
  const { config } = await initConfig({ cwd });
  const rawConfig = JSON.parse(await readFile(config.configPath, "utf8")) as Record<string, unknown>;

  rawConfig.mongoUri = mongoUri;
  rawConfig.dbName = "validation_test";
  await writeFile(config.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);

  return {
    cwd,
    config: await loadConfig({ cwd })
  };
}

async function writeValidationMigration(migrationsPath: string): Promise<void> {
  await mkdir(migrationsPath, { recursive: true });
  await writeFile(path.join(migrationsPath, "20260511120000-validate-users.ts"), `
export default {
  id: "20260511120000-validate-users",
  description: "validate users",
  collection: "users",
  mode: "online",
  match() {
    return {};
  },
  transform(document) {
    return document;
  },
  async validate(ctx) {
    const users = await ctx.db.collection("users").find().sort({ _id: 1 }).toArray();
    const errors = [];
    let validDocs = 0;

    for (const user of users) {
      const before = errors.length;

      if (typeof user.profile?.fullName !== "string" || user.profile.fullName.length === 0) {
        errors.push({ documentId: user._id, message: "profile.fullName must exist" });
      }

      if ("name" in user) {
        errors.push({ documentId: user._id, message: "legacy name field must be absent" });
      }

      if (user.schemaVersion !== 2) {
        errors.push({ documentId: user._id, message: "schemaVersion must be 2" });
      }

      if (errors.length === before) {
        validDocs += 1;
      }
    }

    return {
      passed: errors.length === 0,
      checkedDocs: users.length,
      validDocs,
      invalidDocs: users.length - validDocs,
      errors,
      summary: errors.length === 0
        ? \`Validation passed: \${validDocs}/\${users.length} users valid\`
        : \`Validation failed: \${validDocs}/\${users.length} users valid\`
    };
  }
};
`);
}
