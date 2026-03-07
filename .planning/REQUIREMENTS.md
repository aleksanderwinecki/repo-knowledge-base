# Requirements: Repo Knowledge Base

**Defined:** 2026-03-07
**Core Value:** Eliminate repeated cost of AI agents re-learning codebase architecture every session

## v1.2 Requirements

Requirements for v1.2 Hardening & Quick Wins. Each maps to roadmap phases.

### Safety Net

- [x] **SAFE-01**: MCP tool contract tests verify all 8 tool schemas, parameter names, and response shapes
- [x] **SAFE-02**: FTS golden tests verify search quality for known queries against snapshot data
- [x] **SAFE-03**: CLI output format snapshot tests prevent silent JSON shape changes

### Database Performance

- [x] **PERF-01**: SQLite pragma tuning (cache_size, temp_store, mmap_size) applied at connection open
- [x] **PERF-02**: Prepared statements hoisted out of hot loops in fts.ts, writer.ts, entity.ts, dependencies.ts, status.ts
- [x] **PERF-03**: Missing database indexes added via V5 migration (modules, events, services name lookups)
- [x] **PERF-04**: FTS5 optimize command runs after bulk indexing operations
- [x] **PERF-05**: WAL checkpoint after index completes
- [x] **PERF-06**: FTS5 prefix index configuration (prefix='2,3') for faster prefix searches
- [x] **PERF-07**: perf_hooks instrumentation for indexing and search benchmarking

### MCP Layer

- [x] **MCP-01**: Error handling extracted to wrapToolHandler HOF, eliminating 48 lines of duplication across 8 tools
- [ ] **MCP-02**: Auto-sync pattern extracted to withAutoSync helper, eliminating 36 lines across 3 tools
- [x] **MCP-03**: Consistent McpResponse format across all MCP tools
- [x] **MCP-04**: DB path resolution deduplicated (shared utility)
- [ ] **MCP-05**: learned_fact added to EntityType union, FTS indexing unified through db/fts.ts

### Core Deduplication

- [ ] **CORE-01**: Pipeline extraction logic deduplicated between indexSingleRepo and extractRepoData (~130 lines)
- [ ] **CORE-02**: FTS indexing paths unified — knowledge/store.ts uses db/fts.ts indexEntity()
- [ ] **CORE-03**: Entity hydration pattern consolidated across search modules
- [ ] **CORE-04**: Entity query switch statement deduplicated
- [ ] **CORE-05**: FTS query fallback logic shared between text.ts and entity.ts
- [ ] **CORE-06**: clearRepoEntities batch cleanup optimized
- [ ] **CORE-07**: Writer insert helpers extracted for shared persistence patterns
- [ ] **CORE-08**: Edge operations (insertEventEdges, insertGrpcClientEdges, insertEctoAssociationEdges) consolidated

### TypeScript Hardening

- [ ] **TS-01**: noUncheckedIndexedAccess enabled in tsconfig with all fix sites resolved
- [ ] **TS-02**: Dead code removed from git.ts (HEAD-based getChangedFiles if unused)
- [ ] **TS-03**: Dependencies upstream/downstream symmetry extracted to shared parameterized function
- [ ] **TS-04**: Silent catch blocks replaced with structured error logging

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Deferred Optimizations

- **DEF-01**: Type-safe entity registry (config-driven, eliminates scattered switch statements)
- **DEF-02**: metadata.ts FileReader strategy pattern
- **DEF-03**: Porter stemming for FTS5 (needs real-data validation)
- **DEF-04**: Vitest coverage ratchet thresholds (need baseline measurement first)
- **DEF-05**: Test helper extraction (DB setup boilerplate across 18+ test files)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Architectural restructuring | Architecture is clean, tighten in place only |
| New extractors or entity types | Hardening milestone, no new features |
| Table rebuild migrations | SQLite ALTER TABLE limitations, ADD COLUMN and CREATE INDEX only |
| AST-based parsing | Regex works well for structured macros, out of domain for v1.2 |
| Embedding/semantic search | Separate feature milestone (v2.0) |
| MCP tool parameter renames | Public contract, no breaking changes |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SAFE-01 | Phase 11 | Complete |
| SAFE-02 | Phase 11 | Complete |
| SAFE-03 | Phase 11 | Complete |
| PERF-01 | Phase 12 | Complete |
| PERF-02 | Phase 12 | Complete |
| PERF-03 | Phase 12 | Complete |
| PERF-04 | Phase 12 | Complete |
| PERF-05 | Phase 12 | Complete |
| PERF-06 | Phase 12 | Complete |
| PERF-07 | Phase 12 | Complete |
| MCP-01 | Phase 13 | Complete |
| MCP-02 | Phase 13 | Pending |
| MCP-03 | Phase 13 | Complete |
| MCP-04 | Phase 13 | Complete |
| MCP-05 | Phase 13 | Pending |
| CORE-01 | Phase 14 | Pending |
| CORE-02 | Phase 14 | Pending |
| CORE-03 | Phase 14 | Pending |
| CORE-04 | Phase 14 | Pending |
| CORE-05 | Phase 14 | Pending |
| CORE-06 | Phase 14 | Pending |
| CORE-07 | Phase 14 | Pending |
| CORE-08 | Phase 14 | Pending |
| TS-01 | Phase 15 | Pending |
| TS-02 | Phase 15 | Pending |
| TS-03 | Phase 15 | Pending |
| TS-04 | Phase 15 | Pending |

**Coverage:**
- v1.2 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-07 after roadmap creation*
