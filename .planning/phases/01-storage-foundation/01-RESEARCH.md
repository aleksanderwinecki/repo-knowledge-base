# Phase 1: Storage Foundation - Research

**Researched:** 2026-03-05
**Domain:** SQLite schema design, FTS5 full-text search, graph-like relationship modeling
**Confidence:** HIGH

## Summary

Phase 1 builds the persistence layer: a SQLite database via better-sqlite3 with tables for repos, files, modules, events, services, and a generic edges table for graph-like relationships. FTS5 provides full-text search over names and descriptions.

The critical technical challenge is tokenization — FTS5's built-in unicode61 tokenizer does NOT split CamelCase or snake_case automatically. The recommended approach is application-layer text preprocessing: split CamelCase and snake_case strings into component words before inserting into the FTS5 index. This avoids the complexity of C-level custom tokenizers while achieving the desired search behavior.

**Primary recommendation:** Use better-sqlite3 with WAL mode, a generic edges table for relationships, FTS5 with unicode61 tokenizer + application-level text preprocessing for CamelCase/snake_case splitting, and vitest for testing.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- SQLite via better-sqlite3 (synchronous, fast, zero infrastructure)
- Single .db file, location configurable (default: ~/.repo-knowledge-base/knowledge.db)
- sqlite-vec extension deferred to v2
- Generic edges table: (source_type, source_id, target_type, target_id, relationship_type, source_file)
- Four relationship types for v1: produces_event, consumes_event, calls_grpc, exposes_graphql
- Minimal edge metadata: source, target, type, and the file path where relationship was found
- Service-level granularity (not module-level)
- FTS5 full-text search over: repo descriptions, module/file summaries, event/proto names
- Raw source code NOT indexed in FTS
- Custom tokenizer splits on word boundaries: CamelCase → [camel, case], snake_case → [snake, case]

### Claude's Discretion
- Exact column definitions and data types
- Index strategy beyond FTS5
- Migration/versioning approach for schema changes
- DB file directory creation and permission handling

### Deferred Ideas (OUT OF SCOPE)
- Vector/embedding search (sqlite-vec) — v2
- Module-level relationship tracking
- Graph visualization of service dependencies
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STOR-01 | SQLite database stores all indexed knowledge in a single file | better-sqlite3 creates/opens a single .db file; WAL mode for performance |
| STOR-02 | Schema supports repos, files, modules, events, services, and relationships | Core tables + generic edges table pattern researched |
| STOR-03 | FTS5 full-text search over indexed content | FTS5 virtual table with unicode61 tokenizer + app-level preprocessing |
| STOR-04 | Per-repo metadata tracks last indexed git commit for incremental updates | repos table with last_indexed_commit TEXT column |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.x | SQLite bindings for Node.js | Synchronous API, fastest Node SQLite lib, zero-config |
| @types/better-sqlite3 | ^7.x | TypeScript type definitions | Full type coverage for better-sqlite3 API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.x | Test framework | Unit + integration tests for schema, queries, FTS |
| typescript | ^5.x | Type safety | Project-wide type checking |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | node:sqlite (built-in) | Node 22.5+ has built-in SQLite but it's still experimental, async-only, less mature |
| vitest | jest | vitest has native ESM + TS support, faster, Vite ecosystem alignment |

**Installation:**
```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3 typescript vitest
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── db/
│   ├── database.ts        # Database class: open, close, pragma setup
│   ├── schema.ts          # Schema definitions (CREATE TABLE statements)
│   ├── migrations.ts      # Schema versioning via user_version pragma
│   └── tokenizer.ts       # FTS text preprocessing (CamelCase/snake_case splitting)
├── types/
│   └── entities.ts        # TypeScript interfaces for all entities
└── index.ts               # Public API exports
```

### Pattern 1: Database Singleton with WAL Mode
**What:** Single Database class that opens the SQLite file, enables WAL mode, foreign keys, and initializes schema.
**When to use:** Always — application entry point for all DB operations.
**Example:**
```typescript
// Source: better-sqlite3 official docs
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export function openDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL'); // Safe with WAL
  return db;
}
```

### Pattern 2: Schema Versioning via user_version PRAGMA
**What:** Use SQLite's built-in `user_version` pragma to track schema version. On startup, compare current version to expected, run migration steps sequentially.
**When to use:** Instead of a migration framework — lightweight, no external deps.
**Example:**
```typescript
const currentVersion = db.pragma('user_version', { simple: true }) as number;
if (currentVersion < SCHEMA_VERSION) {
  const migrate = db.transaction(() => {
    // Run migrations from currentVersion to SCHEMA_VERSION
    if (currentVersion < 1) { /* create initial tables */ }
    if (currentVersion < 2) { /* add columns */ }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  migrate();
}
```

### Pattern 3: FTS5 with Content Table Sync
**What:** FTS5 content table that mirrors data from regular tables. On insert/update/delete in source tables, sync to FTS.
**When to use:** When FTS indexes a subset of columns from multiple source tables.
**Example:**
```sql
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  name,
  description,
  entity_type,
  entity_id UNINDEXED,
  tokenize = 'unicode61'
);
```

### Pattern 4: Application-Layer Text Preprocessing for Tokenization
**What:** Before inserting text into FTS5, preprocess CamelCase and snake_case strings into space-separated words. This lets the standard unicode61 tokenizer work correctly.
**When to use:** Always when indexing names/identifiers.
**Why:** FTS5's built-in tokenizers do NOT split CamelCase. Custom C tokenizers require native extensions. Application-level preprocessing is simpler and sufficient.
**Example:**
```typescript
export function tokenizeForFts(text: string): string {
  return text
    // CamelCase → space-separated: BookingCreated → Booking Created
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // snake_case → space-separated: booking_service → booking service
    .replace(/_/g, ' ')
    // dot.separated → space-separated: BookingContext.Commands → BookingContext Commands
    .replace(/\./g, ' ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
// "BookingContext.Commands.CreateBooking" → "booking context commands create booking"
// "booking_service" → "booking service"
// "handle_event/2" → "handle event/2"  (/ preserved as separator by unicode61)
```

### Pattern 5: Generic Edges Table for Graph-Like Queries
**What:** A single edges table with polymorphic source/target types enables graph traversal via recursive CTEs.
**When to use:** For service dependency queries and relationship traversal.
**Example:**
```sql
-- Find all services 2 hops from 'payments-service'
WITH RECURSIVE reachable(entity_type, entity_id, depth) AS (
  SELECT 'service', id, 0 FROM services WHERE name = 'payments-service'
  UNION ALL
  SELECT e.target_type, e.target_id, r.depth + 1
  FROM edges e
  JOIN reachable r ON e.source_type = r.entity_type AND e.source_id = r.entity_id
  WHERE r.depth < 2
)
SELECT DISTINCT entity_type, entity_id, depth FROM reachable WHERE depth > 0;
```

### Anti-Patterns to Avoid
- **Separate relationship tables per type:** Don't create `service_events`, `service_grpc` etc. — the generic edges table handles all relationship types with one query pattern.
- **Storing raw source code in FTS:** Too noisy, too large. Index descriptions and names only.
- **Using FTS5 content= (contentless):** Contentless tables can't be updated/deleted easily. Use a regular content FTS table for maintainability.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CamelCase splitting | Regex-free parser | Simple regex chain | CamelCase splitting has well-known edge cases (HTTPSServer, XMLParser). A 4-line regex chain handles 99% of cases. |
| Schema migrations | Full migration framework | user_version pragma | For a local CLI tool, pragma-based versioning is sufficient. No need for knex/drizzle migrations. |
| FTS ranking | Custom BM25 implementation | FTS5 built-in rank function | FTS5 has BM25 ranking built in via `rank` column and `bm25()` function. |
| Directory creation | Manual path handling | fs.mkdirSync with recursive | Always use `{ recursive: true }` — handles nested paths and existing dirs. |

**Key insight:** This is a local developer tool, not a multi-tenant web app. Keep infrastructure decisions proportional to scope.

## Common Pitfalls

### Pitfall 1: Forgetting WAL Mode
**What goes wrong:** Concurrent reads block writes, performance drops 10-50x under load.
**Why it happens:** SQLite defaults to journal_mode=DELETE which uses file-level locking.
**How to avoid:** Set `db.pragma('journal_mode = WAL')` immediately after opening the database.
**Warning signs:** Slow queries, "database is locked" errors.

### Pitfall 2: Missing Foreign Keys Pragma
**What goes wrong:** Foreign key constraints silently ignored — orphaned records, broken referential integrity.
**Why it happens:** SQLite disables foreign key enforcement by default for backwards compatibility.
**How to avoid:** Set `db.pragma('foreign_keys = ON')` on every connection open.
**Warning signs:** Delete a parent record and child records remain.

### Pitfall 3: FTS5 Insert/Delete Desync
**What goes wrong:** FTS index contains stale data — deleted records still appear in search, updated records show old text.
**Why it happens:** FTS5 is a separate virtual table; changes to source tables don't automatically propagate.
**How to avoid:** Always update FTS in the same transaction as the source table change. Use helper functions that wrap insert/update/delete with FTS sync.
**Warning signs:** Search returns results for entities that no longer exist.

### Pitfall 4: Not Preprocessing Text Before FTS Insert
**What goes wrong:** Searching "booking" doesn't match "BookingCreated" because FTS5 tokenized it as a single token.
**Why it happens:** unicode61 tokenizer treats CamelCase words as single tokens.
**How to avoid:** Always run text through `tokenizeForFts()` before inserting into FTS table AND before querying.
**Warning signs:** Searches for common substrings return no results.

### Pitfall 5: INTEGER vs TEXT for IDs
**What goes wrong:** Using TEXT UUIDs for primary keys when INTEGER autoincrement is faster and more compact.
**Why it happens:** Habit from web frameworks that default to UUIDs.
**How to avoid:** Use INTEGER PRIMARY KEY AUTOINCREMENT for local-only tool. UUIDs add no value when there's a single writer.
**Warning signs:** Unnecessarily large database files, slower joins.

## Code Examples

### Complete Schema Creation
```sql
-- Core entity tables
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  description TEXT,
  last_indexed_commit TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo_id, path)
);

CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT,  -- e.g., 'elixir_module', 'proto_service', 'graphql_type'
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo_id, name)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schema_definition TEXT,
  source_file TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generic relationship table (graph-like)
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,  -- 'service', 'module', 'file'
  source_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,  -- 'produces_event', 'consumes_event', 'calls_grpc', 'exposes_graphql'
  source_file TEXT,  -- file where relationship was discovered
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_edges_relationship ON edges(relationship_type);

-- FTS5 full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  name,
  description,
  entity_type,
  entity_id UNINDEXED,
  tokenize = 'unicode61'
);
```

### Transaction-Wrapped Batch Insert
```typescript
// Source: better-sqlite3 official docs
const insertRepo = db.prepare(`
  INSERT INTO repos (name, path, description, last_indexed_commit)
  VALUES (@name, @path, @description, @lastIndexedCommit)
`);

const insertRepos = db.transaction((repos: RepoInput[]) => {
  for (const repo of repos) {
    insertRepo.run(repo);
  }
});
```

### FTS5 Search Query
```typescript
const searchStmt = db.prepare(`
  SELECT entity_type, entity_id, name, description,
         rank as relevance
  FROM knowledge_fts
  WHERE knowledge_fts MATCH @query
  ORDER BY rank
  LIMIT @limit
`);

function search(query: string, limit = 20) {
  const processedQuery = tokenizeForFts(query);
  return searchStmt.all({ query: processedQuery, limit });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-sqlite3 (async) | better-sqlite3 (sync) | 2020+ | 2-5x faster for typical workloads, simpler API |
| FTS3/FTS4 | FTS5 | SQLite 3.9+ (2015) | Better ranking, prefix queries, custom tokenizers |
| Journal mode DELETE | WAL mode | Standard practice since ~2018 | Massive concurrency improvement |
| UUID primary keys | INTEGER autoincrement | Best practice for local-only | Smaller files, faster joins |

**Deprecated/outdated:**
- FTS3/FTS4: Still works but FTS5 is strictly better for new projects
- node-sqlite3: Async API is slower and more complex for single-process tools

## Open Questions

1. **FTS5 tokenizer for query-time preprocessing**
   - What we know: Application-level preprocessing works for both indexing and querying
   - What's unclear: Whether we need prefix query support (e.g., `book*` matching `BookingCreated`)
   - Recommendation: Support prefix queries — FTS5 handles `book*` natively after preprocessing

2. **Schema versioning edge cases**
   - What we know: `user_version` pragma is sufficient for linear migrations
   - What's unclear: How to handle downgrade scenarios (user rolls back)
   - Recommendation: Don't support downgrades. If schema is ahead of code, error and suggest updating the tool.

## Sources

### Primary (HIGH confidence)
- Context7 /wiselibs/better-sqlite3 - Database setup, PRAGMA, transactions, prepared statements
- https://sqlite.org/fts5.html - FTS5 tokenizer configuration, tokenchars/separators options
- https://sqlite.org/lang_with.html - Recursive CTEs for graph traversal

### Secondary (MEDIUM confidence)
- https://github.com/WiseLibs/better-sqlite3 - Project setup, TypeScript integration
- https://audrey.feldroy.com/articles/2025-01-13-SQLite-FTS5-Tokenizers-unicode61-and-ascii - unicode61 tokenizer behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - better-sqlite3 is well-established, Context7 verified
- Architecture: HIGH - patterns are standard SQLite best practices
- Pitfalls: HIGH - well-documented in official sources

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable domain, 30 days)
