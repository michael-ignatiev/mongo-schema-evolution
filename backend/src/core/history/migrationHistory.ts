import type {
  GetMigrationHistoryOptions,
  MigrationHistory
} from "./types.js";

export async function getMigrationHistory(
  options: GetMigrationHistoryOptions
): Promise<MigrationHistory> {
  await options.metadataStore.ensureIndexes();

  const [appliedMigrations, runs] = await Promise.all([
    options.metadataStore.listAppliedMigrations(),
    options.metadataStore.listRuns()
  ]);

  return {
    appliedMigrations,
    runs
  };
}
