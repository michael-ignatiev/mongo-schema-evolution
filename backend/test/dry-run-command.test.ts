import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../src/cli/createCli.js";
import { initConfig } from "../src/config/index.js";

const tempDirs: string[] = [];

describe("dry-run command", () => {
  const originalCwd = process.cwd();
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("dry_run_command_test").dropDatabase();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
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

  it("prints a dry-run preview without mutating matching documents", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-dry-run-command-"));
    tempDirs.push(cwd);
    const { config } = await initConfig({ cwd });
    const rawConfig = JSON.parse(await readFile(config.configPath, "utf8")) as Record<string, unknown>;
    rawConfig.mongoUri = server.getUri();
    rawConfig.dbName = "dry_run_command_test";
    await writeFile(config.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);
    await mkdir(config.migrationsPath, { recursive: true });
    await writeFile(path.join(config.migrationsPath, "20260511120000-preview-users.ts"), `
export default {
  id: "20260511120000-preview-users",
  description: "preview users",
  collection: "users",
  mode: "online",
  match() {
    return { name: { $exists: true } };
  },
  transform(document) {
    return { ...document, migrated: true };
  }
};
`);

    await client.db("dry_run_command_test").collection("users").insertOne({
      _id: "user-1",
      name: "Ada"
    });
    process.chdir(cwd);

    await createCli().parseAsync([
      "node",
      "mongo-evolution",
      "dry-run",
      "--migration",
      "20260511120000-preview-users",
      "--sample-size",
      "1"
    ]);

    await expect(client.db("dry_run_command_test").collection("users").findOne({ _id: "user-1" }))
      .resolves.not.toHaveProperty("migrated");
    expect(console.log).toHaveBeenCalledWith("Dry-run: 1 documents matched in users");
    expect(console.log).toHaveBeenCalledWith("Migration: 20260511120000-preview-users");
    expect(console.log).toHaveBeenCalledWith("Sample documents: 1");
  });
});
