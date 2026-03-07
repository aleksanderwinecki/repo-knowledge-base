# Project Research Summary

**Project:** repo-knowledge-base v1.2
**Domain:** Hardening & optimization of existing Node.js/TypeScript CLI + MCP tool with SQLite/FTS5 backend
**Researched:** 2026-03-07
**Confidence:** HIGH

## Executive Summary

This is a hardening milestone for a working 5.7K LOC codebase (46 source files, 388 tests) that indexes microservice repos into a SQLite/FTS5 knowledge base. The existing stack is correct and does not need replacing -- the work is about making what exists faster, DRYer, and more defensible. The research identified zero new dependencies to add and zero architectural restructuring needed. Every improvement is a tighten-in-place fix.

The highest-impact work falls into two buckets: **performance** (prepared statement reuse, missing DB indexes, SQLite pragma tuning, FTS5 optimization) and **code quality** (130-line pipeline.ts duplication, 8 duplicated MCP error handlers, divergent FTS indexing paths, test setup boilerplate). The performance bucket delivers measurable gains: prepared statement hoisting alone eliminates ~4000 redundant SQL compilations during a 50-repo index. The code quality bucket prevents bugs: the pipeline.ts duplication means any extractor change must be applied in two places or it silently diverges.

The primary risk is breaking working code during refactoring. Five critical pitfalls were identified, all specific to refactoring-not-building: pipeline consolidation that breaks parallel/serial isolation, MCP schema changes that silently break AI consumers, FTS tokenizer changes that degrade search quality, schema migrations that require table rebuilds, and test "cleanup" that reduces coverage. The mitigation strategy is: contract tests first, golden FTS tests, no table rebuilds, monotonically increasing test count.

## Key Findings

### Recommended Stack Optimizations

No new dependencies. All optimizations use the existing Node.js/TypeScript/SQLite/better-sqlite3 stack.

**Core changes:**
- **SQLite pragma tuning** (`cache_size`, `temp_store`, `mmap_size`, `optimize` on close): 3 lines of code, better memory utilization for search-heavy workloads
- **Prepared statement reuse**: Hoist `db.prepare()` out of hot loops in fts.ts, writer.ts, entity.ts, dependencies.ts, status.ts. Eliminates thousands of redundant SQL compilations during indexing (estimated 10-30% wall-clock improvement on writes)
- **Missing DB indexes**: `modules(repo_id, name)`, `modules(name)`, `events(name, repo_id)`, `services(name)`. Turns entity lookup from O(n) table scan to O(log n) index lookup
- **FTS5 tuning**: Prefix index `prefix='2,3'`, `optimize` command after bulk indexing, WAL checkpoint after index
- **Vitest coverage**: V8 provider, ratchet thresholds from baseline
- **TypeScript `noUncheckedIndexedAccess`**: ~5-15 fix sites, catches array/record access bugs at compile time

See STACK.md for full priority-ordered optimization checklist (P0-P3).

### Expected Features (Refactoring Items)

**Must have (table stakes -- 10 items):**
- TS-04: Pipeline extraction dedup (~130 duplicated lines, highest bug risk)
- TS-01: MCP error handling wrapper (48 lines duplicated across 8 tools)
- TS-02: MCP auto-sync pattern dedup (36 lines across 3 tools)
- TS-07: FTS query fallback dedup (shared retry logic in 2 search modules)
- TS-03: DB path resolution dedup (trivial 5-minute fix)
- TS-05: Entity hydration pattern consolidation
- TS-06: Entity query switch statement dedup
- TS-08: clearRepoEntities batch cleanup
- TS-09: Consistent MCP response format
- TS-10: Prepared statement hoisting (also in STACK.md as P0)

**Should have (differentiators -- 8 items):**
- DF-05: Add `learned_fact` to EntityType union (fixes unsafe casts, unifies FTS paths)
- DF-01: git.ts dead code removal / dedup
- DF-07: Writer insert dedup between persist functions
- DF-08: Edge insertion function sharing in pipeline.ts
- DF-04: Dependencies upstream/downstream symmetry extraction
- DF-06: Shared status module between CLI and MCP
- DF-03: Type-safe entity registry (config-driven, eliminates scattered switches)
- DF-02: metadata.ts FileReader strategy pattern

**Defer (v2+):**
- DF-03 entity registry: High value but medium complexity. Better when adding a new entity type.
- DF-02 metadata strategy: Works fine as-is. Only needed if adding a third I/O source.
- Porter stemming for FTS: Needs validation against real data. Risk of false positives.

See FEATURES.md for dependency graph and MVP recommendation order.

### Architecture Approach

The architecture is clean and should be preserved. Three layers (interface -> core -> DB) with unidirectional dependencies and no circular imports. The module coupling analysis found only LOW-severity layer violations (search re-exporting from db/fts, knowledge/store bypassing fts.ts). The `db/database.ts`, `db/tokenizer.ts`, `cli/db.ts`, `mcp/format.ts`, `mcp/server.ts`, all pure parsers, and `search/dependencies.ts` are explicitly marked as "leave alone."

**Work areas by review order:**
1. `indexer/pipeline.ts` -- Dedup extraction logic (~200 LOC reduction)
2. `db/fts.ts` + `knowledge/store.ts` -- Unify FTS indexing paths
3. `indexer/writer.ts` + edge operations -- Consolidate edge CRUD
4. Test helpers -- Extract DB setup boilerplate (~100 lines saved across 18+ test files)
5. Extractor interface -- Share `listBranchFiles` result, optional ExtractorContext
6. `search/text.ts` + `search/entity.ts` -- Statement preparation, minor cleanup
7. Error handling -- Add structured logging for silent catch blocks

See ARCHITECTURE.md for full module coupling analysis, data flow diagrams, and anti-patterns.

### Critical Pitfalls

1. **Pipeline consolidation breaks parallel isolation** -- `extractRepoData` (parallel, no DB access) and `indexSingleRepo` (serial, inline DB reads) look duplicated but have different DB isolation guarantees. Any shared helper MUST be pure. Write a test asserting identical output from both paths. See Pitfall #1.
2. **MCP tool schema changes silently break AI consumers** -- The 8 MCP tools are the primary API surface. Parameter names and response shapes are a public contract. Create contract tests BEFORE any refactoring. See Pitfall #2.
3. **FTS tokenizer changes degrade search without test failures** -- Production DB has pre-tokenized text. Changing `tokenizeForFts()` without a full re-index causes partial search breakage. Write golden tests. See Pitfall #5.
4. **Schema migration with table rebuild** -- SQLite ALTER TABLE limitations mean table rebuilds are destructive. Restrict v1.2 to `ADD COLUMN` and `CREATE INDEX`. No table rebuilds. See Pitfall #4.
5. **Quick win scope creep** -- Performance optimizations in DB-heavy code rarely stay localized. Time-box every optimization to 2 hours. If it's not done, it's not a quick win. See Pitfall #8.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Safety Net Setup

**Rationale:** Every research file agrees: establish contract tests, golden FTS tests, API snapshot tests, and coverage baseline BEFORE touching anything. The pitfalls research is emphatic -- refactoring without these guarantees is how you break working code.
**Delivers:** Contract tests for MCP tools, API export snapshot test, FTS golden test, Vitest coverage configuration with baseline thresholds, test helper extraction (db setup, fixtures)
**Addresses:** TS-10 awareness (coverage setup from STACK.md Section 6), test architecture from ARCHITECTURE.md Finding #7
**Avoids:** Pitfalls #2 (MCP contract breakage), #3 (public API rename), #5 (FTS regression), #6 (test coverage reduction)

### Phase 2: Database Performance

**Rationale:** The two P0 optimizations (prepared statements, missing indexes) are independent of code refactoring and have the highest measurable impact. Do them first while the codebase is still unchanged from v1.1 -- this makes before/after benchmarking clean.
**Delivers:** SQLite pragma tuning, prepared statement hoisting, new DB indexes (V5 migration), FTS5 optimize after indexing, WAL checkpoint, `perf_hooks` instrumentation for benchmarking
**Uses:** STACK.md Sections 1-4, 7-8 (all P0 and P1 optimizations)
**Avoids:** Pitfalls #4 (safe migration -- indexes only, no table rebuilds), #10 (safe pragma additions only)

### Phase 3: Code Deduplication -- MCP Layer

**Rationale:** The MCP layer refactoring items (TS-01, TS-02, TS-09) are low-risk, low-complexity, and establish patterns used by later phases. Error wrapper and auto-sync dedup touch all 8 MCP tools, so doing them in isolation prevents merge conflicts with other work. Contract tests from Phase 1 protect against regressions.
**Delivers:** `wrapToolHandler` HOF, `withAutoSync` helper, consistent `McpResponse` across all tools, DB path dedup (TS-03)
**Addresses:** TS-01, TS-02, TS-03, TS-09, DF-05 (learned_fact EntityType)
**Avoids:** Pitfall #2 (contract tests already exist from Phase 1)

### Phase 4: Code Deduplication -- Core Layer

**Rationale:** The heavy refactoring: pipeline.ts extraction dedup, FTS path unification, entity query consolidation, writer insert dedup. These touch the core layer and carry higher risk. Depends on safety nets from Phase 1 and performance baselines from Phase 2.
**Delivers:** Shared extraction function in pipeline.ts, unified FTS indexing through `db/fts.ts`, entity hydration consolidation, FTS fallback dedup, clearRepoEntities batch optimization, writer insert helpers, edge operation consolidation
**Addresses:** TS-04, TS-05, TS-06, TS-07, TS-08, DF-07, DF-08, ARCHITECTURE.md Findings #1-#3
**Avoids:** Pitfall #1 (shared helper must be pure), Pitfall #5 (golden tests catch regression), Pitfall #9 (no cross-layer utilities)

### Phase 5: TypeScript Hardening & Cleanup

**Rationale:** `noUncheckedIndexedAccess`, git.ts dead code removal, deps symmetry extraction, and any remaining differentiators. These are lower priority and lower risk. Good cleanup work after the structural changes in Phase 4 have settled.
**Delivers:** `noUncheckedIndexedAccess` enabled (~5-15 fixes), git.ts dedup/dead code removal, dependencies.ts upstream/downstream parameterization, error handling consistency (structured logging for silent catches)
**Addresses:** STACK.md Section 5, DF-01, DF-04, ARCHITECTURE.md Finding #5
**Avoids:** Pitfall #7 (CLI output format tests from Phase 1 protect against shape changes)

### Phase Ordering Rationale

- **Safety first:** Phase 1 exists because all four research documents converge on the same conclusion -- refactoring without contract tests, FTS golden tests, and coverage baselines is reckless. This is non-negotiable.
- **Measure before optimizing:** Phase 2 (performance) before Phase 3-4 (refactoring) because you need clean before/after benchmarks on unchanged code. Refactoring changes the baseline.
- **MCP before core:** Phase 3 (MCP layer) before Phase 4 (core layer) because MCP is the highest-risk API surface and the lowest-complexity refactoring. Get the easy wins with the contract test safety net.
- **Core dedup is the big bang:** Phase 4 is the largest phase -- it consolidates the most code. Everything before it builds the safety net and benchmarks. Everything after it is cleanup.
- **TypeScript hardening last:** `noUncheckedIndexedAccess` will flag issues across the codebase. Better to add it after structural changes are done so you fix it once, not twice.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Database Performance):** The V5 migration needs careful design -- which indexes, FTS5 prefix config, migration ordering. The STACK.md research is thorough but implementation sequencing needs validation.
- **Phase 4 (Core Dedup):** pipeline.ts consolidation is the riskiest refactoring in the entire milestone. The pure-function constraint from Pitfall #1 needs to be validated against the actual extraction flow. Worth a `/gsd:research-phase` to map the exact function signatures.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Safety Net):** Contract tests, snapshot tests, coverage config -- well-documented patterns, nothing novel.
- **Phase 3 (MCP Layer):** Higher-order function wrappers and response format consolidation -- straightforward refactoring.
- **Phase 5 (TS Hardening):** `noUncheckedIndexedAccess` is a compiler flag + fix sites. Standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations based on official SQLite docs, better-sqlite3 API docs, and established best practices. No new dependencies. |
| Features | HIGH | Every finding based on direct line-by-line codebase analysis of all 46 source files. Specific line numbers cited. |
| Architecture | HIGH | Full import graph traced manually. No circular dependencies verified. Module coupling quantified. |
| Pitfalls | HIGH | Pitfalls derived from direct codebase analysis cross-referenced with SQLite docs, MCP spec, and refactoring literature. |

**Overall confidence:** HIGH

### Gaps to Address

- **Porter stemming for FTS (STACK.md 3b):** MEDIUM confidence. Beneficial in theory but needs validation against actual knowledge base data before committing. Risk of false positives on technical terms. Defer to testing during Phase 2 or v2.
- **better-sqlite3 statement caching behavior:** FEATURES.md TS-10 states better-sqlite3 caches prepared statements internally; STACK.md Section 2 says it does NOT. The STACK.md analysis is correct -- better-sqlite3 does not cache `prepare()` calls. The performance impact of hoisting is real, not just cosmetic.
- **Test coverage baseline:** Unknown current coverage percentage. Phase 1 must measure this before setting thresholds. The ratchet pattern depends on having a starting number.
- **`getChangedFiles` dead code (DF-01):** Unclear if the HEAD-based variant is still called. Needs grep verification before removal.
- **MCP SDK `_registeredTools` access in tests:** Brittle internal API access noted in ARCHITECTURE.md. May break on SDK upgrade. No alternative identified yet.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all 46 source files and 25 test files
- [SQLite PRAGMA docs](https://sqlite.org/pragma.html)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)
- [SQLite ALTER TABLE](https://sqlite.org/lang_altertable.html)
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [better-sqlite3 threading docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [TypeScript TSConfig Reference](https://www.typescriptlang.org/tsconfig/)
- [Vitest Coverage Guide](https://vitest.dev/guide/coverage.html)
- [Node.js perf_hooks API](https://nodejs.org/api/perf_hooks.html)

### Secondary (MEDIUM confidence)
- [SQLite Performance Tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [SQLite Pragma Cheatsheet (cj.rs)](https://cj.rs/blog/sqlite-pragma-cheatsheet-for-performance-and-consistency/)
- [FTS5 Index Structure Analysis](https://darksi.de/13.sqlite-fts5-structure/)
- [The Strictest TypeScript Config](https://whatislove.dev/articles/the-strictest-typescript-config/)
- [Avoiding scope creep during refactoring](https://andreigridnev.com/blog/2019-01-20-four-tips-to-avoid-scope-creep-during-refactoring/)
- [Test coverage of impacted code elements](https://www.sciencedirect.com/science/article/abs/pii/S0164121216000388)

### Tertiary (LOW confidence)
- [Forward Email SQLite Guide](https://forwardemail.net/en/blog/docs/sqlite-performance-optimization-pragma-chacha20-production-guide) -- pragma recommendations, needs validation against local-tool workload
- [FTS5 performance tuning pitfalls (Sling Academy)](https://www.slingacademy.com/article/full-text-search-performance-tuning-avoiding-pitfalls-in-sqlite/) -- general guidance, not project-specific

---
*Research completed: 2026-03-07*
*Ready for roadmap: yes*
