# Usage Spec for LLM-Built CLI Tools - Exploration

## Core Insight Deconstruction

The fundamental insight here operates on several levels:

**1. The Interface Contract Problem**

When LLM coding agents build CLI tools, there's a gap between what the agent "thinks" it built and what actually exists. Usage is a spec and CLI for defining CLI tools. Arguments, flags, environment variables, and config files can all be defined in a Usage spec. It can be thought of like OpenAPI (swagger) for CLIs. Just as OpenAPI solved the problem of documenting and validating REST APIs, Usage could solve the problem of documenting and validating CLI interfaces produced by AI.

**2. Single Source of Truth**

Mise uses a declarative CLI definition system based on the "usage" specification format. The usage specification serves as a single source of truth for defining all CLI commands, arguments, flags, and help documentation, which is then used to generate shell completions, documentation, and support CLI parsing. This "single source of truth" concept is crucial for AI agents—they can generate one specification that powers multiple outputs.

**3. KDL as an LLM-Friendly Format**

Usage specs are written in kdl which is a newer document language that sort of combines the best of XML and JSON. Additionally, KDL is a document language, mostly based on SDLang, with xml-like semantics that looks like you're invoking a bunch of CLI commands! This syntax resemblance to CLI commands means LLMs may find it natural to generate, as it mirrors the mental model they already have of command-line interfaces.

**4. The Agentic Coding Context**

Agentic CLI tools are AI-powered command-line agents that go beyond simple autocomplete. They actively plan and execute multi-step tasks-managing files, running commands, and handling Git history directly within your terminal. Current agents build tools but lack a standardized way to describe what they've built. Usage could bridge this gap.

**5. Bidirectional Value**

The spec works in two directions:

- **Agent → Human**: Generated CLIs come with complete documentation, shell completions, and manpages
- **Human → Agent**: Agents can parse existing Usage specs to understand how to invoke tools

## Directions to Explore

### Direction 1: Usage-First Code Generation

- **Description:** LLM agents generate the `.usage.kdl` specification FIRST, before any implementation code. The spec becomes the contract that guides code generation, similar to how API-first design works with OpenAPI.
- **Why it could work:** You could think of Usage like an LSP (Language Server Protocol) for CLIs. Those building CLI frameworks can really benefit from Usage. If agents define interfaces first, they can validate their implementations against the spec. This would catch interface mismatches before runtime.
- **Risks:** Agents might generate specs that are impossible or impractical to implement. The two-step process adds complexity. LLMs might struggle with KDL syntax nuances.
- **First step:** Build a prompt template that instructs an agent to produce a `.usage.kdl` file first, then implement each command. Test with simple CRUD CLIs.

### Direction 2: Automatic Usage Generation from Existing Code

- **Description:** Analyze agent-generated CLI code (argparse, click, clap, etc.) and automatically extract a Usage spec. The mise usage command outputs the complete CLI specification in the usage format, which is then consumed by the usage CLI tool for completions. This command is defined in src/cli/usage.rs and leverages the usage-lib crate's integration with clap.
- **Why it could work:** Doesn't require changing agent behavior. Works retroactively on existing code. Many CLI libraries already have structured argument definitions that can be parsed.
- **Risks:** Loss of semantic information (help text, examples) that isn't in code. Different parsing libraries have different expressiveness. Complex CLIs with dynamic arguments may not translate well.
- **First step:** Build extractors for the top 3 CLI frameworks (Python's click/argparse, Rust's clap, Node's commander) that output Usage specs.

### Direction 3: Usage as Agent-to-Agent Protocol

- **Description:** When one AI agent builds a CLI tool and another agent needs to use it, the Usage spec becomes the interface contract. Agent A produces `tool.usage.kdl`, Agent B reads it to understand how to invoke the tool.
- **Why it could work:** Usage offers shell completions, auto-generated docs, markdown docs, and manpages that stay in sync automatically. It's language agnostic and works with bash scripts or integrates with CLIs written in any language via the usage CLI. This universality makes it ideal for multi-agent systems where different components may be written in different languages.
- **Risks:** Agents still need training on KDL/Usage format. Semantic meaning may be lost in translation. Requires agents to trust specs over empirical testing.
- **First step:** Create a "tool consumer" prompt that takes a Usage spec and demonstrates calling the tool correctly. Test in multi-agent coding scenarios.

### Direction 4: Usage-Guided Testing Harness

- **Description:** Use the Usage spec to automatically generate comprehensive test cases for CLI tools. The spec defines valid/invalid inputs, the harness generates tests.
- **Why it could work:** The priority over which is used (CLI flag, env var, config file, default) is the order which they are defined. The spec explicitly defines input precedence, types, and constraints—exactly what you need to generate edge-case tests.
- **Risks:** Behavioral testing (does it do the right thing?) still needs custom logic. May generate too many tests for complex CLIs. Doesn't catch subtle bugs in business logic.
- **First step:** Build a generator that takes a Usage spec and outputs pytest/jest tests covering all flag combinations, required arguments, and invalid inputs.

### Direction 5: Usage Scripts for Rapid Prototyping

- **Description:** Scripts can be used with the Usage CLI to display help, powerful arg parsing, and autocompletion in any language. For this to work, we add comments to the script that describe the flags and arguments that the script accepts. LLM agents could generate simple bash/node scripts with embedded Usage comments as a rapid prototyping layer before full implementation.
- **Why it could work:** Dramatically lowers the barrier to creating functional CLIs. Agents can iterate quickly. Users get completions and help immediately. Easy to graduate to full implementations.
- **Risks:** Bash scripts have limitations. Not suitable for complex applications. May create technical debt if prototypes become production code.
- **First step:** Train an agent to output Usage-commented bash scripts for simple automation tasks. Compare development speed vs traditional approaches.

### Direction 6: CLI Component Library with Usage Specs

- **Description:** Create a library of pre-built, Usage-specified CLI components (config management, logging, progress bars, output formatting) that agents can compose into full CLIs.
- **Why it could work:** Reduces code generation burden. Ensures consistent UX across agent-built tools. Components are pre-validated. This file is parsed by the usage CLI tool to generate various outputs. This approach ensures consistency across all these outputs and provides a single place to maintain CLI interface definitions.
- **Risks:** Components may not compose cleanly. Over-abstraction could limit flexibility. Maintenance burden of the component library.
- **First step:** Design 5-10 foundational CLI components (version command, config reader, output formatter) with Usage specs. Test agent composition.

### Direction 7: Interactive Specification Builder

- **Description:** Create a conversational interface where users describe what CLI they want, and the system iteratively builds and refines a Usage spec before any code generation.
- **Why it could work:** Captures user intent more accurately. Allows iteration at the specification level (cheaper than code). Users learn about CLI design patterns through the conversation.
- **Risks:** Users may not know what they want until they see working code. Conversation overhead may frustrate experienced developers. Spec refinement could be endless.
- **First step:** Build a simple chat interface that asks questions about command structure, flags, and behaviors, then outputs a draft Usage spec for review.

### Direction 8: Usage-MCP Bridge

- **Description:** Create a Model Context Protocol (MCP) server that exposes Usage-specified CLIs as callable tools. MCP Builder guides creation of high-quality MCP servers for integrating external APIs and services with LLMs using Python or TypeScript. Any CLI with a Usage spec becomes instantly available to Claude and other MCP-compatible agents.
- **Why it could work:** MCP is gaining traction in the agentic ecosystem. Usage provides the structured interface description that MCP needs. One spec could power both human CLI usage and AI tool usage.
- **Risks:** MCP is still evolving. Performance overhead of the bridge. Security implications of exposing CLIs to AI agents.
- **First step:** Build an MCP server that reads a Usage spec and exposes each command as an MCP tool. Test with Claude Code.

### Direction 9: Spec Diffing and Migration

- **Description:** When agents modify CLI tools, automatically detect spec changes and generate migration guides. Track breaking changes, deprecated flags, and new features.
- **Why it could work:** CLIs evolve over time. Users need to understand what changed. Agents can inadvertently introduce breaking changes. Structured specs make diffing tractable.
- **Risks:** Semantic changes (same interface, different behavior) aren't captured. Requires maintaining spec history. May generate noise for minor changes.
- **First step:** Build a Usage spec differ that categorizes changes as breaking/non-breaking and generates changelog entries.

### Direction 10: Usage-Aware Code Review

- **Description:** In PR review, automatically verify that code changes match Usage spec changes (and vice versa). Flag when implementation diverges from specification.
- **Why it could work:** Catches "spec rot" where documentation falls behind code. Ensures agents maintain consistency. Provides reviewers with interface-level summary of changes.
- **Risks:** False positives when spec intentionally lags implementation. Requires parsing multiple languages. May slow CI pipelines.
- **First step:** Build a GitHub Action that compares Usage spec against implementation for clap-based Rust CLIs and reports discrepancies.

## Unexpected Connections

**Connection to OpenAPI/Swagger Ecosystem**
Usage can be thought of like OpenAPI (swagger) for CLIs. This suggests potential for tooling crossover: mock servers that pretend to be CLIs, SDK generators that produce wrapper libraries, testing harnesses based on the spec.

**KDL's Linguistic Fit with LLMs**
KDL is a document language, mostly based on SDLang, with xml-like semantics that looks like you're invoking a bunch of CLI commands! This visual similarity to CLI invocations may make KDL unusually natural for LLMs to generate—they're essentially writing "example commands" that happen to be the spec.

**Shell Completions as Implicit Documentation**
Rather than building features like autocompletion for every shell, just output a Usage definition and use the Usage CLI to generate autocompletion scripts for all of the shells it supports. For AI-generated tools, this means users can explore capabilities interactively through tab completion—a form of "just-in-time documentation."

**The Tool Stub Pattern**
A tool stub consists of: a shebang line, TOML configuration specifying the tool, version, and options. The stub will automatically install the specified tool version if missing and execute it with any arguments passed to the stub. This pattern of "self-installing executables" could apply to agent-generated tools—ship a spec that bootstraps its own implementation.

**Config File/Env Var Unification**
Arguments, flags, environment variables, and config files can all be defined in a Usage spec. This unified approach to configuration could help agents build "12-factor compliant" CLIs by default.

## Questions Worth Answering

1. **Adoption Friction**: How easily can existing coding agents (Claude Code, Aider, Copilot) be prompted to generate Usage specs? What's the success rate without fine-tuning?

2. **KDL Learning Curve**: Do LLMs produce syntactically valid KDL consistently, or is the format obscure enough to cause frequent errors?

3. **Semantic Completeness**: What aspects of CLI behavior can't be captured in a Usage spec? (Dynamic argument validation, state-dependent flags, complex inter-flag dependencies)

4. **Toolchain Maturity**: Is the Usage ecosystem mature enough for production use? What gaps exist in parsers across languages?

5. **User Expectation Gap**: When a user interacts with an AI-generated CLI that has beautiful completions and help text, do they expect the implementation quality to match? Does professional-looking scaffolding set unrealistic expectations?

6. **Security Surface**: If agents can generate specs that other agents consume, what attack vectors open up? Can malicious specs inject commands or leak information?

7. **Versioning Strategy**: How should specs evolve as agents iterate on tools? Semantic versioning? Append-only changes?

8. **Competitive Landscape**: How does Usage compare to alternatives like [argc](https://github.com/sigoden/argc) or custom JSON schemas? What makes it the right choice for agent tooling?
