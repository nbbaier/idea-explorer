# Idea Explorer: Remaining Improvement Ideas

## 1. Follow-Up/Iterative Explorations

### The Problem

Ideas aren't static - they evolve through iteration. Currently, the system treats each exploration as isolated. If you explore "AI-powered calendar" and discover interesting angles, you can't easily say "now explore the enterprise market angle from that research" without manually copying context.

### The Solution

Add a `continue_from` parameter that references a previous job, automatically loading that research as context:

```typescript
POST /api/explore
{
  "idea": "Focus on the enterprise market angle - what would procurement look like?",
  "continue_from": "abc123de",  // previous job_id
  "mode": "business"
}
```

The workflow would:

1. Fetch the previous job to get its GitHub URL
2. Clone and read the previous `research.md`
3. Prepend it to Claude's context as "Previous Research"
4. Instruct Claude to build upon (not repeat) the previous analysis
5. Create `research-v2.md` or append a dated section

### Implementation

```typescript
// In workflow step 3.5 (new step: load context)
if (params.continue_from) {
   const previousJob = await getJob(ctx.env, params.continue_from);
   if (previousJob?.github_url) {
      const previousResearch = await fetchFromGitHub(previousJob.github_url);
      params.context = `## Previous Research\n${previousResearch}\n\n## New Direction\n${
         params.context || ""
      }`;
   }
}
```

### Why This Matters

-  **Transforms the tool's utility:** From one-shot analysis to iterative ideation partner
-  **Matches real workflows:** Ideas require 3-5 iterations to crystallize - this enables that
-  **Low complexity:** Mostly reusing existing infrastructure (GitHub fetch, context injection)
-  **Compounds over time:** Builds a connected graph of idea evolution
-  **User perception:** "This feels like having a research assistant I can collaborate with"

This elevates the tool from "interesting experiment" to "essential workflow component."

---

## 2. Custom Analysis Frameworks

### The Problem

The tool currently offers only two analysis modes: `business` (viability analysis) and `exploration` (creative exploration). But users might want:

-  Technical feasibility analysis
-  Competitive landscape mapping
-  Market sizing
-  Customer interview synthesis
-  Patent/prior art search

Being locked to two frameworks severely limits utility.

### The Solution

Allow users to define or reference custom prompt frameworks:

**Option A: Inline custom prompt**

```typescript
POST /api/explore
{
  "idea": "AI-powered legal document review",
  "mode": "custom",
  "custom_prompt": "Analyze this idea from a regulatory compliance perspective. Focus on..."
}
```

**Option B: Named frameworks from repository**

Store custom frameworks in the GitHub repo under `prompts/custom/`, automatically detected:

```
prompts/
├── business.md
├── exploration.md
└── custom/
    ├── technical-feasibility.md
    ├── competitive-landscape.md
    └── market-sizing.md
```

Users can add their own via PR or direct commit, and reference by name:

```typescript
{ "mode": "technical-feasibility" }
```

### Implementation

```typescript
// Detect available frameworks
const frameworks = await listDirectory("/workspace/prompts");
const customFrameworks = await listDirectory("/workspace/prompts/custom");

// Validate mode parameter
if (!["business", "exploration", ...customFrameworks].includes(mode)) {
   if (params.custom_prompt) {
      promptContent = params.custom_prompt;
   } else {
      throw new Error(`Unknown framework: ${mode}`);
   }
}
```

### Why This Matters

-  **Massive extensibility:** Turns the tool into a platform
-  **User-controlled evolution:** Users extend without code changes
-  **GitHub-native:** Frameworks versioned and shareable
-  **Reasonable implementation:** ~100 lines + documentation
-  **Power user magnet:** Serious users will create dozens of specialized frameworks

This moves the tool from "fixed function" to "infinitely extensible platform."

---

## 3. Rich Failure Diagnostics

### The Problem

When jobs fail, the error information is nearly useless:

```json
{
   "status": "failed",
   "error": "Container execution timed out"
}
```

Which step timed out? What was Claude working on? Was there partial output? Did git push fail due to auth or conflict? Users are completely blind without access to Cloudflare dashboard logs.

### The Solution

Capture comprehensive failure context:

```json
{
   "status": "failed",
   "error": "Container execution timed out after 900000ms",
   "failure_details": {
      "step": "running_claude",
      "step_started_at": 1704816000000,
      "duration_ms": 900000,
      "partial_output": "## Market Analysis\n\nThe AI calendar space...",
      "command": "claude --model opus --prompt /prompts/business.md",
      "exit_code": null,
      "stderr_tail": "..."
   }
}
```

### Implementation

```typescript
// Wrap each step execution
try {
  const result = await step.do("run_claude", async () => {
    const { stdout, stderr, exitCode } = await runWithTimeout(
      sandbox.exec(...),
      COMMAND_TIMEOUT_MS
    );
    return { stdout, stderr, exitCode };
  });
} catch (error) {
  await updateJob(ctx, jobId, {
    status: "failed",
    error: error.message,
    failure_details: {
      step: "running_claude",
      step_started_at: stepStartTime,
      duration_ms: Date.now() - stepStartTime,
      partial_output: capturedOutput?.slice(-2000),
      stderr_tail: capturedStderr?.slice(-500)
    }
  });
  throw error;
}
```

### Why This Matters

-  **Debugging becomes possible:** Users can self-diagnose most issues
-  **Reduces support burden:** Clear errors = fewer "why did this fail?" questions
-  **Partial output is valuable:** If Claude analyzed 80% before timeout, that work isn't lost
-  **Implementation is additive:** Doesn't change happy path, just enriches error path
-  **Professional quality:** Production systems need actionable error information

This transforms failures from "black box" to "actionable diagnostic."

---

## Summary

| Rank | Idea                     | Effort   | Impact    | Confidence |
| ---- | ------------------------ | -------- | --------- | ---------- |
| 1    | Follow-up explorations   | ~4 hours | Very High | 95%        |
| 2    | Custom frameworks        | ~3 hours | Very High | 90%        |
| 3    | Rich failure diagnostics | ~2 hours | High      | 95%        |

All three improvements are pragmatic (reasonable implementation) and address real gaps in the current system. Together with the already-implemented step-level progress and job listing features, they would transform the tool from "interesting personal project" to "robust, professional-grade idea analysis platform."
