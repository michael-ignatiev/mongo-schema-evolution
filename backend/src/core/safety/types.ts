import type { Document, Filter } from "mongodb";

import type { ResolvedMongoEvolutionConfig } from "../../config/index.js";
import type { MetadataStore } from "../metadata/index.js";
import type {
  MigrationMode,
  ValidationResult
} from "../migrations/index.js";

export type DryRunWarning = {
  code: string;
  message: string;
};

export type DryRunResult = {
  migrationId: string;
  description: string;
  collection: string;
  mode: MigrationMode;
  batchSize?: number;
  filter: Filter<Document>;
  matchedDocs: number;
  sampleDocs: Document[];
  alreadyApplied: boolean;
  warnings: DryRunWarning[];
};

export type DryRunMigrationOptions = {
  config: ResolvedMongoEvolutionConfig;
  db: import("mongodb").Db;
  migrationId: string;
  metadataStore?: Pick<MetadataStore, "ensureIndexes" | "isMigrationApplied">;
  sampleSize?: number;
};

export type ValidateMigrationOptions = {
  config: ResolvedMongoEvolutionConfig;
  db: import("mongodb").Db;
  migrationId: string;
};

export type MigrationValidationResult = ValidationResult & {
  migrationId: string;
  collection: string;
  mode: MigrationMode;
};
