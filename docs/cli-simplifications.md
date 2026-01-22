# CLI Code Simplification Opportunities

Review of the CLI implementation in `packages/cli/` for potential simplifications.

## High Priority

### No-op `formatStatusBadge` function

**File:** `src/lib/output.ts:11-24`

```typescript
function formatStatusBadge(status: string): string {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return status;
  }
}
```

This function returns the exact same string it receives as input. It should either be:
- Removed entirely and replaced with direct `status` usage
- Implemented with actual formatting (colors via chalk/picocolors)

## Medium Priority

### Use switch statement in `setConfigValue`

**File:** `src/lib/config.ts:67-83`

The if-else chain for type-checked assignment could be a switch statement:

```typescript
switch (key) {
  case "api_url":
    config.api_url = value;
    break;
  case "default_mode":
    config.default_mode = parseOrThrow(ModeSchema, value, "mode", "business", "exploration");
    break;
  case "default_model":
    config.default_model = parseOrThrow(ModelSchema, value, "model", "sonnet", "opus");
    break;
}
```

### Duplicated `getOutputMode` function

**Files:** `src/commands/submit.ts` and `src/commands/status.ts`

Both files define their own `getOutputMode` function. The one in `submit.ts` handles `quiet` mode while `status.ts` does not. Consolidate in `src/lib/output.ts`.

### Loose return types on config getters

**File:** `src/lib/config.ts:102-108`

```typescript
export function getDefaultMode(): string | undefined {
  return loadConfig().default_mode;
}

export function getDefaultModel(): string | undefined {
  return loadConfig().default_model;
}
```

These should return `Mode | undefined` and `Model | undefined` respectively, since the config is already validated by Zod. This would eliminate type casting at call sites.

### Duplicated validation logic

**Files:** `src/commands/submit.ts:64-90` and `src/lib/config.ts`

`validateMode` and `validateModel` are nearly identical:

```typescript
function validateMode(mode: string | undefined): "business" | "exploration" | undefined {
  if (!mode) return undefined;
  const result = ModeSchema.safeParse(mode);
  if (!result.success) {
    throw new Error(`Invalid mode: ${mode}. Must be 'business' or 'exploration'`);
  }
  return result.data;
}
```

Create a shared validation utility that both files can use.

## Low Priority

### Repeated config key validation

**File:** `src/commands/config.ts` (lines 18-23, 30-35, 47-52)

The same validation and error message pattern is repeated three times:

```typescript
if (!isValidConfigKey(key)) {
  console.error(
    `Unknown config key: ${key}. Valid keys: ${CONFIGURABLE_KEYS.join(", ")}`
  );
  process.exit(1);
}
```

Extract into a helper function like `validateConfigKeyOrExit(key: string): ConfigKey`.

## Summary

| Priority | File | Issue |
|----------|------|-------|
| High | `output.ts` | No-op `formatStatusBadge` |
| Medium | `config.ts` | Use switch in `setConfigValue` |
| Medium | `submit.ts` + `status.ts` | Duplicated `getOutputMode` |
| Medium | `config.ts` | Loose return types on getters |
| Medium | `submit.ts` + `config.ts` | Duplicated validation logic |
| Low | `config.ts` (commands) | Repeated key validation |

The codebase is generally well-structured. These issues are primarily about reducing code duplication and improving type safety.
