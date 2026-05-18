import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { initConfig, loadConfig } from "../src/config/index.js";
import { createMongoMetadataStore } from "../src/core/metadata/index.js";
import { dryRunMigration } from "../src/core/safety/index.js";

const tempDirs: string[] = [];

describe("dry-run", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 60_000);

  beforeEach(async () => {
    await client.db("dry_run_test").dropDatabase();
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

  it("counts and samples matching documents without mutating data", async () => {
    const { config } = await createProjectConfig(server.getUri());
    await writeMigration(config.migrationsPath, "20260511120000-preview-users.ts", `
export default {
  id: "20260511120000-preview-users",
  description: "preview users",
  collection: "users",
  mode: "lazy-compatible",
  batchSize: 100,
  match() {
    return { name: { $exists: true } };
  },
  transform() {
    throw new Error("dry-run must not call transform");
  }
};
`);

    const db = client.db(config.dbName);
    await db.collection("users").insertMany([
      { _id: "user-2", name: "Grace Hopper", email: "grace@example.com" },
      { _id: "user-1", name: "Ada Lovelace", email: "ada@example.com" },
      { _id: "user-3", profile: { fullName: "Already Migrated" } }
    ]);
    const before = await db.collection("users").find().sort({ _id: 1 }).toArray();
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);

    const result = await dryRunMigration({
      config,
      db,
      metadataStore,
      migrationId: "20260511120000-preview-users",
      sampleSize: 1
    });
    const after = await db.collection("users").find().sort({ _id: 1 }).toArray();

    expect(result).toMatchObject({
      migrationId: "20260511120000-preview-users",
      collection: "users",
      mode: "lazy-compatible",
      batchSize: 100,
      matchedDocs: 2,
      alreadyApplied: false
    });
    expect(result.sampleDocs).toHaveLength(1);
    expect(result.sampleDocs[0]).toMatchObject({ _id: "user-1", name: "Ada Lovelace" });
    expect(result.warnings).toEqual([
      {
        code: "mixed_versions_expected",
        message: "Migration is lazy-compatible; old and new document shapes may coexist during rollout."
      }
    ]);
    expect(after).toEqual(before);
  });

  it("emits warnings for already-applied migrations and no matches", async () => {
    const { config } = await createProjectConfig(server.getUri());
    await writeMigration(config.migrationsPath, "20260511120000-no-matches.ts", `
export default {
  id: "20260511120000-no-matches",
  description: "no matches",
  collection: "users",
  mode: "online",
  match() {
    return { missing: true };
  },
  transform(document) {
    return document;
  }
};
`);

    const db = client.db(config.dbName);
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);
    await metadataStore.ensureIndexes();
    await metadataStore.recordAppliedMigration({
      migrationId: "20260511120000-no-matches",
      description: "no matches",
      collection: "users",
      mode: "online",
      runId: "run-1"
    });

    const result = await dryRunMigration({
      config,
      db,
      metadataStore,
      migrationId: "20260511120000-no-matches"
    });

    expect(result.matchedDocs).toBe(0);
    expect(result.sampleDocs).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "already_applied",
      "no_matches",
      "no_batch_size"
    ]);
  });
});

async function createProjectConfig(mongoUri: string) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-dry-run-"));
  tempDirs.push(cwd);
  const { config } = await initConfig({ cwd });
  const rawConfig = JSON.parse(await readFile(config.configPath, "utf8")) as Record<string, unknown>;

  rawConfig.mongoUri = mongoUri;
  rawConfig.dbName = "dry_run_test";
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
