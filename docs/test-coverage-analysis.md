# Test Coverage Analysis

**Date:** 2026-01-24
**Overall Coverage:** 70.81% statements, 56.76% branches, 69.86% functions

## Executive Summary

The codebase has good test coverage for core API clients and middleware (85-100%), but critical gaps exist in:
- **CLI modules** (0% coverage - 11 files completely untested)
- **Utility functions** (0% coverage for logger and slug)
- **Error classes** (26.66% coverage)
- **API endpoints** (38.57% coverage)

The most concerning gap is the **CLI encryption module** (`src/cli/lib/crypto.ts`) which handles sensitive API token storage with 0% test coverage.

---

## Coverage by Module

### ✅ Well-Tested Modules (>85% coverage)

| Module | Coverage | Status |
|--------|----------|--------|
| `src/clients/` | 90.78% | Excellent - anthropic.ts, github.ts, tool-executor.ts all well tested |
| `src/middleware/auth.ts` | 93.75% | Excellent |
| `src/prompts/index.ts` | 85% | Good |
| `src/types/api.ts` | 100% | Complete |
| `src/utils/retry.ts` | 100% | Complete |
| `src/utils/webhook.ts` | 100% | Complete |

### ⚠️ Modules Needing Improvement

| Module | Coverage | Lines Missing Coverage |
|--------|----------|------------------------|
| `src/workflows/exploration.ts` | 81.86% | 113, 133, 152-153, 165-171, 178, 188, 201, 215, 240-241, 260-268, 336, 358, 383, 392, 457, 499, 648-684 |
| `src/jobs.ts` | 61.9% | 54-60, 70, 80, 86, 97-102, 116-144, 150, 171, 174, 177, 181, 249, 261, 267-270, 288, 301, 331 |
| `src/index.ts` | 38.57% | 70, 116, 119-184, 191-192, 203, 212, 255-420 |

### 🚨 Critical Coverage Gaps (0-27% coverage)

| Module | Coverage | Issue |
|--------|----------|-------|
| **`src/cli/` (all files)** | **0%** | **Entire CLI untested - 11 files** |
| `src/utils/logger.ts` | 0% | All logging functions untested |
| `src/utils/slug.ts` | 0% | Slug generation untested (only mocked) |
| `src/errors.ts` | 26.66% | Only basic instantiation tested |

---

## Priority 1: CLI Module Testing (CRITICAL)

### Status: 0% coverage across 11 files

The CLI has zero test coverage, including security-critical encryption code.

#### 🔐 Security-Critical Files

##### `src/cli/lib/crypto.ts`
**Risk Level:** HIGH - Handles AES-256-GCM encryption for API tokens

**Untested functionality:**
- `encrypt(plaintext)` - AES-256-GCM encryption with random IV
- `decrypt(ciphertext)` - Decryption with authentication
- `deriveKey()` - Key derivation from machine ID

**Required tests:**
```typescript
describe('crypto', () => {
  it('should encrypt and decrypt roundtrip successfully')
  it('should generate different ciphertexts for same plaintext (random IV)')
  it('should throw on invalid ciphertext')
  it('should throw on tampered auth tag')
  it('should handle empty strings')
  it('should handle unicode and special characters')
  it('should derive deterministic key from machine ID')
})
```

##### `src/cli/lib/config.ts`
**Risk Level:** MEDIUM - Manages encrypted token storage and config validation

**Untested functionality:**
- `loadConfig()` - JSON parsing with schema validation
- `saveConfig(config)` - File I/O with validation
- `setApiKey(token)` - Encrypt and store API token
- `getApiKey()` - Decrypt stored token with fallback to env var
- `setConfigValue(key, value)` - Schema validation for mode/model

**Required tests:**
```typescript
describe('config', () => {
  it('should create config directory if missing')
  it('should return empty config when file does not exist')
  it('should save and load config roundtrip')
  it('should validate mode enum (business/exploration)')
  it('should validate model enum (sonnet/opus)')
  it('should reject invalid URLs')
  it('should prefer env var over stored token')
  it('should decrypt stored token correctly')
  it('should handle corrupted config file gracefully')
  it('should handle decryption failures for invalid tokens')
})
```

#### Important CLI Files

##### `src/cli/lib/api.ts`
**Untested:** API client for submitting ideas to worker

**Required tests:**
- Request construction with auth headers
- Error handling (network, 4xx, 5xx)
- Timeout handling
- Response parsing

##### `src/cli/commands/*.ts`
**Untested:** All CLI commands (init, config, auth, submit, status)

**Required tests:**
- Command parsing and validation
- Interactive prompts
- Error messages
- Success/failure exit codes

---

## Priority 2: Utility Functions

### `src/utils/logger.ts` - 0% coverage

**Risk:** Production debugging relies on structured logs

**Untested functionality:**
- `logJobCreated()`, `logWebhookSent()`, `logJobComplete()`, `logError()`, `logInfo()`, `logWarn()`

**Required tests:**
```typescript
describe('logger', () => {
  it('should output valid JSON')
  it('should include timestamp, level, event in all logs')
  it('should attach job_id when provided')
  it('should serialize errors correctly')
  it('should handle unknown error types')
  it('should merge additional data fields')
})
```

### `src/utils/slug.ts` - 0% coverage

**Risk:** Used for GitHub file paths - bugs could cause commit failures

**Untested functionality:**
- `generateSlug(text)` - Converts text to URL-safe slug

**Required tests:**
```typescript
describe('generateSlug', () => {
  it('should return "untitled" for empty/null/undefined')
  it('should convert to lowercase')
  it('should replace spaces with hyphens')
  it('should remove special characters')
  it('should truncate to 50 characters')
  it('should truncate at word boundary when possible')
  it('should remove trailing hyphens')
  it('should handle unicode characters')
  it('should handle emoji')
  it('should collapse multiple hyphens')
})
```

---

## Priority 3: Error Classes

### `src/errors.ts` - 26.66% coverage

**Issue:** 13 error classes defined, but most constructors never executed in tests

**Untested errors:**
- `GitHubNotFoundError`, `GitHubConflictError`, `GitHubApiError`, `GitHubConfigError`
- `AnthropicApiError`
- `StorageError`, `JobNotFoundError`, `JsonParseError`
- `WebhookDeliveryError`
- `WorkflowCreationError`, `WorkflowNotFoundError`, `WorkflowStepError`, `WorkflowFailureError`
- `ExplorationLogParseError`, `ExplorationLogUpdateError`

**Required tests:**
```typescript
describe('errors', () => {
  describe('GitHubNotFoundError', () => {
    it('should include path in message')
    it('should have correct tag')
  })

  describe('GitHubApiError', () => {
    it('should include operation and status in message')
    it('should handle Error cause')
    it('should handle string cause')
    it('should handle unknown cause')
  })

  // Similar tests for each error class
})
```

---

## Priority 4: API Routes

### `src/index.ts` - 38.57% coverage

**Missing coverage:** Lines 119-184, 191-192, 203, 212, 255-420

**Untested routes:**
- Health check endpoint
- Some error handling middleware
- Edge cases in POST /ideas

**Required tests:**
```typescript
describe('API routes', () => {
  it('GET /health should return 200')
  it('should return 401 for missing auth header')
  it('should return 401 for invalid bearer token')
  it('should return 400 for malformed request body')
  it('should handle oversized payloads')
  it('should handle concurrent POST requests')
  it('should return 500 on KV failure')
})
```

---

## Priority 5: Workflow Edge Cases

### `src/workflows/exploration.ts` - 81.86% coverage

**Good coverage overall, but missing:**
- Error recovery paths (lines 165-171, 260-268, 648-684)
- Retry logic edge cases
- Webhook delivery failure handling

**Required tests:**
```typescript
describe('ExplorationWorkflow edge cases', () => {
  it('should handle GitHub commit failures gracefully')
  it('should retry on transient GitHub errors')
  it('should log webhook delivery failures')
  it('should handle exploration log parsing errors')
  it('should handle workflow timeout scenarios')
  it('should recover from Anthropic API rate limits')
  it('should handle partial results on errors')
})
```

---

## Priority 6: Job Management

### `src/jobs.ts` - 61.9% coverage

**Missing coverage:**
- KV storage error handling (lines 97-102, 116-144)
- Job listing and filtering (lines 267-270, 288, 301, 331)
- Edge cases in job updates

**Required tests:**
```typescript
describe('jobs edge cases', () => {
  it('should handle KV get failures')
  it('should handle KV put failures')
  it('should handle concurrent job updates')
  it('should list jobs with status filter')
  it('should list jobs with limit')
  it('should handle malformed job data in KV')
  it('should handle missing job gracefully')
})
```

---

## Recommended Testing Strategy

### Phase 1: Security & Core Functionality (Week 1)
**Goal:** Cover security-critical code

1. ✅ `src/cli/lib/crypto.ts` - Encryption/decryption (HIGH PRIORITY)
2. ✅ `src/cli/lib/config.ts` - Token storage
3. ✅ `src/utils/logger.ts` - Production debugging
4. ✅ `src/errors.ts` - Error handling

**Target:** 80%+ coverage on these modules

### Phase 2: User-Facing Features (Week 2)
**Goal:** Ensure CLI works reliably

5. ✅ `src/cli/commands/auth.ts` - Token management
6. ✅ `src/cli/commands/submit.ts` - Idea submission
7. ✅ `src/cli/commands/status.ts` - Job status
8. ✅ `src/cli/commands/config.ts` - Config management
9. ✅ `src/cli/lib/api.ts` - API client
10. ✅ `src/utils/slug.ts` - Slug generation

**Target:** 75%+ coverage on CLI

### Phase 3: Edge Cases & Resilience (Week 3)
**Goal:** Handle failure scenarios

11. ✅ `src/index.ts` - Missing API route tests
12. ✅ `src/workflows/exploration.ts` - Error recovery
13. ✅ `src/jobs.ts` - Job management edge cases
14. ✅ Integration tests for full workflows

**Target:** 85%+ overall coverage

---

## Testing Patterns to Follow

The existing tests demonstrate good patterns:

✅ **Co-location:** Tests live next to source files (`*.test.ts`)
✅ **Mocking:** Proper use of `vi.fn()` and `vi.mock()`
✅ **Structure:** Clear `describe`/`it` blocks
✅ **Fixtures:** Reusable mock data
✅ **Coverage:** Both happy path and error cases

**Example from `src/utils/retry.test.ts`:**
```typescript
describe("retryWithBackoff", () => {
  it("should succeed on first attempt if operation succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("success");
    const shouldRetry = vi.fn().mockReturnValue(false);

    const result = await retryWithBackoff(operation, shouldRetry, {
      maxAttempts: 3,
      delaysMs: [100, 200, 400],
    });

    expect(result.success).toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
```

---

## Coverage Goals

| Module | Current | Target |
|--------|---------|--------|
| **Overall** | 70.81% | **85%+** |
| CLI modules | 0% | **80%+** |
| Utils | 33% | **90%+** |
| Errors | 26.66% | **80%+** |
| Core (clients, middleware) | 90%+ | **Maintain 85%+** |

---

## Summary

**Critical Actions:**
1. 🔴 **Immediately add tests for `src/cli/lib/crypto.ts`** - Security risk
2. 🔴 Add tests for `src/cli/lib/config.ts` - Token storage
3. 🟡 Add tests for utility functions (logger, slug)
4. 🟡 Improve error class coverage
5. 🟢 Fill gaps in workflow and job management tests

**Risk Assessment:**
- **HIGH:** Encryption bugs could leak API tokens
- **MEDIUM:** Config corruption could break CLI for all users
- **LOW:** Missing utility tests could hide bugs but won't cause security issues

The CLI being untested is the biggest technical debt, especially given it handles sensitive credentials.
