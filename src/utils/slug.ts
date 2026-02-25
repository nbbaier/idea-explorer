import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { Result } from "better-result";

const MAX_SLUG_LENGTH = 50;
const MAX_PROMPT_IDEA_LENGTH = 500;
const TRAILING_DASHES = /-+$/;
const CONTROL_CHARS = /[\r\n\t\f\v]/g;
const PROMPT_SPECIAL_CHARS = /[<>`]/g;

// Patterns that indicate the LLM returned an error/explanation instead of a slug
const ERROR_PATTERNS = [
  /^i-dont/,
  /^i-cant/,
  /^i-cannot/,
  /^sorry/,
  /^unable/,
  /^cannot/,
  /^i-need/,
  /^please-provide/,
  /^not-enough/,
  /^insufficient/,
  /^generic/,
  /^untitled/,
  /^no-title/,
  /^placeholder/,
];

export function generateSlug(text: string): string {
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

export async function generateSlugWithLLM(
  idea: string,
  apiKey: string
): Promise<string> {
  const sanitizedIdea = sanitizeIdeaForPrompt(idea);
  const result = await Result.tryPromise({
    try: async () => {
      const provider = createAnthropic({ apiKey });
      const response = await generateText({
        model: provider("claude-haiku-4-5"),
        prompt: `Convert this text into a URL slug (2-5 words separated by hyphens).

Examples:
- "Build a CLI tool for managing Docker containers" → "docker-cli-manager"
- "How to implement OAuth2 in Node.js" → "nodejs-oauth2-implementation"
- "test" → "test-project"
- "asdf" → "asdf-exploration"

Output ONLY the slug. No explanations.

Text: ${sanitizedIdea}
Slug:`,
        maxOutputTokens: 30,
      });

      const slug = generateSlug(response.text.trim().toLowerCase());

      // Check if the LLM returned an error message instead of a slug
      const isErrorResponse = ERROR_PATTERNS.some((pattern) =>
        pattern.test(slug)
      );
      if (isErrorResponse) {
        throw new Error("LLM returned error message instead of slug");
      }

      return slug;
    },
    catch: (error) => {
      console.error("Failed to generate slug with LLM, falling back:", error);
      return error instanceof Error
        ? error
        : new Error("Failed to generate slug with LLM");
    },
  });

  return result.unwrapOr(generateSlug(idea));
}
