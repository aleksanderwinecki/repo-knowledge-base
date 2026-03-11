# Stack Research

**Domain:** Search quality improvements to an existing SQLite/FTS5/Node.js knowledge base
**Researched:** 2026-03-11
**Confidence:** HIGH — all claims verified against official SQLite FTS5 docs and live source code

## Overview

This is a no-new-dependencies milestone. Every feature is implementable using existing stack
primitives (SQLite FTS5, TypeScript regex, existing pipeline). The research below documents
the exact syntax and patterns needed, not options to evaluate.

---

## Recommended Stack

### Core Technologies

All pre-existing. No changes to core technology decisions.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| SQLite FTS5 | bundled with better-sqlite3 | Full-text search with BM25 ranking | Already deployed; OR queries and progressive relaxation are pure query logic changes |
| better-sqlite3 | current (already in package.json) | Synchronous SQLite driver | Existing choice; no change needed |
| TypeScript regex | N/A | Elixir AST-free parsing | Consistent with all existing extractors; AST (tree-sitter) remains deferred |

### Supporting Libraries

None to add. All four features are pure logic changes within existing modules.

| Library | Status | Purpose |
|---------|--------|---------|
| vitest | already installed | Test new query-building logic and Ecto regex patterns |
| p-limit | already installed | No change; null-guard scan runs in existing extraction phase |

---

## Feature-Specific Technical Details

### Feature 1: FTS5 OR-Default Queries with Progressive Relaxation

**Confirmed behavior (HIGH confidence — official SQLite docs):**
FTS5 implicit operator between whitespace-separated terms is always AND. There is no
configuration option or tokenizer setting to change this default. OR must be explicit.

**How to implement OR-default:**
Build the MATCH string in TypeScript by joining terms with ` OR ` before passing to SQLite.

```typescript
// AND query (current behavior — implicit)
// "booking payment" → MATCH 'booking payment'  (AND)

// OR query (explicit construction in TS)
// "booking payment" → MATCH 'booking OR payment'

function buildOrQuery(processedQuery: string): string {
  const terms = processedQuery.trim().split(/\s+/);
  if (terms.length <= 1) return processedQuery;
  return terms.join(' OR ');
}
```

**Progressive relaxation strategy (implement in `src/db/fts.ts` or `src/search/text.ts`):**

```typescript
// Step 1: AND query (current behavior — exact multi-term match, high precision)
// Step 2: OR query (if AND returns < threshold results, e.g., < 3)
// Step 3: Prefix OR query (if OR still sparse, add * suffix to each term)

function buildProgressiveQuery(processedQuery: string, step: 1 | 2 | 3): string {
  const terms = processedQuery.trim().split(/\s+/);
  if (terms.length <= 1) return step === 3 ? `${processedQuery}*` : processedQuery;
  switch (step) {
    case 1: return processedQuery;                          // implicit AND
    case 2: return terms.join(' OR ');                      // explicit OR
    case 3: return terms.map(t => `${t}*`).join(' OR ');   // prefix OR
  }
}
```

**Threshold recommendation:** Relax AND→OR when results < 3. Single-term queries skip
straight to prefix match (step 3) since AND and OR are equivalent for one term.

**Where this lives:** New `searchWithRelaxation()` function in `src/db/fts.ts`, called from
`searchText()` in `src/search/text.ts`. Existing `executeFtsWithFallback` handles syntax
errors; progressive relaxation is a separate concern layered on top.

**FTS5 query syntax for reference (HIGH confidence — verified against sqlite.org/fts5.html):**

```sql
-- Explicit OR
WHERE knowledge_fts MATCH 'booking OR payment'

-- Prefix match (star must be attached to term, no space)
WHERE knowledge_fts MATCH 'book* OR pay*'

-- Combined: phrase with fallback
WHERE knowledge_fts MATCH '"booking service"'  -- phrase
WHERE knowledge_fts MATCH 'booking OR service' -- OR fallback
```

**Important FTS5 constraint:** Implicit AND groups more tightly than NOT and OR operators.
`'one OR two three'` is parsed as `'one OR (two AND three)'`, NOT `'(one OR two) AND three'`.
When building OR queries, join ALL terms with OR — do not mix implicit AND with OR.

---

### Feature 2: Richer FTS Descriptions with Repo/Parent Context

**Current state (from `src/indexer/writer.ts`):**

| Entity | Current FTS description |
|--------|------------------------|
| module (no table) | `mod.summary` or null |
| module (Ecto schema) | `"${mod.summary} table:${tableName}"` |
| event | `evt.schemaDefinition` (proto message body) |
| field | `"${field.parentName} ${field.fieldType}"` |
| service | `svc.description` |
| repo | `metadata.description` |

**Missing context that would improve recall:**
- Repo name is NOT in FTS descriptions — searching for module names from a known repo
  fails to surface those results when terms are ambiguous across repos.
- Field descriptions lack the repo name (just `parentName fieldType`).
- Proto events lack the message name in a searchable position distinct from the body.
- Module summary for Ecto schemas does not include required/optional field hints.

**Recommended enrichment (changes to `insertModuleWithFts` and the field indexing block
in `persistRepoData`/`persistSurgicalData`):**

```typescript
// Field FTS description — add repo name and nullable hint
description: `${repoName} ${field.parentName} ${field.fieldType} ${field.nullable ? 'nullable' : 'required'}`

// Module FTS description — add repo name prefix for cross-repo disambiguation
ftsDescription = `${repoName} ${ftsDescription}`

// Event FTS description — already has message body; add repo name
description: `${repoName} ${evt.schemaDefinition}`
```

**Where `repoName` comes from:** The `persistRepoData` and `persistSurgicalData` functions
already have `data.metadata.name`. Pass it down to `insertModuleWithFts` and the field
indexing block — it is a one-argument addition to those private functions.

**Constraint:** FTS descriptions feed `tokenizeForFts` before storage. Repo names like
`app-booking-service` will be split to `app booking service` — which is exactly what we want
for substring matching.

---

### Feature 3: Deeper Ecto Constraint Extraction

**Current state (from `src/indexer/elixir.ts`):**

The existing `extractRequiredFields` function handles `validate_required/2` with atom lists.
The `ElixirModule` interface already has `requiredFields: string[]`.

What's missing:
1. `@required_fields` and `@optional_fields` module attribute patterns
2. `cast(attrs, @required_fields ++ @optional_fields)` or `cast(attrs, [:field1, :field2])`
   patterns where the cast list IS the complete field set
3. Fields present in `cast` but not in `validate_required` → optional by convention

**New regex patterns to add to `elixir.ts` (new `extractConstraintFields` function):**

```typescript
// Pattern: @required_fields ~w(name email)a  or  @required_fields [:name, :email]
const moduleAttrListRe = /@required_fields\s+(?:~w\(([\s\S]*?)\)a|\[([\s\S]*?)\])/g;

// Pattern: @optional_fields ~w(nickname bio)a  or  @optional_fields [:nickname, :bio]
const moduleAttrOptRe = /@optional_fields\s+(?:~w\(([\s\S]*?)\)a|\[([\s\S]*?)\])/g;

// Pattern: cast(changeset, attrs, [:field1, :field2]) — inline atom list
// Note: cast takes (struct_or_changeset, params, allowed_fields)
const castInlineRe = /\bcast\s*\(\s*\w[\s\S]*?,\s*\w+\s*,\s*\[([\s\S]*?)\]/g;
```

**Atom extraction helpers:**

```typescript
// ~w(name email age)a → ["name", "email", "age"]
function extractAtomsFromSigil(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

// [:name, :email, :age] → ["name", "email", "age"]
function extractAtomsFromList(s: string): string[] {
  return [...s.matchAll(/:(\w+)/g)].map(m => m[1]!);
}
```

**Recommended approach:** Add `extractConstraintFields(content: string): { required: string[], optional: string[] }` in `elixir.ts`. Supplements the existing `extractRequiredFields` (which reads `validate_required`) with module-attribute and cast-list patterns. Final required set = union of all sources.

**Precedence for nullable determination (in `pipeline.ts` ectoFields mapping):**
```typescript
nullable = !(requiredFromValidate.has(f.name) || requiredFromAttributes.has(f.name))
```

**Note on `cast` pattern reliability (MEDIUM confidence):** Cast lists represent "allowed to
be set" not "required." Only treat cast-only fields as optional (nullable=true). Only
`@required_fields` and `validate_required` imply non-nullable. Verify against actual Fresha
changeset patterns before treating cast-presence as a required signal.

---

### Feature 4: Null-Guard Heuristic Scanning in Elixir Code

**Goal:** Detect `is_nil(field)` / `case field do nil ->` patterns near field references as a
secondary signal that the field is treated as nullable at the call site, even if `validate_required`
marks it non-null.

**Current state:** No null-guard scanning exists.

**Recommended regex patterns:**

```typescript
// is_nil guard: is_nil(record.field_name)  or  is_nil(field_name)
const isNilRe = /\bis_nil\s*\(\s*(?:\w+\.)?([\w]+)\s*\)/g;

// case nil match: case expr.field_name do ... nil ->
const caseNilRe = /case\s+(?:\w+\.)?(\w+)\s+do[\s\S]{0,50}nil\s*->/g;

// when is_nil(field_name) in function guards
const guardNilRe = /when\s+is_nil\s*\(\s*(?:\w+\.)?([\w]+)\s*\)/g;
```

**Where this lives:** New `extractNullGuardedFields(moduleContent: string): Set<string>`
function in `elixir.ts`. Accepts module content, returns field names that appear in null guards.

**Integration — critical design decision:**
The current pipeline discards raw module content after parsing — `ElixirModule` only stores
structured data. To scan for null guards, either:
- **Option A (recommended):** Add `nullGuardedFields: string[]` to `ElixirModule` interface
  and populate in `parseElixirFile`. Consistent with "parse once" pattern.
- Option B: Re-read file content in pipeline. Defeats per-file caching, adds I/O.

Use Option A. The `nullGuardedFields` set feeds the nullable override in `pipeline.ts`:
```typescript
nullable: !mod.requiredFields.includes(f.name) || nullGuardedFields.has(f.name)
```

**Confidence on null-guard coverage:** MEDIUM — covers common Elixir patterns. Unusual guard
forms (multi-branch `case`, macro-wrapped guards) will be missed. False negatives are
acceptable for a heuristic scan.

---

## Installation

No new packages required.

```bash
# No changes to package.json
```

---

## Alternatives Considered

| Feature | Recommended | Alternative | Why Not |
|---------|-------------|-------------|---------|
| OR-default queries | Build OR string in TypeScript, pass to FTS5 MATCH | Configure FTS5 tokenizer to default OR | FTS5 has no such configuration; implicit AND is hardcoded in query parser |
| OR-default queries | Progressive relaxation (AND→OR→prefix) | Always OR | AND first preserves precision for exact queries; AI agents benefit from high-precision results when available |
| Ecto constraint extraction | Extend existing regex extractor | tree-sitter AST | Deferred in PROJECT.md; regex is sufficient for well-structured macros |
| Null-guard heuristics | Add `nullGuardedFields` to `ElixirModule` | Scan separately in pipeline | Avoids re-reading file; consistent with "parse once" pattern |
| Richer FTS descriptions | Prepend repo name in FTS description string | Add `repo_name` column to FTS table | FTS5 text columns are already tokenized; adding a column would require schema bump and re-index; string prepend achieves identical recall with zero schema change |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| FTS5 tokenizer config to change default operator | FTS5 does not support this; default AND is hardcoded in query parser | Explicit OR construction in TypeScript before calling MATCH |
| Changing `prefix='2,3'` tokenizer setting | Already configured and working | Leave tokenizer config as-is |
| New npm packages (natural, lunr, fuse.js) | Zero new dependencies is an explicit project constraint | Extend existing FTS5 query layer |
| Schema version bump for this milestone | None of these changes touch DB schema | Keep SCHEMA_VERSION = 10; all changes are query-time or description-string changes |

---

## Summary: Exact Code Locations for Each Feature

| Feature | File(s) to change | What changes |
|---------|--------------------|--------------|
| OR-default + relaxation | `src/db/fts.ts`, `src/search/text.ts` | New `buildOrQuery()` helper; `searchWithRelaxation()` wrapper; wire into `searchText()` |
| Richer FTS descriptions | `src/indexer/writer.ts` | Pass `repoName` into `insertModuleWithFts`; update field description format in `persistRepoData` and `persistSurgicalData` |
| Deeper Ecto constraints | `src/indexer/elixir.ts`, `src/indexer/pipeline.ts` | New `extractConstraintFields()`; extend `ElixirModule` interface; update nullable logic in pipeline.ts |
| Null-guard heuristics | `src/indexer/elixir.ts`, `src/indexer/pipeline.ts` | New `extractNullGuardedFields()`; add `nullGuardedFields: string[]` to `ElixirModule`; update nullable logic |

---

## Sources

- [SQLite FTS5 Extension — sqlite.org/fts5.html](https://www.sqlite.org/fts5.html) — verified OR syntax, implicit AND behavior, no configurable default operator (HIGH confidence)
- [Ecto.Changeset — hexdocs.pm/ecto](https://hexdocs.pm/ecto/Ecto.Changeset.html) — verified `validate_required`, `cast` signatures and semantics (HIGH confidence)
- Live source code: `src/indexer/elixir.ts`, `src/db/fts.ts`, `src/search/text.ts`, `src/indexer/writer.ts`, `src/indexer/pipeline.ts` (HIGH confidence)
- Elixir Forum + community for `@required_fields ~w(...)a` module attribute convention (MEDIUM confidence — common pattern, not in official Ecto docs)

---
*Stack research for: v4.2 Search Quality milestone*
*Researched: 2026-03-11*
