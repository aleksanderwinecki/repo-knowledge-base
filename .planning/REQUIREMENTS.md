# Requirements: Repo Knowledge Base

**Defined:** 2026-03-06
**Core Value:** Eliminate repeated cost of AI agents re-learning codebase architecture every session

## v1.1 Requirements

### Indexing Infrastructure

- [ ] **IDX2-01**: Indexer tracks only `main`/`master` branch commit SHA, ignoring checked-out PR branches
- [ ] **IDX2-02**: Re-indexing surgically processes only files changed since last indexed commit (no full wipe-and-rewrite)
- [ ] **IDX2-03**: Deleted files detected via `git diff` and their entities/FTS entries cleaned up
- [ ] **IDX2-04**: Repos indexed in parallel with configurable concurrency, DB writes serialized on main thread
- [ ] **IDX2-05**: Schema migration (v3) adds columns/tables needed for new extractors

### Extractors

- [ ] **EXT-01**: gRPC service definitions from `.proto` files persisted to services table (already parsed, needs wiring)
- [ ] **EXT-02**: Ecto schema fields, associations (`belongs_to`, `has_many`), and table names extracted from `.ex` files
- [ ] **EXT-03**: GraphQL types, queries, and mutations extracted from `.graphql` SDL files
- [ ] **EXT-04**: Absinthe macro definitions (`object`, `field`, `query`, `mutation`) extracted from `.ex` files
- [ ] **EXT-05**: Event Catalog data (event descriptions, team ownership, domain assignments) integrated from local catalog repo
- [ ] **EXT-06**: gRPC client call patterns detected to create `calls_grpc` edges between services

## v1.2 Requirements

### Ownership

- **OWN-01**: CODEOWNERS file parsed per repo, mapping glob patterns to team handles
- **OWN-02**: Each entity (module, event, service) matched against CODEOWNERS patterns to derive owning team(s)
- **OWN-03**: Ownership queryable — "who owns X?" and "what does team Y own?"

## Out of Scope

| Feature | Reason |
|---------|--------|
| Embedding-based semantic search | Deferred to v2 — FTS5 sufficient for current scale |
| Auto-learn patterns from tasks | Deferred to v2 — intelligence layer |
| Cross-repo impact analysis | Deferred to v2 — requires stable extractor coverage first |
| worker_threads parallelism | p-limit + Promise.all sufficient; SQLite can't share connections across threads |
| AST-based parsing | Regex sufficient for well-structured Elixir/proto/GraphQL macros |
| EventCatalog HTTP API | Doesn't exist — SDK is filesystem-based, use direct file parsing |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| IDX2-01 | TBD | Pending |
| IDX2-02 | TBD | Pending |
| IDX2-03 | TBD | Pending |
| IDX2-04 | TBD | Pending |
| IDX2-05 | TBD | Pending |
| EXT-01 | TBD | Pending |
| EXT-02 | TBD | Pending |
| EXT-03 | TBD | Pending |
| EXT-04 | TBD | Pending |
| EXT-05 | TBD | Pending |
| EXT-06 | TBD | Pending |

**Coverage:**
- v1.1 requirements: 11 total
- Mapped to phases: 0
- Unmapped: 11

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after initial definition*
