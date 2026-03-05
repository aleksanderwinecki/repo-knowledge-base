---
phase: 04-cli-mcp-knowledge
plan: 02
status: complete
started: "2026-03-05"
completed: "2026-03-05"
---

# Plan 04-02: Knowledge injection and docs command

## What Was Built

Knowledge injection layer enabling manual fact storage with full-text search integration, plus self-documenting CLI:
- `kb learn <text>`: Stores a fact in learned_facts table and indexes it in FTS. Optional --repo flag.
- `kb learned`: Lists all learned facts as JSON array. Optional --repo filter.
- `kb forget <id>`: Deletes fact from both learned_facts and FTS index. Validates numeric ID.
- `kb docs`: Outputs markdown documentation of all 8 commands with usage examples.
- Schema V2 migration: Adds `learned_facts` table (id, content, repo, created_at).
- FTS integration: Learned facts appear in `kb search` results alongside indexed entities.

## Key Files

### Created
- `src/knowledge/types.ts` -- LearnedFact interface
- `src/knowledge/store.ts` -- learnFact, listFacts, forgetFact with direct FTS INSERT/DELETE
- `src/cli/commands/learn.ts` -- kb learn command
- `src/cli/commands/learned.ts` -- kb learned command
- `src/cli/commands/forget.ts` -- kb forget command
- `src/cli/commands/docs.ts` -- kb docs command (raw markdown output)
- `tests/knowledge/store.test.ts` -- 14 tests
- `tests/cli/knowledge-commands.test.ts` -- 11 tests

### Modified
- `src/db/schema.ts` -- SCHEMA_VERSION 1 -> 2
- `src/db/migrations.ts` -- Added migrateToV2 (learned_facts table)
- `src/search/text.ts` -- Added 'learned_fact' case in hydration switch, hydrateLearnedFact function
- `src/cli/index.ts` -- Registered learn, learned, forget, docs commands
- `src/index.ts` -- Added knowledge module exports
- `tests/db/schema.test.ts` -- Updated to use SCHEMA_VERSION constant instead of hardcoded 1

## Test Results

- 25 new tests added (14 store + 11 CLI knowledge-commands)
- 192 total tests passing (no regressions)
- TypeScript compiles cleanly

## Design Decisions

- **Direct FTS INSERT instead of indexEntity helper:** The `indexEntity` function accepts `EntityType` which doesn't include 'learned_fact'. Rather than type gymnastics, we write directly to the knowledge_fts table (its TEXT column accepts any string).
- **`switch (entityType as string)` in text.ts:** Allows handling 'learned_fact' in the hydration switch without extending the EntityType union (which would have ripple effects across the codebase).
- **Default repo 'user-knowledge':** Unassociated learned facts get repoName 'user-knowledge' in search results so they're distinguishable from indexed content.
- **ORDER BY created_at DESC, id DESC:** Tiebreaker on id ensures stable sort when multiple facts share the same timestamp.
- **Docs command outputs raw markdown:** Not JSON -- it's documentation for AI discoverability, not data.

## Self-Check: PASSED

- [x] `kb learn` stores fact in DB and FTS index, outputs JSON confirmation
- [x] `kb learn --repo` associates fact with specific repo
- [x] `kb learned` lists all facts as JSON array
- [x] `kb learned --repo` filters by repo
- [x] `kb forget <id>` removes from both DB and FTS, outputs confirmation
- [x] `kb search` returns learned facts alongside indexed data
- [x] `kb docs` outputs markdown documentation
- [x] Schema V2 migration creates learned_facts table
- [x] Full test suite green (192 tests)
