---
plan: 02-02
status: complete
commit: d5e50c7
tests_added: 48
tests_total: 124
duration_estimate: ~30min
---

# Plan 02-02 Summary: Elixir/Proto Extractors, Event Detector, Pipeline

## What was built

Four domain-specific modules completing the indexing pipeline:

1. **elixir.ts** — `extractElixirModules(repoPath)` finds .ex files under lib/ and apps/*/lib/, parses defmodule, @moduledoc, public functions, Ecto schemas. Classifies as context/command/query/schema/module.
2. **proto.ts** — `extractProtoDefinitions(repoPath)` parses .proto files for messages (with fields), services (with RPCs), and package names. Uses brace-depth tracking for nested structures.
3. **events.ts** — `detectEventRelationships(repoPath, protos, modules)` identifies producers (repo owns proto messages) and consumers (handle_event/handle_message patterns in .ex files).
4. **pipeline.ts** — `indexAllRepos(db, options)` and `indexSingleRepo(db, repoPath, options)` orchestrate the full pipeline: discover repos, check commit SHA for skip, run all extractors, persist to DB with FTS, insert event edges. Per-repo error isolation (IDX-07).

## Key decisions

- Elixir parser uses regex-based extraction (no AST) — good enough for defmodule/def patterns
- Proto parser tracks brace depth for message boundaries — handles nested messages
- Event consumer detection regex: `/def\s+handle_(?:event|message)\s*\(%(\w+(?:\.\w+)*)\{/g`
- Pipeline maps extractor output to writer format inline (no intermediate types)
- Incremental indexing: compares last_indexed_commit vs current HEAD, uses getChangedFiles for deletions

## Requirements covered

- IDX-03: Elixir module extraction with classification
- IDX-04: Proto parsing with messages, fields, services, RPCs
- IDX-05: Kafka event producer/consumer detection
- IDX-06: Pipeline orchestrator with incremental indexing
- IDX-07: Per-repo error isolation (try/catch in main loop)

## Files

- `src/indexer/elixir.ts`, `proto.ts`, `events.ts`, `pipeline.ts`
- `tests/indexer/elixir.test.ts` (16), `proto.test.ts` (11), `events.test.ts` (10), `pipeline.test.ts` (11)
- `src/index.ts` — added Plan 02 exports
