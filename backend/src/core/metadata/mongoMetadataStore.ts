import { randomUUID } from "node:crypto";

import type { Collection, Db, Filter, OptionalUnlessRequiredId } from "mongodb";

import type {
  AppliedMigrationRecord,
  CompleteMigrationRunInput,
  CreateMigrationRunInput,
  FailMigrationRunInput,
  MetadataCollections,
  MetadataDocument,
  MetadataStore,
  MigrationCheckpointRecord,
  MigrationRunProgress,
  MigrationRunRecord,
  RecordAppliedMigrationInput,
  SaveCheckpointInput
} from "./types.js";

export class MetadataRecordNotFoundError extends Error {
  constructor(recordType: string, id: string) {
    super(`${recordType} not found: ${id}`);
    this.name = "MetadataRecordNotFoundError";
  }
}

export class MongoMetadataStore implements MetadataStore {
  private readonly migrations: Collection<MetadataDocument<AppliedMigrationRecord>>;
  private readonly runs: Collection<MetadataDocument<MigrationRunRecord>>;
  private readonly checkpoints: Collection<MetadataDocument<MigrationCheckpointRecord>>;

  constructor(db: Db, collections: MetadataCollections) {
    this.migrations = db.collection(collections.migrations);
    this.runs = db.collection(collections.runs);
    this.checkpoints = db.collection(collections.checkpoints);
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.migrations.createIndex({ migrationId: 1 }, { unique: true }),
      this.migrations.createIndex({ appliedAt: 1, migrationId: 1 }),
      this.runs.createIndex({ runId: 1 }, { unique: true }),
      this.runs.createIndex({ migrationId: 1, startedAt: 1, runId: 1 }),
      this.checkpoints.createIndex({ runId: 1, batchNumber: 1 }, { unique: true }),
      this.checkpoints.createIndex({ migrationId: 1, updatedAt: -1, batchNumber: -1 })
    ]);
  }

  async recordAppliedMigration(
    input: RecordAppliedMigrationInput
  ): Promise<AppliedMigrationRecord> {
    const record: AppliedMigrationRecord = {
      ...input,
      appliedAt: input.appliedAt ?? new Date()
    };

    await this.migrations.insertOne(record as OptionalUnlessRequiredId<MetadataDocument<AppliedMigrationRecord>>);

    return record;
  }

  async isMigrationApplied(migrationId: string): Promise<boolean> {
    const count = await this.migrations.countDocuments({ migrationId }, { limit: 1 });

    return count > 0;
  }

  async getAppliedMigration(migrationId: string): Promise<AppliedMigrationRecord | null> {
    return this.migrations.findOne(
      { migrationId },
      { projection: { _id: 0 } }
    );
  }

  async listAppliedMigrations(): Promise<AppliedMigrationRecord[]> {
    return this.migrations
      .find({}, { projection: { _id: 0 } })
      .sort({ migrationId: 1 })
      .toArray();
  }

  async createRun(input: CreateMigrationRunInput): Promise<MigrationRunRecord> {
    const record: MigrationRunRecord = {
      runId: input.runId ?? randomUUID(),
      migrationId: input.migrationId,
      status: "running",
      startedAt: input.startedAt ?? new Date(),
      resumedFromCheckpoint: input.resumedFromCheckpoint ?? false,
      matchedDocs: 0,
      modifiedDocs: 0,
      failedDocs: 0,
      batchCount: 0,
      warnings: input.warnings ?? []
    };

    await this.runs.insertOne(record as OptionalUnlessRequiredId<MetadataDocument<MigrationRunRecord>>);

    return record;
  }

  async getRun(runId: string): Promise<MigrationRunRecord | null> {
    return this.runs.findOne(
      { runId },
      { projection: { _id: 0 } }
    );
  }

  async listRuns(migrationId?: string): Promise<MigrationRunRecord[]> {
    const filter: Filter<MetadataDocument<MigrationRunRecord>> = migrationId
      ? { migrationId }
      : {};

    return this.runs
      .find(filter, { projection: { _id: 0 } })
      .sort({ startedAt: 1, migrationId: 1, runId: 1 })
      .toArray();
  }

  async updateRunProgress(
    runId: string,
    progress: MigrationRunProgress
  ): Promise<MigrationRunRecord> {
    return this.updateRun(runId, progress);
  }

  async completeRun(
    runId: string,
    input: CompleteMigrationRunInput = {}
  ): Promise<MigrationRunRecord> {
    return this.updateRun(runId, {
      ...input,
      status: "succeeded",
      finishedAt: input.finishedAt ?? new Date()
    });
  }

  async failRun(runId: string, input: FailMigrationRunInput): Promise<MigrationRunRecord> {
    return this.updateRun(runId, {
      ...input,
      status: "failed",
      finishedAt: input.finishedAt ?? new Date()
    });
  }

  async saveCheckpoint(input: SaveCheckpointInput): Promise<MigrationCheckpointRecord> {
    const record: MigrationCheckpointRecord = {
      ...input,
      updatedAt: input.updatedAt ?? new Date()
    };

    await this.checkpoints.replaceOne(
      { runId: record.runId, batchNumber: record.batchNumber },
      record,
      { upsert: true }
    );

    return record;
  }

  async listCheckpointsForRun(runId: string): Promise<MigrationCheckpointRecord[]> {
    return this.checkpoints
      .find({ runId }, { projection: { _id: 0 } })
      .sort({ batchNumber: 1 })
      .toArray();
  }

  async getLatestCheckpointForMigration(
    migrationId: string
  ): Promise<MigrationCheckpointRecord | null> {
    return this.checkpoints.findOne(
      { migrationId },
      {
        projection: { _id: 0 },
        sort: { updatedAt: -1, batchNumber: -1, runId: 1 }
      }
    );
  }

  private async updateRun(
    runId: string,
    patch: Partial<MigrationRunRecord>
  ): Promise<MigrationRunRecord> {
    const updated = await this.runs.findOneAndUpdate(
      { runId },
      { $set: patch },
      {
        projection: { _id: 0 },
        returnDocument: "after"
      }
    );

    if (!updated) {
      throw new MetadataRecordNotFoundError("migration run", runId);
    }

    return updated;
  }
}

export function createMongoMetadataStore(
  db: Db,
  collections: MetadataCollections
): MongoMetadataStore {
  return new MongoMetadataStore(db, collections);
}
