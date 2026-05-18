import type { Command } from "commander";

import {
  InvalidMigrationNameError,
  createMigration
} from "../core/migrations/index.js";

export function registerCreateCommand(program: Command): void {
  program
    .command("create")
    .argument("<name>", "human-readable migration name")
    .description("Scaffold a timestamped migration file.")
    .action(async (name: string) => {
      try {
        const result = await createMigration({ name });

        console.log(`Created migration ${result.id}`);
        console.log(`File: ${result.filePath}`);
      } catch (error) {
        if (error instanceof InvalidMigrationNameError) {
          console.error(error.message);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });
}
