import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../src/cli/createCli.js";
import { initConfig } from "../src/config/index.js";
import { createMongoMetadataStore } from "../src/core/metadata/index.js";

const tempDirs: string[] = [];

describe("history command", () => {
  const originalCwd = process.cwd();
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("history_command_test").dropDatabase();
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

  it("prints applied migrations and run status counts", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-history-command-"));
    tempDirs.push(cwd);
    const { config } = await initConfig({ cwd });
    const rawConfig = JSON.parse(await readFile(config.configPath, "utf8")) as Record<string, unknown>;
    rawConfig.mongoUri = server.getUri();
    rawConfig.dbName = "history_command_test";
    await writeFile(config.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);

    const db = client.db("history_command_test");
    const store = createMongoMetadataStore(db, config.metadataCollections);
    await store.ensureIndexes();
    await store.createRun({
      runId: "run-1",
      migrationId: "20260511120000-users",
      startedAt: new Date("2026-05-11T12:00:00.000Z")
    });
    await store.completeRun("run-1", {
      matchedDocs: 7,
      modifiedDocs: 6,
      failedDocs: 0,
      batchCount: 2,
      finishedAt: new Date("2026-05-11T12:01:00.000Z")
    });
    await store.recordAppliedMigration({
      migrationId: "20260511120000-users",
      description: "users",
      collection: "users",
      mode: "online",
      runId: "run-1",
      appliedAt: new Date("2026-05-11T12:01:00.000Z")
    });
    process.chdir(cwd);

    await createCli().parseAsync(["node", "mongo-evolution", "history"]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Migration history"));
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "- 20260511120000-users | collection=users | mode=online | appliedAt=2026-05-11T12:01:00.000Z | runId=run-1"
      )
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "status=succeeded | runId=run-1 | startedAt=2026-05-11T12:00:00.000Z | finishedAt=2026-05-11T12:01:00.000Z | matched=7 | modified=6 | failed=0 | batches=2"
      )
    );
  });
});
