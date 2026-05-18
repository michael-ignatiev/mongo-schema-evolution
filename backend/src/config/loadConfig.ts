import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { CONFIG_FILE_NAME } from "./defaultConfig.js";
import { ConfigNotFoundError, InvalidConfigError } from "./errors.js";
import type { MongoEvolutionConfig, ResolvedMongoEvolutionConfig } from "./types.js";

export type LoadConfigOptions = {
  cwd?: string;
  configFileName?: string;
};

export async function loadConfig(
  options: LoadConfigOptions = {}
): Promise<ResolvedMongoEvolutionConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = path.resolve(cwd, options.configFileName ?? CONFIG_FILE_NAME);

  try {
    await access(configPath);
  } catch {
    throw new ConfigNotFoundError(configPath);
  }

  const rawConfig = await readFile(configPath, "utf8");
  const parsedConfig = parseConfig(rawConfig, configPath);

  return resolveConfig(parsedConfig, configPath);
}

export function resolveConfig(
  config: MongoEvolutionConfig,
  configPath: string
): ResolvedMongoEvolutionConfig {
  validateConfig(config, configPath);

  return {
    ...config,
    configPath,
    migrationsPath: path.resolve(path.dirname(configPath), config.migrationsDir)
  };
}

function parseConfig(rawConfig: string, configPath: string): MongoEvolutionConfig {
  try {
    return JSON.parse(rawConfig) as MongoEvolutionConfig;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown parse error";
    throw new InvalidConfigError(`Invalid JSON in ${configPath}: ${reason}`);
  }
}

function validateConfig(
  config: MongoEvolutionConfig,
  configPath: string
): asserts config is MongoEvolutionConfig {
  const requiredStringFields: Array<keyof MongoEvolutionConfig> = [
    "mongoUri",
    "dbName",
    "migrationsDir",
    "metadataCollectionPrefix",
    "environment"
  ];

  for (const field of requiredStringFields) {
    if (typeof config[field] !== "string" || config[field].trim() === "") {
      throw new InvalidConfigError(
        `Invalid ${configPath}: ${String(field)} must be a non-empty string`
      );
    }
  }

  if (
    typeof config.defaultBatchSize !== "number" ||
    !Number.isInteger(config.defaultBatchSize) ||
    config.defaultBatchSize <= 0
  ) {
    throw new InvalidConfigError(
      `Invalid ${configPath}: defaultBatchSize must be a positive integer`
    );
  }

  if (typeof config.metadataCollections !== "object" || config.metadataCollections === null) {
    throw new InvalidConfigError(
      `Invalid ${configPath}: metadataCollections must be an object`
    );
  }

  for (const field of ["migrations", "runs", "checkpoints"] as const) {
    if (
      typeof config.metadataCollections[field] !== "string" ||
      config.metadataCollections[field].trim() === ""
    ) {
      throw new InvalidConfigError(
        `Invalid ${configPath}: metadataCollections.${field} must be a non-empty string`
      );
    }
  }
}
