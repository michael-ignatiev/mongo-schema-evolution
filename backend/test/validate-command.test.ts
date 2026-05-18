import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../src/cli/createCli.js";
import { initConfig } from "../src/config/index.js";

const tempDirs: string[] = [];

describe("validate command", () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("validate_command_test").dropDatabase();
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, {
      force: true,
      recursive: true
    })));
  });

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  it("runs validation and reports invariant violations", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-validate-command-"));
    tempDirs.push(cwd);
    const { config } = await initConfig({ cwd });
    const rawConfig = JSON.parse(await readFile(config.configPath, "utf8")) as Record<string, unknown>;
    rawConfig.mongoUri = server.getUri();
    rawConfig.dbName = "validate_command_test";
    await writeFile(config.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);
    await mkdir(config.migrationsPath, { recursive: true });
    await writeFile(path.join(config.migrationsPath, "20260511120000-validate-users.ts"), `
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
    const errors = users
      .filter((user) => user.schemaVersion !== 2)
      .map((user) => ({ documentId: user._id, message: "schemaVersion must be 2" }));

    return {
      passed: errors.length === 0,
      checkedDocs: users.length,
      validDocs: users.length - errors.length,
      invalidDocs: errors.length,
      errors,
      summary: errors.length === 0 ? "ok" : "schema version mismatch"
    };
  }
};
`);
    await client.db("validate_command_test").collection("users").insertMany([
      { _id: "user-1", schemaVersion: 2 },
      { _id: "user-2", schemaVersion: 1 }
    ]);
    process.chdir(cwd);

    await createCli().parseAsync([
      "node",
      "mongo-evolution",
      "validate",
      "--migration",
      "20260511120000-validate-users"
    ]);

    expect(process.exitCode).toBe(1);
    expect(console.log).toHaveBeenCalledWith("Validation failed: 1/2 documents valid");
    expect(console.log).toHaveBeenCalledWith("Invalid documents: 1");
    expect(console.log).toHaveBeenCalledWith(
      "Violation [document user-2]: schemaVersion must be 2"
    );
  });
});
