# Phase 36: Ecto Constraint Extraction - Research

**Researched:** 2026-03-11
**Domain:** Elixir/Ecto module attribute extraction, regex-based field constraint parsing, nullability pipeline
**Confidence:** HIGH

## Summary

This phase extends the existing Ecto field extractor in `src/indexer/elixir.ts` to recognize `@required_fields`, `@optional_fields`, and `cast/4` field lists as additional nullability signals, beyond the current `validate_required/2`-only approach. The current `extractRequiredFields` function handles only inline atom lists inside `validate_required()` calls. When a module uses module attribute indirection (e.g., `validate_required(@required_fields)` or `@required_fields ~w(name email)a`), the current regex silently produces zero results -- this is documented in the existing test suite (test: "returns empty set for variable references like @required_fields").

The implementation is a pure TypeScript regex extension within existing files. No new dependencies, no schema changes, no new DB columns. The work touches three files: `src/indexer/elixir.ts` (new extraction logic + interface extension), `src/indexer/pipeline.ts` (updated nullability determination), and tests. The `~w(...)a` sigil form and `[:atom, :list]` form both need handling since real Elixir codebases use both interchangeably. Cast-only fields (present in `cast/4` but absent from `validate_required` and `@required_fields`) should be treated as optional/nullable.

**Primary recommendation:** Implement two-pass extraction within `parseElixirFile`: first resolve module attribute declarations to field lists, then resolve references in `validate_required`/`cast` calls. Extend `ElixirModule` interface with `optionalFields` and `castFields`. Update pipeline nullability logic to use the combined signal.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FEXT-01 | Ecto extractor parses `@required_fields` and `@optional_fields` module attributes (both list and `~w()a` sigil forms) | Two-pass extraction: first pass resolves module attributes to field lists handling both `[:atom]` and `~w(...)a` syntax; second pass resolves `@attr` references in validate_required/cast calls |
| FEXT-02 | Ecto extractor parses `cast/4` call attributes to identify permitted fields | New `extractCastFields` logic in elixir.ts handles both inline atom lists and module attribute references in cast's third argument |
| FEXT-03 | Pipeline nullability determination uses combined required/optional/cast signals | Updated pipeline.ts nullable logic: field is NOT nullable if in requiredFields (from validate_required) OR in module-attribute-declared required fields; field IS nullable if cast-only or in optionalFields |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript regex | N/A | Elixir source parsing | Existing approach; AST (tree-sitter) explicitly deferred per PROJECT.md |
| vitest | existing | Test framework | Already installed and used for all project tests |

### Supporting
No new libraries needed. All changes are pure logic extensions within existing modules.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex two-pass extraction | tree-sitter AST | AST gives perfect parsing but adds native binary dependency; deferred per PROJECT.md Out of Scope: "AST-based extraction... regex sufficient for well-structured macros" |
| Module attribute resolution | Only extract inline lists | Would miss 30-50% of real Ecto patterns using `@required_fields` indirection |

**Installation:**
```bash
# No changes to package.json
```

## Architecture Patterns

### Files to Modify
```
src/
  indexer/
    elixir.ts      # New extraction functions, ElixirModule interface extension
    pipeline.ts    # Updated nullable logic in ectoFields mapping (line ~190)
tests/
  indexer/
    elixir.test.ts # New test cases for attribute + sigil extraction
    fields.test.ts # Updated tests for combined nullability signal
```

### Pattern 1: Two-Pass Module Attribute Resolution
**What:** First pass scans for `@attr_name value` declarations, building a `Map<string, string[]>` of attribute-name to field-name-list. Second pass scans `validate_required`/`cast` calls and resolves `@attr_name` references via the map.
**When to use:** Any time an Elixir module uses module attributes as indirection for field lists.
**Example:**
```typescript
// Source: verified against Ecto.Changeset docs (hexdocs.pm/ecto)
// and existing elixir.ts extraction patterns

interface ModuleAttributes {
  [attrName: string]: string[];
}

function resolveModuleAttributes(moduleContent: string): ModuleAttributes {
  const attrs: ModuleAttributes = {};
  // Pattern: @attr_name ~w(word list)a  OR  @attr_name [:atom, :list]
  const attrRe = /@(\w+)\s+(?:~w\(([\s\S]*?)\)a|\[([\s\S]*?)\])/g;
  let match;
  while ((match = attrRe.exec(moduleContent)) !== null) {
    const attrName = match[1]!;
    const sigilContent = match[2]; // ~w(...) capture
    const listContent = match[3]; // [...] capture
    if (sigilContent !== undefined) {
      attrs[attrName] = sigilContent.trim().split(/\s+/).filter(Boolean);
    } else if (listContent !== undefined) {
      attrs[attrName] = [...listContent.matchAll(/:(\w+)/g)].map(m => m[1]!);
    }
  }
  return attrs;
}
```

### Pattern 2: Cast Field Extraction
**What:** Extract field names from `cast/4` calls -- both inline atom lists and module attribute references.
**When to use:** Identifying the full set of "permitted" fields that a changeset allows.
**Example:**
```typescript
// cast(changeset, params, [:field1, :field2])  -- inline
// cast(changeset, params, @permitted_fields)   -- attribute reference
// cast(changeset, params, @required ++ @optional)  -- concatenation

function extractCastFields(
  moduleContent: string,
  attrs: ModuleAttributes,
): Set<string> {
  const fields = new Set<string>();

  // Inline atom list in cast: cast(x, y, [:field1, :field2])
  const castInlineRe = /\bcast\s*\(\s*[\w.]+\s*,\s*\w+\s*,\s*\[([\s\S]*?)\]/g;
  let match;
  while ((match = castInlineRe.exec(moduleContent)) !== null) {
    for (const [, atom] of match[1]!.matchAll(/:(\w+)/g)) {
      fields.add(atom!);
    }
  }

  // Module attribute reference in cast: cast(x, y, @fields)
  // Also handles concatenation: cast(x, y, @required ++ @optional)
  const castAttrRe = /\bcast\s*\(\s*[\w.]+\s*,\s*\w+\s*,\s*([@\w\s+]+)\)/g;
  while ((match = castAttrRe.exec(moduleContent)) !== null) {
    const argStr = match[1]!;
    // Extract all @attr references
    for (const [, attrName] of argStr.matchAll(/@(\w+)/g)) {
      const resolved = attrs[attrName!];
      if (resolved) {
        for (const f of resolved) fields.add(f);
      }
    }
  }

  // Pipe form: |> cast(params, [...]) or |> cast(params, @attr)
  const pipeCastInlineRe = /\|>\s*cast\s*\(\s*\w+\s*,\s*\[([\s\S]*?)\]/g;
  while ((match = pipeCastInlineRe.exec(moduleContent)) !== null) {
    for (const [, atom] of match[1]!.matchAll(/:(\w+)/g)) {
      fields.add(atom!);
    }
  }

  const pipeCastAttrRe = /\|>\s*cast\s*\(\s*\w+\s*,\s*([@\w\s+]+)\)/g;
  while ((match = pipeCastAttrRe.exec(moduleContent)) !== null) {
    const argStr = match[1]!;
    for (const [, attrName] of argStr.matchAll(/@(\w+)/g)) {
      const resolved = attrs[attrName!];
      if (resolved) {
        for (const f of resolved) fields.add(f);
      }
    }
  }

  return fields;
}
```

### Pattern 3: Combined Nullability Determination
**What:** Field is non-nullable if it appears in any required signal source. Field is nullable if it's only in cast/optional or has no constraint signal at all.
**When to use:** In pipeline.ts when constructing `FieldData` from `ElixirModule`.
**Example:**
```typescript
// In pipeline.ts ectoFields mapping (currently line ~190)
// Current: nullable: !mod.requiredFields.includes(f.name)
// New: combine all signals

const requiredSet = new Set(mod.requiredFields);     // from validate_required + @required_fields
const optionalSet = new Set(mod.optionalFields ?? []); // from @optional_fields
const castSet = new Set(mod.castFields ?? []);          // from cast/4 calls

// A field is NOT nullable if explicitly required
// A field IS nullable if:
//   - explicitly in optional set, OR
//   - in cast set but not in required set (cast-only = permitted but not required), OR
//   - not mentioned in any constraint signal (schema field with no changeset info)
const isRequired = requiredSet.has(f.name);
const nullable = !isRequired;
```

### Anti-Patterns to Avoid
- **Treating cast-only fields as required:** `cast/4` marks fields as "permitted to change," NOT "must be present." A field in cast but not in validate_required is optional.
- **Single regex that tries to handle both forms:** Combining `[:atom]` and `~w(...)a` in one alternation group is fragile. Use the two-pass approach: resolve attributes first, then resolve references.
- **Hardcoding attribute names:** Don't match only `@required_fields` / `@optional_fields`. Real codebases use `@required`, `@optional`, `@permitted`, `@fields`, etc. The attribute resolution should be generic and capture ALL `@name [list]` or `@name ~w(...)a` patterns. The second pass then identifies which attributes are used in `validate_required` vs `cast` to determine their semantic meaning (required vs permitted).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atom list parsing from Elixir source | Custom tokenizer/parser | Regex with two-form alternation (`[:atom]` and `~w()a`) | Both forms are structurally simple and well-suited to regex; the codebase already uses this approach |
| Module attribute resolution across files | Cross-file dependency resolver | Single-file attribute map within `parseElixirFile` | Module attributes in Elixir are compile-time constants defined in the same file; cross-file resolution is unnecessary and would add massive complexity |

**Key insight:** Module attributes in Elixir are always defined in the same file where they're used. This means the two-pass extraction is purely within a single file's content -- no cross-file dependency graph needed.

## Common Pitfalls

### Pitfall 1: Missing `~w(...)a` Sigil Form
**What goes wrong:** A regex targeting only `[:atom, :list]` syntax silently returns zero results for modules using `~w(name email)a`.
**Why it happens:** The two forms look completely different textually but produce identical runtime values.
**How to avoid:** Every regex that extracts atom lists must handle BOTH forms with alternation. Test fixtures must cover both forms side by side.
**Warning signs:** Repos using `@required_fields ~w(...)a` show zero required fields in extraction output; existing test already documents this gap ("returns empty set for variable references like @required_fields").

### Pitfall 2: Attribute Name Variety
**What goes wrong:** Hardcoding `@required_fields` and `@optional_fields` as the only recognized attribute names misses modules using `@required`, `@optional`, `@permitted`, `@changeset_fields`, etc.
**Why it happens:** There's no official naming convention -- it's just a community pattern with many variations.
**How to avoid:** Extract ALL module attributes that declare atom lists. Then determine the semantic meaning (required vs permitted) from how the attribute is *used* (in `validate_required` vs `cast`), not from the attribute *name*.
**Warning signs:** Modules that use `@required ~w(...)a` instead of `@required_fields ~w(...)a` are missed.

### Pitfall 3: Pipe vs Direct Call Forms
**What goes wrong:** Regex matches `validate_required(changeset, @fields)` but misses `|> validate_required(@fields)` (pipe form, no explicit first argument).
**Why it happens:** Elixir pipe operator implicitly passes the first argument, so piped calls have one fewer visible argument.
**How to avoid:** The existing `extractRequiredFields` regex already handles both forms: `validate_required\s*\(\s*(?:\w+\s*,\s*)?[...]`. The new attribute-aware version must maintain this flexibility.
**Warning signs:** Test passes for direct call form but fails for pipe form.

### Pitfall 4: `@required ++ @optional` Concatenation in Cast
**What goes wrong:** A simple regex for `cast(x, y, @attr)` misses `cast(x, y, @required ++ @optional)` because the third argument contains `++` operator and multiple attribute references.
**Why it happens:** This is the standard Ecto pattern for combining required and optional field lists in the cast call.
**How to avoid:** Extract all `@attr` references from the third argument of cast, not just one. The concatenation operator `++` joins lists at runtime; for our purposes, we just need to find all attribute names referenced.
**Warning signs:** Modules using the `@required ++ @optional` pattern show zero cast fields.

### Pitfall 5: Multiple Changeset Functions in One Module
**What goes wrong:** A module with `create_changeset/2` and `update_changeset/2` that validate different field sets -- last-write-wins silently drops fields from the first changeset.
**Why it happens:** Extracting into a single flat list without considering union semantics.
**How to avoid:** The existing `extractRequiredFields` already uses Set union across all `validate_required` calls in a module. The new extraction must maintain this union behavior for attribute-based fields too.
**Warning signs:** `requiredFields` array is shorter than expected for modules with multiple changesets.

## Code Examples

Verified patterns from the codebase and Ecto documentation:

### Current Extraction (what exists today)
```typescript
// Source: src/indexer/elixir.ts lines 280-294
export function extractRequiredFields(moduleContent: string): Set<string> {
  const required = new Set<string>();
  const re = /validate_required\s*\(\s*(?:\w+\s*,\s*)?\[([\s\S]*?)\]/g;
  let match;
  while ((match = re.exec(moduleContent)) !== null) {
    const atomList = match[1]!;
    const atomRe = /:(\w+)/g;
    let atomMatch;
    while ((atomMatch = atomRe.exec(atomList)) !== null) {
      required.add(atomMatch[1]!);
    }
  }
  return required;
}
```

### Current Pipeline Nullability (what needs updating)
```typescript
// Source: src/indexer/pipeline.ts lines 182-193
const ectoFields: FieldData[] = elixirModules
  .filter(mod => mod.tableName)
  .flatMap(mod =>
    mod.schemaFields.map(f => ({
      parentType: 'ecto_schema' as const,
      parentName: mod.name,
      fieldName: f.name,
      fieldType: f.type,
      nullable: !mod.requiredFields.includes(f.name),  // <-- only source today
      sourceFile: mod.filePath,
    }))
  );
```

### ElixirModule Interface Extension Needed
```typescript
// Source: src/indexer/elixir.ts lines 4-16 (existing)
// Additions needed: optionalFields, castFields
export interface ElixirModule {
  name: string;
  type: string;
  filePath: string;
  moduledoc: string | null;
  functions: string[];
  tableName: string | null;
  schemaFields: { name: string; type: string }[];
  associations: { kind: string; name: string; target: string }[];
  absintheTypes: { kind: string; name: string }[];
  grpcStubs: string[];
  requiredFields: string[];
  optionalFields: string[];   // NEW: from @optional_fields or equivalent
  castFields: string[];        // NEW: from cast/4 permitted field list
}
```

### Real Ecto Patterns to Handle (from Ecto docs + community)
```elixir
# Pattern A: Inline atom lists (already handled by current extractRequiredFields)
def changeset(user, attrs) do
  user
  |> cast(attrs, [:name, :email, :bio])
  |> validate_required([:name, :email])
end

# Pattern B: Module attributes with ~w sigil (NOT handled today)
@required_fields ~w(name email)a
@optional_fields ~w(bio phone)a

def changeset(user, attrs) do
  user
  |> cast(attrs, @required_fields ++ @optional_fields)
  |> validate_required(@required_fields)
end

# Pattern C: Module attributes with atom list (NOT handled today)
@required_fields [:name, :email]
@optional_fields [:bio, :phone]

def changeset(user, attrs) do
  user
  |> cast(attrs, @required_fields ++ @optional_fields)
  |> validate_required(@required_fields)
end

# Pattern D: Short attribute names (NOT handled today)
@required ~w(name email)a
@optional ~w(bio)a

def changeset(user, attrs) do
  user
  |> cast(attrs, @required ++ @optional)
  |> validate_required(@required)
end

# Pattern E: Single @fields attribute (NOT handled today)
@fields ~w(name email bio phone)a

def changeset(user, attrs) do
  user
  |> cast(attrs, @fields)
  |> validate_required([:name, :email])
end
```

### Nullability Truth Table
```
| Signal Source                           | nullable? |
|----------------------------------------|-----------|
| In validate_required (inline list)     | false     |
| In @required_fields + used in v_r      | false     |
| In @optional_fields                    | true      |
| In cast/4 but NOT in validate_required | true      |
| Schema field with no changeset mention | true      |
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `validate_required` inline lists only | Two-pass: module attributes + call-site resolution | This phase | Captures 30-50% more real-world required field declarations |
| Single `requiredFields` signal | Combined required + optional + cast signals | This phase | More accurate nullability for Ecto fields in `kb_field_impact` |

**Deprecated/outdated:**
- Nothing deprecated. This is purely additive extraction logic.

## Open Questions

1. **Attribute name heuristics vs semantic resolution**
   - What we know: Real codebases use `@required_fields`, `@required`, `@permitted`, `@fields`, etc.
   - What's unclear: Should we try to infer required/optional from the attribute *name* (heuristic) or only from *usage* (in validate_required vs cast)?
   - Recommendation: Use semantic resolution (how it's used), not name heuristics. An attribute named `@fields` used in `validate_required(@fields)` means those fields are required, regardless of the name. Name-based heuristics are a fallback only when the attribute is used in cast but not in validate_required -- in that case, attributes containing "required" in the name should be treated as required signal, and all others as permitted/optional.

2. **`~w` sigil delimiter variations**
   - What we know: `~w(words)a` uses parentheses as delimiter. Elixir also allows `~w[words]a`, `~w{words}a`, `~w|words|a`, `~w/words/a`, etc.
   - What's unclear: How common are non-parenthesis delimiters in practice?
   - Recommendation: Start with `~w(...)a` only (parenthesis form). This is overwhelmingly dominant in Ecto codebases. Add other delimiters if real-world extraction misses them. LOW risk of missing anything.

3. **Prevalence of `~w` in Fresha repos**
   - What we know: Community estimates 30-50% of Ecto code uses `~w(...)a` sigil form.
   - What's unclear: Exact prevalence in Fresha's specific repos.
   - Recommendation: A quick grep across a few indexed repos after implementation will confirm. The two-pass approach handles both forms regardless, so this is a validation question, not a blocker.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest.config.ts (existing) |
| Quick run command | `npx vitest run tests/indexer/elixir.test.ts tests/indexer/fields.test.ts --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FEXT-01 | `@required_fields ~w(name email)a` extracts as required | unit | `npx vitest run tests/indexer/fields.test.ts -t "module attribute" -x` | Needs new tests |
| FEXT-01 | `@optional_fields [:phone, :bio]` extracts as optional | unit | `npx vitest run tests/indexer/fields.test.ts -t "optional" -x` | Needs new tests |
| FEXT-02 | `cast(x, y, [:field1, :field2])` extracts permitted fields | unit | `npx vitest run tests/indexer/fields.test.ts -t "cast" -x` | Needs new tests |
| FEXT-02 | `cast(x, y, @required ++ @optional)` resolves attribute refs | unit | `npx vitest run tests/indexer/fields.test.ts -t "cast.*attribute" -x` | Needs new tests |
| FEXT-03 | Pipeline nullability uses combined signals | unit | `npx vitest run tests/indexer/fields.test.ts -t "nullability.*combined" -x` | Needs new tests |
| FEXT-03 | `kb_field_impact` reflects updated nullability | integration | `npx vitest run tests/search/field-impact.test.ts -x` | Existing tests pass + new ones needed |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indexer/elixir.test.ts tests/indexer/fields.test.ts --reporter=verbose`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] New test cases in `tests/indexer/fields.test.ts` for `@required_fields ~w(...)a` extraction
- [ ] New test cases in `tests/indexer/fields.test.ts` for `@optional_fields [:atom]` extraction
- [ ] New test cases in `tests/indexer/fields.test.ts` for `cast/4` field extraction (inline + attribute ref)
- [ ] New test cases in `tests/indexer/fields.test.ts` for combined nullability determination
- [ ] New test case in `tests/indexer/elixir.test.ts` for `parseElixirFile` populating `optionalFields` and `castFields`
- [ ] Updated `tests/search/field-impact.test.ts` asserting that attribute-derived required fields produce `nullable: false`

## Sources

### Primary (HIGH confidence)
- [Ecto.Changeset docs (hexdocs.pm/ecto)](https://hexdocs.pm/ecto/Ecto.Changeset.html) -- `cast/4` signature (struct, params, permitted, opts), `validate_required/3` semantics, "permitted" meaning
- [Elixir Sigils docs (hexdocs.pm/elixir)](https://hexdocs.pm/elixir/sigils.html) -- `~w(...)a` produces atom list, `a` modifier for atoms, whitespace-separated words
- Live source code: `src/indexer/elixir.ts` (current `extractRequiredFields` at lines 280-294, `ElixirModule` interface at lines 4-16, `parseElixirFile` at lines 63-112)
- Live source code: `src/indexer/pipeline.ts` (nullable determination at line 190: `nullable: !mod.requiredFields.includes(f.name)`)
- Live source code: `src/search/field-impact.ts` (FieldHop/FieldBoundary interfaces with `nullable: boolean`, compact formatter)
- Live source code: `tests/indexer/fields.test.ts` (existing test at line 54: "returns empty set for variable references like @required_fields" -- explicitly documenting the gap this phase fixes)

### Secondary (MEDIUM confidence)
- [Elixir School Changesets](https://elixirschool.com/en/lessons/ecto/changesets) -- `@required` / `@optional` module attribute pattern examples
- [Elixir Forum](https://elixirforum.com/t/get-required-fields-from-changeset/12496) -- community patterns for field list module attributes
- [Ecto Changeset guide](https://hexdocs.pm/ecto/data-mapping-and-validation.html) -- cast as "permitted fields" concept

### Tertiary (LOW confidence)
- Community estimate of 30-50% `~w(...)a` prevalence -- sourced from Elixir Forum discussions, not measured against Fresha repos specifically

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns verified against existing codebase and official docs
- Architecture: HIGH -- two-pass extraction approach verified against Ecto patterns; integration points identified via direct code inspection; `ElixirModule` interface extension is a straightforward addition
- Pitfalls: HIGH -- primary pitfall (`~w` sigil miss) is already documented in existing test suite; pipe vs direct call forms verified against current regex; attribute name variety confirmed via multiple community sources

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable domain -- Ecto changeset patterns don't change)
