import type { Document, Filter, ObjectId, WithId } from "mongodb";

import {
  type MetadataStore,
  createMongoMetadataStore
} from "../metadata/index.js";
import {
  type DiscoveredMigration,
  discoverConfiguredUnappliedMigrations
} from "../migrations/index.js";
import type {
  MigrationExecutionSummary,
  RunMigrationsOptions,
  RunMigrationsResult
} from "./types.js";

export class MigrationExecutionError extends Error {
  readonly summary: MigrationExecutionSummary;
  readonly cause: unknown;

  constructor(summary: MigrationExecutionSummary, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Migration ${summary.migrationId} failed: ${reason}`);
    this.name = "MigrationExecutionError";
    this.summary = summary;
    this.cause = cause;
  }
}

export async function runMigrations(
  options: RunMigrationsOptions
): Promise<RunMigrationsResult> {
  const metadataStore = options.metadataStore
    ?? createMongoMetadataStore(options.db, options.config.metadataCollections);

  await metadataStore.ensureIndexes();

  const migrations = await discoverConfiguredUnappliedMigrations(options.config, metadataStore);
  const appliedMigrations: MigrationExecutionSummary[] = [];

  for (const discoveredMigration of migrations) {
    const summary = await executeMigration({
      config: options.config,
      discoveredMigration,
      db: options.db,
      metadataStore
    });

    appliedMigrations.push(summary);
  }

  return {
    discoveredMigrations: migrations.length,
    appliedMigrations
  };
}

type ExecuteMigrationOptions = {
  config: RunMigrationsOptions["config"];
  discoveredMigration: DiscoveredMigration;
  db: RunMigrationsOptions["db"];
  metadataStore: MetadataStore;
};

async function executeMigration(
  options: ExecuteMigrationOptions
): Promise<MigrationExecutionSummary> {
  const { migration } = options.discoveredMigration;
  const resumeCheckpoint = await options.metadataStore.getLatestCheckpointForMigration(migration.id);
  const resumedFromCheckpoint = resumeCheckpoint !== null;
  const run = await options.metadataStore.createRun({
    migrationId: migration.id,
    resumedFromCheckpoint,
    warnings: resumedFromCheckpoint
      ? [`Resuming from checkpoint after _id ${String(resumeCheckpoint.lastProcessedId)}`]
      : []
  });
  const collection = options.db.collection(migration.collection);
  const batchSize = migration.batchSize ?? options.config.defaultBatchSize;
  const ctx = {
    db: options.db,
    migration
  };

  let matchedDocs = resumeCheckpoint?.processedCount ?? 0;
  let modifiedDocs = resumeCheckpoint?.modifiedCount ?? 0;
  let failedDocs = resumeCheckpoint?.failedCount ?? 0;
  let batchCount = resumeCheckpoint?.batchNumber ?? 0;

  try {
    const filter = await migration.match(ctx);
    const retrySafeFilter = buildRetrySafeFilter(filter as Filter<Document>, migration.id);

    validateBatchSize(batchSize, migration.id);

    let lastProcessedId = resumeCheckpoint?.lastProcessedId as DocumentId | undefined;

    while (true) {
      const batchFilter = buildBatchFilter(retrySafeFilter, lastProcessedId);
      const documents = await collection
        .find(batchFilter)
        .sort({ _id: 1 })
        .limit(getRemainingBatchCapacity(matchedDocs, batchSize))
        .toArray();

      if (documents.length === 0) {
        break;
      }

      for (const document of documents) {
        matchedDocs += 1;

        try {
          const transformed = await migration.transform(document as WithId<Document>, ctx);

          if (transformed !== null) {
            const replacement = markDocumentMigrated(
              preserveDocumentId(document as WithId<Document>, transformed),
              migration.id,
              run.runId
            );
            const update = await collection.replaceOne(
              buildReplacementFilter(document._id as DocumentId, migration.id),
              replacement
            );
            modifiedDocs += update.modifiedCount;
          }

          lastProcessedId = document._id;
          batchCount = getBatchNumber(matchedDocs, batchSize);

          await options.metadataStore.saveCheckpoint({
            runId: run.runId,
            migrationId: migration.id,
            batchNumber: batchCount,
            lastProcessedId,
            processedCount: matchedDocs,
            modifiedCount: modifiedDocs,
            failedCount: failedDocs
          });

          await options.metadataStore.updateRunProgress(run.runId, {
            matchedDocs,
            modifiedDocs,
            failedDocs,
            batchCount
          });
        } catch (error) {
          failedDocs += 1;
          throw error;
        }
      }
    }

    await options.metadataStore.completeRun(run.runId, {
      matchedDocs,
      modifiedDocs,
      failedDocs,
      batchCount
    });

    await options.metadataStore.recordAppliedMigration({
      migrationId: migration.id,
      description: migration.description,
      collection: migration.collection,
      mode: migration.mode,
      runId: run.runId
    });

    return {
      migrationId: migration.id,
      runId: run.runId,
      status: "succeeded",
      resumedFromCheckpoint,
      matchedDocs,
      modifiedDocs,
      failedDocs,
      batchCount,
      batchSize
    };
  } catch (error) {
    const summary: MigrationExecutionSummary = {
      migrationId: migration.id,
      runId: run.runId,
      status: "failed",
      resumedFromCheckpoint,
      matchedDocs,
      modifiedDocs,
      failedDocs,
      batchCount,
      batchSize
    };

    await options.metadataStore.failRun(run.runId, {
      matchedDocs,
      modifiedDocs,
      failedDocs,
      batchCount,
      error: toErrorRecord(error)
    });

    throw new MigrationExecutionError(summary, error);
  }
}

function preserveDocumentId(original: WithId<Document>, transformed: Document): Document {
  return {
    ...transformed,
    _id: original._id
  };
}

type DocumentId = string | number | ObjectId | Date;

const TOOLKIT_METADATA_FIELD = "_mongoEvolution";

function buildRetrySafeFilter(
  filter: Filter<Document>,
  migrationId: string
): Filter<Document> {
  return {
    $and: [
      filter,
      migrationMarkerMissingFilter(migrationId)
    ]
  };
}

function buildBatchFilter(
  filter: Filter<Document>,
  lastProcessedId: DocumentId | undefined
): Filter<Document> {
  if (lastProcessedId === undefined) {
    return filter;
  }

  return {
    $and: [
      filter,
      { _id: { $gt: lastProcessedId } } as Filter<Document>
    ]
  };
}

function buildReplacementFilter(
  documentId: DocumentId,
  migrationId: string
): Filter<Document> {
  return {
    $and: [
      { _id: documentId } as Filter<Document>,
      migrationMarkerMissingFilter(migrationId)
    ]
  };
}

function migrationMarkerMissingFilter(migrationId: string): Filter<Document> {
  return {
    [`${TOOLKIT_METADATA_FIELD}.appliedMigrations.${migrationId}`]: { $exists: false }
  };
}

function markDocumentMigrated(document: Document, migrationId: string, runId: string): Document {
  const existingMetadata = getObject(document[TOOLKIT_METADATA_FIELD]);
  const existingAppliedMigrations = getObject(existingMetadata.appliedMigrations);

  return {
    ...document,
    [TOOLKIT_METADATA_FIELD]: {
      ...existingMetadata,
      appliedMigrations: {
        ...existingAppliedMigrations,
        [migrationId]: {
          runId,
          appliedAt: new Date()
        }
      }
    }
  };
}

function getObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validateBatchSize(batchSize: number, migrationId: string): void {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`Migration ${migrationId} resolved batchSize must be a positive integer`);
  }
}

function getBatchNumber(processedCount: number, batchSize: number): number {
  return Math.ceil(processedCount / batchSize);
}

function getRemainingBatchCapacity(processedCount: number, batchSize: number): number {
  const processedInCurrentBatch = processedCount % batchSize;

  return processedInCurrentBatch === 0
    ? batchSize
    : batchSize - processedInCurrentBatch;
}

function toErrorRecord(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return { message: String(error) };
}
