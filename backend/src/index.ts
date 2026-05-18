export { createCli } from "./cli/createCli.js";
export {
  CONFIG_FILE_NAME,
  ConfigAlreadyExistsError,
  ConfigNotFoundError,
  InvalidConfigError,
  createDefaultConfig,
  initConfig,
  loadConfig
} from "./config/index.js";
export type {
  InitConfigResult,
  MetadataCollectionSettings,
  MongoEvolutionConfig,
  ResolvedMongoEvolutionConfig
} from "./config/index.js";
export { formatMigrationHistory } from "./cli/historyFormatter.js";
export {
  getMigrationHistory
} from "./core/history/index.js";
export {
  formatDryRunResult,
  formatUpResult,
  formatValidationResult
} from "./cli/outputFormatters.js";
export {
  withMongoCommand
} from "./cli/mongoCommand.js";
export type {
  MongoCommandContext
} from "./cli/mongoCommand.js";
export type {
  GetMigrationHistoryOptions,
  MigrationHistory
} from "./core/history/index.js";
export {
  InvalidMigrationNameError,
  MigrationDiscoveryError,
  createMigration,
  discoverConfiguredMigrations,
  discoverConfiguredUnappliedMigrations,
  discoverMigrationFiles,
  discoverMigrations,
  discoverUnappliedMigrations,
  filterUnappliedMigrations,
  formatTimestamp,
  loadMigrationFile,
  sortMigrations,
  slugifyMigrationName
} from "./core/migrations/index.js";
export type {
  CreateMigrationOptions,
  CreateMigrationResult,
  DiscoveredMigration,
  MigrationContext,
  MigrationDefinition,
  MigrationMetadata,
  MigrationMode,
  ValidationContext,
  ValidationIssue,
  ValidationResult
} from "./core/migrations/index.js";
export {
  MetadataRecordNotFoundError,
  MongoMetadataStore,
  createMongoMetadataStore
} from "./core/metadata/index.js";
export type {
  AppliedMigrationRecord,
  CompleteMigrationRunInput,
  CreateMigrationRunInput,
  FailMigrationRunInput,
  MetadataCollections,
  MetadataStore,
  MigrationCheckpointRecord,
  MigrationErrorRecord,
  MigrationRunProgress,
  MigrationRunRecord,
  MigrationRunStatus,
  RecordAppliedMigrationInput,
  SaveCheckpointInput
} from "./core/metadata/index.js";
export { connectMongo } from "./core/mongo/index.js";
export {
  MigrationExecutionError,
  runMigrations
} from "./core/runner/index.js";
export type {
  MigrationExecutionStatus,
  MigrationExecutionSummary,
  RunMigrationsOptions,
  RunMigrationsResult
} from "./core/runner/index.js";
export {
  InvalidValidationResultError,
  MigrationNotFoundError,
  MigrationValidationUnavailableError,
  dryRunMigration,
  validateMigration
} from "./core/safety/index.js";
export type {
  DryRunMigrationOptions,
  DryRunResult,
  DryRunWarning,
  MigrationValidationResult,
  ValidateMigrationOptions
} from "./core/safety/index.js";
