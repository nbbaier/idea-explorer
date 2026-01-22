import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ModelSchema, ModeSchema } from "@/types/api";

const CONFIG_DIR = join(homedir(), ".config", "idea");
const CONFIG_FILE = join(CONFIG_DIR, "settings.json");

export const ConfigSchema = z.object({
  api_url: z.string().url().optional(),
  default_mode: ModeSchema.optional(),
  default_model: ModelSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const CONFIGURABLE_KEYS = [
  "api_url",
  "default_mode",
  "default_model",
] as const;

export type ConfigKey = (typeof CONFIGURABLE_KEYS)[number];

export function isValidConfigKey(key: string): key is ConfigKey {
  return CONFIGURABLE_KEYS.includes(key as ConfigKey);
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return {};
    }
    const content = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content);
    return ConfigSchema.parse(parsed);
  } catch {
    return {};
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const validated = ConfigSchema.parse(config);
  writeFileSync(CONFIG_FILE, `${JSON.stringify(validated, null, 2)}\n`);
}

export function getConfigValue(key: ConfigKey): string | undefined {
  const config = loadConfig();
  return config[key];
}

export function setConfigValue(key: ConfigKey, value: string): void {
  const config = loadConfig();

  if (key === "api_url") {
    config.api_url = value;
  } else if (key === "default_mode") {
    const result = ModeSchema.safeParse(value);
    if (!result.success) {
      throw new Error(
        `Invalid mode: ${value}. Must be 'business' or 'exploration'`
      );
    }
    config.default_mode = result.data;
  } else if (key === "default_model") {
    const result = ModelSchema.safeParse(value);
    if (!result.success) {
      throw new Error(`Invalid model: ${value}. Must be 'sonnet' or 'opus'`);
    }
    config.default_model = result.data;
  }

  saveConfig(config);
}

export function unsetConfigValue(key: ConfigKey): void {
  const config = loadConfig();
  delete config[key];
  saveConfig(config);
}

export function getApiUrl(): string | undefined {
  return process.env.IDEA_EXPLORER_URL ?? loadConfig().api_url;
}

export function getApiKey(): string | undefined {
  return process.env.IDEA_EXPLORER_API_KEY;
}

export function getDefaultMode(): string | undefined {
  return loadConfig().default_mode;
}

export function getDefaultModel(): string | undefined {
  return loadConfig().default_model;
}
