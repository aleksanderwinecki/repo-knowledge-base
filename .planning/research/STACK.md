# Technology Stack: v1.1 Additions

**Project:** repo-knowledge-base v1.1 — Improved Reindexing & New Extractors
**Researched:** 2026-03-06
**Scope:** Only NEW dependencies/changes for v1.1 features. Existing stack (better-sqlite3, TypeScript, commander, vitest, @modelcontextprotocol/sdk, zod) is validated and unchanged.

## Recommended Additions

### GraphQL Schema Parsing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| graphql | ^16.13.1 | Parse `.graphql`/`.gql` SDL files | The official reference implementation. `buildSchema()` parses SDL into a `GraphQLSchema` object, then `getTypeMap()` extracts all types with fields, and `schema.getQueryType()` / `schema.getMutationType()` / `schema.getSubscriptionType()` give direct access to root operation types. No alternatives worth considering — this IS the GraphQL spec implementation. |

**Why not regex?** GraphQL SDL has nested types, directives, interfaces, unions, input types, and enums. A regex approach would be fragile and incomplete. `graphql` parses SDL in ~1ms per file with full fidelity. At 2.3MB install size, it's well worth it.

**Integration point:** New `src/indexer/graphql.ts` extractor. Scan for `*.graphql` and `*.gql` files, parse with `buildSchema()`, walk `getTypeMap()` to extract types/fields, extract queries/mutations/subscriptions from root types. Map output to existing `ModuleData` (type name = module name, type = "graphql_type"/"graphql_query"/"graphql_mutation") and `EventData` (subscriptions as events).

**Confidence:** HIGH — graphql 16.x is stable (latest 16.13.1 published March 2026), the parse/introspect API has been unchanged since v15.

### gRPC/Proto Service Extraction

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| *(none — enhance existing regex)* | — | Better gRPC service extraction | The existing `proto.ts` already parses proto files with regex and extracts `ProtoService` with RPCs. The data just isn't being persisted to the `services` table. No new dependency needed. |

**Current gap (code-level, not stack-level):** The existing proto extractor already captures `ProtoService[]` with full RPC signatures. But `pipeline.ts` line 169 only maps `protoDefinitions` to `events` (messages). It completely ignores `proto.services`. The fix is wiring, not a new library.

**Enhancements to existing regex (no new deps):**
- Add streaming detection: `rpc Method(stream Input) returns (stream Output)` — extend the existing `extractRpcs` regex to capture `stream` keyword
- Add proto `option` extraction for things like `option (google.api.http)` for REST gateway mappings
- Persist services to the existing `services` table and create `edges` from services to their request/response message types

**Confidence:** HIGH — verified by reading the existing source code. This is pure wiring work.

### Ecto Schema Extraction

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| *(none — enhance existing regex)* | — | Deeper Ecto schema field/association extraction | The existing `elixir.ts` already detects `schema "table_name"` and sets `type: 'schema'`. Deepening to extract fields and associations is a regex enhancement, not a new library. |

**Current state:** `elixir.ts` extracts module name, type, public functions, @moduledoc, and table name. It classifies modules with `schema` as type "schema".

**What's missing (all doable with regex, no AST parser needed):**
- **Field extraction:** `field :name, :type` patterns — straightforward regex: `/field\s+:(\w+),\s+:?(\w+(?:\.\w+)*)/g`
- **Association extraction:** `belongs_to :assoc, Module` / `has_many :assocs, Module` / `has_one :assoc, Module` / `many_to_many :assocs, Module` — regex: `/(?:belongs_to|has_many|has_one|many_to_many)\s+:(\w+),\s+([\w.]+)/g`
- **Embedded schemas:** `embeds_one`/`embeds_many` follow the same pattern
- **Timestamps detection:** presence of `timestamps()` macro

**Why not tree-sitter?** Tree-sitter-elixir exists but adds a native addon dependency, ~30MB download, and node-gyp build requirement. The Ecto schema DSL is deliberately simple and repetitive — regex handles it with HIGH reliability. The existing regex approach in `elixir.ts` is already proven against ~50 production repos.

**Confidence:** HIGH — Ecto schema syntax is macro-based with rigid patterns. Verified against official Ecto.Schema docs.

### Event Catalog Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| gray-matter | ^4.0.3 | Parse YAML frontmatter from EventCatalog `.mdx` files | Battle-tested frontmatter parser (used by Gatsby, Astro, VitePress, etc.). Handles YAML frontmatter delimited by `---`. Returns `{ data, content }` where `data` is the parsed YAML object. CJS package but works fine with ESM via esModuleInterop (already enabled in tsconfig). |

**Why gray-matter over raw js-yaml?** EventCatalog files are Markdown with YAML frontmatter, not pure YAML. gray-matter handles the delimiter extraction + YAML parsing in one step. Rolling our own `---` splitter + `js-yaml` call is trivially more code for no benefit, and gray-matter handles edge cases (JSON frontmatter, excerpts, custom delimiters).

**Why not `@eventcatalog/sdk`?** EventCatalog's SDK is designed for building catalog UIs, not for extracting data from catalog files. We need to read the raw files from disk, not interact with a running catalog instance.

**EventCatalog directory structure to parse:**
```
eventcatalog/
  domains/{DomainName}/index.mdx          # frontmatter: id, name, version, summary
  domains/{DomainName}/services/{Name}/index.mdx  # frontmatter: id, name, version, sends, receives
  events/{EventName}/index.mdx            # frontmatter: id, name, version, summary, owners
  commands/{CommandName}/index.mdx        # same pattern
  queries/{QueryName}/index.mdx           # same pattern
```

**Key frontmatter fields for extraction:**
- Services: `id`, `name`, `sends` (array of message refs), `receives` (array of message refs)
- Events: `id`, `name`, `version`, `summary`
- Domains: `id`, `name`, `summary`, containing services/events

**Integration point:** New `src/indexer/eventcatalog.ts`. Discover EventCatalog repo by checking for `eventcatalog.config.js` in scanned repos. Walk directory structure, parse `.mdx` files with gray-matter, map to existing entity types: domains as modules (type: "domain"), services to `services` table, events to `events` table, sends/receives to `edges` table.

**Confidence:** MEDIUM — EventCatalog directory conventions verified via official docs, but frontmatter field names may vary between EventCatalog v2 and v3. Needs validation against the actual catalog repo during implementation.

### Parallel Repo Indexing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| p-limit | ^7.3.0 | Concurrency limiter for parallel indexing | Pure ESM (compatible — project already uses `"type": "module"`). Tiny (2KB), zero dependencies, 4800+ dependents. Wraps async functions with a concurrency cap. Perfect for "run N repos in parallel" without worker_threads complexity. |

**Why p-limit over worker_threads?** The bottleneck in repo indexing is file I/O (scanning directories, reading files) and git operations (execSync calls), not CPU. Worker threads add complexity (separate DB connections required, message serialization overhead, can't share better-sqlite3 instances across threads) for minimal gain. p-limit with `Promise.all` and concurrency of 4-6 gives most of the speedup by overlapping I/O waits across repos.

**Why not `@supercharge/promise-pool`?** p-limit is smaller, more focused, and more widely adopted. promise-pool adds iterator semantics we don't need.

**Critical constraint: better-sqlite3 is NOT thread-safe.** A single better-sqlite3 `Database` instance cannot be shared across worker threads. Since all extractors call `persistRepoData` which writes to the DB, true parallelism would require:
- Each worker opens its own DB connection
- WAL mode enabled for concurrent reads/writes
- Coordination for transaction conflicts

This is significant complexity for ~50 repos. The simpler approach: parallelize the EXTRACTION phase (file scanning, git ops, regex parsing — all pure computation/I/O), then SERIALIZE the DB writes on the main thread. p-limit handles this perfectly.

**Implementation pattern:**
```typescript
import pLimit from 'p-limit';

const limit = pLimit(4); // 4 concurrent repos

const results = await Promise.all(
  repos.map(repo => limit(() => extractRepoData(repo)))  // parallel extraction
);

// Sequential DB writes (single-threaded, safe)
for (const data of results) {
  persistRepoData(db, data);
}
```

**Confidence:** HIGH — p-limit 7.3.0 verified as latest. ESM compatibility confirmed (project is ESM). Pattern is well-established.

### Branch-Aware Git Tracking

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| *(none — use existing `child_process.execSync`)* | — | Detect and track default branch | The existing `git.ts` already uses `execSync` for git operations. Branch detection is 2-3 additional git commands, not a library. |

**Git commands needed (no new deps):**
1. **Detect default branch:** `git rev-parse --abbrev-ref refs/remotes/origin/HEAD` returns `origin/main` or `origin/master`. Fallback: check if `main` or `master` branch exists.
2. **Get commit on default branch:** `git rev-parse origin/main` (or whatever the default branch is) — use this instead of `HEAD` for the indexed commit, so PR branch checkouts don't trigger reindexing.
3. **Get changed files on default branch:** `git diff --name-status <last-commit>..origin/main` instead of `..HEAD`.
4. **Check if working copy is on default branch:** `git rev-parse --abbrev-ref HEAD` — if it's not the default branch, still index from the default branch tip.

**Schema change needed:** Add `default_branch TEXT` column to `repos` table (migration V3). Cache the detected default branch to avoid repeated remote HEAD lookups.

**Why not simple-git?** simple-git wraps git commands in a Node.js API with promise support. But we're making 2-3 synchronous calls per repo. The existing `execSync` pattern is simpler, has zero dependencies, and the codebase already uses it consistently. Adding simple-git for branch detection would be inconsistent.

**Confidence:** HIGH — git commands verified against git documentation. Pattern is standard.

## No New Dependencies Needed For

| Feature | Why No New Dep |
|---------|----------------|
| gRPC service extraction | Existing `proto.ts` regex already parses services. Just need to wire output to DB. |
| Ecto schema fields/associations | Regex patterns on top of existing `elixir.ts`. Ecto DSL is rigid enough. |
| Branch-aware git tracking | 2-3 additional `execSync` calls in existing `git.ts`. |
| Surgical file-level reindexing | Existing `getChangedFiles()` + `clearRepoFiles()` already support this. Need to route changed files to appropriate extractors instead of re-running all extractors. |

## Complete New Dependencies

```bash
# New production dependencies for v1.1
npm install graphql gray-matter p-limit

# New dev dependencies: none needed
```

**Total new deps: 3 packages.** This is deliberately minimal. The codebase's regex-based extraction approach is working well for Elixir/proto and extending it to Ecto schemas is the right call. GraphQL is the one domain where a real parser is justified (complex nested syntax). gray-matter is the minimal correct tool for frontmatter. p-limit is the simplest concurrency primitive.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| GraphQL parsing | graphql (official) | Regex | GraphQL SDL is too complex for regex (nested types, directives, interfaces, unions). The official parser is 2.3MB and battle-tested. |
| GraphQL parsing | graphql (official) | @graphql-tools/load | Overkill — we're parsing SDL files from disk, not loading from URLs or merging schemas. `buildSchema()` from the core package is all we need. |
| Proto parsing | Existing regex | protobufjs | protobufjs (67MB!) is for serialization/deserialization, not just parsing definitions. Our regex handles the extraction use case fine. |
| Proto parsing | Existing regex | proto-parser | Tiny npm package for proto parsing, but the existing regex is already proven and handles our patterns. Adding a dep for marginal improvement isn't worth it. |
| Ecto parsing | Regex | tree-sitter-elixir | Adds native addon, node-gyp build, ~30MB. Ecto macros are simple enough for regex. |
| EventCatalog | gray-matter | js-yaml + manual splitting | gray-matter handles frontmatter delimiter edge cases. ~5 lines saved isn't worth potential bugs. |
| EventCatalog | gray-matter | @eventcatalog/sdk | SDK is for building catalog UIs, not reading catalog files from disk. |
| Parallelism | p-limit | worker_threads | better-sqlite3 isn't thread-safe. Parallelizing I/O with promises is sufficient for ~50 repos. Worker threads add DB connection management complexity. |
| Parallelism | p-limit | Promise.allSettled (no lib) | Works but no concurrency limit. Running 50 repos simultaneously would exhaust file descriptors and git subprocesses. Need bounded concurrency. |
| Git operations | execSync (existing) | simple-git | Adds dependency for 2-3 simple commands. Inconsistent with existing codebase patterns. |
| YAML parsing | gray-matter (includes js-yaml) | yaml (npm) | gray-matter already bundles YAML parsing and adds frontmatter awareness. Separate YAML lib is redundant. |

## What NOT to Add

| Avoid | Why |
|-------|-----|
| protobufjs | 67MB install for proto parsing we already handle with regex. Overkill. |
| tree-sitter / tree-sitter-elixir | Native addon requiring node-gyp. Ecto schema DSL is simple enough for regex. Adds build complexity for marginal gain. |
| simple-git | Wraps `child_process` git calls we already do directly. Adding abstraction for 2-3 new commands is pointless churn. |
| @graphql-tools/* | The guild's tool suite is for building GraphQL servers. We just need to parse SDL, which core `graphql` does fine. |
| worker_threads | better-sqlite3 can't be shared across threads. The parallelism we need (overlapping I/O across repos) is better served by async promises with p-limit. |
| glob / fast-glob | The existing `collectFiles()` recursive scanner works fine. No need to add a glob library for the same directory walking. |
| chalk | CLI output is JSON (`INTF-03`). Colored output doesn't apply. |

## Version Compatibility Matrix

| New Package | Node.js | ESM | TypeScript | Notes |
|-------------|---------|-----|------------|-------|
| graphql ^16.13.1 | 16+ | Yes (dual CJS/ESM) | Built-in types | Stable since 2022. v17 is alpha — do not use. |
| gray-matter ^4.0.3 | 12+ | CJS (works with esModuleInterop) | @types/gray-matter available but may be outdated; type assertions may be needed | Last published 2022 but rock-solid. No breaking changes expected. |
| p-limit ^7.3.0 | 18+ | Pure ESM only | Built-in types | Must use dynamic import or ESM. Project is ESM, so this works. |

## Integration Points with Existing Code

### Pipeline Changes (`pipeline.ts`)

Current flow: `discoverRepos() -> for each: checkSkip() -> indexSingleRepo()` (synchronous loop)

v1.1 flow:
1. `discoverRepos()` — unchanged
2. For each repo: `detectDefaultBranch()` — new, uses cached `default_branch` from DB
3. `checkSkip()` — modified to compare against default branch commit, not HEAD
4. **Parallel extraction phase:** `p-limit` wraps extraction (file scanning + parsing), returns `ExtractedData[]`
5. **Sequential persist phase:** iterate `ExtractedData[]`, call `persistRepoData()` for each

### New Extractors

| Extractor | Input | Output | Maps To |
|-----------|-------|--------|---------|
| `graphql.ts` | `.graphql`/`.gql` files | Types, queries, mutations, subscriptions | `ModuleData` (types), `EventData` (subscriptions) |
| `eventcatalog.ts` | `.mdx` files with frontmatter | Domains, services, events, commands | `ModuleData`, services table, `EventData`, `EdgeData` |
| Enhanced `elixir.ts` | Same `.ex` files | Additional field/association data | Enrich existing `ModuleData` summary |
| Enhanced `proto.ts` | Same `.proto` files | Streaming RPCs, service metadata | `services` table, `EdgeData` |

### Schema Migration (V3)

```sql
ALTER TABLE repos ADD COLUMN default_branch TEXT;
ALTER TABLE modules ADD COLUMN metadata TEXT; -- JSON blob for type-specific data (fields, associations, etc.)
```

The `metadata` column avoids schema explosion — GraphQL types have different data than Ecto schemas, but both can store structured info as JSON in one column.

## Sources

- graphql npm: [npm registry](https://www.npmjs.com/package/graphql) — v16.13.1 confirmed (HIGH confidence)
- graphql-js utilities: [graphql.org/graphql-js/utilities](https://graphql.org/graphql-js/utilities/) (HIGH confidence)
- p-limit: [npm registry](https://www.npmjs.com/package/p-limit) — v7.3.0 confirmed (HIGH confidence)
- p-limit GitHub: [sindresorhus/p-limit](https://github.com/sindresorhus/p-limit) (HIGH confidence)
- gray-matter: [npm registry](https://www.npmjs.com/package/gray-matter) (HIGH confidence)
- EventCatalog directory structure: [eventcatalog.dev/docs](https://www.eventcatalog.dev/docs/development/getting-started/project-structure) (MEDIUM confidence — verified v3 structure, may differ from actual instance)
- EventCatalog event API: [eventcatalog.dev/docs/api/event-api](https://www.eventcatalog.dev/docs/api/event-api) (MEDIUM confidence)
- EventCatalog service API: [eventcatalog.dev/docs/api/service-api](https://www.eventcatalog.dev/docs/api/service-api) (MEDIUM confidence)
- Ecto.Schema docs: [hexdocs.pm/ecto/Ecto.Schema](https://hexdocs.pm/ecto/Ecto.Schema.html) — field/association syntax verified (HIGH confidence)
- better-sqlite3 concurrency: [WiseLibs/better-sqlite3 performance.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) (HIGH confidence)
- git rev-parse docs: [git-scm.com](https://git-scm.com/docs/git-rev-parse) (HIGH confidence)

---
*Stack research for: repo-knowledge-base v1.1 improved reindexing and new extractors*
*Researched: 2026-03-06*
