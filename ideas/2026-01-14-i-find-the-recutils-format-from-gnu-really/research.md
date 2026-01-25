# GNU Recutils Reimplementation in Rust - Exploration

## Core Insight Deconstruction

**The fundamental appeal of recutils:**

1. **Human-readable structured data** - Text files that are simultaneously machine-parseable and human-editable
2. **Unix philosophy alignment** - Simple, composable tools that do one thing well
3. **Database-like querying without database complexity** - SQL-like operations on plain text
4. **Version control friendly** - Line-based format that diffs cleanly
5. **Low ceremony** - No schemas required, optional typing, gradual formalization

**Why Rust specifically?**

- Memory safety without GC makes it suitable for CLI tools
- Strong type system could enhance the optional typing features
- Performance for large record sets
- Modern tooling and library ecosystem
- Cross-platform compilation
- Could offer both library and CLI tool

**The gap in the ecosystem:**

- Recutils is primarily C with Python bindings
- Modern languages lack recutils implementations
- Rust's data manipulation ecosystem is rich but lacks this specific pattern
- Opportunity to modernize the format while maintaining compatibility

## Directions to Explore

### Direction 1: Faithful Port with Modern CLI

- **Description:** A direct reimplementation of recutils commands (recsel, recins, recdel, recset, recfix) in Rust, maintaining compatibility with the GNU format spec but with modern CLI UX (better error messages, colored output, interactive modes)
- **Why it could work:**
  - Clear specification to follow
  - Existing test corpus from GNU project
  - Immediate utility for existing recutils users
  - Rust's parsing libraries (nom, pest) are excellent
- **Risks:**
  - Becomes "just another port" without innovation
  - GNU recutils is mature and works well
  - Hard to compete on features alone
- **First step:** Parse the recutils manual thoroughly, implement the format parser with comprehensive tests from GNU test suite

### Direction 2: Recutils-as-a-Library Ecosystem

- **Description:** Focus on creating a Rust library (`recutils-rs`) with ergonomic APIs that other Rust projects can embed. Think `serde` integration, query builder patterns, type-safe record access. CLI tools become just one consumer of the library.
- **Why it could work:**
  - Enables new use cases (web services serving recfiles, embedded systems)
  - Serde integration makes it interoperable with JSON/TOML/YAML
  - Type-safe builders prevent invalid queries at compile time
  - Could become the canonical Rust implementation
- **Risks:**
  - Library design requires more upfront architecture
  - Harder to demonstrate value without applications
  - API design is subtle and easy to get wrong
- **First step:** Design core types (`Record`, `RecordSet`, `Query`) with a focus on ergonomic API, implement basic parsing and querying

### Direction 3: Extended Format with Modern Features

- **Description:** Implement recutils format but extend it with modern capabilities: JSONB-like nested fields, full-text search integration, computed fields, foreign key relationships, triggers. Think "SQLite for text files."
- **Why it could work:**
  - Addresses limitations of original format
  - Could attract new users who find recutils too limited
  - Rust's type system could enforce these extensions safely
  - Still maintains basic compatibility
- **Risks:**
  - Feature creep could make it complex
  - Breaks compatibility with GNU tools
  - Might just become "another database"
- **First step:** Document proposed extensions, implement backward-compatible parser that handles extended syntax, prototype one killer feature (e.g., nested records)

### Direction 4: Interactive REPL and TUI

- **Description:** Build an interactive shell for working with recfiles - think `psql` or `sqlite3` CLI but for recfiles. Add a TUI mode using ratatui for browsing, editing, and querying records visually.
- **Why it could work:**
  - Makes recutils more approachable for non-CLI experts
  - Visual feedback helps understand query results
  - Could integrate with editors (vim/emacs plugins)
  - Modern terminal UIs are highly capable
- **Risks:**
  - TUI development is time-consuming
  - Might not add enough value over command-line tools
  - Requires significant UX design
- **First step:** Build basic REPL with rustyline, add syntax highlighting and auto-completion, prototype simple table view with ratatui

### Direction 5: Web-First Recutils

- **Description:** Create a recutils server that exposes recfiles over HTTP/REST APIs. Include a web UI for browsing and editing. Think "Datasette for recfiles" or "recutils-as-a-service."
- **Why it could work:**
  - Makes recfiles accessible to web applications
  - Could enable collaborative editing
  - Built-in API generation from recfile schemas
  - Static site generation from recfiles
- **Risks:**
  - Scope creep into becoming a full web framework
  - Network access changes the simplicity model
  - Security concerns with file system access
- **First step:** Build basic Axum/Actix server that serves recfile contents as JSON, implement read-only REST API, create simple viewer with HTMX

### Direction 6: Format Converter and Bridge

- **Description:** Focus on making recutils a bridge format - excellent tools for converting to/from CSV, JSON, SQLite, YAML, TOML, etc. Position recutils as the "intermediate representation" for data transformation pipelines.
- **Why it could work:**
  - Clear value proposition: recfiles as the universal adapter
  - Complements rather than competes with other tools
  - Leverages Rust's strong serialization ecosystem
  - Useful for data migration and ETL
- **Risks:**
  - Becomes "just another data converter"
  - Hard to differentiate from existing tools
  - Recutils format might not be needed if you're converting anyway
- **First step:** Implement bidirectional converters for 3 common formats (CSV, JSON, SQLite), create CLI tool that chains conversions, write examples of practical use cases

### Direction 7: Git-Integrated Record Versioning

- **Description:** Build deep integration with git: track record-level history, show diffs at the field level, merge conflicts intelligently, query historical states. Think "git + database + recutils."
- **Why it could work:**
  - Solves real pain point of versioning structured data
  - Leverages recutils' text-based format
  - Unique positioning in the market
  - Appeals to developers who live in git
- **Risks:**
  - Complex implementation (git integration is hard)
  - Narrow use case
  - Performance issues with large histories
- **First step:** Use git2-rs to read recfile history, implement field-level diff viewer, prototype smart merge that understands record structure

### Direction 8: Schema Evolution and Migration Tools

- **Description:** Create sophisticated tooling around schema changes in recfiles: generate migrations, validate data against schemas, automatic field transformations, migration rollback. Think "Alembic/Flyway for recfiles."
- **Why it could work:**
  - Addresses pain point of schema evolution in text files
  - Enables using recfiles for more serious applications
  - Type system integration could make this robust
  - Clear value for teams using recfiles
- **Risks:**
  - Adds complexity to simple format
  - Might be over-engineering the problem
  - Limited audience who needs this
- **First step:** Implement schema definition format (possibly using existing %rec syntax), build validator, create simple migration generator for common transformations

### Direction 9: Domain-Specific Recutils Applications

- **Description:** Build opinionated tools for specific domains: contacts management (vCard-like), task tracking, bibliography management (BibTeX alternative), inventory systems. Each uses recutils under the hood but provides domain-specific commands.
- **Why it could work:**
  - Demonstrates recutils value through concrete applications
  - Each tool can be marketed separately
  - Builds ecosystem of interoperable tools
  - Users might not even know they're using recutils
- **Risks:**
  - Spreads effort across multiple projects
  - Each domain has established competition
  - Maintenance burden of multiple applications
- **First step:** Pick one domain (contacts seems promising given vCard complexity), implement core CRUD operations, add domain-specific queries (e.g., "find all contacts in NYC")

### Direction 10: Educational and Documentation Focus

- **Description:** Create the best possible learning resources for recutils: interactive tutorial, comprehensive examples, comparison with alternatives, video walkthroughs. Position the Rust implementation as the "modern introduction to recutils."
- **Why it could work:**
  - GNU documentation is comprehensive but dense
  - Good docs dramatically increase adoption
  - Could become the canonical modern resource
  - Lower barrier to entry attracts new users
- **Risks:**
  - Doesn't differentiate the implementation itself
  - Documentation is time-consuming
  - Hard to monetize or gain recognition
- **First step:** Create interactive mdBook-based tutorial, build runnable examples with WASM playground, write "Recutils by Example" cookbook

## Unexpected Connections

**Recutils × Obsidian/Logseq:**
Personal knowledge management tools could use recfiles as their storage format instead of JSON. Properties/frontmatter are essentially records. A recutils query language could be more powerful than dataview queries.

**Recutils × Testing:**
Test fixtures and test data could be stored in recfiles. The query language could select specific test cases. Rust's testing framework could have a recutils integration for data-driven tests.

**Recutils × Configuration Management:**
Many applications use TOML/YAML for config. Recfiles could be superior for configs with multiple instances of similar items (e.g., multiple servers, multiple API keys). Environment-specific queries could select the right config.

**Recutils × Static Site Generation:**
Hugo/Zola use TOML frontmatter. Recfiles could store all posts as records, with sophisticated queries for generating different views. Related to prior research on bookmarking apps.

**Recutils × Email:**
Email headers are essentially key-value pairs, and mbox format already uses a line-based structure. Recutils could be an excellent email archive format with powerful queries. Integration with notmuch/mu could be interesting.

**Recutils × Conlang (from prior research):**
A conlang lexicon stored as recfiles would be excellent. Each word is a record with fields for definition, pronunciation, grammar category, etymology, etc. Queries could find all verbs, or all words derived from a root. Connects to 2026-01-12 conlang research.

**Recutils × Card Games (from prior research):**
Card definitions stored in recfiles! Each card is a record with fields for suit, rank, game-specific properties. Generate different decks by querying. Connects to 2026-01-14 card game research.

**Recutils × Schema.org (from prior research):**
Schema.org vocabulary could be stored in recfiles. The Zod schemas from 2026-01-12 research could generate recfile schemas or vice versa. Bidirectional conversion would be powerful.

**Recutils × AI/LLM:**
Recfiles as a format for LLM training data or prompt libraries. Each prompt is a record with fields for category, temperature, expected output, etc. Query language selects appropriate prompts. Could feed into AI agents.

**Recutils × Zig/Odin:**
Instead of Rust, implement in Zig or Odin for maximum performance and simplicity. These languages align even better with GNU recutils' C heritage while being more modern.

## Questions Worth Answering

**Format & Compatibility:**

- How strict should compatibility with GNU recutils be? Is 100% compatibility necessary or desirable?
- What are the edge cases in the recutils format spec that aren't well-documented?
- Can the format be extended in backward-compatible ways?
- What's the performance profile of recutils vs. SQLite/JSON for different dataset sizes?

**Use Cases & Users:**

- Who actually uses GNU recutils today, and what for?
- What prevented recutils from wider adoption?
- Are there domains where recutils would be superior but isn't being used?
- Would people use recutils if it had better tooling?

**Technical Decisions:**

- Should parsing be streaming or load everything into memory?
- What's the right abstraction for queries - AST, builder pattern, or something else?
- How should concurrent access be handled? (File locking, WAL, etc.)
- Should there be a binary format for better performance with large files?

**Ecosystem & Integration:**

- Which existing Rust crates would this integrate with? (serde, sqlx, polars?)
- Should this be one monorepo or multiple crates?
- What's the relationship to existing text-format tools (ripgrep, fd, sd)?
- Could this become a database backend for something like Diesel?

**User Experience:**

- What error messages would make the format more approachable?
- Should there be an LSP (Language Server Protocol) for editors?
- What visualization tools would help understand record relationships?
- How do users typically want to edit recfiles - in editor or with CLI?

**Differentiation:**

- What would make this implementation compelling vs. GNU recutils?
- Is "written in Rust" enough of a differentiator?
- What killer feature would drive adoption?
- Should this try to replace GNU recutils or complement it?

**Scope & Roadmap:**

- What's the MVP that provides immediate value?
- Which direction should be pursued first?
- Can multiple directions be explored incrementally?
- What's the 1-year vision vs. the first working prototype?

**Community & Sustainability:**

- Is there enough interest to sustain an open source project?
- What's the maintenance burden of compatibility testing?
- How to build community around a niche format?
- Should this eventually try to become the "official" modern implementation?
