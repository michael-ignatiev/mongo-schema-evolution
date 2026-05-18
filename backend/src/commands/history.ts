import type { Command } from "commander";

import { formatMigrationHistory } from "../cli/historyFormatter.js";
import { withMongoCommand } from "../cli/mongoCommand.js";
import { getMigrationHistory } from "../core/history/index.js";

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("Show migration history from MongoDB metadata collections.")
    .action(async () => {
      const history = await withMongoCommand(({ metadataStore }) =>
        getMigrationHistory({ metadataStore })
      );

      console.log(formatMigrationHistory(history));
    });
}
