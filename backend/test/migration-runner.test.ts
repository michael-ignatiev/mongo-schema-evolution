import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { initConfig, loadConfig } from "../src/config/index.js";
import { createMongoMetadataStore } from "../src/core/metadata/index.js";
import { MigrationExecutionError, runMigrations } from "../src/core/runner/index.js";

const tempDirs: string[] = [];

describe("migration runner", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("runner_test").dropDatabase();
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

  it("applies unapplied migrations in deterministic order and records success", async () => {
    const { config } = await createProjectConfig(server.getUri());
    await writeMigration(config.migrationsPath, "20260511130000-add-active.ts", `
export default {
  id: "20260511130000-add-active",
  description: "add active",
  collection: "users",
  mode: "online",
  match() {
    return { schemaVersion: 2 };
  },
  transform(document) {
    return { ...document, active: true, schemaVersion: 3 };
  }
};
`);
    await writeMigration(config.migrationsPath, "20260511120000-move-name.ts", `
export default {
  id: "20260511120000-move-name",
  description: "move name",
  collection: "users",
  mode: "online",
  match() {
    return { name: { $exists: true } };
  },
  transform(document) {
    const { name, ...rest } = document;
    return {
      ...rest,
      profile: { fullName: name },
      schemaVersion: 2
    };
  }
};
`);

    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
      { _id: "user-2", name: "Grace Hopper", email: "grace@example.com" }
    ]);

    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);
    const result = await runMigrations({ config, db, metadataStore });
    const users = await db.collection("users").find().sort({ _id: 1 }).toArray();
    const runs = await metadataStore.listRuns();
    const applied = await metadataStore.listAppliedMigrations();

    expect(result.appliedMigrations.map((migration) => migration.migrationId)).toEqual([
      "20260511120000-move-name",
      "20260511130000-add-active"
    ]);
    expect(result.appliedMigrations).toEqual([
      expect.objectContaining({
        status: "succeeded",
        matchedDocs: 2,
        modifiedDocs: 2,
        failedDocs: 0
      }),
      expect.objectContaining({
        status: "succeeded",
        matchedDocs: 2,
        modifiedDocs: 2,
        failedDocs: 0
      })
    ]);
    expect(users).toEqual([
      expect.objectContaining({
        _id: "user-1",
        email: "ada@example.com",
        profile: { fullName: "Ada Lovelace" },
        active: true,
        schemaVersion: 3
      }),
      expect.objectContaining({
        _id: "user-2",
        email: "grace@example.com",
        profile: { fullName: "Grace Hopper" },
        active: true,
        schemaVersion: 3
      })
    ]);
    expect(users[0]).not.toHaveProperty("name");
    expect(runs.map((run) => run.status)).toEqual(["succeeded", "succeeded"]);
    expect(applied.map((migration) => migration.migrationId)).toEqual([
      "20260511120000-move-name",
      "20260511130000-add-active"
    ]);
  });

  it("skips already-applied migrations", async () => {
    const { config } = await createProjectConfig(server.getUri());
    await writeMigration(config.migrationsPath, "20260511120000-skip-me.ts", `
export default {
  id: "20260511120000-skip-me",
  description: "skip me",
  collection: "users",
  mode: "online",
  match() {
    return {};
  },
  transform(document) {
    return { ...document, shouldNotExist: true };
  }
};
`);

    const db = client.db(config.dbName);
    await db.collection("users").insertOne({ _id: "user-1", name: "Ada" });
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);
    await metadataStore.ensureIndexes();
    await metadataStore.recordAppliedMigration({
      migrationId: "20260511120000-skip-me",
      description: "skip me",
      collection: "users",
      mode: "online",
      runId: "previous-run"
    });

    const result = await runMigrations({ config, db, metadataStore });
    const user = await db.collection("users").findOne({ _id: "user-1" });

    expect(result.appliedMigrations).toEqual([]);
    expect(user).not.toHaveProperty("shouldNotExist");
    expect(await metadataStore.listRuns()).toEqual([]);
  });

  it("processes a migration in multiple configured batches and records progress", async () => {
    const { config } = await createProjectConfig(server.getUri(), { defaultBatchSize: 2 });
    await writeMigration(config.migrationsPath, "20260511120000-batched.ts", `
export default {
  id: "20260511120000-batched",
  description: "batched",
  collection: "users",
  mode: "online",
  match() {
    return { migrated: { $ne: true } };
  },
  transform(document) {
    return { ...document, migrated: true };
  }
};
`);

    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-1", name: "User 1" },
      { _id: "user-2", name: "User 2" },
      { _id: "user-3", name: "User 3" },
      { _id: "user-4", name: "User 4" },
      { _id: "user-5", name: "User 5" }
    ]);
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);

    const result = await runMigrations({ config, db, metadataStore });
    const run = (await metadataStore.listRuns())[0];
    const migratedCount = await db.collection("users").countDocuments({ migrated: true });

    expect(result.appliedMigrations).toEqual([
      expect.objectContaining({
        migrationId: "20260511120000-batched",
        status: "succeeded",
        matchedDocs: 5,
        modifiedDocs: 5,
        failedDocs: 0,
        batchCount: 3,
        batchSize: 2
      })
    ]);
    expect(run).toMatchObject({
      migrationId: "20260511120000-batched",
      status: "succeeded",
      matchedDocs: 5,
      modifiedDocs: 5,
      failedDocs: 0,
      batchCount: 3
    });
    expect(migratedCount).toBe(5);
  });

  it("uses migration batchSize before the configured default batch size", async () => {
    const { config } = await createProjectConfig(server.getUri(), { defaultBatchSize: 10 });
    await writeMigration(config.migrationsPath, "20260511120000-migration-batch-size.ts", `
export default {
  id: "20260511120000-migration-batch-size",
  description: "migration batch size",
  collection: "users",
  mode: "online",
  batchSize: 2,
  match() {
    return {};
  },
  transform(document) {
    return { ...document, migrated: true };
  }
};
`);

    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-1" },
      { _id: "user-2" },
      { _id: "user-3" }
    ]);
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);

    const result = await runMigrations({ config, db, metadataStore });

    expect(result.appliedMigrations[0]).toMatchObject({
      batchCount: 2,
      batchSize: 2,
      matchedDocs: 3,
      modifiedDocs: 3
    });
  });

  it("resumes from the latest checkpoint after a failed batched migration", async () => {
    const { config } = await createProjectConfig(server.getUri(), { defaultBatchSize: 2 });
    await writeMigration(config.migrationsPath, "20260511120000-resumable.ts", `
export default {
  id: "20260511120000-resumable",
  description: "resumable",
  collection: "users",
  mode: "online",
  match() {
    return {};
  },
  async transform(document, ctx) {
    const control = await ctx.db.collection("controls").findOne({ _id: "failure" });

    if (document._id === "user-4" && control?.enabled === true) {
      throw new Error("planned failure on user-4");
    }

    return {
      ...document,
      migrated: true,
      migrationCount: (document.migrationCount ?? 0) + 1
    };
  }
};
`);

    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-1" },
      { _id: "user-2" },
      { _id: "user-3" },
      { _id: "user-4" },
      { _id: "user-5" }
    ]);
    await db.collection("controls").insertOne({ _id: "failure", enabled: true });
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);

    await expect(runMigrations({ config, db, metadataStore })).rejects.toBeInstanceOf(
      MigrationExecutionError
    );

    const failedRuns = await metadataStore.listRuns();
    const failedRunCheckpoints = await metadataStore.listCheckpointsForRun(failedRuns[0]?.runId ?? "");
    const latestFailedCheckpoint = await metadataStore.getLatestCheckpointForMigration(
      "20260511120000-resumable"
    );

    expect(failedRuns).toHaveLength(1);
    expect(failedRuns[0]).toMatchObject({
      migrationId: "20260511120000-resumable",
      status: "failed",
      resumedFromCheckpoint: false,
      matchedDocs: 4,
      modifiedDocs: 3,
      failedDocs: 1,
      batchCount: 2
    });
    expect(failedRunCheckpoints.map((checkpoint) => checkpoint.batchNumber)).toEqual([1, 2]);
    expect(latestFailedCheckpoint).toMatchObject({
      migrationId: "20260511120000-resumable",
      batchNumber: 2,
      lastProcessedId: "user-3",
      processedCount: 3,
      modifiedCount: 3,
      failedCount: 0
    });

    await db.collection("controls").updateOne(
      { _id: "failure" },
      { $set: { enabled: false } }
    );

    const retryResult = await runMigrations({ config, db, metadataStore });
    const runs = await metadataStore.listRuns();
    const users = await db.collection("users").find().sort({ _id: 1 }).toArray();
    const applied = await metadataStore.listAppliedMigrations();
    const latestCheckpoint = await metadataStore.getLatestCheckpointForMigration(
      "20260511120000-resumable"
    );

    expect(retryResult.appliedMigrations).toEqual([
      expect.objectContaining({
        migrationId: "20260511120000-resumable",
        status: "succeeded",
        resumedFromCheckpoint: true,
        matchedDocs: 5,
        modifiedDocs: 5,
        failedDocs: 0,
        batchCount: 3,
        batchSize: 2
      })
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({
      migrationId: "20260511120000-resumable",
      status: "succeeded",
      resumedFromCheckpoint: true,
      matchedDocs: 5,
      modifiedDocs: 5,
      failedDocs: 0,
      batchCount: 3
    });
    expect(users.map((user) => user.migrationCount)).toEqual([1, 1, 1, 1, 1]);
    expect(applied.map((migration) => migration.migrationId)).toEqual([
      "20260511120000-resumable"
    ]);
    expect(latestCheckpoint).toMatchObject({
      migrationId: "20260511120000-resumable",
      batchNumber: 3,
      lastProcessedId: "user-5",
      processedCount: 5,
      modifiedCount: 5,
      failedCount: 0
    });
  });

  it("uses document migration markers to avoid double-transforming when checkpoints are unavailable", async () => {
    const { config } = await createProjectConfig(server.getUri(), { defaultBatchSize: 10 });
    await writeMigration(config.migrationsPath, "20260511120000-marker-safe.ts", `
export default {
  id: "20260511120000-marker-safe",
  description: "marker safe",
  collection: "users",
  mode: "online",
  schemaVersion: { field: "schemaVersion", from: 1, to: 2 },
  match() {
    return {};
  },
  async transform(document, ctx) {
    const control = await ctx.db.collection("controls").findOne({ _id: "failure" });

    if (document._id === "user-3" && control?.enabled === true) {
      throw new Error("planned failure on user-3");
    }

    return {
      ...document,
      schemaVersion: 2,
      migrationCount: (document.migrationCount ?? 0) + 1
    };
  }
};
`);

    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-1", schemaVersion: 1 },
      { _id: "user-2", schemaVersion: 1 },
      { _id: "user-3", schemaVersion: 1 },
      { _id: "user-4", schemaVersion: 1 }
    ]);
    await db.collection("controls").insertOne({ _id: "failure", enabled: true });
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);

    await expect(runMigrations({ config, db, metadataStore })).rejects.toBeInstanceOf(
      MigrationExecutionError
    );

    await db.collection(config.metadataCollections.checkpoints).deleteMany({});
    await db.collection("controls").updateOne(
      { _id: "failure" },
      { $set: { enabled: false } }
    );

    const retryResult = await runMigrations({ config, db, metadataStore });
    const users = await db.collection("users").find().sort({ _id: 1 }).toArray();

    expect(retryResult.appliedMigrations[0]).toMatchObject({
      migrationId: "20260511120000-marker-safe",
      status: "succeeded",
      resumedFromCheckpoint: false,
      matchedDocs: 2,
      modifiedDocs: 2
    });
    expect(users.map((user) => user.migrationCount)).toEqual([1, 1, 1, 1]);
    expect(users.every((user) =>
      user._mongoEvolution?.appliedMigrations?.["20260511120000-marker-safe"] !== undefined
    )).toBe(true);
  });

  it("marks failed runs explicitly and does not mark the migration as applied", async () => {
    const { config } = await createProjectConfig(server.getUri());
    await writeMigration(config.migrationsPath, "20260511120000-fails.ts", `
export default {
  id: "20260511120000-fails",
  description: "fails",
  collection: "users",
  mode: "online",
  match() {
    return {};
  },
  transform(document) {
    if (document._id === "user-2") {
      throw new Error("cannot migrate user-2");
    }

    return { ...document, migrated: true };
  }
};
`);

    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-1", name: "Ada" },
      { _id: "user-2", name: "Grace" }
    ]);
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);

    await expect(runMigrations({ config, db, metadataStore })).rejects.toBeInstanceOf(
      MigrationExecutionError
    );

    const runs = await metadataStore.listRuns();
    const applied = await metadataStore.listAppliedMigrations();
    const users = await db.collection("users").find().sort({ _id: 1 }).toArray();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      migrationId: "20260511120000-fails",
      status: "failed",
      matchedDocs: 2,
      modifiedDocs: 1,
      failedDocs: 1,
      error: { message: "cannot migrate user-2" }
    });
    expect(applied).toEqual([]);
    expect(users[0]).toMatchObject({ _id: "user-1", migrated: true });
    expect(users[1]).not.toHaveProperty("migrated");
  });
});

async function createProjectConfig(
  mongoUri: string,
  overrides: Partial<{ defaultBatchSize: number }> = {}
) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-runner-"));
  tempDirs.push(cwd);
  const { config } = await initConfig({ cwd });
  const rawConfig = JSON.parse(await readFile(config.configPath, "utf8")) as Record<string, unknown>;

  rawConfig.mongoUri = mongoUri;
  rawConfig.dbName = "runner_test";
  Object.assign(rawConfig, overrides);
  await writeFile(config.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`);

  return {
    cwd,
    config: await loadConfig({ cwd })
  };
}

async function writeMigration(
  migrationsPath: string,
  fileName: string,
  source: string
): Promise<void> {
  await mkdir(migrationsPath, { recursive: true });
  await writeFile(path.join(migrationsPath, fileName), source);
}
