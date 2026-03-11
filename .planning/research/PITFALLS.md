# Pitfalls Research

**Domain:** FTS5 search quality improvements — OR default, progressive relaxation, description enrichment, deeper Ecto constraint extraction, null-guard heuristics
**Researched:** 2026-03-11
**Confidence:** HIGH (first-party codebase analysis + FTS5 documentation)

---

## Critical Pitfalls

### Pitfall 1: OR Default Silently Breaks the Existing Golden Test Suite

**What goes wrong:**
`tests/search/golden.test.ts` has a comment on test #4 that explicitly documents the current behavior: `"OR" is lowercased by tokenizeForFts, so it becomes the literal word "or" and the query becomes an implicit AND of three terms.` If the code switches to OR-by-default at the query builder level, this test still passes (it was already testing an edge case). But tests #2 ("booking creation" phrase) and #3 ("booking AND cancellation") now face a problem: OR default means multi-word queries produce inflated result sets, and test #3's assertion of "hasBothTerms" trivially passes even when the top result only contains one term.

**Why it happens:**
Test assertions check for presence/absence, not ordering or result count bloat. When OR becomes default, `search('booking cancellation')` returns everything with "booking" OR "cancellation" — potentially 50+ entities. The test passes because `hasBothTerms` finds *something* with both terms somewhere in the 50 results. The actual search quality has degraded but tests are green.

**How to avoid:**
Before changing the FTS query builder, add ordering-aware golden tests: for a two-word query, assert that rank #1 contains BOTH terms, not just one. Also add a result count sanity assertion — a two-word AND query returning 3 results should not suddenly return 18 results under OR. The limit is 20 by default; hitting that limit is a warning sign.

**Warning signs:**
- Multi-word queries returning 18-20 results (limit exhausted) where they previously returned 3-5
- BM25 `rank` values for top results becoming much less negative (weaker matches promoted)
- Golden test suite entirely green but manual spot-checks return noise

**Phase to address:** The phase implementing OR default must add ordering-aware golden tests before changing the query builder, not after. Tests are the regression net — add them while AND behavior is still correct so you can verify the OR implementation ranks correctly.

---

### Pitfall 2: `tokenizeForFts` Runs Before OR Joins Are Built — Destroying the `OR` Keyword

**What goes wrong:**
The query path is: user query → `tokenizeForFts` → FTS5 MATCH. The tokenizer lowercases everything and replaces non-alphanumeric characters with spaces. This means if the code tries to build an OR query by joining tokens with ` OR `, then running the whole string through `tokenizeForFts` again, `OR` becomes `or` (a literal search term). The FTS5 engine receives `booking or payment` and treats `or` as a third search term, not an operator.

This is already documented in the golden test suite comments (tests #4 and #5), but it's a trap waiting to catch the OR-default implementation.

**Why it happens:**
The `search()` function in `fts.ts` passes `tokenizeForFts(query)` directly to MATCH. If the OR construction happens inside `tokenizeForFts`'s input, the operator gets destroyed. If it happens before the function call on the raw user query, it bypasses the camelCase/snake_case splitting that makes names searchable.

**How to avoid:**
Build OR queries in two steps:
1. Tokenize each individual term: `const tokens = rawQuery.split(/\s+/).map(tokenizeForFts)`
2. Join with ` OR `: `const ftsQuery = tokens.join(' OR ')`
Never pass the joined OR string through `tokenizeForFts` again.

For progressive relaxation specifically, the AND query is `tokens.join(' ')` (FTS5 default AND) and the OR fallback is `tokens.join(' OR ')` — both constructed from pre-tokenized individual terms.

**Warning signs:**
- Searching `booking payment` with OR default returns results for the literal word "or"
- Three-word queries suddenly return fewer results than expected (the middle word becomes "or" and degrades the match)
- Golden test #4 comment behavior persists even after "implementing" OR support

**Phase to address:** The phase implementing OR default and progressive relaxation. This is a structural constraint that must be addressed in the query builder before any search quality changes ship.

---

### Pitfall 3: FTS Description Enrichment Creates Token Pollution for Common Field Names

**What goes wrong:**
The tokenizer splits all separators including underscores, dots, and colons. If enriched descriptions include structured content like `constraints: [:name, :email, :status]` or `cast_fields: name email status`, every common field name (`id`, `name`, `status`, `type`, `email`) gets indexed into every schema module's FTS entry. Searching for `name` returns the entire schema corpus with near-identical BM25 scores.

**Why it happens:**
The current `insertModuleWithFts` already does this at small scale: `table:${tableName}` adds the table name to the description. It works because table names are specific (`bookings`, `payment_transactions`). Constraint field names are not specific — they're the 20 most common words in any application schema.

The `fields` table already has its own FTS entries for every field name. Adding field names to the module description creates double-counting: BM25 sees the field name appearing in both `fields` entities and in `modules` entities, inflating both. This is especially bad because the `fields` entities are more precise (they carry parent context) while the module-level duplicates are noise.

**How to avoid:**
Define a clear boundary: the module FTS description captures module-level semantics (moduledoc, table name, association targets, changeset intent). Field names belong in the `fields` table only. For enrichment, add:
- Parent schema name in field FTS descriptions (already done: `${field.parentName} ${field.fieldType}`)
- Constraint *type* in module descriptions (`has_required_fields`, `has_cast_attrs`) — not the field names themselves
- `validate_required` presence as a boolean annotation, not a field name dump

**Warning signs:**
- Searching `id` or `name` returns 80%+ of indexed modules
- `listAvailableTypes` shows module counts unchanged but `searchText('id')` result count has jumped from ~5 to ~200
- BM25 rank spread collapses (all results have nearly identical relevance scores)

**Phase to address:** The description enrichment phase. Write a golden test asserting that searching a common field name (`id`) does not appear in the top 5 module results (unless the module is specifically named after that field).

---

### Pitfall 4: Ecto Constraint Extraction Misses `~w(...)a` Sigil Syntax

**What goes wrong:**
The current `extractRequiredFields` targets `validate_required(..., [:field1, :field2])` — atom list syntax. Elixir developers frequently use the word sigil form: `@required_fields ~w(name email status)a`. The sigil form `~w(...)a` produces the same atom list at compile time but looks completely different as text. A regex written for `[...]` silently produces zero results for the sigil form.

Additionally, `cast(changeset, attrs, @required_fields)` uses a module attribute reference, not an inline list. Extracting required fields correctly requires:
1. Finding `@required_fields ~w(name email status)a` or `@required_fields [:name, :email, :status]` declarations
2. Resolving `@required_fields` references inside `cast` or `validate_required` calls

A single-pass regex can't do both. The common shortcut is to only target inline lists, which silently misses 30-50% of real Elixir code patterns.

**How to avoid:**
Two-pass extraction within `parseElixirFile`:
1. First pass: scan for module attribute declarations, building a `Map<attrName, string[]>` of resolved field lists. Handle both `[...]` and `~w(...)a` forms.
2. Second pass: scan `validate_required`, `cast`, `validate_change` calls. For inline lists, extract directly. For `@attribute` references, look up the map.

The `~w(...)a` regex: `/~w\(([\s\S]*?)\)a/` — captures the word list, then split on whitespace.

**Warning signs:**
- Repos using `@required_fields` module attributes show zero required fields in extraction output
- `required_fields` array in `ElixirModule` is consistently empty for modules that visibly use `validate_required`
- Test fixture that uses `~w` syntax produces different output than the `[...]` equivalent

**Phase to address:** The Ecto constraint extraction phase. Add test fixtures covering both syntactic forms before wiring into the indexing pipeline.

---

### Pitfall 5: Null-Guard Heuristics Overwrite Authoritative Schema Nullability

**What goes wrong:**
The `fields` table has a `nullable` column populated from schema-derived sources: Ecto `null: false` constraints, proto `optional` qualifier, GraphQL `!` non-null marker. These are authoritative. If the null-guard heuristic scanner writes `nullable: true` back to this column when it finds `is_nil(user_id)` in a context function, it corrupts authoritative data with a guess.

The specific failure: a function `def process(user_id)` that defensively checks `if is_nil(user_id), do: :error` will trigger the heuristic. But `user_id` may be `NOT NULL` in the Ecto schema — it's just being defensively guarded against bad callers. The heuristic sees "guard exists = field can be nil" and overwrites `nullable: false` with `nullable: true`.

**Why it happens:**
The heuristic is implemented as an additional extraction pass that updates the `nullable` column. It feels natural to update the single source of truth. But the single source of truth is wrong here — schema-derived nullability and runtime null-safety patterns are different concepts.

**How to avoid:**
Null-guard results must go into a separate field: `nullable_in_practice` (or stored as a metadata JSON annotation), never into the `nullable` column. MCP tool output (`kb_field_impact`) must distinguish between the two:
- `"nullable": false` = schema says NOT NULL
- `"nullableInPractice": true` = code defensively guards against nil

If both exist and contradict, surface the contradiction as a data quality signal ("schema says NOT NULL but code handles nil — possible missing constraint").

**Warning signs:**
- `kb_field_impact` shows fields as nullable that the Ecto schema has `null: false`
- Running heuristic scan twice produces different nullability results (non-idempotent)
- The `nullable` column in `fields` changes values between indexing runs without schema changes

**Phase to address:** The null-guard scanning phase. Add a test asserting that a field with schema-derived `nullable: false` retains that value after heuristic scanning runs, even when `is_nil(field_name)` appears in the same repo.

---

### Pitfall 6: Null-Guard Heuristic Has O(fields × files) Scan Complexity

**What goes wrong:**
For each field name, scanning all `.ex` files in a repo to find `is_nil(field_name)` or `case field_name` patterns is O(fields × files). A repo with 150 schema fields and 300 `.ex` files = 45,000 regex matches per repo. Across 400 repos = 18 million regex matches. Full reindex time goes from minutes to tens of minutes.

**Why it happens:**
The approach feels obvious: "for each field, grep for its name." But field names are short (`id`, `name`, `status`) and appear everywhere in code for reasons unrelated to null-guarding. A file scan for `is_nil(id)` returns hits in every file that checks any ID for nil — not just hits for the specific schema field.

**How to avoid:**
Invert the scan: one pass over all `.ex` files, collecting all `is_nil(X)` and `case X when nil` patterns into a Set of variable names found in null-guard context. Then intersect with known field names. This is O(total_lines_across_all_files) — one read per file, not one read per field per file.

Also scope the scan to files within the same module namespace as the schema. Cross-file scanning for short field names (`id`) would produce false positives from every file that does any nil-checking, so restrict to files in the same `lib/` subtree as the schema file.

**Warning signs:**
- Full reindex time increasing from <10 minutes to >20 minutes after adding heuristic scanning
- CPU profiling shows `extractNullGuards` taking more time than all other extractors combined
- The scan produces "null-guarded" results for fields like `id` in every schema

**Phase to address:** The null-guard scanning phase, specifically in the design of the scan algorithm before any implementation begins.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Run enriched descriptions through `tokenizeForFts` uniformly | No pipeline changes needed | Common tokens swamp BM25 rankings for all module entities | Never for structured constraint/field lists |
| Hardcode OR fallback threshold as a magic constant | Simple initial implementation | Threshold becomes wrong as corpus grows; needs tuning | Only if documented with explicit derivation and re-evaluation trigger |
| Write heuristic nullability to `nullable` column | Single source of truth | Corrupts authoritative schema data with guesses | Never |
| Single-pass `~w` sigil extraction | Less code | Silently misses 30-50% of real Elixir usage patterns | Only if scope is documented as "atom lists only" |
| Index constraint field names in module FTS descriptions | Richer module search | Duplicates fields-table FTS entries; pollutes BM25; common terms explode results | Only if field names are simultaneously removed from fields-table FTS (which would break field search) |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| FTS5 MATCH + OR operator | Running `tokenizeForFts` on the joined `"term1 OR term2"` string — `OR` becomes `or` literal | Tokenize each term individually, then join with ` OR ` after tokenization |
| `executeFtsWithFallback` + OR queries | The phrase fallback wraps the query in `"..."` — an OR query like `booking OR payment` becomes the phrase `"booking or payment"` which matches nothing | Detect whether the primary query uses ` OR ` before applying the phrase fallback; skip phrase fallback for OR queries |
| Progressive relaxation + `entityTypeFilter` | AND-then-OR relaxation ignores the type filter scope — zero-result AND for `--type schema` may "succeed" with OR using unrelated entity types | Relaxation must re-run with the identical type filter; never relax type boundaries |
| Description enrichment + drop-rebuild schema | Descriptions are written at index time; old format persists until next reindex — `kb reindex --repo X` only updates the changed files | Bump `SCHEMA_VERSION` when enrichment format changes so the DB auto-rebuilds cleanly |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| OR default with no minimum relevance filtering | `searchText` returns 20 results (limit exhausted) where 15 are single-term weak matches | Add BM25 threshold filtering, or document that OR results require consumer-side ranking judgment | Immediately on first multi-word query after OR becomes default |
| Double FTS execution for every query (AND then OR fallback) | `kb search` response time doubles; `perf_hooks` shows two sequential MATCH executions per query | Set threshold based on measured AND result rate for the actual corpus, not a gut-feel constant | When >50% of queries trigger fallback (depends on corpus size and query patterns) |
| Null-guard O(fields × files) scan | Full reindex takes 3x longer; CPU shows extractor as bottleneck | Invert scan direction: one pass per file, intersect results with known field names | At approximately 100 fields × 200 files per repo (20,000 matches), becomes noticeable |
| FTS index bloat from enriched descriptions | Slower `OPTIMIZE` runs; slightly larger DB file | Measure index size before and after enrichment; run OPTIMIZE after full reindex | Unlikely to matter below 50K entities, but measure |

---

## "Looks Done But Isn't" Checklist

- [ ] **OR default implementation:** Verify the OR operator survives tokenization — search `booking payment` under OR semantics and confirm exactly 2 OR tokens in the MATCH expression, not 3 tokens including a literal `or`
- [ ] **Progressive relaxation:** Verify the AND result count threshold is evaluated per-query against the actual result set, not a globally cached constant; verify the same `entityTypeFilter` is applied in both the AND and OR passes
- [ ] **Description enrichment:** Verify that searching a common field name (`id`, `name`, `status`) does not return all indexed schemas; verify that the existing `table:tableName` suffix format doesn't conflict with new enrichment
- [ ] **Ecto constraint extraction:** Verify `~w(name email)a` produces the same results as `[:name, :email]`; verify multi-changeset modules accumulate correctly rather than last-write-wins; verify `@required_fields` attribute references are resolved
- [ ] **Null-guard heuristics:** Verify the `nullable` column in the `fields` table is NOT written by the heuristic scanner; verify results land in a separate column or metadata; verify `kb_field_impact` output distinguishes schema-derived from heuristic-derived nullability

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| OR default breaks golden tests | LOW | Revert query builder; add ordering-aware golden tests while AND behavior is confirmed correct; re-implement OR with tests guiding correctness |
| Token pollution from description enrichment | MEDIUM | Bump `SCHEMA_VERSION` (already the standard upgrade path) to force drop-rebuild; strip structured content from description enrichment; full reindex all repos |
| Null-guard heuristic corrupts `nullable` column | HIGH | Drop + rebuild schema; re-index all repos; audit `kb_field_impact` output against known schemas |
| Progressive relaxation doubles query time | LOW | Remove fallback or raise threshold to effectively disable it until properly calibrated |
| Ecto extraction misses `~w` syntax | LOW | Add the `~w` regex branch; next reindex picks up the missed fields automatically |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| OR operator destroyed by tokenizer | Phase implementing OR default / query builder | Unit test: `tokenizeForFts('booking') + ' OR ' + tokenizeForFts('payment')` = correct MATCH string |
| OR default breaks existing golden tests | Phase implementing OR default | All existing golden tests pass AND new ordering-aware tests are added and pass |
| Token pollution from enrichment | Phase implementing description enrichment | Golden test: common field name search does not return all schemas |
| Ecto `~w` sigil extraction miss | Phase implementing deeper constraint extraction | Fixture test: `~w(name email)a` and `[:name, :email]` produce identical extraction output |
| Null-guard overwrites schema nullability | Phase implementing null-guard scanning | Integration test: field with schema `null: false` retains `nullable: false` after heuristic scan |
| Null-guard O(fields × files) complexity | Phase implementing null-guard scanning | Timing assertion: full reindex with heuristic scanning completes under 10 minutes |

---

## Sources

- First-party codebase analysis:
  - `src/db/fts.ts` — FTS query structure, UNINDEXED entity_type decision, `executeFtsWithFallback` phrase fallback
  - `src/db/tokenizer.ts` — lowercasing behavior that destroys `OR`/`NOT` operators (critical constraint for OR implementation)
  - `src/search/text.ts` — query pipeline, entity type filter application
  - `src/indexer/elixir.ts` — `extractRequiredFields` regex, `extractSchemaDetails` structure
  - `src/indexer/writer.ts` — how FTS descriptions are currently built per entity type
  - `tests/search/golden.test.ts` — comments on tests #4/#5 explicitly document `OR`/`NOT` tokenizer behavior
- Key architectural decisions from PROJECT.md: "All extractors use regex parsing (no AST) — good enough for well-structured Elixir/proto/GraphQL macros" and existing `UNINDEXED entity_type` rationale

---
*Pitfalls research for: v4.2 Search Quality improvements*
*Researched: 2026-03-11*
