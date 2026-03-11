# Phase 34: Search Query Layer - Research

**Researched:** 2026-03-11
**Domain:** FTS5 query construction, progressive relaxation, result enrichment
**Confidence:** HIGH

## Summary

Phase 34 modifies the query path in two files (`src/db/fts.ts` and `src/search/text.ts`) and adds a presentation-layer `nextAction` hint to MCP search responses in `src/mcp/tools/search.ts`. No schema changes, no new dependencies, no reindex required. The entire phase is query-time and response-formatting changes.

The current system uses FTS5 implicit AND for multi-term queries. This phase switches the default to OR with BM25 ranking (SRCH-01), adds progressive relaxation when AND returns fewer than 3 results (SRCH-02), preserves all existing golden tests while adding new ordering-aware ones (SRCH-03), and attaches `nextAction` hints to search results (ENRICH-01, ENRICH-02).

The single most dangerous trap is the tokenizer destroying the `OR` operator. `tokenizeForFts` lowercases everything -- `OR` becomes the literal word `or` and FTS5 treats it as a third search term. The golden test suite already documents this behavior in comments on tests #4 and #5. The fix is structural: tokenize each term individually, then join with ` OR ` after.

**Primary recommendation:** Implement a new `searchWithRelaxation()` function in `fts.ts` that wraps the existing query pipeline with a three-step cascade (AND -> OR -> prefix OR), wire it into `searchText()` in `text.ts`, and add `nextAction` as a computed property during result hydration based on `entityType`/`subType`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | FTS queries default to OR with BM25 ranking (terms joined with OR after tokenization) | `buildOrQuery()` helper tokenizes terms individually then joins with ` OR `; FTS5 OR syntax verified against official docs; `executeFtsQuery` in text.ts is the single callsite to modify |
| SRCH-02 | Progressive relaxation retries with broader query when AND returns <3 results | New `searchWithRelaxation()` in fts.ts implements AND->OR->prefix OR cascade; threshold=3 as named constant; must preserve entityTypeFilter across all relaxation steps |
| SRCH-03 | All existing search tests pass; new golden tests cover OR ranking order and relaxation behavior | 15 existing golden tests + text.test.ts suite; new tests must assert ordering (rank #1 contains both terms), result count sanity, and relaxation trigger behavior |
| ENRICH-01 | Search results include `nextAction` hint suggesting appropriate follow-up MCP tool based on entity type | Pure mapping: entityType -> tool name; no DB changes; add to `TextSearchResult` interface or compute at MCP response layer |
| ENRICH-02 | nextAction hints are included in MCP `kb_search` responses | Wire nextAction into `formatResponse` call in `src/mcp/tools/search.ts` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SQLite FTS5 | bundled with better-sqlite3 | Full-text search with BM25 ranking | Already deployed; OR queries are pure query syntax changes |
| better-sqlite3 | current | Synchronous SQLite driver | No change needed |
| vitest | current | Test framework | Already configured for the project |

### Supporting
No new libraries. All changes are pure TypeScript logic within existing modules.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Explicit OR construction in TS | FTS5 tokenizer config to change default operator | FTS5 has no such config; AND is hardcoded in the query parser |
| Progressive AND->OR->prefix cascade | Always OR | AND first preserves precision for exact queries; only relaxes when needed |
| nextAction in search results | Separate MCP tool for enrichment | Adds round-trip; nextAction is a pure O(1) mapping, no reason to separate |

**Installation:**
```bash
# No changes to package.json
```

## Architecture Patterns

### Current Query Flow (before changes)
```
User query
  -> tokenizeForFts(query)     [text.ts: executeFtsQuery]
  -> FTS5 MATCH (implicit AND) [text.ts: executeFtsWithFallback]
  -> hydrate results            [text.ts: searchText]
  -> return TextSearchResult[]
```

### Target Query Flow (after changes)
```
User query
  -> tokenize individual terms  [fts.ts: searchWithRelaxation]
  -> Step 1: AND query          [join with space]
  -> if results < 3:
     Step 2: OR query           [join with ' OR ']
  -> if results still < 3:
     Step 3: prefix OR query    [join with '* OR ' + trailing *]
  -> hydrate results            [text.ts: searchText]
  -> add nextAction per result  [text.ts or mcp/tools/search.ts]
  -> return enriched results
```

### Recommended File Changes
```
src/
  db/
    fts.ts          # Add buildOrQuery(), searchWithRelaxation()
  search/
    text.ts         # Wire searchWithRelaxation; add nextAction mapping
    types.ts        # Add nextAction to TextSearchResult (or enriched variant)
  mcp/
    tools/search.ts # Ensure nextAction flows through formatResponse
```

### Pattern 1: Tokenize-Then-Join for OR Construction
**What:** Tokenize each search term individually through `tokenizeForFts`, then join with FTS5 operators
**When to use:** Every multi-term query construction
**Why critical:** The tokenizer lowercases everything and strips non-alphanumeric chars. If `OR` is included before tokenization, it becomes the literal word `or`.

```typescript
// CORRECT: tokenize individually, then join
function buildOrQuery(rawQuery: string): string {
  const terms = rawQuery.trim().split(/\s+/)
    .map(term => tokenizeForFts(term))
    .filter(Boolean);
  if (terms.length <= 1) return terms[0] ?? '';
  return terms.join(' OR ');
}

// WRONG: tokenize the whole joined string
function buildOrQueryBAD(rawQuery: string): string {
  const terms = rawQuery.trim().split(/\s+/);
  return tokenizeForFts(terms.join(' OR ')); // "OR" becomes "or" literal!
}
```

### Pattern 2: Progressive Relaxation with Preserved Filters
**What:** Cascade through AND -> OR -> prefix OR, re-running the same SQL with the same type/repo filters
**When to use:** When the tightest query returns fewer than `MIN_RESULTS` (3)

```typescript
const MIN_RELAXATION_RESULTS = 3; // named constant, tunable

function searchWithRelaxation(
  db: Database.Database,
  rawQuery: string,
  limit: number,
  entityTypeFilter?: string,
): FtsMatch[] {
  const terms = rawQuery.trim().split(/\s+/)
    .map(t => tokenizeForFts(t))
    .filter(Boolean);

  if (terms.length === 0) return [];
  if (terms.length === 1) {
    // Single term: AND and OR are identical, just run it
    return runFtsQuery(db, terms[0], limit, entityTypeFilter);
  }

  // Step 1: AND (implicit -- FTS5 default)
  const andQuery = terms.join(' ');
  const andResults = runFtsQuery(db, andQuery, limit, entityTypeFilter);
  if (andResults.length >= MIN_RELAXATION_RESULTS) return andResults;

  // Step 2: OR
  const orQuery = terms.join(' OR ');
  const orResults = runFtsQuery(db, orQuery, limit, entityTypeFilter);
  if (orResults.length >= MIN_RELAXATION_RESULTS) return orResults;

  // Step 3: Prefix OR
  const prefixOrQuery = terms.map(t => `${t}*`).join(' OR ');
  return runFtsQuery(db, prefixOrQuery, limit, entityTypeFilter);
}
```

**Key constraint:** `entityTypeFilter` MUST be passed through all relaxation steps. Never relax the type boundary -- only the query strictness.

### Pattern 3: nextAction Mapping
**What:** Static mapping from entityType/subType to the appropriate follow-up MCP tool
**When to use:** On every search result before returning to the caller

```typescript
function getNextAction(entityType: EntityType, subType: string): string {
  switch (entityType) {
    case 'field':
      return 'kb_field_impact';
    case 'repo':
      return 'kb_explain';
    case 'module':
    case 'event':
    case 'service':
      return 'kb_entity';
    case 'learned_fact':
      return 'kb_search';  // facts don't have a dedicated tool
    default:
      return 'kb_entity';
  }
}
```

### Anti-Patterns to Avoid
- **Passing joined OR string through `tokenizeForFts`:** Destroys the `OR` operator. This is the #1 trap. Tokenize each term individually.
- **Relaxing the type filter during progressive relaxation:** If the user asked for `--type schema`, returning non-schema results during OR relaxation is a correctness bug, not a quality improvement.
- **Using `executeFtsWithFallback` phrase fallback for OR queries:** The phrase fallback wraps the query in `"..."`, which converts `booking OR payment` into the phrase `"booking or payment"` -- matching nothing useful. OR queries must skip or handle the phrase fallback differently.
- **Adding nextAction at the DB layer:** nextAction is presentation logic. It belongs in `searchText()` or at the MCP tool layer, not in `fts.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BM25 ranking | Custom relevance scoring | FTS5 built-in `rank` column | FTS5 BM25 is the standard; ORDER BY rank already works |
| Query tokenization | Custom word splitter | Existing `tokenizeForFts` | Handles CamelCase, snake_case, dot-separated -- tested extensively |
| Response size limiting | Manual JSON truncation | Existing `formatResponse` | Already handles 4KB cap with progressive item reduction |

## Common Pitfalls

### Pitfall 1: OR Operator Destroyed by Tokenizer
**What goes wrong:** `tokenizeForFts` lowercases everything. `OR` becomes literal `or`. FTS5 treats `booking or payment` as AND of three terms: `booking`, `or`, `payment`.
**Why it happens:** Natural instinct is to build the full query string then tokenize it.
**How to avoid:** Tokenize each term individually via `tokenizeForFts(term)`, then join with ` OR `. Never pass the joined string through `tokenizeForFts` again.
**Warning signs:** Searching `booking payment` with OR default returns results containing the literal word "or". Golden test #4 comments document this exact behavior.

### Pitfall 2: OR Default Silently Passes Tests While Degrading Quality
**What goes wrong:** OR inflates result sets. Existing `hasBothTerms` assertions pass trivially because with 50 results, *some* result contains both terms. But rank #1 might only contain one term.
**Why it happens:** Test assertions check presence, not ordering.
**How to avoid:** Add ordering-aware golden tests *before* changing the query builder: assert rank #1 contains both terms; assert result count doesn't hit the 20-result limit for two-word queries.
**Warning signs:** Golden suite entirely green but manual spot-checks show noise in top results.

### Pitfall 3: Phrase Fallback Breaks OR Queries
**What goes wrong:** `executeFtsWithFallback` wraps failing queries in `"..."` as a phrase match. An OR query like `booking OR payment` that throws a syntax error gets retried as `"booking or payment"` -- matching nothing useful.
**Why it happens:** The fallback was designed for AND queries where phrase matching is a reasonable degradation.
**How to avoid:** Either (a) skip the phrase fallback for OR queries, or (b) detect OR syntax before applying phrase wrapping. Since OR queries are constructed programmatically (not user-typed), they should never have syntax errors -- the fallback is moot.
**Warning signs:** OR queries that should return results return empty arrays after the fallback.

### Pitfall 4: Relaxation Without Type Filter Preservation
**What goes wrong:** AND query for `--type schema` returns 1 result, OR relaxation returns 10 results but from all entity types. User gets non-schema results when they specifically asked for schemas.
**Why it happens:** The relaxation wrapper forgets to pass `entityTypeFilter` to the OR step.
**How to avoid:** Make `entityTypeFilter` a required parameter in the relaxation cascade. Every step uses the identical SQL template with the identical type filter clause.
**Warning signs:** Relaxed queries return entity types the user didn't ask for.

### Pitfall 5: FTS5 Operator Precedence with Mixed AND/OR
**What goes wrong:** FTS5 parses `one OR two three` as `one OR (two AND three)`, not `(one OR two) AND three`. Implicit AND binds tighter than OR.
**Why it happens:** FTS5 operator precedence is the opposite of what most developers expect.
**How to avoid:** When building OR queries, join ALL terms with OR. Never mix implicit AND with explicit OR in the same query string. The progressive relaxation design handles this: step 1 is pure AND, step 2 is pure OR. No mixing.
**Warning signs:** Three-term OR queries return unexpected result sets.

## Code Examples

### Current tokenizeForFts behavior (verified from source)
```typescript
// Source: src/db/tokenizer.ts
tokenizeForFts("BookingCreated")       // -> "booking created"
tokenizeForFts("booking_service")      // -> "booking service"
tokenizeForFts("booking OR payment")   // -> "booking or payment" (OR destroyed!)
tokenizeForFts("book*")               // -> "book"  (* stripped!)
```

### Current executeFtsQuery flow (verified from src/search/text.ts)
```typescript
// Source: src/search/text.ts lines 73-107
function executeFtsQuery(db, query, limit, entityTypeFilter?) {
  const processedQuery = tokenizeForFts(query);  // <-- single tokenization of whole query
  // ... builds SQL with optional type filter ...
  return executeFtsWithFallback(db, sql, processedQuery, buildParams);
}
```

The key change: replace this single `tokenizeForFts(query)` call with term-level tokenization + OR joining + progressive relaxation.

### nextAction mapping (to implement)
```typescript
// Map entity type to follow-up MCP tool
// field -> kb_field_impact (trace field across service boundaries)
// repo -> kb_explain (full service overview)
// module/event/service -> kb_entity (entity card with relationships)
// learned_fact -> kb_search (no dedicated tool; search for related)
```

### TextSearchResult with nextAction (to implement)
```typescript
// Extension to src/search/types.ts TextSearchResult
interface TextSearchResult {
  // ... existing fields ...
  nextAction?: string;  // suggested MCP tool for follow-up
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Implicit AND for all queries | OR-default with progressive relaxation | This phase | Dramatically improves recall for AI agent consumers |
| No follow-up hints in results | nextAction per result | This phase | Reduces agent reasoning overhead for follow-up queries |
| Single-pass query execution | AND -> OR -> prefix OR cascade | This phase | Graceful degradation when strict queries underperform |

**Current behavior being changed:**
- `searchText("booking payment")` currently returns only results containing BOTH terms (FTS5 implicit AND). After this phase, it returns results containing ANY term, ranked by BM25 relevance -- results containing both terms rank highest.

## Open Questions

1. **Should the OR-default change apply to `findEntity` FTS fallback too?**
   - What we know: `findEntity` in `entity.ts` also uses `executeFtsWithFallback` with implicit AND
   - What's unclear: Whether entity lookup benefits from OR semantics (it's exact-name-then-FTS, different use case)
   - Recommendation: Leave `findEntity` unchanged for now. It's a name-resolution tool where precision matters more than recall. The requirements (SRCH-01/02) specifically target `kb_search`.

2. **Should nextAction include the suggested query/parameter?**
   - What we know: ENRICH-01 says "suggesting appropriate follow-up MCP tool"
   - What's unclear: Whether to include just the tool name or also the suggested argument (e.g., `{tool: "kb_entity", args: {name: "BookingCreated"}}`)
   - Recommendation: Include both tool name and the entity name as the suggested argument. This makes the hint immediately actionable for AI agents without extra reasoning.

3. **Should the relaxation threshold (3) be configurable via TextSearchOptions?**
   - What we know: ASRCH-02 (deferred to v4.3+) specifies "Configurable relaxation threshold"
   - What's unclear: Whether to pre-wire the option now
   - Recommendation: Use a named constant (`MIN_RELAXATION_RESULTS = 3`). Don't add it to `TextSearchOptions` yet -- that's v4.3 scope. Making it a constant is sufficient for tunability.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (current) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/search/golden.test.ts tests/db/fts.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-01 | Multi-term query returns results containing ANY term, ranked by BM25 | unit | `npx vitest run tests/search/golden.test.ts -t "OR"` | Partial (test #4 exists but tests old behavior) |
| SRCH-01 | OR-constructed query preserves operator through tokenization | unit | `npx vitest run tests/db/fts.test.ts -t "OR"` | No -- Wave 0 |
| SRCH-02 | AND query < 3 results triggers OR relaxation, returns more results | unit | `npx vitest run tests/search/golden.test.ts -t "relaxation"` | No -- Wave 0 |
| SRCH-02 | Type filter preserved across relaxation steps | unit | `npx vitest run tests/search/text.test.ts -t "relaxation"` | No -- Wave 0 |
| SRCH-03 | All 15 existing golden tests pass after changes | integration | `npx vitest run tests/search/golden.test.ts` | Yes (15 tests) |
| SRCH-03 | New golden tests verify OR ranking order | integration | `npx vitest run tests/search/golden.test.ts -t "OR ranking"` | No -- Wave 0 |
| ENRICH-01 | Each result includes nextAction based on entity type | unit | `npx vitest run tests/search/text.test.ts -t "nextAction"` | No -- Wave 0 |
| ENRICH-02 | MCP kb_search response includes nextAction | integration | `npx vitest run tests/mcp/search.test.ts -t "nextAction"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/golden.test.ts tests/db/fts.test.ts tests/search/text.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/db/fts.test.ts` -- add `buildOrQuery` unit tests (OR operator survives tokenization, single term passthrough, empty input)
- [ ] `tests/search/golden.test.ts` -- add OR ranking golden tests (rank #1 contains both terms, result count sanity) and relaxation golden tests (AND sparse -> OR returns more)
- [ ] `tests/search/text.test.ts` -- add nextAction tests (field -> kb_field_impact, module -> kb_entity, etc.) and relaxation type-filter preservation test
- [ ] `tests/mcp/search.test.ts` -- verify nextAction appears in MCP formatted response (if not already tested elsewhere)

## Sources

### Primary (HIGH confidence)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html) -- OR syntax, implicit AND behavior, operator precedence, prefix match syntax
- Live source: `src/db/fts.ts` -- current search(), executeFtsWithFallback(), indexEntity()
- Live source: `src/db/tokenizer.ts` -- tokenizeForFts() lowercasing behavior (destroys OR/NOT operators)
- Live source: `src/search/text.ts` -- searchText(), executeFtsQuery() (the callsite to modify)
- Live source: `src/search/types.ts` -- TextSearchResult interface (where nextAction will be added)
- Live source: `src/mcp/tools/search.ts` -- registerSearchTool() (MCP response formatting)
- Live source: `tests/search/golden.test.ts` -- 15 golden tests, comments on tests #4/#5 documenting OR/NOT tokenizer behavior
- Live source: `tests/fixtures/seed.ts` -- test data structure (2 repos, 5 modules, 1 event, 1 service, 2 facts)

### Secondary (MEDIUM confidence)
- .planning/research/STACK.md -- FTS5 OR syntax verified, progressive relaxation strategy documented
- .planning/research/PITFALLS.md -- tokenizer trap, test suite regression risks, phrase fallback conflict
- .planning/research/SUMMARY.md -- phase ordering rationale, feature dependencies confirmed

### Tertiary (LOW confidence)
- None. All findings verified against source code and official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all changes to existing files verified via source inspection
- Architecture: HIGH -- exact callsites identified, data flow traced end-to-end through fts.ts -> text.ts -> mcp/tools/search.ts
- Pitfalls: HIGH -- tokenizer trap documented in golden test comments; operator precedence verified against SQLite docs; phrase fallback conflict identified from executeFtsWithFallback source

**Research date:** 2026-03-11
**Valid until:** No expiration -- all findings from direct codebase inspection and stable SQLite FTS5 documentation
