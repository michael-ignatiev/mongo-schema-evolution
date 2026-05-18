import type { MongoEvolutionConfig } from "./types.js";

export const CONFIG_FILE_NAME = ".mongo-evolution.json";

export const DEFAULT_METADATA_COLLECTION_PREFIX = "_schema";

export function createDefaultConfig(): MongoEvolutionConfig {
  return {
    mongoUri: "mongodb://localhost:27017",
    dbName: "mongo_evolution_demo",
    migrationsDir: "./migrations",
    defaultBatchSize: 500,
    metadataCollectionPrefix: DEFAULT_METADATA_COLLECTION_PREFIX,
    metadataCollections: {
      migrations: `${DEFAULT_METADATA_COLLECTION_PREFIX}_migrations`,
      runs: `${DEFAULT_METADATA_COLLECTION_PREFIX}_migration_runs`,
      checkpoints: `${DEFAULT_METADATA_COLLECTION_PREFIX}_migration_checkpoints`
    },
    environment: "local"
  };
}
