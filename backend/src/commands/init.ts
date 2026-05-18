import type { Command } from "commander";

import { ConfigAlreadyExistsError, initConfig } from "../config/index.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .option("--force", "overwrite an existing config file")
    .description("Initialize mongo-evolution config and migrations directory.")
    .action(async (options: { force?: boolean }) => {
      try {
        const result = await initConfig({ force: Boolean(options.force) });

        console.log(`Initialized mongo-evolution in ${result.config.configPath}`);
        console.log(`Migrations directory: ${result.config.migrationsPath}`);
      } catch (error) {
        if (error instanceof ConfigAlreadyExistsError) {
          console.error(`${error.message}. Use --force to overwrite it.`);
          process.exitCode = 1;
          return;
        }

        throw error;
      }
    });
}
