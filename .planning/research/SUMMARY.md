# Project Research Summary

**Project:** repo-knowledge-base v1.1 -- Improved Reindexing & New Extractors
**Domain:** Codebase knowledge base / code intelligence for local microservice indexing
**Researched:** 2026-03-06
**Confidence:** HIGH

## Executive Summary

This is a v1.1 iteration of an existing, functional knowledge base CLI (8,193 LOC, 236 tests) that indexes ~50 Elixir/gRPC microservice repos into a searchable SQLite database. The v1.1 work splits cleanly into two tracks: **pipeline infrastructure** (branch-aware tracking, surgical file-level reindexing, parallel execution) and **new extractors** (GraphQL/Absinthe, gRPC service persistence, Ecto schema enrichment, Event Catalog integration). The existing codebase is well-layered -- new extractors are pure additions -- but the surgical indexing work requires reworking the core pipeline's wipe-and-rewrite model, making it the highest-risk, highest-impact change.

The recommended approach is to fix the indexing pipeline first, then layer new extractors on top. The current pipeline has a critical design flaw: despite having incremental detection (`getChangedFiles`) and per-file deletion (`clearRepoFiles`), it always does full extraction and full wipe-and-rewrite via `clearRepoEntities`. Surgical indexing is not a tweak -- it is a pipeline mode change. Branch-aware tracking must come first as a prerequisite. Parallel execution should come last since it is an optimization on top of an already-improved pipeline. New extractors are independent of each other and can be built in any order once the schema migration is designed.

The key risks are: (1) orphaned FTS entries during surgical updates when entity IDs change but FTS references are not cleaned, (2) dangling cross-repo edges when one repo is re-indexed and its entity IDs change but other repos' edges still point to old IDs, and (3) SQLite write lock contention if parallelism is not architectured as parallel-extraction + serial-writes. All three are solvable with known patterns, but all three will cause silent data corruption if not addressed deliberately. The recovery strategy is always `kb index --force` (full wipe-and-rewrite), which means these bugs degrade gracefully rather than catastrophically.

## Key Findings

### Recommended Stack

Only 3 new npm dependencies needed. The existing regex-based extraction approach is sound for Elixir/proto patterns, and most v1.1 features are wiring changes or regex extensions, not new library integrations.

**New dependencies:**
- `graphql` (^16.13.1): Parse `.graphql` SDL files -- the official reference parser, justified because GraphQL SDL is too complex for regex (nested types, directives, interfaces, unions)
- `gray-matter` (^4.0.3): Parse YAML frontmatter from EventCatalog `.mdx` files -- battle-tested, handles delimiter edge cases
- `p-limit` (^7.3.0): Bounded concurrency for parallel repo indexing -- pure ESM, 2KB, zero deps

**No new dependencies needed for:** gRPC service extraction (existing `proto.ts` already parses services), Ecto schema fields/associations (regex extension of `elixir.ts`), branch-aware git tracking (`execSync` calls), surgical file-level reindexing (existing `clearRepoFiles` + `getChangedFiles`).

**Explicitly avoid:** `protobufjs` (67MB overkill), `tree-sitter-elixir` (native addon + node-gyp for marginal gain), `simple-git` (wraps 2-3 commands we already do), `worker_threads` (better-sqlite3 not thread-safe).

### Expected Features

**Must have (table stakes):**
- Branch-aware git tracking -- v1.0 indexes whatever branch is checked out, polluting the KB with WIP code
- Surgical file-level re-indexing -- v1.0 wipes and rewrites ALL entities on every incremental index, defeating the purpose of `getChangedFiles`
- Parallel repo indexing -- sequential indexing of 50+ repos is slow for a release focused on "improved reindexing"
- Ecto schema field/association extraction -- low-hanging fruit given existing regex infrastructure

**Should have (differentiators):**
- GraphQL/Absinthe schema extraction -- answers "what API surface does this service expose?"
- gRPC service definition persistence -- the parser already extracts this data, it is just never stored
- Event Catalog integration -- enriches the KB with curated domain ownership, event descriptions, team assignments

**Defer (anti-features for v1.1):**
- Worker thread parallelism (better-sqlite3 constraint)
- Full AST parsing for Elixir (tree-sitter overhead not justified)
- GraphQL introspection from running services (violates local-only constraint)
- Real-time file watching (on-demand indexing is sufficient)

### Architecture Approach

The v1.1 architecture introduces a dual-mode pipeline: full wipe-and-rewrite (existing behavior, for new repos or `--force`) and surgical file-scoped updates (for incremental changes). Extraction is separated from persistence to enable parallel execution -- extractors run concurrently across repos (CPU/IO-bound work), then results are persisted sequentially from the main thread (SQLite single-writer constraint).

**Major components:**
1. **Branch resolver** (`git.ts`) -- determines default branch per repo, resolves to main/master SHA regardless of checked-out branch
2. **Dual-mode pipeline** (`pipeline.ts`) -- orchestrates full vs. surgical indexing based on commit ancestry, routes changed files to extractors
3. **File-scoped writer** (`writer.ts`) -- new `persistFileData` function that clears+reinserts entities for specific files only, maintaining FTS consistency
4. **New extractors** (`graphql.ts`, `grpc.ts`, enhanced `elixir.ts`, `eventcatalog.ts`) -- hook into the pipeline at the standard extraction point, all must set `source_file` correctly for surgical deletion
5. **Parallel orchestrator** (`pipeline.ts`) -- `p-limit` wrapping extraction phase with concurrency of 4, sequential persistence on main thread

### Critical Pitfalls

1. **Orphaned FTS entries during surgical updates** -- When entities are deleted and re-created with new IDs, FTS references become stale. Prevention: delete FTS entries BEFORE deleting entity rows, within the same transaction. The existing `clearRepoFiles` partially handles this but needs extension for modified (not just deleted) files.

2. **Dangling cross-repo edges after partial re-index** -- The `edges` table uses polymorphic IDs without foreign keys. When repo A's entities get new IDs, repo B's edges pointing at repo A's old entity IDs become dangling. Prevention: when re-indexing a repo, also delete edges in other repos that target this repo's entities. Or better: use stable identifiers (`repo_name + entity_name`) instead of auto-increment IDs for cross-repo references.

3. **SQLite write lock contention** -- better-sqlite3 connections cannot be shared across threads, and even in WAL mode only one writer is allowed at a time. Prevention: parallelize extraction only, serialize all DB writes on the main thread. Do not open separate DB connections in workers.

4. **Detached HEAD crashes indexer** -- `git symbolic-ref` fails on detached HEAD. Prevention: use `git rev-parse refs/heads/main` instead of `symbolic-ref`, with fallback chain main -> master -> HEAD.

5. **EventCatalog has no HTTP API** -- The `@eventcatalog/sdk` is file-based, not network-based. The integration must parse local `.mdx` files with frontmatter, not call an HTTP endpoint. Prevention: use `gray-matter` to parse frontmatter directly from the catalog repo's filesystem.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation -- Branch-Aware Tracking & Schema Migration

**Rationale:** Smallest change, immediately valuable, and is a hard prerequisite for surgical indexing. Also the right time to design and implement the V3 schema migration that all subsequent phases need.
**Delivers:** Repos always indexed from main/master branch regardless of local checkout state. New `default_branch` and `metadata` columns in the database.
**Features:** Branch-aware git tracking (table stake)
**Avoids:** Detached HEAD crash (Pitfall 1), wrong diff after branch switch (Pitfall 9)
**Stack:** No new dependencies -- `execSync` calls in `git.ts`

### Phase 2: Core Pipeline -- Surgical File-Level Indexing

**Rationale:** The highest-impact infrastructure change and the most architecturally complex. Must come before parallelism because parallel full-wipe is pointless. This is where the dual-mode pipeline is built: the full path stays as-is, the surgical path routes changed files to extractors and uses `persistFileData` for file-scoped writes.
**Delivers:** Incremental reindexing that only touches changed files. Dramatically faster re-index for repos with small changes.
**Features:** Surgical file-level re-indexing (table stake)
**Avoids:** Orphaned FTS entries (Pitfall 2), dangling cross-repo edges (Pitfall 4), missing source_file convention (Pitfall 10)
**Stack:** No new dependencies -- refactors `pipeline.ts`, `writer.ts`, and adds `changedFiles` filter parameter to all extractors

### Phase 3: New Extractors

**Rationale:** Independent of each other, all hook into the pipeline at the same extension point. Can be shipped incrementally. Grouped together because they all need the V3 schema migration from Phase 1 and should follow the file-scoped conventions established in Phase 2.
**Delivers:** GraphQL types/queries/mutations, gRPC service entities + client/server edges, Ecto schema fields/associations, Event Catalog domain/team/event enrichment
**Features:** All differentiator features -- GraphQL extraction, gRPC persistence, Ecto enrichment, Event Catalog integration

Suggested sub-ordering within Phase 3:
1. **gRPC service persistence** -- nearly free, data already extracted, just needs DB wiring
2. **Ecto schema enrichment** -- extends existing `elixir.ts`, straightforward regex additions
3. **GraphQL/Absinthe extraction** -- new extractor file, requires `graphql` npm package for SDL and Elixir-specific regex for Absinthe
4. **Event Catalog integration** -- architecturally different (supplementary data source, not a per-repo extractor), requires `gray-matter`, has merge/dedup complexity

**Avoids:** Ecto duplication of existing module data (Pitfall 7), gRPC re-implementation of existing parser (Pitfall 8), Absinthe/SDL confusion (Pitfall 14), EventCatalog HTTP assumption (Pitfall 5)
**Stack:** `graphql`, `gray-matter`

### Phase 4: Parallel Execution

**Rationale:** Optimization, not functionality. Surgical indexing from Phase 2 already dramatically reduces reindex time. Parallelism is the cherry on top. Also benefits from having all extractors finalized (less rework of the parallel extraction pipeline).
**Delivers:** 2-4x speedup on full re-index by overlapping file I/O across repos
**Features:** Parallel repo indexing (table stake)
**Avoids:** SQLite write lock contention (Pitfall 3), I/O saturation (Pitfall 11), MCP sync conflicts (Pitfall 13)
**Stack:** `p-limit`

### Phase Ordering Rationale

- **Branch tracking before surgical indexing:** Surgical indexing needs accurate commit tracking against the right branch. If you compare against HEAD on a feature branch, the changed-file diff is wrong.
- **Surgical indexing before parallelism:** Parallel full-wipe is wasteful. Parallel surgical updates are where the real speedup lives.
- **Extractors after surgical indexing:** New extractors must follow the `source_file` convention and `changedFiles` filter pattern established in Phase 2. Building them after the pattern exists avoids retrofitting.
- **gRPC wiring first among extractors:** It is essentially free (data already parsed, just not persisted) and validates the extractor -> persistence -> FTS pipeline for new entity types.
- **Parallelism last:** It is an optimization, and the pipeline must be stable before adding concurrency complexity.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Surgical Indexing):** The cross-repo edge consistency problem is the trickiest design decision. Need to decide between stable identifiers vs. cascading re-index vs. orphan cleanup. Worth a focused research spike.
- **Phase 3, Event Catalog:** EventCatalog frontmatter field names may vary between v2 and v3. Need to validate against the actual `fresha-event-catalog` repo during implementation. The merge/dedup logic (matching catalog event names to proto message names) needs heuristic design.
- **Phase 3, GraphQL:** Need to audit actual repos to determine whether Absinthe macros or `.graphql` SDL files are the primary schema definition format. Both paths should be built, but effort allocation depends on what the repos actually use.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Branch Tracking):** Well-documented git commands, minimal code changes, clear fallback chain.
- **Phase 4 (Parallel Execution):** The `p-limit` + `Promise.all` pattern is well-established. The architecture decision (parallel extract, serial write) is already settled by the better-sqlite3 constraint.
- **Phase 3, gRPC persistence:** Pure wiring of already-extracted data. No unknowns.
- **Phase 3, Ecto enrichment:** Ecto schema DSL is rigid and well-documented. Regex patterns are straightforward.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Only 3 new deps, all verified on npm with version pinning. Existing stack validated and unchanged. |
| Features | HIGH | Based on direct codebase analysis. Feature deps and complexity assessed against real code. |
| Architecture | HIGH | Verified against existing source files. Dual-mode pipeline and extraction/persistence separation are well-understood patterns. |
| Pitfalls | HIGH | All critical pitfalls verified by reading the actual code paths that would fail. Prevention strategies are concrete, not theoretical. |

**Overall confidence:** HIGH

### Gaps to Address

- **EventCatalog frontmatter schema:** Verified against EventCatalog v3 docs, but actual `fresha-event-catalog` repo may use v2 or custom fields. Validate during Phase 3 implementation.
- **Absinthe vs. SDL prevalence:** Research identified both extraction paths are needed, but the ratio of Absinthe-based vs. `.graphql`-based repos is unknown. Audit repos before allocating effort.
- **Cross-repo edge stability model:** Three approaches identified (stable identifiers, cascading re-index, orphan cleanup) but no clear winner. Needs design decision during Phase 2 planning.
- **gray-matter TypeScript types:** `@types/gray-matter` may be outdated. May need type assertions or a thin wrapper. Minor issue, handle during implementation.
- **Sync concurrency:** MCP auto-sync and CLI `kb index` can conflict via SQLite write locks. This is a latent v1.0 bug that becomes more likely with parallelism. Should add `busy_timeout` pragma regardless of v1.1 work.

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis: `git.ts`, `pipeline.ts`, `writer.ts`, `elixir.ts`, `proto.ts`, `events.ts`, `fts.ts`, `database.ts`, `sync.ts`
- graphql npm package (v16.13.1) -- [npmjs.com](https://www.npmjs.com/package/graphql)
- p-limit (v7.3.0) -- [npmjs.com](https://www.npmjs.com/package/p-limit)
- gray-matter (v4.0.3) -- [npmjs.com](https://www.npmjs.com/package/gray-matter)
- better-sqlite3 threading docs -- [GitHub](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md)
- SQLite WAL mode -- [sqlite.org/wal.html](https://sqlite.org/wal.html)
- Ecto.Schema docs -- [hexdocs.pm](https://hexdocs.pm/ecto/Ecto.Schema.html)
- Absinthe.Schema.Notation docs -- [hexdocs.pm](https://hexdocs.pm/absinthe/Absinthe.Schema.Notation.html)
- git rev-parse, git symbolic-ref -- [git-scm.com](https://git-scm.com/docs/)

### Secondary (MEDIUM confidence)
- EventCatalog v3 project structure -- [eventcatalog.dev/docs](https://www.eventcatalog.dev/docs/development/getting-started/project-structure)
- EventCatalog SDK -- [eventcatalog.dev/docs/sdk](https://www.eventcatalog.dev/docs/sdk)
- `fresha-event-catalog` repo structure -- direct inspection (catalog may have evolved since inspection)

---
*Research completed: 2026-03-06*
*Ready for roadmap: yes*
