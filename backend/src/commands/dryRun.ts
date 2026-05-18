import type { Command } from "commander";

import { withMongoCommand } from "../cli/mongoCommand.js";
import { formatDryRunResult } from "../cli/outputFormatters.js";
import { MigrationNotFoundError, dryRunMigration } from "../core/safety/index.js";

export function registerDryRunCommand(program: Command): void {
  program
    .command("dry-run")
    .requiredOption("--migration <id>", "migration id to preview")
    .option("--sample-size <count>", "number of matching documents to sample", parseSampleSize)
    .description("Preview a migration without mutating data.")
    .action(async (options: { migration: string; sampleSize?: number }) => {
      try {
        const result = await withMongoCommand(({ config, db, metadataStore }) =>
          dryRunMigration({
            config,
            db,
            metadataStore,
            migrationId: options.migration,
            sampleSize: options.sampleSize
          })
        );
        formatDryRunResult(result).forEach((line) => console.log(line));
      } catch (error) {
        if (error instanceof MigrationNotFoundError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });
}

function parseSampleSize(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--sample-size must be a non-negative integer");
  }

  return parsed;
}
