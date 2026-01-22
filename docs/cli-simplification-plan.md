# CLI Simplification Plan

## Context

We are simplifying the CLI from a separate package into an internal tool to
reduce overhead while iterating. The CLI will live under `src/cli/` and build
to `dist/cli` using tsdown. We will also consolidate API schemas into a shared
module inside `src/` for both the worker and CLI.

## Goals

- Remove the monorepo-style CLI package while preserving functionality.
- Share API request/response schemas locally inside the worker codebase.
- Keep CLI build output in `dist/cli` using tsdown for now.
- Leave a clean path to re-split into a monorepo later.

## Detailed Steps

1. **Audit current CLI entrypoints and references**
   - Confirm `packages/cli/src/index.ts` is the entry file.
   - Locate any scripts/docs that reference `packages/cli` paths.

2. **Create shared API schema module**
   - Add `src/types/api.ts` with shared schemas and types:
     - `ModeSchema`, `ModelSchema`, `JobStatusSchema`
     - `ExploreRequestSchema`, `ExploreResponseSchema`,
       `JobStatusResponseSchema`
     - Export inferred types from these schemas.

3. **Update worker to use shared API schemas**
   - Replace schema definitions in `src/jobs.ts` with imports from
     `src/types/api.ts`.
   - Extend worker-only fields (e.g., `webhook_url`, `callback_secret`) locally
     in `src/jobs.ts` or a new `src/types/worker.ts` module.

4. **Move CLI into `src/cli/`**
   - Move `packages/cli/src/**` to `src/cli/**`.
   - Update imports to use `@/` alias where appropriate.
   - Update any relative paths to match the new directory layout.

5. **Add root tsdown config for CLI build**
   - Add `tsdown.config.ts` at repo root (if missing).
   - Set entry to `src/cli/index.ts`.
   - Set output directory to `dist/cli`.
   - Ensure ESM output and correct bin-style entry when needed.

6. **Update root package scripts**
   - Add `cli:build` and `cli:dev` scripts using tsdown.
   - Keep worker scripts intact.

7. **Remove old CLI package scaffolding**
   - Delete `packages/cli/package.json`.
   - Delete `packages/cli/tsconfig.json`.
   - Delete `packages/cli/tsdown.config.ts`.
   - Remove `packages/cli` directory if empty.

8. **Validate**
   - Run `bun run typecheck`.
   - Run `bun run cli:build` and ensure output in `dist/cli`.
   - Smoke-test CLI by executing the built entry.

## Follow-ups

- Update `docs/cli-spec.md` once the refactor lands.
- Revisit a monorepo split once the API/CLI/frontend boundaries stabilize.
