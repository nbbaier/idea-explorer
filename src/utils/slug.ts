import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { Result } from "better-result";

const MAX_SLUG_LENGTH = 50;
const MAX_PROMPT_IDEA_LENGTH = 500;
const TRAILING_DASHES = /-+$/;
const CONTROL_CHARS = /[\r\n\t\f\v]/g;
const PROMPT_SPECIAL_CHARS = /[<>`]/g;

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

function sanitizeIdeaForPrompt(idea: string): string {
  const trimmed = idea
    .replace(CONTROL_CHARS, " ")
    .replace(PROMPT_SPECIAL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed) {
    return "untitled";
  }

  return trimmed.slice(0, MAX_PROMPT_IDEA_LENGTH);
}

export function generateSlug(text: string): string {
  return sanitizeSlug(text);
}

export async function generateSlugWithLLM(
  idea: string,
  apiKey: string
): Promise<string> {
  const sanitizedIdea = sanitizeIdeaForPrompt(idea);
  const result = await Result.tryPromise({
    try: async () => {
      const provider = createAnthropic({ apiKey });
      const response = await generateText({
        model: provider("claude-3-5-haiku-latest"),
        prompt: `Generate a concise, descriptive slug (3-5 words max) for this idea. Return ONLY the slug text with words separated by hyphens, no other text or explanation.

Idea: ${sanitizedIdea}

Slug:`,
        maxOutputTokens: 50,
      });

      const slug = response.text.trim().toLowerCase();
      return sanitizeSlug(slug);
    },
    catch: (error) => {
      console.error("Failed to generate slug with LLM, falling back:", error);
      return error instanceof Error
        ? error
        : new Error("Failed to generate slug with LLM");
    },
  });

  return result.unwrapOr(sanitizeSlug(idea));
}
