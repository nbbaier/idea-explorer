# Future Ideas

Ideas and directions for enhancing Idea Explorer.

---

## Follow-Up/Iterative Explorations

Ideas evolve through iteration. Add a `continue_from` parameter that references a previous job, automatically loading that research as context:

```typescript
POST /api/explore
{
  "idea": "Focus on the enterprise market angle",
  "continue_from": "abc123de",
  "mode": "business"
}
```

The workflow would fetch previous research, prepend it to Claude's context, and instruct Claude to build upon (not repeat) the previous analysis.

---

## Custom Analysis Frameworks

Allow users to define or reference custom prompt frameworks beyond `business` and `exploration`:

- **Inline custom prompt**: `"mode": "custom", "custom_prompt": "..."`
- **Named frameworks**: Store in `prompts/custom/` in the repo, reference by name

Enables technical feasibility, competitive landscape, market sizing, etc.

---

## Rich Failure Diagnostics

Capture comprehensive failure context instead of opaque errors:

```json
{
  "status": "failed",
  "error": "Execution timed out",
  "failure_details": {
    "step": "generate_research",
    "duration_ms": 900000,
    "partial_output": "## Market Analysis\n\nThe AI calendar space..."
  }
}
```

---

## Multi-Turn Refinement

Structure the workflow as a conversation:

1. Claude analyzes and asks clarifying questions
2. Tool calls gather external information
3. Synthesis with refined analysis
4. Self-critique and iteration

---

## Dynamic Framework Selection

Instead of hardcoded modes, have Claude analyze idea characteristics first and choose/blend frameworks dynamically.

---

## Sub-Problem Decomposition

For complex ideas, enable parallel research:

- Claude breaks the idea into research questions
- Each becomes a sub-task (parallel workflow steps)
- Results aggregated into final synthesis

```
Idea: "AI-powered legal document review"
  ├── Sub-task 1: Research existing legal tech market
  ├── Sub-task 2: Analyze AI document processing capabilities
  ├── Sub-task 3: Investigate regulatory requirements
  └── Sub-task 4: Identify target customer segments
      ↓
  Final synthesis
```

---

## Validation Loops

Add hypothesis testing:

- Claude proposes claims to verify
- Tools execute verification (web search, APIs)
- Claude revises based on evidence

---

## Memory Across Explorations

Cross-exploration intelligence:

- Pattern recognition across multiple explorations
- Query similar past research when starting new exploration
- Research graph connecting related work

---

## External Data Integration

Specialized data tools beyond web search:

- GitHub search for related projects
- Patent/prior art search
- Academic paper search
- Market data APIs

---

## Priority

| Direction | Effort | Impact |
|-----------|--------|--------|
| Follow-up explorations | Low | High |
| Custom frameworks | Low | High |
| Rich failure diagnostics | Low | High |
| Multi-turn refinement | Medium | High |
| Sub-problem decomposition | High | High |
| Dynamic framework selection | Low | Medium |
| Memory across explorations | High | Medium |
| Validation loops | Medium | Medium |
| External data integration | Medium | Medium |
