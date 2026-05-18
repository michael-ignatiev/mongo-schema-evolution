import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ResolvedMongoEvolutionConfig } from "../../config/index.js";
import type { MetadataStore } from "../metadata/index.js";
import type { MigrationDefinition, MigrationMode } from "./types.js";

const MIGRATION_FILE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);
const MIGRATION_ID_PATTERN = /^\d{14}-[a-z0-9][a-z0-9-]*$/;
const MIGRATION_MODES = new Set<MigrationMode>(["online", "offline", "lazy-compatible"]);

export type DiscoveredMigration = {
  id: string;
  filePath: string;
  migration: MigrationDefinition;
};

export class MigrationDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationDiscoveryError";
  }
}

export async function discoverMigrations(migrationsPath: string): Promise<DiscoveredMigration[]> {
  const filePaths = await discoverMigrationFiles(migrationsPath);
  const migrations = await Promise.all(filePaths.map(loadMigrationFile));

  return sortMigrations(validateUniqueMigrationIds(migrations));
}

export async function discoverConfiguredMigrations(
  config: ResolvedMongoEvolutionConfig
): Promise<DiscoveredMigration[]> {
  return discoverMigrations(config.migrationsPath);
}

export async function discoverMigrationFiles(migrationsPath: string): Promise<string[]> {
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  const discovered: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(migrationsPath, entry.name);

    if (entry.isDirectory()) {
      discovered.push(...await discoverMigrationFiles(entryPath));
      continue;
    }

    if (entry.isFile() && isMigrationFile(entry.name)) {
      discovered.push(entryPath);
    }
  }

  return discovered.sort((left, right) => left.localeCompare(right));
}

export async function loadMigrationFile(filePath: string): Promise<DiscoveredMigration> {
  const fileStats = await stat(filePath);
  const fileUrl = pathToFileURL(filePath);
  fileUrl.hash = `mtime-${Math.trunc(fileStats.mtimeMs)}`;

  const module = await import(fileUrl.href) as { default?: unknown };
  const migration = validateMigrationDefinition(module.default, filePath);

  return {
    id: migration.id,
    filePath,
    migration
  };
}

export function validateMigrationDefinition(
  value: unknown,
  filePath: string
): MigrationDefinition {
  if (!isObject(value)) {
    throw new MigrationDiscoveryError(`${filePath} must export a migration object as default`);
  }

  const migration = value as Partial<MigrationDefinition>;

  assertNonEmptyString(migration.id, "id", filePath);
  assertNonEmptyString(migration.description, "description", filePath);
  assertNonEmptyString(migration.collection, "collection", filePath);

  if (!MIGRATION_ID_PATTERN.test(migration.id)) {
    throw new MigrationDiscoveryError(
      `${filePath} has invalid migration id "${migration.id}". Expected YYYYMMDDHHmmss-slug`
    );
  }

  if (!MIGRATION_MODES.has(migration.mode as MigrationMode)) {
    throw new MigrationDiscoveryError(
      `${filePath} has invalid mode "${String(migration.mode)}"`
    );
  }

  if (
    migration.batchSize !== undefined &&
    (!Number.isInteger(migration.batchSize) || migration.batchSize <= 0)
  ) {
    throw new MigrationDiscoveryError(`${filePath} batchSize must be a positive integer`);
  }

  if (migration.schemaVersion !== undefined) {
    validateSchemaVersion(migration.schemaVersion, filePath);
  }

  if (typeof migration.match !== "function") {
    throw new MigrationDiscoveryError(`${filePath} match must be a function`);
  }

  if (typeof migration.transform !== "function") {
    throw new MigrationDiscoveryError(`${filePath} transform must be a function`);
  }

  if (migration.validate !== undefined && typeof migration.validate !== "function") {
    throw new MigrationDiscoveryError(`${filePath} validate must be a function when provided`);
  }

  return migration as MigrationDefinition;
}

export function sortMigrations(migrations: DiscoveredMigration[]): DiscoveredMigration[] {
  return [...migrations].sort((left, right) => {
    const byId = left.id.localeCompare(right.id);

    if (byId !== 0) {
      return byId;
    }

    return left.filePath.localeCompare(right.filePath);
  });
}

export async function filterUnappliedMigrations(
  migrations: DiscoveredMigration[],
  metadataStore: Pick<MetadataStore, "isMigrationApplied">
): Promise<DiscoveredMigration[]> {
  const pending: DiscoveredMigration[] = [];

  for (const migration of sortMigrations(migrations)) {
    if (!await metadataStore.isMigrationApplied(migration.id)) {
      pending.push(migration);
    }
  }

  return pending;
}

export async function discoverUnappliedMigrations(
  migrationsPath: string,
  metadataStore: Pick<MetadataStore, "isMigrationApplied">
): Promise<DiscoveredMigration[]> {
  return filterUnappliedMigrations(await discoverMigrations(migrationsPath), metadataStore);
}

export async function discoverConfiguredUnappliedMigrations(
  config: ResolvedMongoEvolutionConfig,
  metadataStore: Pick<MetadataStore, "isMigrationApplied">
): Promise<DiscoveredMigration[]> {
  return discoverUnappliedMigrations(config.migrationsPath, metadataStore);
}

function validateUniqueMigrationIds(migrations: DiscoveredMigration[]): DiscoveredMigration[] {
  const seen = new Map<string, string>();

  for (const migration of migrations) {
    const previousPath = seen.get(migration.id);

    if (previousPath !== undefined) {
      throw new MigrationDiscoveryError(
        `Duplicate migration id "${migration.id}" in ${previousPath} and ${migration.filePath}`
      );
    }

    seen.set(migration.id, migration.filePath);
  }

  return migrations;
}

function isMigrationFile(fileName: string): boolean {
  if (fileName.endsWith(".d.ts")) {
    return false;
  }

  return MIGRATION_FILE_EXTENSIONS.has(path.extname(fileName));
}

function assertNonEmptyString(value: unknown, field: string, filePath: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MigrationDiscoveryError(`${filePath} ${field} must be a non-empty string`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateSchemaVersion(value: unknown, filePath: string): void {
  if (!isObject(value)) {
    throw new MigrationDiscoveryError(`${filePath} schemaVersion must be an object when provided`);
  }

  if (value.field !== undefined && (typeof value.field !== "string" || value.field.trim() === "")) {
    throw new MigrationDiscoveryError(`${filePath} schemaVersion.field must be a non-empty string`);
  }

  if (value.from !== undefined && !Number.isInteger(value.from)) {
    throw new MigrationDiscoveryError(`${filePath} schemaVersion.from must be an integer`);
  }

  if (!Number.isInteger(value.to)) {
    throw new MigrationDiscoveryError(`${filePath} schemaVersion.to must be an integer`);
  }
}
