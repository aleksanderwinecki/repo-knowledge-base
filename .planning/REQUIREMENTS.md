# Requirements: Repo Knowledge Base

**Defined:** 2026-03-10
**Core Value:** Eliminate repeated cost of AI agents re-learning codebase architecture every session

## v4.1 Requirements

Requirements for Indexing Performance milestone. Each maps to roadmap phases.

### Filesystem Reads

- [ ] **FS-01**: Extractors read file contents via `fs.readFileSync()` instead of `execSync('git show ...')`
- [ ] **FS-02**: File listing uses filesystem traversal instead of `execSync('git ls-tree ...')`
- [ ] **FS-03**: Branch parameter removed from all extractor function signatures
- [ ] **FS-04**: Pipeline uses repo working tree path directly — no branch resolution needed for extraction

### Schema Simplification

- [ ] **SCH-01**: Schema version mismatch triggers full DB recreate (drop + rebuild) instead of incremental migrations
- [ ] **SCH-02**: Migration system removed — single `createSchema()` function creates all tables at current version
- [ ] **SCH-03**: Learned facts preserved across schema rebuilds (exported before drop, re-imported after)

### Correctness

- [ ] **COR-01**: `--refresh` still fetches and resets to remote default branch before indexing
- [ ] **COR-02**: Incremental indexing (commit comparison) still works — compares HEAD vs last indexed commit
- [ ] **COR-03**: All existing tests pass after refactor

## Future Requirements

Deferred to post-v4.1 milestones.

### Advanced Data Lineage

- **ALIN-01**: `kb_flow "<field_name>" --from <repo> --to <repo>` shows full data lineage between two specific services
- **ALIN-02**: Boundary constraint extraction from Ecto changesets and proto field optionality
- **ALIN-03**: SQL `structure.sql` column extraction with NOT NULL metadata

### Advanced Output

- **AOUT-01**: Colorized output (green for success, red for errors, yellow for warnings)
- **AOUT-03**: ETA estimation based on historical indexing times

## Out of Scope

| Feature | Reason |
|---------|--------|
| Branch-aware indexing (read from non-checked-out branch) | Marginal correctness gain not worth 1000x performance cost |
| `git cat-file --batch` optimization | Filesystem reads eliminate git entirely — no need for batch git |
| Worker threads for parallelism | SQLite can't share connections across threads; p-limit sufficient |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FS-01 | — | Pending |
| FS-02 | — | Pending |
| FS-03 | — | Pending |
| FS-04 | — | Pending |
| SCH-01 | — | Pending |
| SCH-02 | — | Pending |
| SCH-03 | — | Pending |
| COR-01 | — | Pending |
| COR-02 | — | Pending |
| COR-03 | — | Pending |

**Coverage:**
- v4.1 requirements: 10 total
- Mapped to phases: 0
- Unmapped: 10 ⚠️

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after initial definition*
