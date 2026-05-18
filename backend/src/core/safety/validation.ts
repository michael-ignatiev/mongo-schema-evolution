import {
  type ValidationResult,
  discoverConfiguredMigrations
} from "../migrations/index.js";
import {
  MigrationNotFoundError
} from "./dryRun.js";
import type {
  MigrationValidationResult,
  ValidateMigrationOptions
} from "./types.js";

export class MigrationValidationUnavailableError extends Error {
  constructor(migrationId: string) {
    super(`Migration ${migrationId} does not define validate logic`);
    this.name = "MigrationValidationUnavailableError";
  }
}

export class InvalidValidationResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidValidationResultError";
  }
}

export async function validateMigration(
  options: ValidateMigrationOptions
): Promise<MigrationValidationResult> {
  const discoveredMigrations = await discoverConfiguredMigrations(options.config);
  const discoveredMigration = discoveredMigrations.find(
    (migration) => migration.id === options.migrationId
  );

  if (discoveredMigration === undefined) {
    throw new MigrationNotFoundError(options.migrationId);
  }

  const { migration } = discoveredMigration;

  if (migration.validate === undefined) {
    throw new MigrationValidationUnavailableError(migration.id);
  }

  const result = await migration.validate({
    db: options.db,
    migration
  });

  validateValidationResult(result, migration.id);

  return {
    ...result,
    migrationId: migration.id,
    collection: migration.collection,
    mode: migration.mode
  };
}

function validateValidationResult(
  result: ValidationResult,
  migrationId: string
): void {
  if (typeof result !== "object" || result === null) {
    throw new InvalidValidationResultError(
      `Migration ${migrationId} validate must return a validation result object`
    );
  }

  if (typeof result.passed !== "boolean") {
    throw new InvalidValidationResultError(
      `Migration ${migrationId} validation result passed must be a boolean`
    );
  }

  for (const field of ["checkedDocs", "validDocs", "invalidDocs"] as const) {
    if (!Number.isInteger(result[field]) || result[field] < 0) {
      throw new InvalidValidationResultError(
        `Migration ${migrationId} validation result ${field} must be a non-negative integer`
      );
    }
  }

  if (result.validDocs + result.invalidDocs !== result.checkedDocs) {
    throw new InvalidValidationResultError(
      `Migration ${migrationId} validation counts must satisfy validDocs + invalidDocs === checkedDocs`
    );
  }

  if (!Array.isArray(result.errors)) {
    throw new InvalidValidationResultError(
      `Migration ${migrationId} validation result errors must be an array`
    );
  }

  for (const error of result.errors) {
    if (
      typeof error !== "object" ||
      error === null ||
      typeof error.message !== "string" ||
      error.message.trim() === ""
    ) {
      throw new InvalidValidationResultError(
        `Migration ${migrationId} validation errors must include non-empty messages`
      );
    }
  }

  if (typeof result.summary !== "string" || result.summary.trim() === "") {
    throw new InvalidValidationResultError(
      `Migration ${migrationId} validation result summary must be a non-empty string`
    );
  }

  if (result.warnings !== undefined && !Array.isArray(result.warnings)) {
    throw new InvalidValidationResultError(
      `Migration ${migrationId} validation result warnings must be an array when provided`
    );
  }
}
