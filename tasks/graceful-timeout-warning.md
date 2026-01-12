# Graceful Timeout Warning for Claude

## Problem
When Claude times out after 15 minutes, no work is committed and there's no way to tell Claude "you're running out of time, wrap it up."

## Proposed Solutions

### Option 1: Time-Aware Prompt (Simple)

Add time constraints directly to the prompt templates so Claude self-monitors.

**Add to both `prompts/business.md` and `prompts/exploration.md`:**

```markdown
## Time Constraint

You have approximately 12 minutes to complete this analysis. If you find yourself 
going deep on any single section, prioritize breadth over depth. It's better to 
deliver a complete document with lighter analysis than a partial document with 
deep analysis on only some sections.

Check the time periodically with `date` and pace yourself accordingly.
```

**Pros:**
- Simple to implement (just update prompt files)
- No code changes required
- Claude has context from the start

**Cons:**
- Claude may not reliably check time
- No dynamic adjustment based on actual elapsed time

---

### Option 2: Signal File + Prompt Instruction (Dynamic)

Write a "wrap up" signal file from the checkpoint interval, and instruct Claude to check for it.

**1. Update prompt templates with:**

```markdown
## Time Management

IMPORTANT: Periodically check if `/workspace/.wrap-up` exists. If it does, 
finish your current thought and save your work immediately. This file will 
appear when you're running low on time.
```

**2. Modify `src/workflows/exploration.ts` checkpoint interval:**

```typescript
const CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;
const WRAP_UP_WARNING_MS = 10 * 60 * 1000; // 10 minutes

let wrapUpSent = false;

const checkpointInterval = setInterval(async () => {
  checkpointCount++;
  const elapsed = Date.now() - claudeStartTime;
  
  // Send wrap-up signal at 10 minutes
  if (!wrapUpSent && elapsed >= WRAP_UP_WARNING_MS) {
    await sandbox.exec('touch /workspace/.wrap-up');
    logInfo("wrap_up_signal_sent", { elapsed_ms: elapsed }, jobId);
    wrapUpSent = true;
  }
  
  logInfo("checkpoint_starting", undefined, jobId);
  await commitPartialWork(sandbox, {
    ...checkpointConfig,
    message: `WIP: checkpoint ${checkpointCount} for ${slug}`,
  });
}, CHECKPOINT_INTERVAL_MS);
```

**Pros:**
- Dynamic - only warns when actually running long
- Clear signal that Claude can check
- Could adjust warning threshold based on job complexity

**Cons:**
- Relies on Claude actually checking the file
- Slightly more complex implementation
- Claude might not check at the right moment

---

### Option 3: Hybrid Approach (Recommended)

Combine both: include time awareness in the prompt AND send a signal file as a backup.

**Prompt addition:**

```markdown
## Time Management

You have approximately 12 minutes to complete this analysis. Prioritize delivering 
a complete document over going deep on any single section.

Additionally, check periodically if `/workspace/.wrap-up` exists - this is an 
urgent signal that you must wrap up immediately and save your work.
```

**Code changes:** Same as Option 2.

---

## Implementation Checklist

- [ ] Update `prompts/business.md` with time constraint section
- [ ] Update `prompts/exploration.md` with time constraint section  
- [ ] Add wrap-up signal file logic to checkpoint interval in `exploration.ts`
- [ ] Add logging for wrap-up signal
- [ ] Test with a long-running idea to verify Claude responds to signals
- [ ] Consider making the wrap-up threshold configurable (env var or per-job)

## Notes

- The 15-minute timeout is set in `exploration.ts` line 345: `{ timeout: "15 minutes" }`
- Checkpoints happen every 5 minutes (line 374)
- A 10-minute wrap-up warning gives Claude ~5 minutes to finish
