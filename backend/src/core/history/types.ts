import type {
  AppliedMigrationRecord,
  MetadataStore,
  MigrationRunRecord
} from "../metadata/index.js";

export type MigrationHistory = {
  appliedMigrations: AppliedMigrationRecord[];
  runs: MigrationRunRecord[];
};

export type GetMigrationHistoryOptions = {
  metadataStore: Pick<MetadataStore, "ensureIndexes" | "listAppliedMigrations" | "listRuns">;
};
