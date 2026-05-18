export type MetadataCollectionSettings = {
  migrations: string;
  runs: string;
  checkpoints: string;
};

export type MongoEvolutionConfig = {
  mongoUri: string;
  dbName: string;
  migrationsDir: string;
  defaultBatchSize: number;
  metadataCollectionPrefix: string;
  metadataCollections: MetadataCollectionSettings;
  environment: string;
};

export type ResolvedMongoEvolutionConfig = MongoEvolutionConfig & {
  configPath: string;
  migrationsPath: string;
};

export type InitConfigResult = {
  config: ResolvedMongoEvolutionConfig;
  createdConfig: boolean;
  createdMigrationsDir: boolean;
};
