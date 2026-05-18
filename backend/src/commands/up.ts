import type { Command } from "commander";

import { withMongoCommand } from "../cli/mongoCommand.js";
import { formatUpResult } from "../cli/outputFormatters.js";
import { MigrationExecutionError, runMigrations } from "../core/runner/index.js";

export function registerUpCommand(program: Command): void {
  program
    .command("up")
    .description("Apply unapplied migrations in order.")
    .action(async () => {
      try {
        const result = await withMongoCommand(({ config, db, metadataStore }) =>
          runMigrations({ config, db, metadataStore })
        );
        formatUpResult(result).forEach((line) => console.log(line));
      } catch (error) {
        if (error instanceof MigrationExecutionError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });
}
