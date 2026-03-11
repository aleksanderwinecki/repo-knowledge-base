# Project Research Summary

**Project:** repo-knowledge-base v4.2 Search Quality
**Domain:** AI-optimized code knowledge base — FTS5 search quality improvements
**Researched:** 2026-03-11
**Confidence:** HIGH

## Executive Summary

This is a focused, no-new-dependencies milestone targeting four independent improvements to an existing SQLite/FTS5/Node.js knowledge base. The system already works; this milestone makes it work *well* for AI agent consumers specifically. Research confirms that all four features (OR-default queries, richer FTS descriptions, deeper Ecto constraint extraction, and null-guard heuristic scanning) are implementable as surgical modifications to existing files — no new packages, no schema version bump for the P1 work, no architectural changes.

The recommended approach follows a clear dependency order: fix the query layer first (zero re-index needed, immediate recall improvement), then enrich the FTS descriptions (requires re-index, no extractor risk), then extend the Ecto extractor (isolated risk, feeds description enrichment), and finally add null-guard heuristic scanning as an explicitly P2 feature after core quality is validated. The P2 null-guard phase requires a schema version bump and careful algorithm design to avoid O(fields x files) indexing performance regression.

The two highest-risk areas are the OR-default implementation and the null-guard heuristic. OR-default has a non-obvious tokenizer trap where `OR` gets lowercased to `or` (a literal search term) if the operator is inserted before tokenization runs — the golden test suite even documents this in comments, making it a well-flagged trap. Null-guard has a data integrity trap where heuristic results must never overwrite the authoritative `nullable` column. Both have clear, documented mitigations. The rest of the milestone is low-risk: the codebase is well-understood from direct inspection and all patterns are established.

## Key Findings

### Recommended Stack

This milestone requires no changes to the technology stack. All features are pure logic changes within existing modules using SQLite FTS5, better-sqlite3, and TypeScript regex. The key constraint — zero new npm dependencies — is explicitly established in PROJECT.md and confirmed feasible. FTS5 query syntax for OR, prefix matching, and progressive relaxation is fully verified against official SQLite documentation.

**Core technologies:**
- SQLite FTS5 (bundled): full-text search with BM25 ranking — OR queries require explicit TypeScript construction; FTS5 has no configurable default operator (AND is hardcoded in the query parser)
- better-sqlite3 (existing): synchronous SQLite driver — no change needed
- TypeScript regex (existing): Ecto/proto field extraction — sufficient for well-structured Fresha macros; AST (tree-sitter) explicitly deferred to post-v4.2

### Expected Features

**Must have (P1 — v4.2 launch):**
- OR-default search mode — AND-default silently returns nothing when both terms don't coexist; OR is the correct default for AI agent consumers where recall > precision
- Progressive AND → OR relaxation — graceful degradation when narrow queries return fewer than 3 results; distinct from the existing syntax-error fallback in `executeFtsWithFallback`
- Richer FTS descriptions: proto field includes message/event context — currently `"BookingCreated string"` with no event association; agents can't find proto fields by event name
- Richer FTS descriptions: repo name inline — improves cross-repo disambiguation; `repoName` is already in scope in `writer.ts`, zero schema changes needed
- Deeper Ecto cast/optional field extraction — completes nullability metadata started in v4.0; prerequisite for null-guard; must handle both `[:atom, :list]` and `~w(word sigil)a` syntax forms

**Should have (P2 — after core validation):**
- Result enrichment with `nextAction` hint per result — pure presentation logic in `searchText()`, no DB changes; reduces agent reasoning overhead
- Null-guard heuristic scanning — schema version bump required; algorithm must use inverted scan (one pass per file, intersect results) to avoid O(fields x files) complexity

**Defer (v5+):**
- Multi-concept fan-out — requires latency measurement and query structure detection; deferred until OR-default is proven insufficient for cross-entity-type queries

**Anti-features (confirmed wrong approaches):**
- Semantic/vector search — already removed in v2.1; contradicts SQLite-only constraint; richer FTS descriptions + OR-default cover the primary motivation
- Fuzzy/edit-distance matching — FTS5 prefix matching (`prefix=2,3` already configured) handles 90% of the use case
- Per-query null-guard scanning — would break the <2s response constraint; must be index-time only

### Architecture Approach

All changes are surgical modifications to six existing files. The layered architecture (Interface → Search → DB → Indexer → Storage) stays intact. The key architectural principles for this milestone: query transformation belongs in `fts.ts` (not `text.ts`), FTS description assembly belongs in `writer.ts` (not `pipeline.ts`), and null-guard results must go in a new column (not the authoritative `nullable` column). The `FieldData` interface stays stable — richer descriptions are assembled inside `writer.ts` using data already in scope.

**Components and changes:**
1. `src/db/fts.ts` — add `buildOrQuery()` helper and `executeFtsWithRelaxation()` wrapper; keep `tokenizeForFts` pure (shared by write path and query path)
2. `src/search/text.ts` — wire `executeFtsWithRelaxation` replacing `executeFtsWithFallback`; hydration loop unchanged
3. `src/indexer/writer.ts` — richer field description builder (repo name + constraint + event context); `repoName` already in scope via `metadata.name`
4. `src/indexer/elixir.ts` — new `extractCastFields()` and `detectNullGuardedFields()` helpers; extend `ElixirModule` interface with `optionalFields`, `castFields`, `nullGuardedFields`
5. `src/indexer/proto.ts` — surface event/message association in extraction output for richer field FTS descriptions
6. `src/indexer/pipeline.ts` — minor: use new `ElixirModule` fields for nullability signal in `FieldData.nullable`

### Critical Pitfalls

1. **OR operator destroyed by tokenizer** — `tokenizeForFts` lowercases everything; `OR` becomes literal `or` if inserted before tokenization. Prevention: tokenize each term individually first, then join with ` OR ` after. Never pass the joined OR string through `tokenizeForFts` again. This is already documented in golden test comments for tests #4 and #5.

2. **OR default silently passes existing tests while degrading quality** — OR inflates result sets; existing `hasBothTerms` assertions pass trivially with 50 results when 5 were expected. Prevention: add ordering-aware golden tests (rank #1 must contain both terms, result count must not hit the 20-result limit) *before* changing the query builder while AND behavior is confirmed correct.

3. **Token pollution from constraint field names in module FTS descriptions** — adding required/optional field name lists to module FTS descriptions indexes `id`, `name`, `status` into every schema module, collapsing BM25 rank spread. Prevention: field names belong in the `fields` table only; module descriptions capture module-level semantics (table name, association targets), not field name dumps. Add constraint *types* as boolean annotations, not field name lists.

4. **Ecto `~w(...)a` sigil syntax missed by single-pass regex** — `@required_fields ~w(name email)a` looks nothing like `[:name, :email]`; single-pass regex silently produces zero results for the sigil form (30-50% of real Elixir code). Prevention: two-pass extraction — first resolve module attribute declarations (`@required_fields` → field list map), then resolve references in `validate_required`/`cast` calls.

5. **Null-guard heuristic overwrites authoritative schema nullability** — writing `nullable: true` to the `nullable` column corrupts data derived from Ecto `null: false` constraints. Prevention: null-guard results go in a separate `nullable_in_practice` column; never touch `nullable`; surface contradictions ("schema says NOT NULL but code handles nil") as data quality signals in `kb_field_impact` output.

6. **Null-guard O(fields x files) scan complexity** — scanning all `.ex` files per field name = 18 million regex matches across 400 repos; full reindex time multiplies. Prevention: invert the scan — one pass per file collecting all null-guard patterns into a Set, then intersect with known field names. Also restrict to the same `lib/` subtree as the schema file.

## Implications for Roadmap

Based on research dependencies and risk profile, four phases are recommended:

### Phase 1: FTS Query Layer — OR Default and Progressive Relaxation

**Rationale:** Pure query-time changes with zero re-index required. Delivers immediate recall improvement with no extractor risk. The most impactful single change for AI agent consumers. Correct foundation before description enrichment — more results from better queries compounds with richer indexed content once re-index runs.

**Delivers:** OR-default search mode, progressive AND → OR → prefix relaxation, updated golden tests with ordering-aware assertions.

**Addresses:** OR-default search mode (P1), progressive relaxation (P1) from FEATURES.md.

**Avoids:** Pitfall 2 (tokenizer OR-destruction) — must tokenize terms individually first. Must add ordering-aware golden tests before changing query builder (Pitfall 1).

**Research needed:** None — FTS5 OR syntax fully verified, exact code locations identified, tokenizer trap documented with prevention steps.

---

### Phase 2: Richer FTS Descriptions

**Rationale:** Depends on stable `FieldData` interface (unchanged). Requires re-index to see results but carries no extractor risk. Natural second step: once the query layer handles OR, richer indexed content amplifies that improvement on the next reindex.

**Delivers:** Repo name in module/field/event FTS descriptions; proto field FTS entries include event/message context; `repoName` threaded through `insertModuleWithFts` and field insert loop.

**Addresses:** Richer FTS description features (P1 x2) from FEATURES.md.

**Avoids:** Token pollution pitfall (Pitfall 3) — add repo names and constraint types only; do not add field name lists to module descriptions.

**Research needed:** None — change locations confirmed in `writer.ts`; `repoName` already in scope via `metadata.name`; pattern established by existing `table:${tableName}` enrichment.

---

### Phase 3: Deeper Ecto Constraint Extraction

**Rationale:** Independent of query-layer changes. Feeds improved nullability signal into `FieldData.nullable`, which improves the description enrichment from Phase 2 on re-index. Isolated extractor risk validates separately before consumption by other components.

**Delivers:** Populated `optionalFields` and `castFields` on `ElixirModule`; corrected nullability for Ecto schemas using `@optional_fields` or `cast` attr lists; both `[:atom, :list]` and `~w(word sigil)a` syntax forms handled.

**Addresses:** Deeper Ecto cast/optional field extraction (P1) from FEATURES.md.

**Avoids:** `~w` sigil miss (Pitfall 4) — two-pass extraction: first resolve module attribute declarations, then resolve references in `validate_required`/`cast` calls.

**Research needed:** None — regex patterns designed, two-pass extraction approach documented, integration point in `pipeline.ts` identified.

---

### Phase 4: Null-Guard Heuristic Scanning (P2)

**Rationale:** Requires schema version bump (triggers drop+rebuild — established pattern since v4.1). Explicitly P2 — defer until core search quality (Phases 1-3) is validated. Highest complexity and data integrity risk of the milestone.

**Delivers:** `nullGuardedFields` per `ElixirModule`; new `nullable_in_practice` column in `fields` table; `kb_field_impact` output distinguishes schema-derived vs heuristic-derived nullability; contradictions surfaced as data quality signals.

**Addresses:** Null-guard heuristic scanning (P2) from FEATURES.md.

**Avoids:** Nullability column corruption (Pitfall 5) — never write to `nullable`; use new column. O(fields x files) complexity (Pitfall 6) — inverted scan: one pass per file collecting null-guard patterns, then intersect with known field names; scope to same `lib/` subtree.

**Research needed:** None — algorithm design documented, schema upgrade path is the established drop+rebuild pattern. Implementation design review is warranted before coding begins to confirm inverted-scan scope boundaries.

---

### Phase Ordering Rationale

- **Phase 1 before Phase 2:** Query improvements deliver value immediately without re-index. Description enrichment requires re-index — ship query improvements first, then get compound benefit when re-index runs.
- **Phases 2 and 3 loosely coupled:** Both are independently buildable. Phase 3 improves the nullability signal that Phase 2's description builder consumes, so running a final re-index after Phase 3 completes gives the richest combined output.
- **Phase 4 last:** Schema bump, new column, highest complexity and risk. The P2 classification is firm — validate simpler phases first.

### Research Flags

All four phases have standard patterns — research-phase not needed for any of them:

- **Phase 1:** FTS5 OR syntax fully documented; exact code locations and test strategy identified; tokenizer trap is documented in golden test comments with prevention steps.
- **Phase 2:** Change locations and data shapes confirmed via direct inspection; `repoName` threading is a one-argument addition; no external dependencies.
- **Phase 3:** Regex patterns designed with both sigil and atom-list forms; two-pass extraction approach documented; Ecto `validate_required`/`cast` semantics verified against official docs.
- **Phase 4:** Algorithm design documented (inverted scan); schema upgrade path is the established drop+rebuild pattern. No external research needed, but a brief pre-implementation design review on scan scope boundaries is worthwhile.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All claims verified against official SQLite FTS5 docs and live source code; zero new dependencies confirmed feasible across all four features |
| Features | HIGH (P1) / MEDIUM (P2) | P1 features verified via direct code inspection and official docs; P2 null-guard patterns rely partly on community Elixir sources for prevalence estimates |
| Architecture | HIGH | All findings from direct codebase inspection; component responsibilities, data flows, and integration boundaries fully mapped; `FieldData` stability confirmed |
| Pitfalls | HIGH | Two critical traps (tokenizer OR-destruction, nullable column corruption) verified against actual code behavior; golden test comments explicitly document the tokenizer issue |

**Overall confidence:** HIGH

### Gaps to Address

- **`~w` sigil prevalence in Fresha codebase:** Research estimates 30-50% of real Elixir code uses `~w(...)a` syntax, but this is a community estimate. A quick grep across indexed repos before Phase 3 begins would confirm whether two-pass extraction is critical or if single-pass with documented scope is acceptable.
- **OR fallback threshold (3 results):** The `minResults = 3` threshold is a documented recommendation, not empirically measured. Should be validated against real query patterns after Phase 1 ships. The threshold is a named constant — trivial to tune without structural changes.
- **Null-guard scan scope boundary:** Restricting to the same `lib/` subtree as the schema file may miss guards in sibling context modules. This tradeoff (fewer false positives vs fewer true positives) should be confirmed during Phase 4 design before implementation begins.
- **nextAction hints (P2, not researched):** Pure presentation logic with no DB changes — no research needed; implement during or after Phase 4 as capacity allows.

## Sources

### Primary (HIGH confidence)
- [SQLite FTS5 Extension — sqlite.org/fts5.html](https://www.sqlite.org/fts5.html) — OR syntax, implicit AND behavior, no configurable default operator, prefix match syntax
- [Ecto.Changeset — hexdocs.pm/ecto](https://hexdocs.pm/ecto/Ecto.Changeset.html) — `validate_required`, `cast` signatures and semantics
- [Elixir Patterns and Guards — HexDocs](https://hexdocs.pm/elixir/main/patterns-and-guards.html) — nil-guard patterns
- Live source code: `src/db/fts.ts`, `src/db/tokenizer.ts`, `src/search/text.ts`, `src/indexer/elixir.ts`, `src/indexer/proto.ts`, `src/indexer/writer.ts`, `src/indexer/pipeline.ts`, `tests/search/golden.test.ts` (2026-03-11)

### Secondary (MEDIUM confidence)
- [RapidSearch query relaxation glossary](https://www.rapidsearch.app/glossary/query-relaxation) — progressive relaxation patterns and threshold strategies
- [Context Engineering for Coding Agents — Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html) — recall > precision rationale for AI agent consumers
- [LLM Agents Improve Semantic Code Search — arXiv 2408.11058](https://arxiv.org/html/2408.11058v1) — result enrichment patterns for LLM agent consumers
- Elixir Forum community — `@required_fields ~w(...)a` module attribute convention (common pattern, not in official Ecto docs)

---
*Research completed: 2026-03-11*
*Ready for roadmap: yes*
