import type { Mode, Model } from "../jobs";

export interface BuildUserPromptParams {
  idea: string;
  context?: string;
  existingContent?: string;
  existingResearchList?: string[];
  datePrefix: string;
  jobId: string;
  mode: Mode;
  model: Model;
}

export const PROMPTS = {
  business: `# Business Analysis Framework

You are analyzing an idea for business viability. Use the framework below to produce a structured research document.

## Instructions

1. Analyze the provided idea thoroughly
2. Fill out each section with detailed, actionable insights
3. Be honest and direct in your assessment
4. Output your analysis as a markdown document following the template below

## Output Template

\`\`\`markdown
# [Idea Title]

## 1. Problem Analysis

- What specific problem does this solve?
- Who experiences this problem and how often?
- What's the current workaround?
- How painful is this problem (1-10)?

## 2. Market Assessment

- Target market definition
- Market size estimation (TAM/SAM/SOM)
- Existing solutions and competitors
- Key differentiators

## 3. Use Cases & Personas

- Primary use cases (top 3)
- Key user personas
- Value proposition for each persona

## 4. Technical Feasibility

- Core technical requirements
- Build vs buy decisions
- MVP scope and complexity
- Major technical risks

## 5. Verdict

**Recommendation:** STRONG YES | CONDITIONAL YES | PIVOT | PASS

[2-3 paragraph reasoning]

**If pursuing, first steps:**

1. [Immediate action]
2. [Validation experiment]
3. [Key decision to make]
\`\`\``,

  exploration: `# Exploration Framework

You are exploring an idea with divergent thinking. Use the framework below to produce a creative exploration document.

## Instructions

1. Deconstruct the core insight behind the idea
2. Generate 5-10 distinct directions to explore
3. Find unexpected connections and combinations
4. Identify key questions worth answering
5. Output your exploration as a markdown document following the template below

## Output Template

\`\`\`markdown
# [Idea Title] - Exploration

## Core Insight Deconstruction

[First principles breakdown of the underlying insight]

## Directions to Explore

### Direction 1: [Name]

- **Description:** [What this direction looks like]
- **Why it could work:** [Key advantages]
- **Risks:** [What could go wrong]
- **First step:** [How to start exploring this]

### Direction 2: [Name]

- **Description:** [What this direction looks like]
- **Why it could work:** [Key advantages]
- **Risks:** [What could go wrong]
- **First step:** [How to start exploring this]

### Direction 3: [Name]

- **Description:** [What this direction looks like]
- **Why it could work:** [Key advantages]
- **Risks:** [What could go wrong]
- **First step:** [How to start exploring this]

[Continue for 5-10 directions]

## Unexpected Connections

[Adjacent ideas, unusual combinations, what-if scenarios]

## Questions Worth Answering

[Key unknowns that would unlock clarity]
\`\`\``,
} as const;

const TOOL_GUIDANCE = `## Available Tools

### Web Search
Use web search to find current market data, competitor information, recent news, industry trends, and factual information about companies or technologies.

### Read Research
Use this to read existing research documents from the repository. Available when exploring ideas that relate to previous work. Returns a JSON object with ok: true and content on success, or ok: false with error details on failure.

## Tool Usage Guidelines
- Prefer web_search when you need current, factual, or external information (market data, competitors, news)
- Prefer read_research when building on previous explorations or referencing internal analysis
- Avoid redundancy: Do not re-read the same file multiple times in a single exploration
- Synthesize, do not dump: Integrate tool results into your analysis rather than quoting them verbatim
- Fail gracefully: If a tool returns an error, acknowledge it and proceed with available information
`;

export function buildSystemPrompt(mode: Mode): string {
  return `${PROMPTS[mode]}

${TOOL_GUIDANCE}`;
}

export function buildUserPrompt(params: BuildUserPromptParams): string {
  const {
    idea,
    context,
    existingContent,
    existingResearchList,
    datePrefix,
    jobId,
    mode,
    model,
  } = params;

  const frontmatter = buildFrontmatter({
    idea,
    mode,
    model,
    datePrefix,
    jobId,
    isUpdate: !!existingContent,
  });

  const parts: string[] = [frontmatter];

  parts.push(`## Idea\n\n${idea}`);

  if (context) {
    parts.push(`## Additional Context\n\n${context}`);
  }

  if (existingResearchList && existingResearchList.length > 0) {
    const researchListMd = existingResearchList
      .map((name) => `- ${name}`)
      .join("\n");
    parts.push(
      `## Related Research\n\nThe following research documents already exist in this repository. Consider referencing or building upon any relevant prior work:\n\n${researchListMd}`
    );
  }

  if (existingContent) {
    parts.push(
      `## Existing Research\n\nThis is an update to existing research. Review and build upon the following:\n\n${existingContent}`
    );
    parts.push(
      `## Instructions\n\nAdd a new section to this research document with updated analysis. Prefix the new section with "## Update - ${datePrefix}" and include any new insights, changed circumstances, or refined thinking.`
    );
  }

  return parts.join("\n\n");
}

interface FrontmatterParams {
  idea: string;
  mode: Mode;
  model: Model;
  datePrefix: string;
  jobId: string;
  isUpdate: boolean;
}

function buildFrontmatter(params: FrontmatterParams): string {
  const lines = [
    "---",
    `idea: "${escapeYamlString(params.idea)}"`,
    `mode: ${params.mode}`,
    `model: ${params.model}`,
    `date: ${params.datePrefix}`,
    `job_id: ${params.jobId}`,
    `is_update: ${params.isUpdate}`,
    "---",
  ];
  return lines.join("\n");
}

function escapeYamlString(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
