import type { Document } from "mongodb";

import type { MigrationMode } from "../migrations/index.js";

export type MigrationRunStatus = "running" | "succeeded" | "failed";

export type MigrationErrorRecord = {
  message: string;
  stack?: string;
};

export type AppliedMigrationRecord = {
  migrationId: string;
  description: string;
  collection: string;
  mode: MigrationMode;
  appliedAt: Date;
  runId: string;
  checksum?: string;
};

export type MigrationRunRecord = {
  runId: string;
  migrationId: string;
  status: MigrationRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  resumedFromCheckpoint: boolean;
  matchedDocs: number;
  modifiedDocs: number;
  failedDocs: number;
  batchCount: number;
  warnings: string[];
  error?: MigrationErrorRecord;
};

export type MigrationCheckpointRecord = {
  runId: string;
  migrationId: string;
  batchNumber: number;
  lastProcessedId: unknown;
  processedCount: number;
  modifiedCount?: number;
  failedCount?: number;
  updatedAt: Date;
};

export type RecordAppliedMigrationInput = Omit<AppliedMigrationRecord, "appliedAt"> & {
  appliedAt?: Date;
};

export type CreateMigrationRunInput = {
  runId?: string;
  migrationId: string;
  startedAt?: Date;
  resumedFromCheckpoint?: boolean;
  warnings?: string[];
};

export type MigrationRunProgress = Partial<
  Pick<MigrationRunRecord, "matchedDocs" | "modifiedDocs" | "failedDocs" | "batchCount" | "warnings">
>;

export type CompleteMigrationRunInput = MigrationRunProgress & {
  finishedAt?: Date;
};

export type FailMigrationRunInput = MigrationRunProgress & {
  finishedAt?: Date;
  error: MigrationErrorRecord;
};

export type SaveCheckpointInput = Omit<MigrationCheckpointRecord, "updatedAt"> & {
  updatedAt?: Date;
};

export type MetadataCollections = {
  migrations: string;
  runs: string;
  checkpoints: string;
};

export type MetadataStore = {
  ensureIndexes(): Promise<void>;
  recordAppliedMigration(input: RecordAppliedMigrationInput): Promise<AppliedMigrationRecord>;
  isMigrationApplied(migrationId: string): Promise<boolean>;
  getAppliedMigration(migrationId: string): Promise<AppliedMigrationRecord | null>;
  listAppliedMigrations(): Promise<AppliedMigrationRecord[]>;
  createRun(input: CreateMigrationRunInput): Promise<MigrationRunRecord>;
  getRun(runId: string): Promise<MigrationRunRecord | null>;
  listRuns(migrationId?: string): Promise<MigrationRunRecord[]>;
  updateRunProgress(runId: string, progress: MigrationRunProgress): Promise<MigrationRunRecord>;
  completeRun(runId: string, input?: CompleteMigrationRunInput): Promise<MigrationRunRecord>;
  failRun(runId: string, input: FailMigrationRunInput): Promise<MigrationRunRecord>;
  saveCheckpoint(input: SaveCheckpointInput): Promise<MigrationCheckpointRecord>;
  listCheckpointsForRun(runId: string): Promise<MigrationCheckpointRecord[]>;
  getLatestCheckpointForMigration(migrationId: string): Promise<MigrationCheckpointRecord | null>;
};

export type MetadataDocument<T> = T & Document;
