import type { Db, MongoClient } from "mongodb";

import {
  type ResolvedMongoEvolutionConfig,
  loadConfig
} from "../config/index.js";
import {
  type MongoMetadataStore,
  createMongoMetadataStore
} from "../core/metadata/index.js";
import { connectMongo } from "../core/mongo/index.js";

export type MongoCommandContext = {
  config: ResolvedMongoEvolutionConfig;
  client: MongoClient;
  db: Db;
  metadataStore: MongoMetadataStore;
};

export async function withMongoCommand<T>(
  handler: (context: MongoCommandContext) => Promise<T>
): Promise<T> {
  const config = await loadConfig();
  const client = await connectMongo(config);

  try {
    const db = client.db(config.dbName);
    const metadataStore = createMongoMetadataStore(db, config.metadataCollections);

    return await handler({
      config,
      client,
      db,
      metadataStore
    });
  } finally {
    await client.close();
  }
}
