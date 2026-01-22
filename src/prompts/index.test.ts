import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt, PROMPTS } from "./index";

describe("prompts", () => {
  describe("PROMPTS", () => {
    it("should have business prompt", () => {
      expect(PROMPTS.business).toContain("Business Analysis Framework");
      expect(PROMPTS.business).toContain("Problem Analysis");
      expect(PROMPTS.business).toContain("Market Assessment");
      expect(PROMPTS.business).toContain("Verdict");
    });

    it("should have exploration prompt", () => {
      expect(PROMPTS.exploration).toContain("Exploration Framework");
      expect(PROMPTS.exploration).toContain("Core Insight Deconstruction");
      expect(PROMPTS.exploration).toContain("Directions to Explore");
      expect(PROMPTS.exploration).toContain("Unexpected Connections");
    });

    it("should not contain /workspace/ideas/ references", () => {
      expect(PROMPTS.business).not.toContain("/workspace/ideas/");
      expect(PROMPTS.exploration).not.toContain("/workspace/ideas/");
    });
  });

  describe("buildSystemPrompt", () => {
    it("should return business prompt for business mode", () => {
      const result = buildSystemPrompt("business");
      expect(result).toContain(PROMPTS.business);
      expect(result).toContain("## Available Tools");
    });

    it("should return exploration prompt for exploration mode", () => {
      const result = buildSystemPrompt("exploration");
      expect(result).toContain(PROMPTS.exploration);
      expect(result).toContain("## Available Tools");
    });
  });

  describe("buildUserPrompt", () => {
    const baseParams = {
      idea: "Test idea for validation",
      datePrefix: "2025-01-12",
      jobId: "job-123",
      mode: "business" as const,
      model: "sonnet" as const,
    };

    it("should include YAML frontmatter", () => {
      const result = buildUserPrompt(baseParams);

      expect(result).toContain("---");
      expect(result).toContain('idea: "Test idea for validation"');
      expect(result).toContain("mode: business");
      expect(result).toContain("model: sonnet");
      expect(result).toContain("date: 2025-01-12");
      expect(result).toContain("job_id: job-123");
      expect(result).toContain("is_update: false");
    });

    it("should include idea section", () => {
      const result = buildUserPrompt(baseParams);
      expect(result).toContain("## Idea\n\nTest idea for validation");
    });

    it("should include context when provided", () => {
      const result = buildUserPrompt({
        ...baseParams,
        context: "Additional context here",
      });

      expect(result).toContain(
        "## Additional Context\n\nAdditional context here"
      );
    });

    it("should not include context section when not provided", () => {
      const result = buildUserPrompt(baseParams);
      expect(result).not.toContain("## Additional Context");
    });

    it("should include existing content for updates", () => {
      const result = buildUserPrompt({
        ...baseParams,
        existingContent: "# Previous Research\n\nOld analysis here",
      });

      expect(result).toContain("## Existing Research");
      expect(result).toContain("# Previous Research\n\nOld analysis here");
      expect(result).toContain("is_update: true");
    });

    it("should include update instructions when existingContent provided", () => {
      const result = buildUserPrompt({
        ...baseParams,
        existingContent: "Previous content",
      });

      expect(result).toContain("## Instructions");
      expect(result).toContain("## Update - 2025-01-12");
    });

    it("should escape quotes in idea", () => {
      const result = buildUserPrompt({
        ...baseParams,
        idea: 'Idea with "quotes"',
      });

      expect(result).toContain('idea: "Idea with \\"quotes\\""');
    });

    it("should escape newlines in idea", () => {
      const result = buildUserPrompt({
        ...baseParams,
        idea: "Line 1\nLine 2",
      });

      expect(result).toContain('idea: "Line 1\\nLine 2"');
    });

    it("should handle opus model in frontmatter", () => {
      const result = buildUserPrompt({
        ...baseParams,
        model: "opus",
      });

      expect(result).toContain("model: opus");
    });

    it("should handle exploration mode in frontmatter", () => {
      const result = buildUserPrompt({
        ...baseParams,
        mode: "exploration",
      });

      expect(result).toContain("mode: exploration");
    });
  });
});
