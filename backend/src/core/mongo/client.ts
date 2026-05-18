import { MongoClient } from "mongodb";

import type { ResolvedMongoEvolutionConfig } from "../../config/index.js";

export async function connectMongo(config: ResolvedMongoEvolutionConfig): Promise<MongoClient> {
  return MongoClient.connect(config.mongoUri);
}
