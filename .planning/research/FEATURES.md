# Feature Research

**Domain:** AI-optimized code knowledge base search — v4.2 Search Quality milestone
**Researched:** 2026-03-11
**Confidence:** HIGH (code analysis of existing system) / MEDIUM (ecosystem patterns)

---

## Context: What Already Exists

This is a subsequent milestone. The system already has:
- FTS5 with implicit AND, BM25 ranking, unicode61 tokenizer, prefix=2,3
- `executeFtsWithFallback` (syntax-error fallback to phrase match — NOT a zero-results OR fallback)
- `searchText()` returns: entityType, subType, entityId, name, snippet (= description ?? name), repoName, repoPath, filePath, relevance
- Field FTS description: `"${parentName} ${fieldType}"` (writer.ts line ~430)
- Module FTS description: summary, or `"Ecto schema table: ${tableName}"` if table present
- Event FTS description: raw `schema_definition` string (proto field list)
- Ecto extractor captures: schemaFields, associations, requiredFields (validate_required atoms)
- Proto extractor captures: field name, type, optional flag — but message name NOT in FTS description
- No null-guard scanning exists anywhere in the indexer

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that define "search actually works" for an AI agent consumer. Missing any of these produces silence or misleading results.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| OR-default search mode | An agent searching "booking created" expects results for either word when both-word entities don't exist. AND-default silently returns nothing — worse than noisy results for AI consumers (recall > precision is the right tradeoff). | LOW | Change query-construction in `executeFtsQuery` in `text.ts` to join tokenized terms with OR. Tokenizer stays pure. One-line change. |
| Progressive relaxation: AND → OR fallback | When a narrow query returns zero or fewer than N results, automatically retry with OR. Provides graceful degradation without requiring callers to know about it. Distinct from the existing syntax-error fallback in `executeFtsWithFallback`. | LOW | Add zero-result check in `executeFtsQuery`; if result count < 3, retry with terms joined by OR. Pattern already established by `executeFtsWithFallback`. |
| Richer FTS description: proto field includes message context | An agent searching "BookingCreated scheduled_at" misses proto fields because FTS description is just `"BookingCreated string"` with no event association. Message context is missing from searchable text. | LOW | In `writer.ts` field insertion block: build description as `"${parentName}.${fieldName} ${fieldType} [event: ${eventName}]"` when `eventId !== null`. Event name is resolvable from `lookupEvent` already prepared in the same transaction. |
| Richer FTS description: repo name inline | BM25 ranks results within FTS content. Repo name is not in the searchable text for modules/services, so cross-repo disambiguation is weaker than it could be. | LOW | Append `repo:${repoName}` to FTS description at write time in `persistRepoData`. Repo name is already available via `metadata.name`. |
| Deeper Ecto cast/optional field extraction | `requiredFields` from `validate_required` is already extracted. `cast/2` call and `@optional_fields` attribute (Fresha pattern) are not. Without this, nullability metadata for Ecto fields is incomplete — agents can't tell if a field is optional from the index. | MEDIUM | Add regex patterns for `@optional_fields\s*\[...\]` and `cast(changeset, @optional_fields)` in `elixir.ts`. Cross-reference against `schemaFields`: fields not in `requiredFields` and not in explicit `@optional_fields` list are nullable=true by Ecto default. Follows pattern of existing `extractRequiredFields`. |

### Differentiators (Competitive Advantage)

Features that make this tool meaningfully better for AI agents than a naive FTS grep tool.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Result enrichment: `nextAction` hint per result | Each search result includes a structured hint for the next tool call. E.g., a repo result suggests `kb_explain`; a field result suggests `kb_field_impact`; a module with edges suggests `kb_deps`. Reduces agent reasoning from "what do I do with this?" to "execute the hint." | MEDIUM | Add `nextAction?: { tool: string; args: Record<string, string> }` to `TextSearchResult` type. Populate in `searchText()` hydration loop based on `entityType`. No DB changes. Logic is pure branching on entity type and relationship presence. |
| Null-guard heuristic scanning | Detect `is_nil`, `case x when nil`, `with x when not is_nil(x)`, `Map.get/3` (three-arg = nil-safe), `Access.get` near field references in Elixir source. Index a `has_null_guard` boolean per field. Agents immediately know whether a field is defensively used or dangerously assumed non-nil — without reading source. | HIGH | New extraction function in `elixir.ts`. For each schemaField, scan ±20 lines for nil-guard patterns. Add `has_null_guard` boolean to `FieldData` and `fields` table. Schema version bump required (triggers drop+rebuild, which is the established migration pattern). Regex patterns: `is_nil\(\s*[^)]*fieldName`, `case.*fieldName.*nil\s*->`, `when not is_nil.*fieldName`, `Map\.get\([^,]+,\s*:fieldName\s*,`. |
| Multi-concept fan-out to parallel entity types | Query "BookingCreated payment_method" spans an event name and a field name. A single BM25 pass deprioritizes one. Fan-out executes one FTS pass per detected concept, merges ranked results — surfaces cross-entity-type results that a single pass misses. | MEDIUM | Detect query as multi-concept if tokenized form has 2+ terms and no explicit OR/AND/NOT operators. Split on natural concept boundaries (CamelCase terms vs snake_case terms), run N sub-queries (N=2 or 3 max), merge with dedup by entityId. SQLite sub-queries are <5ms each; N=3 stays under 20ms total. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Semantic / vector search | "Find conceptually related things even without exact name" | Already removed in v2.1: 1hr generation time, OOM on targeted runs. Contradicts SQLite-only constraint. Embeddings add infra complexity with marginal return over well-tuned FTS. | Richer FTS descriptions + OR-default covers the primary motivation. Better descriptions mean better recall without embeddings. |
| Fuzzy / edit-distance matching | "appointment should match appointments" | FTS5 prefix matching (prefix=2,3 already configured) handles the 90% case. Edit-distance requires custom tokenizer or external lib, adds query latency, and produces noisy results in a code domain where exact naming matters. | Prefix search handles plural/truncated forms. OR-default handles multi-token misses. |
| Result pagination (cursor-based) | "I want more than 20 results" | MCP responses are capped at 4KB. Stateless MCP server can't hold pagination state between calls. Large result sets cause agent context bloat. | Increase recall via OR-default instead of returning more results. Use type-filtering to scope. Agents should make focused queries, not browse. |
| Per-query null-guard scan (on-the-fly) | "Show null guard status without reindexing" | Scanning source files per query breaks the <2s response constraint. Source files aren't cached post-indexing — the DB is the cache. On-the-fly regex across 400 repos = minutes, not milliseconds. | Index null-guard status at index time (the differentiator above). Query-time is read-only. |
| AST-based extraction | "Regex misses edge cases" | tree-sitter or equivalent requires native binary dependency, breaking the zero-infrastructure constraint. Explicitly deferred in PROJECT.md (NOM-03). Fresha's macros are well-structured enough for regex. | Improve regex coverage for specific gaps (cast/@optional_fields) rather than replacing the extraction approach. |

---

## Feature Dependencies

```
OR-default search mode
    └──enables──> Progressive relaxation
                  (relaxation becomes "drop rarest term" rather than "change operator" if OR is default)
                      └──enhances──> Multi-concept fan-out
                                     (fan-out sub-queries use single-term queries internally)

Richer FTS descriptions (proto message name, repo name)
    └──required by──> Multi-concept fan-out
                      (better per-field descriptions make merged results distinguishable)
    └──required by──> Result enrichment: nextAction hint
                      (richer snippets give agent better context to decide follow-up)

Deeper Ecto cast extraction
    └──feeds into──> Null-guard heuristic scanning
                     (cast fields are the target population; knowing optional vs required
                      makes guard detection meaningful)

Null-guard heuristic scanning
    └──required by──> Field result enrichment showing constraint summary
                      (guard status to surface in search results)
```

### Dependency Notes

- **OR-default before progressive relaxation:** Relaxation logic needs a clear "what is the expanded query" contract. If OR is default, the expansion step is "drop least-informative term" — semantically cleaner than switching operators mid-flight.
- **Richer descriptions before fan-out:** Fan-out merges results from multiple sub-queries. Sparse descriptions make merged results look indistinguishable. Richer descriptions make rank-merge and dedup meaningful.
- **Null-guard scan depends on cast extraction:** Without knowing which fields are in the cast set, the guard check has incomplete coverage. Required fields (already extracted) + optional fields (new) = full field surface area.
- **Null-guard is independent of search mode changes:** Touches only the indexer, not the query path. Can be built in parallel with OR-default/relaxation work.
- **nextAction hint is independent of all above:** Pure presentation logic in `searchText()`. No indexer changes. Can ship in any order.

---

## MVP Definition

### Launch With (v4.2)

Minimum set to deliver the milestone goal — "optimize search for AI agent consumers."

- [ ] **OR-default search mode** — highest recall impact, lowest risk, single-function change
- [ ] **Progressive AND → OR relaxation** — complements OR-default; handles zero-result edge cases
- [ ] **Richer FTS descriptions: proto message context** — fixes the specific gap where proto fields are unfindable by event name
- [ ] **Richer FTS descriptions: repo name inline** — improves cross-repo disambiguation without schema changes
- [ ] **Deeper Ecto cast/optional field extraction** — completes nullability metadata that v4.0 started; prerequisite for null-guard

### Add After Validation (v4.2.x)

- [ ] **Result enrichment: nextAction hint** — trigger: agents are still making unnecessary follow-up calls after search
- [ ] **Null-guard heuristic scanning** — trigger: agents need to know call-site safety without reading source; requires schema bump

### Future Consideration (v5+)

- [ ] **Multi-concept fan-out** — trigger: agents fail to find cross-entity concept queries even with OR-default; requires careful latency measurement and query-structure detection

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| OR-default search mode | HIGH | LOW | P1 |
| Progressive AND→OR relaxation | HIGH | LOW | P1 |
| Richer FTS description: proto message name | HIGH | LOW | P1 |
| Richer FTS description: repo name inline | MEDIUM | LOW | P1 |
| Deeper Ecto cast/optional extraction | HIGH | MEDIUM | P1 |
| Result enrichment: nextAction hint | HIGH | MEDIUM | P2 |
| Null-guard heuristic scanning | MEDIUM | HIGH | P2 |
| Multi-concept fan-out | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v4.2 launch
- P2: Should have; add once core is validated
- P3: Nice to have; defer to v5+

---

## Implementation Notes by Feature

### OR-default search mode
Current: `tokenizeForFts("booking service")` → `"booking service"` → FTS5 implicit AND (both terms required).
Proposed: join tokenized terms with ` OR ` in the query-construction layer in `executeFtsQuery` (`text.ts`). The tokenizer stays pure. One-line change in query building.

Caution: OR-default increases result count. BM25 mitigates this — exact phrase matches rank higher than incidental OR matches. Set `limit` default conservatively and let ranking do the filtering.

### Progressive AND → OR relaxation
Current: `executeFtsWithFallback` retries on syntax error only — not zero results.
Proposed: in `executeFtsQuery`, after OR-default query, if `results.length < 3`, retry with single-term queries per tokenized term, merge results, dedup by entityId. Stop when `count >= 3`. Log relaxation type internally (not stderr) for future synonym gap analysis.

### Richer FTS descriptions: proto message context
In `writer.ts`, field insertion block (line ~429-430):
- Current: `description: \`${field.parentName} ${field.fieldType}\``
- Proposed: when `eventId !== null`, suffix with ` [event: ${eventName}]`. Event name resolvable from `lookupEvent` already prepared in the same transaction scope. No schema change needed.

### Deeper Ecto cast/optional extraction
New regex in `elixir.ts` `extractRequiredFields`-adjacent function:
- `@optional_fields\s*\[([\s\S]*?)\]` — extract optional field atom list
- `cast\s*\(\s*\w+\s*,\s*@optional_fields\b` — detect pipe-to-optional-cast
- Cross-reference: fields in `schemaFields` but not in `requiredFields` and not in `@optional_fields` list → nullable=true (Ecto default for non-cast fields varies; be conservative, treat ambiguous as nullable)

### Null-guard heuristic scanning
Two-pass per Elixir file:
1. Collect field names from schema fields list for the module
2. For each field, scan ±20 lines in module content for nil-guard patterns:
   - `is_nil\(\s*[^)]*\b{fieldName}\b`
   - `case\s+[^,\n]*\b{fieldName}\b[\s\S]{0,200}nil\s+->`
   - `when not is_nil\s*\([^)]*\b{fieldName}\b`
   - `Map\.get\s*\([^,]+,\s*:{fieldName}\s*,` (three-arg form = has default = nil-safe)
   - `with\s+[^<\n]*\b{fieldName}\b\s+when not is_nil`

Regex-only; no AST. False-positive rate is acceptable for advisory heuristics. Add `has_null_guard: boolean` to `FieldData` interface and `fields` table. Schema version bump triggers drop+rebuild (established pattern since v4.1).

### Multi-concept fan-out
Detection: tokenized query has 2+ terms, no FTS5 operators (AND/OR/NOT/NEAR), and terms are from different "concept namespaces" (CamelCase = entity/event name, snake_case = field name). Run up to 3 parallel sub-queries, each against a single concept, merge results with Set-based dedup on `entityId`, re-rank by sum of per-query relevance scores. All sub-queries are synchronous SQLite; N=3 stays well under 2s budget.

---

## Sources

- Code analysis: `/src/db/fts.ts`, `/src/search/text.ts`, `/src/search/entity.ts`, `/src/indexer/elixir.ts`, `/src/indexer/proto.ts`, `/src/indexer/writer.ts` (HIGH confidence — direct inspection)
- FTS5 boolean query syntax and OR operator: [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html) (HIGH confidence)
- Query relaxation patterns and best practices: [RapidSearch query relaxation glossary](https://www.rapidsearch.app/glossary/query-relaxation) (MEDIUM confidence — single source, conceptually sound)
- Code search result enrichment for LLM agents: [Context Engineering for Coding Agents — Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html), [LLM Agents Improve Semantic Code Search — arXiv 2408.11058](https://arxiv.org/html/2408.11058v1) (MEDIUM confidence)
- Elixir nil-guard patterns: [Elixir Patterns and Guards — HexDocs](https://hexdocs.pm/elixir/main/patterns-and-guards.html) (HIGH confidence)

---
*Feature research for: repo-knowledge-base v4.2 Search Quality*
*Researched: 2026-03-11*
