import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { CONFIG_FILE_NAME, createDefaultConfig } from "./defaultConfig.js";
import { ConfigAlreadyExistsError } from "./errors.js";
import { resolveConfig } from "./loadConfig.js";
import type { InitConfigResult } from "./types.js";

export type InitConfigOptions = {
  cwd?: string;
  configFileName?: string;
  force?: boolean;
};

export async function initConfig(
  options: InitConfigOptions = {}
): Promise<InitConfigResult> {
  const cwd = options.cwd ?? process.cwd();
  const configFileName = options.configFileName ?? CONFIG_FILE_NAME;
  const configPath = path.resolve(cwd, configFileName);
  const configExists = await pathExists(configPath);

  if (configExists && !options.force) {
    throw new ConfigAlreadyExistsError(configPath);
  }

  const config = resolveConfig(createDefaultConfig(), configPath);

  const migrationsDirExists = await pathExists(config.migrationsPath);

  await mkdir(config.migrationsPath, { recursive: true });

  if (!configExists || options.force) {
    await writeFile(configPath, `${JSON.stringify(stripResolvedFields(config), null, 2)}\n`, {
      flag: "w"
    });
  }

  return {
    config,
    createdConfig: !configExists || Boolean(options.force),
    createdMigrationsDir: !migrationsDirExists
  };
}

function stripResolvedFields(config: InitConfigResult["config"]) {
  const { configPath: _configPath, migrationsPath: _migrationsPath, ...rawConfig } = config;
  return rawConfig;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
