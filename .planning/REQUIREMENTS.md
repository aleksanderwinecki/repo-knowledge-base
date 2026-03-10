# Requirements: Repo Knowledge Base

**Defined:** 2026-03-10
**Core Value:** Eliminate the repeated cost of AI agents re-learning codebase architecture every session

## v4.0 Requirements

Requirements for Data Contract Intelligence milestone. Each maps to roadmap phases.

### Field Extraction

- [x] **FLD-01**: Ecto schema `field/3` calls are extracted as individual searchable field entities with name, type, and parent module
- [x] **FLD-02**: Proto message field declarations are extracted as individual searchable field entities with name, type, and parent message
- [x] **FLD-03**: GraphQL type field definitions are extracted as individual searchable field entities with name, type, and parent type
- [x] **FLD-04**: `fields` table created via schema migration with columns: parent_type, parent_name, field_name, field_type, nullable, source_file, repo_id, module_id, event_id

### Field Search

- [x] **FSRCH-01**: `kb_search "<field_name>"` returns every schema/proto/GraphQL type containing a field with that name across all indexed repos
- [x] **FSRCH-02**: Field names are indexed in FTS5 as both tokenized and literal (exact match for compound names like `employee_id`, fuzzy match for individual tokens)
- [x] **FSRCH-03**: `kb_search --type field` filters results to field entities only

### Nullability

- [x] **NULL-01**: Ecto `validate_required` fields are marked nullable=false; other cast fields are marked nullable=true
- [x] **NULL-02**: Proto `optional` keyword marks field as nullable=true; plain fields are nullable=false (proto3 default semantics)

### Shared Concepts

- [x] **SHARED-01**: Post-indexing pass identifies field names appearing in 2+ repos and stores cross-repo occurrence count as shared concept metadata
- [x] **SHARED-02**: `kb_entity "<field_name>" --type field` shows all repos/schemas/protos containing that field with parent type and nullability

### Field Impact

- [x] **FIMPACT-01**: `kb_field_impact "<field_name>"` traces a field from its origin schemas through proto/event boundaries to all consuming services
- [x] **FIMPACT-02**: Output shows: origin repo + parent schema, proto boundary with topic, consuming repos + their local field info, nullability at each hop
- [x] **FIMPACT-03**: Available as both MCP tool (`kb_field_impact`) and CLI command (`kb field-impact`)

### Field Edges

- [x] **FEDGE-01**: During indexing, when a field name in a proto message matches a field name in an Ecto schema within the same repo, a `maps_to` edge is created between them
- [x] **FEDGE-02**: Field-level edges are traversable by existing BFS machinery in graph.ts (bfsDownstream/bfsUpstream)

## Future Requirements

Deferred to post-v4.0 milestones.

### Advanced Data Lineage

- **ALIN-01**: `kb_flow "<field_name>" --from <repo> --to <repo>` shows full data lineage between two specific services
- **ALIN-02**: Boundary constraint extraction from Ecto changesets (validate_required, custom validators) and proto field optionality
- **ALIN-03**: SQL `structure.sql` column extraction with NOT NULL metadata

### Advanced Output

- **AOUT-01**: Colorized output (green for success, red for errors, yellow for warnings)
- **AOUT-03**: ETA estimation based on historical indexing times

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| AST parsing (tree-sitter etc.) | Regex gets 95% of the way for Elixir/proto/GraphQL; not worth the complexity |
| Function body indexing | Code duplication; fields table covers the contract surface |
| Custom validator extraction | Too varied (dynamic, wrapped in helpers); just index required/optional split |
| Runtime data flow tracing | Stick to static analysis; proto + Kafka topology captures real boundaries |
| structure.sql parsing | Nice-to-have but Ecto schemas + proto cover the critical path; defer to v4.1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FLD-01 | Phase 29 | Complete |
| FLD-02 | Phase 29 | Complete |
| FLD-03 | Phase 29 | Complete |
| FLD-04 | Phase 29 | Complete |
| NULL-01 | Phase 29 | Complete |
| NULL-02 | Phase 29 | Complete |
| FSRCH-01 | Phase 30 | Complete |
| FSRCH-02 | Phase 30 | Complete |
| FSRCH-03 | Phase 30 | Complete |
| SHARED-01 | Phase 30 | Complete |
| SHARED-02 | Phase 30 | Complete |
| FEDGE-01 | Phase 31 | Complete |
| FEDGE-02 | Phase 31 | Complete |
| FIMPACT-01 | Phase 31 | Complete |
| FIMPACT-02 | Phase 31 | Complete |
| FIMPACT-03 | Phase 31 | Complete |

**Coverage:**
- v4.0 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap creation*
