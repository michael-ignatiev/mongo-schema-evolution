import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type MetadataCollections,
  createMongoMetadataStore
} from "../src/core/metadata/index.js";

const metadataCollections: MetadataCollections = {
  migrations: "_schema_migrations",
  runs: "_schema_migration_runs",
  checkpoints: "_schema_migration_checkpoints"
};

describe("MongoMetadataStore", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("metadata_store_test").dropDatabase();
  });

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  it("records applied migrations and lists them in deterministic migration id order", async () => {
    const store = createMongoMetadataStore(client.db("metadata_store_test"), metadataCollections);
    await store.ensureIndexes();

    await store.recordAppliedMigration({
      migrationId: "20260511130000-second",
      description: "second",
      collection: "users",
      mode: "online",
      runId: "run-2",
      appliedAt: new Date("2026-05-11T13:00:00.000Z")
    });
    await store.recordAppliedMigration({
      migrationId: "20260511120000-first",
      description: "first",
      collection: "users",
      mode: "offline",
      runId: "run-1",
      appliedAt: new Date("2026-05-11T12:00:00.000Z")
    });

    const applied = await store.listAppliedMigrations();

    expect(applied.map((record) => record.migrationId)).toEqual([
      "20260511120000-first",
      "20260511130000-second"
    ]);
    await expect(store.isMigrationApplied("20260511120000-first")).resolves.toBe(true);
    await expect(store.getAppliedMigration("20260511120000-first")).resolves.toMatchObject({
      collection: "users",
      mode: "offline",
      runId: "run-1"
    });
  });

  it("tracks migration run status, progress, success, and failure", async () => {
    const store = createMongoMetadataStore(client.db("metadata_store_test"), metadataCollections);
    await store.ensureIndexes();

    await store.createRun({
      runId: "run-1",
      migrationId: "20260511120000-first",
      startedAt: new Date("2026-05-11T12:00:00.000Z"),
      resumedFromCheckpoint: true,
      warnings: ["resuming from checkpoint"]
    });

    await store.updateRunProgress("run-1", {
      matchedDocs: 20,
      modifiedDocs: 10,
      batchCount: 2
    });

    const succeeded = await store.completeRun("run-1", {
      modifiedDocs: 20,
      finishedAt: new Date("2026-05-11T12:01:00.000Z")
    });

    expect(succeeded).toMatchObject({
      runId: "run-1",
      migrationId: "20260511120000-first",
      status: "succeeded",
      resumedFromCheckpoint: true,
      matchedDocs: 20,
      modifiedDocs: 20,
      failedDocs: 0,
      batchCount: 2,
      warnings: ["resuming from checkpoint"]
    });

    await store.createRun({
      runId: "run-2",
      migrationId: "20260511130000-second",
      startedAt: new Date("2026-05-11T13:00:00.000Z")
    });

    const failed = await store.failRun("run-2", {
      matchedDocs: 5,
      failedDocs: 1,
      error: { message: "transform failed" },
      finishedAt: new Date("2026-05-11T13:01:00.000Z")
    });

    expect(failed).toMatchObject({
      runId: "run-2",
      status: "failed",
      matchedDocs: 5,
      failedDocs: 1,
      error: { message: "transform failed" }
    });
    expect((await store.listRuns()).map((run) => run.runId)).toEqual(["run-1", "run-2"]);
  });

  it("upserts checkpoints and returns checkpoint history in deterministic order", async () => {
    const store = createMongoMetadataStore(client.db("metadata_store_test"), metadataCollections);
    await store.ensureIndexes();

    await store.saveCheckpoint({
      runId: "run-1",
      migrationId: "20260511120000-first",
      batchNumber: 2,
      lastProcessedId: new ObjectId("000000000000000000000002"),
      processedCount: 200,
      updatedAt: new Date("2026-05-11T12:02:00.000Z")
    });
    await store.saveCheckpoint({
      runId: "run-1",
      migrationId: "20260511120000-first",
      batchNumber: 1,
      lastProcessedId: new ObjectId("000000000000000000000001"),
      processedCount: 100,
      updatedAt: new Date("2026-05-11T12:01:00.000Z")
    });
    await store.saveCheckpoint({
      runId: "run-1",
      migrationId: "20260511120000-first",
      batchNumber: 2,
      lastProcessedId: new ObjectId("000000000000000000000003"),
      processedCount: 250,
      updatedAt: new Date("2026-05-11T12:03:00.000Z")
    });

    const checkpoints = await store.listCheckpointsForRun("run-1");
    const latest = await store.getLatestCheckpointForMigration("20260511120000-first");

    expect(checkpoints.map((checkpoint) => checkpoint.batchNumber)).toEqual([1, 2]);
    expect(checkpoints[1]).toMatchObject({
      batchNumber: 2,
      processedCount: 250
    });
    expect(latest).toMatchObject({
      runId: "run-1",
      batchNumber: 2,
      processedCount: 250
    });
  });
});
