import type { RunMigrationsResult } from "../core/runner/index.js";
import type {
  DryRunResult,
  MigrationValidationResult
} from "../core/safety/index.js";

export function formatUpResult(result: RunMigrationsResult): string[] {
  const lines = result.appliedMigrations.map((migration) =>
    `Applied migration ${migration.migrationId}: ${migration.modifiedDocs}/${migration.matchedDocs} documents modified`
  );

  lines.push(`Applied ${result.appliedMigrations.length} migrations successfully`);

  return lines;
}

export function formatDryRunResult(result: DryRunResult): string[] {
  return [
    `Dry-run: ${result.matchedDocs} documents matched in ${result.collection}`,
    `Migration: ${result.migrationId}`,
    `Mode: ${result.mode}`,
    `Sample documents: ${result.sampleDocs.length}`,
    ...result.warnings.map((warning) => `Warning [${warning.code}]: ${warning.message}`)
  ];
}

export function formatValidationResult(result: MigrationValidationResult): string[] {
  const status = result.passed ? "passed" : "failed";
  const lines = [
    `Validation ${status}: ${result.validDocs}/${result.checkedDocs} documents valid`,
    `Migration: ${result.migrationId}`,
    `Invalid documents: ${result.invalidDocs}`,
    `Summary: ${result.summary}`
  ];

  for (const error of result.errors) {
    const location = error.documentId === undefined
      ? ""
      : ` [document ${String(error.documentId)}]`;
    lines.push(`Violation${location}: ${error.message}`);
  }

  return lines;
}
