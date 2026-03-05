---
phase: 04-cli-mcp-knowledge
plan: 01
status: complete
started: "2026-03-05"
completed: "2026-03-05"
---

# Plan 04-01: CLI scaffolding with commander.js

## What Was Built

Complete CLI entry point with 4 core subcommands wrapping the existing storage, indexing, and search layers:
- `kb index`: Triggers indexAllRepos, outputs JSON results. Options: --root, --force.
- `kb search <query>`: Full-text search via searchText, or structured entity cards via findEntity with --entity flag. Options: --repo, --type, --limit.
- `kb deps <entity>`: Dependency graph via queryDependencies, hardcoded depth:1 (direct neighbors only per user decision). Options: --direction, --repo.
- `kb status`: Database statistics (repo/module/event/edge/learnedFacts counts) as JSON.

All output is JSON to stdout. Errors go to stderr as JSON with `error` and `code` fields. No colors, no human formatting.

## Key Files

### Created
- `src/cli/index.ts` -- CLI entry point with shebang, commander program, subcommand registration
- `src/cli/output.ts` -- `output()` and `outputError()` JSON helpers
- `src/cli/db.ts` -- `getDbPath()` (KB_DB_PATH env or ~/.kb/knowledge.db) and `withDb()` lifecycle helper
- `src/cli/commands/index-cmd.ts` -- kb index command
- `src/cli/commands/search.ts` -- kb search command
- `src/cli/commands/deps.ts` -- kb deps command
- `src/cli/commands/status.ts` -- kb status command
- `tests/cli/commands.test.ts` -- 10 tests

### Modified
- `package.json` -- Added commander deps, bin field (`"kb": "dist/cli/index.js"`)

## Test Results

- 10 new tests added
- 167 total tests passing at time of commit (no regressions)
- TypeScript compiles cleanly

## Design Decisions

- **File named `index-cmd.ts`:** Avoids collision with barrel export `index.ts` pattern.
- **`withDb` helper:** Opens and closes DB per command invocation. Simple, no connection pooling needed for CLI.
- **`process.stdout.write` over `console.log`:** Avoids trailing newline inconsistencies. JSON output has explicit `\n`.
- **Hardcoded depth:1 for deps:** Per user decision, direct neighbors only. No transitive traversal in CLI.
- **`--entity` flag on search:** Single command with two modes rather than separate `search` and `entity` commands.

## Self-Check: PASSED

- [x] `kb index` triggers indexAllRepos and outputs JSON
- [x] `kb search <query>` returns JSON array of text search results
- [x] `kb deps <entity>` returns JSON dependency graph with direct neighbors
- [x] `kb status` returns JSON summary of database stats
- [x] All CLI output is valid JSON to stdout
- [x] `kb` binary is executable via `node dist/cli/index.js`
- [x] Full test suite green
