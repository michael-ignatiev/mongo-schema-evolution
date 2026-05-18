import type { Db } from "mongodb";

import type { ResolvedMongoEvolutionConfig } from "../../config/index.js";
import type { MetadataStore } from "../metadata/index.js";

export type MigrationExecutionStatus = "succeeded" | "failed";

export type MigrationExecutionSummary = {
  migrationId: string;
  runId: string;
  status: MigrationExecutionStatus;
  resumedFromCheckpoint: boolean;
  matchedDocs: number;
  modifiedDocs: number;
  failedDocs: number;
  batchCount: number;
  batchSize: number;
};

export type RunMigrationsResult = {
  discoveredMigrations: number;
  appliedMigrations: MigrationExecutionSummary[];
};

export type RunMigrationsOptions = {
  config: ResolvedMongoEvolutionConfig;
  db: Db;
  metadataStore?: MetadataStore;
};
