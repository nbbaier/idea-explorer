Now I have solid context on the automated PR landscape. Let me create a comprehensive exploration document for "Opportunist."

# Opportunist - Exploration

## Core Insight Deconstruction

The core insight behind Opportunist is a fascinating inversion of traditional developer tooling:

**Traditional tools are reactive** - they wait for you to ask (Copilot), wait for dependencies to update (Renovate/Dependabot), or respond to events (CI/CD). Opportunist is **proactively speculative** - it guesses what you might want before you know you want it.

The underlying principles:

1. **Ephemerality as feature**: PRs auto-close if not merged, creating zero long-term noise. This eliminates the notorious "1000000 PRs was open and it becomes very hard to keep track" problem that plagues Dependabot users.

2. **Learning from behavior, not instructions**: Unlike tools that require config files, Opportunist observes what you actually merge. This is implicit preference extraction - similar to how recommendation engines work.

3. **Daily serendipity**: A single, low-commitment touchpoint. One PR per project per day creates a ritual without overwhelming.

4. **Asymmetric risk**: The cost of a bad suggestion is minimal (just close it), but the upside of a good one is hours of saved work.

5. **The "night shift" concept**: Your AI works while you sleep, presenting opportunities when you wake up. There's something delightful about waking up to a gift.

## Directions to Explore

### Direction 1: The Pure Play - Speculative Refactoring Bot

- **Description:** An AI that analyzes your codebases each night, identifies potential improvements (dead code, performance optimizations, deprecated patterns, accessibility fixes, better naming), and opens PRs with those changes. Each morning you review what it found.
- **Why it could work:** The volume of merged pull requests increased by 29% year-over-year, driven largely by AI coding assistants, but the verification bottleneck remains. Opportunist flips this - instead of generating more code faster, it generates maintenance work that's typically neglected.
- **Risks:** Could generate noise with trivial changes. AI might not understand codebase context well enough. "AI suggestions can be generic" and may lack deep contextual understanding.
- **First step:** Build a prototype that runs a single analysis (e.g., find all TODO comments in a repo and create PRs to address them).

### Direction 2: Dependency Opportunist

- **Description:** Goes beyond Renovate/Dependabot by not just updating versions, but actively migrating code. When a new major version of a library drops, it attempts the migration and opens a PR. When a library is deprecated, it finds alternatives.
- **Why it could work:** Renovate supports over 30 package managers and has a centralized dependency dashboard, but it only bumps versions - it doesn't rewrite your code to use new APIs. The actual migration work is what developers dread.
- **Risks:** Major version migrations are complex and error-prone. Could break things in subtle ways that tests don't catch.
- **First step:** Focus on a single ecosystem (e.g., React) and build migration scripts for common version bumps.

### Direction 3: Documentation Opportunist

- **Description:** Each night, scans your repos for undocumented functions, stale README sections, missing API documentation, and opens PRs with proposed docs. Notices which documentation styles you prefer from your merge patterns.
- **Why it could work:** Everyone agrees documentation matters; nobody does it. This is the perfect task for speculative automation - low stakes, high value when accurate.
- **Risks:** Generated docs could be wrong or misleading. Stale docs are sometimes worse than no docs.
- **First step:** Start with README.md generation/updates based on package.json changes.

### Direction 4: Test Generation Opportunist

- **Description:** Analyzes your code for untested paths, generates test cases, and opens PRs each night. Learns which types of tests you actually merge (unit vs integration, jest vs vitest style, etc.).
- **Why it could work:** Test coverage is a constant battle. Having something proactively suggest tests removes the "I should write tests" guilt cycle.
- **Risks:** Generated tests might test implementation rather than behavior. Could create maintenance burden.
- **First step:** Focus on edge case generation for existing tested functions - find the gaps in coverage.

### Direction 5: Cross-Project Consistency Bot

- **Description:** Maintains consistency across all your projects. If you update your ESLint config in one project, it opens PRs to update it everywhere. If you add a GitHub Action to one repo, it suggests it for others.
- **Why it could work:** Most developers have multiple repos that drift apart over time. This creates a "single source of truth" enforcement mechanism.
- **Risks:** Not all repos should be consistent. Context matters.
- **First step:** Define a "template" repo concept and propagate changes from template to all derived repos.

### Direction 6: Security Opportunist

- **Description:** Runs security scans nightly and doesn't just report - actually fixes vulnerabilities. Opens PRs with patches, dependency pins, or workarounds.
- **Why it could work:** "Even if your app passes SAST or container scans, outdated dependencies can hide vulnerabilities. This is what's called dependency drift." Fixing, not just alerting, is the gap.
- **Risks:** Security fixes might break functionality. False positives could create noise.
- **First step:** Integrate with a vulnerability database and create automated patches for the most common fixes.

### Direction 7: Personal Code Habits Learner

- **Description:** Studies your entire commit history to understand your coding style, patterns you like, and changes you've made repeatedly. Then proactively applies those patterns across your codebase.
- **Why it could work:** You've already shown your preferences through years of commits. This mines that data. "Cubic learns from your team. It analyzes your past code and comments to understand your coding patterns and preferences. Over time, Cubic improves its reviews by learning from what your human reviewers focus on."
- **Risks:** Past patterns might be outdated. Could reinforce bad habits.
- **First step:** Build a commit history analyzer that identifies repeated refactoring patterns.

### Direction 8: Issue-to-PR Opportunist

- **Description:** Looks at open issues in your repos each night and attempts to solve the simpler ones. Opens PRs tagged with the issue they address.
- **Why it could work:** Many issues sit unresolved because they're not urgent enough to prioritize. Speculative solutions change the calculus - reviewing is easier than implementing.
- **Risks:** Could overwhelm issue trackers with incomplete solutions. Misunderstanding issues is easy.
- **First step:** Start with issues tagged "good first issue" or "documentation" that have clear acceptance criteria.

### Direction 9: The Anti-Entropy Bot

- **Description:** Fights codebase entropy. Each night picks one thing to improve: format inconsistencies, mixed naming conventions, orphaned files, unused dependencies. Makes your codebase marginally better every single day.
- **Why it could work:** Death by a thousand cuts works both ways. Small daily improvements compound into major quality gains.
- **Risks:** "Better" is subjective. Could create churn without meaningful improvement.
- **First step:** Start with the most objective wins: dead code removal, unused import cleanup.

### Direction 10: The Collaborative Opportunist (Social Features)

- **Description:** Watches what PRs are getting merged across popular open source projects you depend on. Brings those patterns to your codebase. "React 19 adopted this pattern, want to try it?"
- **Why it could work:** Keeps you on the cutting edge without having to actively follow everything. Serendipitous learning.
- **Risks:** Not every popular pattern fits your context. Could create cargo-culting.
- **First step:** Track top 100 starred repos in your tech stack and surface interesting patterns weekly.

## Unexpected Connections

**Dream journals & code:** The "wake up to find what your subconscious created" is powerful. Like a dream journal, but for your codebase. There's a whole psychology of anticipation here.

**Stochastic parrots as maintenance workers:** Instead of using LLMs for novel creation (where hallucination is dangerous), use them for tedious maintenance (where human review catches errors). This plays to AI strengths.

**Spaced repetition for codebases:** What if Opportunist revisited old changes after some time? "Hey, you merged this 30 days ago - here's a follow-up improvement based on how you actually use it."

**The "Roomba" of code:** You don't tell your Roomba which rooms to clean. You just let it work and intervene only when needed. Same energy.

**Inverse Pomodoro:** Instead of you working in focused bursts, your AI works in focused bursts while you're away.

**GitHub Actions as cron for creativity:** Most CI is defensive (don't let bad code in). This is offensive (actively improve code). What other "offensive" automations could exist?

**The "surprise me" feature in Spotify, but for code:** Recommendation engines for entertainment are well-established. Why not for your development environment?

## Questions Worth Answering

1. **Learning signal quality:** Is merge/no-merge a strong enough signal? Should it also learn from code review comments, how fast you merged, whether you edited before merging?

2. **Cold start problem:** How does it make useful suggestions before it knows anything about you? Pre-trained on common patterns? Uses your existing commit history?

3. **Multi-repo coordination:** If I have 50 repos, do I want 50 PRs every morning? Or one aggregated "daily digest" with links? How does attention management work?

4. **Confidence thresholds:** Should it only open PRs when highly confident? Or should it be more aggressive and let the daily auto-close handle the noise?

5. **Seasonality:** Do developers want this on weekends? During crunch? Should it understand "now is not a good time"?

6. **Team dynamics:** Does this work for teams, or only solo developers? If a team, who decides what to merge? Does it need role-based access?

7. **The "undo" problem:** If you merge something and later regret it, how does that feed back into learning? Reverts as negative signals?

8. **Scope creep boundaries:** When does "opportunistic improvement" become "unwanted refactoring"? How do you keep it focused?

9. **Trust calibration:** How long before users trust the suggestions enough to auto-merge? Is there a progression from "review everything" to "auto-merge known-good pattern types"?

10. **API design:** Is GitHub API sufficient for this? What about private code in other VCS? Does this need to run locally for privacy-conscious users?