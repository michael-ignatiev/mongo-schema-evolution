import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../../config/index.js";
import { renderMigrationTemplate } from "../../templates/migrationTemplate.js";

export type CreateMigrationOptions = {
  name: string;
  cwd?: string;
  now?: Date;
};

export type CreateMigrationResult = {
  id: string;
  filePath: string;
};

export class InvalidMigrationNameError extends Error {
  constructor(name: string) {
    super(`Migration name must contain at least one letter or number: ${name}`);
    this.name = "InvalidMigrationNameError";
  }
}

export async function createMigration(
  options: CreateMigrationOptions
): Promise<CreateMigrationResult> {
  const config = await loadConfig({ cwd: options.cwd });
  const slug = slugifyMigrationName(options.name);
  const id = `${formatTimestamp(options.now ?? new Date())}-${slug}`;
  const filePath = path.join(config.migrationsPath, `${id}.ts`);
  const source = renderMigrationTemplate({
    id,
    description: options.name.trim(),
    typeImportPath: toTypeImportPath(
      path.relative(
        config.migrationsPath,
        path.resolve(path.dirname(config.configPath), "src/core/migrations/types.js")
      )
    )
  });

  await mkdir(config.migrationsPath, { recursive: true });
  await writeFile(filePath, source, { flag: "wx" });

  return { id, filePath };
}

export function slugifyMigrationName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    throw new InvalidMigrationNameError(name);
  }

  return slug;
}

export function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = padDatePart(date.getUTCMonth() + 1);
  const day = padDatePart(date.getUTCDate());
  const hour = padDatePart(date.getUTCHours());
  const minute = padDatePart(date.getUTCMinutes());
  const second = padDatePart(date.getUTCSeconds());

  return `${year}${month}${day}${hour}${minute}${second}`;
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

function toTypeImportPath(relativePath: string): string {
  const importPath = relativePath.split(path.sep).join("/");

  return importPath.startsWith(".") ? importPath : `./${importPath}`;
}
