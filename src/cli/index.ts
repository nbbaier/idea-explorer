import { Command } from "commander";
import { createConfigCommand } from "./commands/config.js";
import { createInitCommand } from "./commands/init.js";
import { createStatusCommand } from "./commands/status.js";
import { createSubmitCommand } from "./commands/submit.js";

const program = new Command();

program
  .name("idea")
  .description("CLI for submitting ideas to the idea-explorer worker API")
  .version("1.0.0");

program.addCommand(createSubmitCommand());
program.addCommand(createStatusCommand());
program.addCommand(createInitCommand());
program.addCommand(createConfigCommand());

program.parse();
