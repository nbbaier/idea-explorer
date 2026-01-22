import { Command } from "commander";
import {
  CONFIGURABLE_KEYS,
  getConfigValue,
  isValidConfigKey,
  loadConfig,
  setConfigValue,
  unsetConfigValue,
} from "../lib/config.js";
import { outputConfigList, outputConfigValue } from "../lib/output.js";

function listAction(): void {
  const config = loadConfig();
  outputConfigList(config);
}

function getAction(key: string): void {
  if (!isValidConfigKey(key)) {
    console.error(
      `Unknown config key: ${key}. Valid keys: ${CONFIGURABLE_KEYS.join(", ")}`
    );
    process.exit(1);
  }

  const value = getConfigValue(key);
  outputConfigValue(key, value);
}

function setAction(key: string, value: string): void {
  if (!isValidConfigKey(key)) {
    console.error(
      `Unknown config key: ${key}. Valid keys: ${CONFIGURABLE_KEYS.join(", ")}`
    );
    process.exit(1);
  }

  try {
    setConfigValue(key, value);
    console.log(`Set ${key}=${value}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function unsetAction(key: string): void {
  if (!isValidConfigKey(key)) {
    console.error(
      `Unknown config key: ${key}. Valid keys: ${CONFIGURABLE_KEYS.join(", ")}`
    );
    process.exit(1);
  }

  try {
    unsetConfigValue(key);
    console.log(`Unset ${key}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export function createConfigCommand(): Command {
  const config = new Command("config").description("Manage configuration");

  config
    .command("list")
    .description("Show all current configuration values")
    .action(listAction);

  config
    .command("get")
    .description("Get a specific config value")
    .argument("<key>", `Config key (${CONFIGURABLE_KEYS.join(", ")})`)
    .action(getAction);

  config
    .command("set")
    .description("Set a config value")
    .argument("<key>", `Config key (${CONFIGURABLE_KEYS.join(", ")})`)
    .argument("<value>", "Config value")
    .action(setAction);

  config
    .command("unset")
    .description("Remove a config value")
    .argument("<key>", `Config key (${CONFIGURABLE_KEYS.join(", ")})`)
    .action(unsetAction);

  return config;
}
