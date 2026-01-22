# Idea CLI Specification

A command-line interface for submitting ideas to the idea-explorer worker API.

## Overview

| Property | Value |
|----------|-------|
| CLI Name | `idea` |
| Location | `src/cli/` (internal package) |
| Build Tool | tsdown (output: `dist/cli`) |
| Installation | Local build, symlink to PATH |
| Prompts Library | @clack/prompts |
| CLI Library | commander |

## Subcommands

### `idea submit`

Submit an idea for exploration.

**Input Methods:**
- **stdin**: Read idea text until EOF (supports multi-line). Use for piping: `echo "my idea" | idea submit` or `cat idea.txt | idea submit`
- **Interactive**: If no stdin detected, launch clack wizard prompts
- **Hybrid**: Stdin provides idea, flags provide metadata

**Flags:**
| Flag | Type | Description |
|------|------|-------------|
| `--mode` | `business` \| `exploration` | Exploration mode (default from config or API default) |
| `--model` | `sonnet` \| `opus` | Model to use (default from config or API default) |
| `--context` | string | Additional context - auto-detects if value is a file path and reads it |
| `--update` | boolean | Update an existing idea rather than create new |
| `--debug` | boolean | Enable debug mode (collect_tool_stats + verbose errors) |
| `--json` | boolean | Output structured JSON instead of human-friendly text |
| `--quiet` | boolean | Suppress all output except the job ID |
| `--verbose` | boolean | Show detailed error information |

**Interactive Wizard Flow:**
When no stdin is provided, launch clack prompts. Only prompt for fields not already provided via flags:
1. Idea text (required, multi-line text input)
2. Mode selection (optional, select prompt)
3. Model selection (optional, select prompt)
4. Additional context (optional, text input)

**Output:**
- Default: Styled terminal output with job ID
- `--json`: `{"job_id": "abc123", "status": "pending"}`
- `--quiet`: Just the job ID on stdout

**Exit Codes:**
- `0`: Success
- `1`: Error (missing auth, API failure, validation error)

### `idea status <job-id>`

Check the status of a submitted job.

**Behavior:** One-shot query - shows current status and exits immediately (no polling/watch mode).

**Output Fields:**
- Status (pending, running, completed, failed)
- Idea text
- Mode
- GitHub URL (if completed)
- Error message (if failed)
- Progress info (if running): current step, steps completed/total

**Flags:**
| Flag | Type | Description |
|------|------|-------------|
| `--json` | boolean | Output structured JSON |
| `--verbose` | boolean | Show detailed error information |

### `idea init`

Interactive setup wizard for initial configuration.

**Flow:**
1. Welcome message
2. Prompt for API URL (show default, allow override)
3. Prompt for default mode preference
4. Prompt for default model preference
5. Remind user to set `IDEA_EXPLORER_API_KEY` env var
6. Write config to `~/.config/idea/settings.json`
7. Success message

### `idea config`

Manage CLI configuration.

**Subcommands:**
| Command | Description |
|---------|-------------|
| `idea config list` | Show all current configuration values |
| `idea config get <key>` | Get a specific config value |
| `idea config set <key> <value>` | Set a config value |
| `idea config unset <key>` | Remove a config value |

**Configurable Keys:**
- `api_url` - Worker API URL
- `default_mode` - Default exploration mode
- `default_model` - Default model

## Configuration

### File Location

`~/.config/idea/settings.json`

### Schema

```json
{
  "api_url": "https://idea-explorer.example.workers.dev",
  "default_mode": "business",
  "default_model": "sonnet"
}
```

### Precedence (highest to lowest)

1. Command-line flags
2. Environment variables
3. Config file
4. Hardcoded defaults

## Authentication

**API Key:** Always from `IDEA_EXPLORER_API_KEY` environment variable. Never stored in config file for security.

**Missing Auth Behavior:** Print error message explaining how to set the env var, exit with code 1.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `IDEA_EXPLORER_API_KEY` | **Required.** API key for worker authentication |
| `IDEA_EXPLORER_URL` | Override API URL (takes precedence over config file) |

## Error Handling

- **Default:** User-friendly error messages
- **`--verbose` or `--debug`:** Full error details including HTTP status codes and response bodies
- **Network errors:** Friendly message with suggestion to check connectivity
- **Auth errors:** Clear message about missing/invalid API key
- **Validation errors:** Show which field failed validation and why

## Help

Basic `--help` flag on each command showing usage information.

```
$ idea --help
Usage: idea <command> [options]

Commands:
  submit    Submit an idea for exploration
  status    Check job status
  init      Setup wizard
  config    Manage configuration

$ idea submit --help
Usage: idea submit [options]

Submit an idea for exploration.

Options:
  --mode <mode>       Exploration mode (business, exploration)
  --model <model>     Model to use (sonnet, opus)
  --context <text>    Additional context (string or file path)
  --update            Update existing idea
  --debug             Enable debug mode
  --json              Output as JSON
  --quiet             Only output job ID
  --verbose           Show detailed errors
  --help              Show this help
```

## API Integration

The CLI communicates with the idea-explorer worker API:

**Endpoints Used:**
- `POST /api/explore` - Submit idea (requires auth)
- `GET /api/status/:id` - Get job status (requires auth)

**Request Schema (from worker):**
```typescript
{
  idea: string;           // Required
  mode?: "business" | "exploration";
  model?: "sonnet" | "opus";
  context?: string;
  update?: boolean;
  collect_tool_stats?: boolean;  // Enabled by --debug
}
```

## Project Structure

```
src/cli/
├── index.ts          # Entry point, command routing
├── commands/
│   ├── submit.ts     # Submit command
│   ├── status.ts     # Status command
│   ├── init.ts       # Init wizard
│   └── config.ts     # Config management
├── lib/
│   ├── api.ts        # API client
│   ├── config.ts     # Config file handling
│   └── output.ts     # Output formatting (human/json/quiet)
└── prompts/
    └── submit.ts     # Clack prompts for submit wizard

dist/cli/
├── index.js          # Built CLI entry
└── index.d.ts
```

## Dependencies

- `@clack/prompts` - Interactive prompts
- Shared types from `src/types/api.ts` (ModeSchema, ModelSchema, ExploreRequestSchema)

## Usage Examples

```bash
# Interactive submission
idea submit

# Pipe idea from stdin
echo "Build a task queue system" | idea submit

# Multi-line idea from file
cat idea.txt | idea submit --mode exploration --model opus

# With context from file
idea submit --context ./background.md

# Quick submission with all flags
echo "Add rate limiting" | idea submit --mode business --quiet

# Check status
idea status abc123

# JSON output for scripting
idea status abc123 --json | jq '.status'

# Initial setup
idea init

# View config
idea config list

# Set default model
idea config set default_model opus
```
