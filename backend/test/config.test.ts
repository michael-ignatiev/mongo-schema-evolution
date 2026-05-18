import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONFIG_FILE_NAME,
  ConfigAlreadyExistsError,
  createDefaultConfig,
  initConfig,
  loadConfig
} from "../src/config/index.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mongo-evolution-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, {
    force: true,
    recursive: true
  })));
});

describe("config initialization", () => {
  it("creates the default config file and migrations directory", async () => {
    const cwd = await createTempDir();

    const result = await initConfig({ cwd });
    const rawConfig = await readFile(path.join(cwd, CONFIG_FILE_NAME), "utf8");
    const parsedConfig = JSON.parse(rawConfig) as ReturnType<typeof createDefaultConfig>;

    expect(result.createdConfig).toBe(true);
    expect(result.createdMigrationsDir).toBe(true);
    expect(parsedConfig).toEqual(createDefaultConfig());
    await expect(loadConfig({ cwd })).resolves.toMatchObject({
      mongoUri: "mongodb://localhost:27017",
      dbName: "mongo_evolution_demo",
      migrationsDir: "./migrations",
      defaultBatchSize: 500,
      metadataCollectionPrefix: "_schema",
      metadataCollections: {
        migrations: "_schema_migrations",
        runs: "_schema_migration_runs",
        checkpoints: "_schema_migration_checkpoints"
      },
      environment: "local",
      configPath: path.join(cwd, CONFIG_FILE_NAME),
      migrationsPath: path.join(cwd, "migrations")
    });
  });

  it("does not overwrite an existing config by default", async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, CONFIG_FILE_NAME), "{}\n");

    await expect(initConfig({ cwd })).rejects.toBeInstanceOf(ConfigAlreadyExistsError);
  });
});
