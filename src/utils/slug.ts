import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { Result } from "better-result";

const MAX_SLUG_LENGTH = 50;
const TRAILING_DASHES = /-+$/;

function sanitizeSlug(text: string): string {
  if (!text || typeof text !== "string") {
    return "untitled";
  }

  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    return "untitled";
  }

  if (slug.length <= MAX_SLUG_LENGTH) {
    return slug;
  }

  const truncated = slug.slice(0, MAX_SLUG_LENGTH);
  const lastDash = truncated.lastIndexOf("-");

  if (lastDash > MAX_SLUG_LENGTH * 0.6) {
    return truncated.slice(0, lastDash);
  }

  return truncated.replace(TRAILING_DASHES, "");
}

export function generateSlug(text: string): string {
  return sanitizeSlug(text);
}

export async function generateSlugWithLLM(
  idea: string,
  apiKey: string
): Promise<string> {
  const result = await Result.tryPromise({
    try: async () => {
      const provider = createAnthropic({ apiKey });
      const response = await generateText({
        model: provider("claude-haiku-4-5"),
        prompt: `Generate a concise, descriptive slug (3-5 words max) for this idea. Return ONLY the slug text with words separated by hyphens, no other text or explanation.

Idea: ${idea}

Slug:`,
        maxOutputTokens: 50,
      });

      const slug = response.text.trim().toLowerCase();
      return sanitizeSlug(slug);
    },
    catch: (error) => {
      console.error("Failed to generate slug with LLM, falling back:", error);
      return sanitizeSlug(idea);
    },
  });

  return result.unwrapOr(sanitizeSlug(idea));
}
