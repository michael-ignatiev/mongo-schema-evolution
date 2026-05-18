import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { formatMigrationHistory } from "../src/cli/historyFormatter.js";
import { getMigrationHistory } from "../src/core/history/index.js";
import {
  type MetadataCollections,
  createMongoMetadataStore
} from "../src/core/metadata/index.js";

const metadataCollections: MetadataCollections = {
  migrations: "_schema_migrations",
  runs: "_schema_migration_runs",
  checkpoints: "_schema_migration_checkpoints"
};

describe("migration history", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("history_test").dropDatabase();
  });

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  it("retrieves applied migrations and run records from metadata storage", async () => {
    const store = createMongoMetadataStore(client.db("history_test"), metadataCollections);
    await store.ensureIndexes();
    const run = await store.createRun({
      runId: "run-1",
      migrationId: "20260511120000-users",
      startedAt: new Date("2026-05-11T12:00:00.000Z")
    });
    await store.completeRun(run.runId, {
      matchedDocs: 10,
      modifiedDocs: 9,
      failedDocs: 0,
      batchCount: 2,
      finishedAt: new Date("2026-05-11T12:01:00.000Z")
    });
    await store.recordAppliedMigration({
      migrationId: "20260511120000-users",
      description: "users",
      collection: "users",
      mode: "online",
      runId: run.runId,
      appliedAt: new Date("2026-05-11T12:01:00.000Z")
    });

    const history = await getMigrationHistory({ metadataStore: store });

    expect(history.appliedMigrations).toEqual([
      expect.objectContaining({
        migrationId: "20260511120000-users",
        collection: "users",
        mode: "online",
        runId: "run-1"
      })
    ]);
    expect(history.runs).toEqual([
      expect.objectContaining({
        runId: "run-1",
        migrationId: "20260511120000-users",
        status: "succeeded",
        matchedDocs: 10,
        modifiedDocs: 9,
        failedDocs: 0,
        batchCount: 2
      })
    ]);
  });

  it("formats applied migrations and runs with timestamps and counts", () => {
    const formatted = formatMigrationHistory({
      appliedMigrations: [
        {
          migrationId: "20260511120000-users",
          description: "users",
          collection: "users",
          mode: "online",
          appliedAt: new Date("2026-05-11T12:01:00.000Z"),
          runId: "run-1"
        }
      ],
      runs: [
        {
          runId: "run-1",
          migrationId: "20260511120000-users",
          status: "succeeded",
          startedAt: new Date("2026-05-11T12:00:00.000Z"),
          finishedAt: new Date("2026-05-11T12:01:00.000Z"),
          resumedFromCheckpoint: false,
          matchedDocs: 10,
          modifiedDocs: 9,
          failedDocs: 0,
          batchCount: 2,
          warnings: []
        },
        {
          runId: "run-2",
          migrationId: "20260511130000-failed",
          status: "failed",
          startedAt: new Date("2026-05-11T13:00:00.000Z"),
          resumedFromCheckpoint: true,
          matchedDocs: 3,
          modifiedDocs: 2,
          failedDocs: 1,
          batchCount: 1,
          warnings: [],
          error: { message: "planned failure" }
        }
      ]
    });

    expect(formatted).toContain("Applied migrations:");
    expect(formatted).toContain(
      "- 20260511120000-users | collection=users | mode=online | appliedAt=2026-05-11T12:01:00.000Z | runId=run-1"
    );
    expect(formatted).toContain(
      "- 20260511120000-users | status=succeeded | runId=run-1 | startedAt=2026-05-11T12:00:00.000Z | finishedAt=2026-05-11T12:01:00.000Z | matched=10 | modified=9 | failed=0 | batches=2 | resumed=no"
    );
    expect(formatted).toContain(
      "- 20260511130000-failed | status=failed | runId=run-2 | startedAt=2026-05-11T13:00:00.000Z | finishedAt=pending | matched=3 | modified=2 | failed=1 | batches=1 | resumed=yes"
    );
    expect(formatted).toContain("  error: planned failure");
  });
});
