import type { MigrationHistory } from "../core/history/index.js";
import type {
  AppliedMigrationRecord,
  MigrationRunRecord
} from "../core/metadata/index.js";

export function formatMigrationHistory(history: MigrationHistory): string {
  const lines = ["Migration history", ""];

  lines.push("Applied migrations:");
  if (history.appliedMigrations.length === 0) {
    lines.push("  none");
  } else {
    for (const migration of history.appliedMigrations) {
      lines.push(formatAppliedMigration(migration));
      lines.push(`  description: ${migration.description}`);
    }
  }

  lines.push("");
  lines.push("Runs:");
  if (history.runs.length === 0) {
    lines.push("  none");
  } else {
    for (const run of history.runs) {
      lines.push(formatRun(run));
      if (run.error !== undefined) {
        lines.push(`  error: ${run.error.message}`);
      }
    }
  }

  return lines.join("\n");
}

function formatAppliedMigration(migration: AppliedMigrationRecord): string {
  return [
    `- ${migration.migrationId}`,
    `collection=${migration.collection}`,
    `mode=${migration.mode}`,
    `appliedAt=${formatDate(migration.appliedAt)}`,
    `runId=${migration.runId}`
  ].join(" | ");
}

function formatRun(run: MigrationRunRecord): string {
  return [
    `- ${run.migrationId}`,
    `status=${run.status}`,
    `runId=${run.runId}`,
    `startedAt=${formatDate(run.startedAt)}`,
    `finishedAt=${formatDate(run.finishedAt)}`,
    `matched=${run.matchedDocs}`,
    `modified=${run.modifiedDocs}`,
    `failed=${run.failedDocs}`,
    `batches=${run.batchCount}`,
    `resumed=${run.resumedFromCheckpoint ? "yes" : "no"}`
  ].join(" | ");
}

function formatDate(date: Date | undefined): string {
  return date === undefined ? "pending" : date.toISOString();
}
