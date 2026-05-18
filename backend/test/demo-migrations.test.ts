import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { demoUsers } from "../demo/usersSeed.js";
import { initConfig, loadConfig } from "../src/config/index.js";
import { createMongoMetadataStore } from "../src/core/metadata/index.js";
import { runMigrations } from "../src/core/runner/index.js";
import { validateMigration } from "../src/core/safety/index.js";

const tempDirs: string[] = [];

describe("demo user migrations", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("demo_migrations_test").dropDatabase();
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

  it("migrates seeded users through schemaVersion 2 and 3 with passing validation", async () => {
    const config = await createDemoConfig(server.getUri());
    const db = client.db(config.dbName);
    await db.collection("users").insertMany(demoUsers);

    const before = await db.collection("users").find().sort({ _id: 1 }).toArray();

    expect(before).toEqual([
      expect.objectContaining({
        _id: "user-1",
        name: "Ada Lovelace",
        phone: "+1-555-0101"
      }),
      expect.objectContaining({
        _id: "user-2",
        name: "Grace Hopper",
        phone: "+1-555-0102"
      }),
      expect.objectContaining({
        _id: "user-3",
        name: "Katherine Johnson",
        phone: "+1-555-0103"
      })
    ]);

    await expect(validateMigration({
      config,
      db,
      migrationId: "20260512090000-move-user-name-to-profile-fullname"
    })).resolves.toMatchObject({
      passed: false,
      checkedDocs: 3,
      validDocs: 0,
      invalidDocs: 3
    });

    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);
    const result = await runMigrations({ config, db, metadataStore });
    const after = await db.collection("users").find().sort({ _id: 1 }).toArray();
    const nameValidation = await validateMigration({
      config,
      db,
      migrationId: "20260512090000-move-user-name-to-profile-fullname"
    });
    const phoneValidation = await validateMigration({
      config,
      db,
      migrationId: "20260512091000-move-user-phone-to-contact-phone"
    });

    expect(result.appliedMigrations.map((migration) => migration.migrationId)).toEqual([
      "20260512090000-move-user-name-to-profile-fullname",
      "20260512091000-move-user-phone-to-contact-phone"
    ]);
    expect(result.appliedMigrations).toEqual([
      expect.objectContaining({
        matchedDocs: 3,
        modifiedDocs: 3,
        failedDocs: 0
      }),
      expect.objectContaining({
        matchedDocs: 3,
        modifiedDocs: 3,
        failedDocs: 0
      })
    ]);
    expect(after).toEqual([
      expect.objectContaining({
        _id: "user-1",
        email: "ada@example.com",
        profile: { fullName: "Ada Lovelace" },
        contact: { phone: "+1-555-0101" },
        schemaVersion: 3
      }),
      expect.objectContaining({
        _id: "user-2",
        email: "grace@example.com",
        profile: { fullName: "Grace Hopper" },
        contact: { phone: "+1-555-0102" },
        schemaVersion: 3
      }),
      expect.objectContaining({
        _id: "user-3",
        email: "katherine@example.com",
        profile: { fullName: "Katherine Johnson" },
        contact: { phone: "+1-555-0103" },
        schemaVersion: 3
      })
    ]);
    expect(after.every((user) => !("name" in user) && !("phone" in user))).toBe(true);
    expect(nameValidation).toMatchObject({
      passed: true,
      checkedDocs: 3,
      validDocs: 3,
      invalidDocs: 0,
      errors: []
    });
    expect(phoneValidation).toMatchObject({
      passed: true,
      checkedDocs: 3,
      validDocs: 3,
      invalidDocs: 0,
      errors: []
    });
  });
});

async function createDemoConfig(mongoUri: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-demo-"));
  tempDirs.push(cwd);
  const { config } = await initConfig({ cwd });
  const rawConfig = JSON.parse(await readFile(config.configPath, "utf8")) as Record<string, unknown>;

  rawConfig.mongoUri = mongoUri;
  rawConfig.dbName = "demo_migrations_test";
  rawConfig.migrationsDir = path.resolve("migrations");
  rawConfig.defaultBatchSize = 2;
  await writeFile(config.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);

  return loadConfig({ cwd });
}
