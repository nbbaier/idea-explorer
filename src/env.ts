import { z } from "zod";

export const EnvSchema = z.object({
  IDEA_EXPLORER_API_TOKEN: z.string().min(1, "API Token is required"),
  GH_REPO: z.string().optional(),
  GH_BRANCH: z.string().optional(),
  IDEA_EXPLORER_WEBHOOK_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GH_PAT: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function parseEnv(env: unknown): EnvConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const messages = result.error.errors.map(
      (e) => `${e.path.join(".")}: ${e.message}`
    );
    throw new Error(
      `Invalid environment configuration: ${messages.join(", ")}`
    );
  }
  return result.data;
}
