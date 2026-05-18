import { Command } from "commander";

import { registerCreateCommand } from "../commands/create.js";
import { registerDryRunCommand } from "../commands/dryRun.js";
import { registerHistoryCommand } from "../commands/history.js";
import { registerInitCommand } from "../commands/init.js";
import { registerUpCommand } from "../commands/up.js";
import { registerValidateCommand } from "../commands/validate.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("mongo-evolution")
    .description("CLI-first MongoDB schema evolution and migration safety toolkit.")
    .version("0.1.0");

  registerInitCommand(program);
  registerCreateCommand(program);
  registerDryRunCommand(program);
  registerUpCommand(program);
  registerValidateCommand(program);
  registerHistoryCommand(program);

  return program;
}
