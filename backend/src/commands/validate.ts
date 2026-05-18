import type { Command } from "commander";

import { withMongoCommand } from "../cli/mongoCommand.js";
import { formatValidationResult } from "../cli/outputFormatters.js";
import {
  MigrationNotFoundError,
  MigrationValidationUnavailableError,
  validateMigration
} from "../core/safety/index.js";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .requiredOption("--migration <id>", "migration id to validate")
    .description("Run validation checks for a migration.")
    .action(async (options: { migration: string }) => {
      try {
        const result = await withMongoCommand(({ config, db }) =>
          validateMigration({
            config,
            db,
            migrationId: options.migration
          })
        );
        formatValidationResult(result).forEach((line) => console.log(line));

        if (!result.passed) {
          process.exitCode = 1;
        }
      } catch (error) {
        if (
          error instanceof MigrationNotFoundError ||
          error instanceof MigrationValidationUnavailableError
        ) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });
}
