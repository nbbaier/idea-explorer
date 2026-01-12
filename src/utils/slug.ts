const MAX_SLUG_LENGTH = 50;
const DASH_REGEX = /-+$/;

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

  return truncated.replace(DASH_REGEX, "");
}
