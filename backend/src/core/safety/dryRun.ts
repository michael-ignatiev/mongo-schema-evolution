import type { Document, Filter } from "mongodb";

import {
  type MetadataStore,
  createMongoMetadataStore
} from "../metadata/index.js";
import {
  MigrationDiscoveryError,
  discoverConfiguredMigrations
} from "../migrations/index.js";
import type {
  DryRunMigrationOptions,
  DryRunResult,
  DryRunWarning
} from "./types.js";

const DEFAULT_SAMPLE_SIZE = 5;

export class MigrationNotFoundError extends Error {
  constructor(migrationId: string) {
    super(`Migration not found: ${migrationId}`);
    this.name = "MigrationNotFoundError";
  }
}

export async function dryRunMigration(
  options: DryRunMigrationOptions
): Promise<DryRunResult> {
  const sampleSize = normalizeSampleSize(options.sampleSize);
  const metadataStore = options.metadataStore
    ?? createMongoMetadataStore(options.db, options.config.metadataCollections);

  await metadataStore.ensureIndexes();

  const discoveredMigrations = await discoverConfiguredMigrations(options.config);
  const discoveredMigration = discoveredMigrations.find(
    (migration) => migration.id === options.migrationId
  );

  if (discoveredMigration === undefined) {
    throw new MigrationNotFoundError(options.migrationId);
  }

  const { migration } = discoveredMigration;
  const ctx = {
    db: options.db,
    migration
  };
  const filter = await migration.match(ctx) as Filter<Document>;
  const collection = options.db.collection(migration.collection);
  const [matchedDocs, sampleDocs, alreadyApplied] = await Promise.all([
    collection.countDocuments(filter),
    collection
      .find(filter)
      .sort({ _id: 1 })
      .limit(sampleSize)
      .toArray(),
    metadataStore.isMigrationApplied(migration.id)
  ]);

  return {
    migrationId: migration.id,
    description: migration.description,
    collection: migration.collection,
    mode: migration.mode,
    batchSize: migration.batchSize,
    filter,
    matchedDocs,
    sampleDocs,
    alreadyApplied,
    warnings: buildDryRunWarnings({
      alreadyApplied,
      batchSize: migration.batchSize,
      matchedDocs,
      mode: migration.mode
    })
  };
}

type BuildWarningsOptions = Pick<
  DryRunResult,
  "alreadyApplied" | "batchSize" | "matchedDocs" | "mode"
>;

function buildDryRunWarnings(options: BuildWarningsOptions): DryRunWarning[] {
  const warnings: DryRunWarning[] = [];

  if (options.alreadyApplied) {
    warnings.push({
      code: "already_applied",
      message: "This migration is already recorded as applied."
    });
  }

  if (options.matchedDocs === 0) {
    warnings.push({
      code: "no_matches",
      message: "No documents currently match this migration."
    });
  }

  if (options.batchSize === undefined) {
    warnings.push({
      code: "no_batch_size",
      message: "Migration does not define batchSize; runner defaults will apply when batching is enabled."
    });
  }

  if (options.mode === "offline") {
    warnings.push({
      code: "offline_mode",
      message: "Migration is marked offline; application writes should be stopped or coordinated before execution."
    });
  }

  if (options.mode === "lazy-compatible") {
    warnings.push({
      code: "mixed_versions_expected",
      message: "Migration is lazy-compatible; old and new document shapes may coexist during rollout."
    });
  }

  return warnings;
}

function normalizeSampleSize(sampleSize: number | undefined): number {
  if (sampleSize === undefined) {
    return DEFAULT_SAMPLE_SIZE;
  }

  if (!Number.isInteger(sampleSize) || sampleSize < 0) {
    throw new MigrationDiscoveryError("sampleSize must be a non-negative integer");
  }

  return sampleSize;
}
