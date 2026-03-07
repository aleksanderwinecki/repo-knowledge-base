# Phase 12: Database Performance - Research

**Researched:** 2026-03-07
**Domain:** SQLite performance tuning, prepared statement optimization, FTS5 configuration, Node.js perf_hooks instrumentation
**Confidence:** HIGH

## Summary

This phase is a pure performance pass over existing code with no new features. The codebase uses `better-sqlite3` v12 with SQLite FTS5 for full-text search. All seven requirements are well-understood, low-risk optimizations: pragma tuning at connection open, prepared statement hoisting out of hot loops, adding B-tree indexes via a V5 migration, FTS5 optimize + WAL checkpoint after bulk indexing, FTS5 prefix index rebuild, and perf_hooks instrumentation.

The key constraint is that prepared statements in better-sqlite3 are tied to a specific `Database` instance -- they cannot be module-level singletons unless the module always receives the same db. The existing pattern in `persistRepoData()` already demonstrates the correct approach: prepare once at the top of a function/transaction scope, reuse in loops. The fix is extending this pattern to `clearRepoEntities()`, `clearRepoFiles()`, `clearRepoEdges()`, the entity.ts lookup functions, and the `findLinkedRepos()` BFS loop in dependencies.ts.

**Primary recommendation:** Implement in two waves -- Wave 1 handles all DB-layer changes (pragmas, migration, FTS rebuild, statement hoisting) and Wave 2 adds perf_hooks instrumentation to measure the impact.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- user delegated all implementation decisions to Claude.

### Claude's Discretion
- Benchmark reporting (PERF-07): Use perf_hooks.performance.mark()/measure(), report via stderr, instrument key operations, consider --timing flag
- FTS5 prefix configuration (PERF-06): DROP+CREATE FTS5 table in V5 migration with prefix='2,3'
- Pragma tuning values (PERF-01): cache_size=-64000, temp_store=MEMORY, mmap_size=268435456
- Statement hoisting scope (PERF-02): Strict to 5 named files (fts.ts, writer.ts, entity.ts, dependencies.ts, status.ts)
- Database indexes (PERF-03): V5 migration adds indexes on modules(name), events(name), services(name), modules(repo_id, file_id), events(repo_id, file_id)
- FTS5 optimize + WAL checkpoint (PERF-04, PERF-05): After bulk indexing in pipeline orchestrator

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-01 | SQLite pragma tuning (cache_size, temp_store, mmap_size) applied at connection open | Pragma values verified against SQLite docs; openDatabase() is the single insertion point (line 17-20) |
| PERF-02 | Prepared statements hoisted out of hot loops in 5 files | Full audit of all 5 files complete; 60 db.prepare() calls identified with specific hoisting targets |
| PERF-03 | Missing database indexes added via V5 migration | Index targets identified from entity.ts exact-name queries and writer.ts file-cleanup joins |
| PERF-04 | FTS5 optimize command runs after bulk indexing | Optimize syntax verified; pipeline.ts Phase 3 completion is insertion point |
| PERF-05 | WAL checkpoint after index completes | db.pragma('wal_checkpoint(TRUNCATE)') verified; same insertion point as PERF-04 |
| PERF-06 | FTS5 prefix index configuration (prefix='2,3') | Requires DROP+CREATE of FTS5 virtual table; V5 migration handles this safely |
| PERF-07 | perf_hooks instrumentation for indexing and search benchmarking | Node.js performance.mark()/measure() API verified; stderr output preserves JSON contract |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | SQLite driver | Already in use; synchronous API, prepared statement caching |
| perf_hooks (Node.js built-in) | Node 22+ | Performance instrumentation | Built-in, zero dependencies, W3C Performance API compatible |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.0.0 | Test runner | Already in use for 197 tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| perf_hooks | console.time/timeEnd | perf_hooks gives structured data; console.time is simpler but harder to aggregate |
| Manual --timing flag | Always-on timing | Flag approach keeps normal output clean; always-on adds noise |

**Installation:** No new packages needed. All tools are already available.

## Architecture Patterns

### Recommended Project Structure
No new files needed. Changes target existing files:
```
src/
  db/
    database.ts       # PERF-01: Add pragma tuning
    fts.ts            # PERF-02: Hoist statements; PERF-06: Add prefix config
    migrations.ts     # PERF-03, PERF-06: V5 migration
    schema.ts         # Bump SCHEMA_VERSION to 5
  indexer/
    writer.ts         # PERF-02: Hoist statements in clearRepoEntities/clearRepoFiles/clearRepoEdges
    pipeline.ts       # PERF-04, PERF-05: FTS optimize + WAL checkpoint; PERF-07: Timing
  search/
    entity.ts         # PERF-02: Hoist statements
    dependencies.ts   # PERF-02: Hoist statements
    text.ts           # PERF-02: Minor hoisting opportunity (hydrate functions)
  cli/
    commands/search.ts    # PERF-07: --timing flag
    commands/index-cmd.ts # PERF-07: --timing flag
    commands/deps.ts      # PERF-07: --timing flag
```

### Pattern 1: Pragma Tuning at Connection Open
**What:** Add performance pragmas immediately after opening the database, alongside existing WAL/FK/synchronous pragmas.
**When to use:** Every database connection.
**Example:**
```typescript
// In openDatabase(), after existing pragmas:
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
// NEW: Performance tuning
db.pragma('cache_size = -64000');     // ~64MB page cache
db.pragma('temp_store = MEMORY');      // Temp tables in RAM
db.pragma('mmap_size = 268435456');    // 256MB memory-mapped I/O
```
Source: [SQLite pragma documentation](https://sqlite.org/pragma.html), [SQLite performance tuning guide](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)

### Pattern 2: Prepared Statement Hoisting (Function-Scope)
**What:** Move `db.prepare()` calls outside of loops to the enclosing function/transaction scope, reusing the statement object with different parameters.
**When to use:** Any function that calls `db.prepare()` inside a loop.
**Example:**
```typescript
// BEFORE (hot loop in clearRepoEntities):
for (const mod of modules) {
  removeEntity(db, 'module', mod.id);  // calls db.prepare() internally
}

// AFTER (hoist to function scope):
export function clearRepoEntities(db: Database.Database, repoId: number): void {
  const deleteFromFts = db.prepare(
    'DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?'
  );
  const selectModules = db.prepare('SELECT id FROM modules WHERE repo_id = ?');
  const selectEvents = db.prepare('SELECT id FROM events WHERE repo_id = ?');
  const selectServices = db.prepare('SELECT id FROM services WHERE repo_id = ?');
  // ... use hoisted statements in loops
}
```
**Key insight:** Statements in better-sqlite3 are bound to the `Database` instance. Since these functions all receive `db` as a parameter, prepare once at the top of each function.

### Pattern 3: V5 Migration (Additive Indexes + FTS Rebuild)
**What:** Add B-tree indexes on name columns and rebuild FTS5 with prefix configuration.
**When to use:** Automatic on first connection after code upgrade.
**Example:**
```typescript
function migrateToV5(db: Database.Database): void {
  // Additive indexes (safe, idempotent)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_modules_name ON modules(name);
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
    CREATE INDEX IF NOT EXISTS idx_services_name ON services(name);
    CREATE INDEX IF NOT EXISTS idx_modules_repo_file ON modules(repo_id, file_id);
    CREATE INDEX IF NOT EXISTS idx_events_repo_file ON events(repo_id, file_id);
  `);

  // FTS5 prefix rebuild (virtual tables can't be ALTERed)
  // Save existing data, drop, recreate with prefix, repopulate
  const rows = db.prepare(
    'SELECT name, description, entity_type, entity_id FROM knowledge_fts'
  ).all();
  db.exec('DROP TABLE IF EXISTS knowledge_fts');
  db.exec(`
    CREATE VIRTUAL TABLE knowledge_fts USING fts5(
      name,
      description,
      entity_type UNINDEXED,
      entity_id UNINDEXED,
      tokenize = 'unicode61',
      prefix = '2,3'
    );
  `);
  const insert = db.prepare(
    'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)'
  );
  for (const row of rows) {
    insert.run(row.name, row.description, row.entity_type, row.entity_id);
  }
}
```

### Pattern 4: Post-Index Optimization
**What:** Run FTS5 optimize and WAL checkpoint after bulk indexing completes.
**When to use:** At the end of `indexAllRepos()` in pipeline.ts, after all repos are persisted.
**Example:**
```typescript
// After Phase 3 (serial persistence) and before returning results:
if (success > 0) {
  db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')");
  db.pragma('wal_checkpoint(TRUNCATE)');
}
```

### Pattern 5: perf_hooks Instrumentation
**What:** Wrap key operations with `performance.mark()` / `performance.measure()` and report via stderr.
**When to use:** Index, search, deps commands when `--timing` flag is present.
**Example:**
```typescript
import { performance } from 'node:perf_hooks';

function withTiming<T>(name: string, fn: () => T): T {
  const start = `${name}:start`;
  const end = `${name}:end`;
  performance.mark(start);
  const result = fn();
  performance.mark(end);
  performance.measure(name, start, end);
  return result;
}

// Usage:
const results = withTiming('fts-search', () => search(db, query, limit));

// Report (to stderr so JSON stdout is clean):
function reportTimings(): void {
  const entries = performance.getEntriesByType('measure');
  for (const entry of entries) {
    process.stderr.write(`[timing] ${entry.name}: ${entry.duration.toFixed(1)}ms\n`);
  }
  performance.clearMeasures();
  performance.clearMarks();
}
```

### Anti-Patterns to Avoid
- **Module-level prepared statements without db reference:** Statements are tied to a Database instance. You cannot prepare a statement at module load time because the db doesn't exist yet. Always prepare within a function that has access to `db`.
- **Preparing inside inner loops:** The existing `removeEntity()` function calls `db.prepare()` every invocation. When called in a loop from `clearRepoEntities()`, this creates N prepared statements. Either inline the SQL or pass a pre-prepared statement.
- **FTS5 ALTER TABLE:** FTS5 virtual tables do not support ALTER TABLE. The only way to change tokenizer/prefix configuration is DROP + CREATE + repopulate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Performance timing | Custom Date.now() wrappers | `perf_hooks` performance.mark()/measure() | Built-in, high-resolution, structured API |
| Statement caching | LRU cache of prepared statements | better-sqlite3's built-in statement management | The library handles finalization; just hold references |
| FTS5 optimization | Manual segment merging | `INSERT INTO table(table) VALUES('optimize')` | SQLite's built-in optimize command is correct |
| WAL cleanup | Manual file manipulation | `PRAGMA wal_checkpoint(TRUNCATE)` | SQLite's built-in checkpoint is safe and atomic |

## Common Pitfalls

### Pitfall 1: FTS5 Table Recreation Order in Migration
**What goes wrong:** Dropping knowledge_fts before saving data loses all FTS content permanently.
**Why it happens:** FTS5 tables are virtual -- data is stored in shadow tables that are also dropped.
**How to avoid:** Always SELECT all rows INTO a temp collection BEFORE dropping, then INSERT after CREATE.
**Warning signs:** Empty search results after migration.

### Pitfall 2: Statement Hoisting Breaking removeEntity/indexEntity Reusability
**What goes wrong:** `removeEntity()` and `indexEntity()` are called from multiple callsites (writer.ts, pipeline.ts, store.ts). If you change their signature to accept pre-prepared statements, you break all callers.
**Why it happens:** Over-eager optimization that changes public interfaces.
**How to avoid:** Two approaches: (a) keep removeEntity/indexEntity unchanged for external callers, create private `_removeEntityBatch()` variants that accept statements, used internally; or (b) inline the SQL in the hot loops of writer.ts/clearRepoEntities directly, since the FTS delete/insert is just 2 SQL statements.
**Warning signs:** TypeScript compilation errors across multiple files.

### Pitfall 3: Pragma Order Matters
**What goes wrong:** Some pragmas must be set before others take effect, or must be set outside transactions.
**Why it happens:** SQLite pragma scoping rules.
**How to avoid:** Set pragmas immediately after opening the connection, before any schema operations. The existing code already does this correctly -- just add new pragmas in the same block (lines 17-20 of database.ts).
**Warning signs:** `PRAGMA cache_size` returning default value after set.

### Pitfall 4: mmap_size on macOS
**What goes wrong:** Very large mmap_size values can cause issues on systems with limited address space.
**Why it happens:** 256MB is conservative and fine for this local-only CLI tool, but worth noting.
**How to avoid:** The chosen value of 268435456 (256MB) is well within safe limits for modern macOS.
**Warning signs:** Memory warnings or SQLITE_IOERR.

### Pitfall 5: Timing Instrumentation Affecting Test Output
**What goes wrong:** Tests that assert on stdout/stderr content break when timing output is unconditionally added.
**Why it happens:** Phase 11 snapshot tests lock CLI output shape.
**How to avoid:** Timing output MUST be opt-in via `--timing` flag. Default behavior produces identical output to pre-change code.
**Warning signs:** Phase 11 snapshot tests failing after PERF-07 implementation.

### Pitfall 6: FTS5 Prefix Syntax
**What goes wrong:** Using space-separated prefix values like `prefix='2 3'` instead of comma-separated `prefix='2,3'`.
**Why it happens:** SQLite documentation shows both formats in different sections.
**How to avoid:** Use comma-separated format: `prefix='2,3'`. This is the canonical form.
**Warning signs:** "malformed prefix" error during migration.

## Code Examples

### Exact Hot-Loop Inventory (PERF-02)

**fts.ts** (5 db.prepare calls):
- `indexEntity()` lines 61, 67: DELETE + INSERT inside transaction, called per-entity from writer loops
- `removeEntity()` line 83: DELETE, called per-entity from clearRepoEntities loops
- `search()` line 156: prepare per-call (moderate -- not in tight loop, but could be hoisted if search is called repeatedly)
- `listAvailableTypes()` line 121: prepare per-call (low frequency, skip)

**writer.ts** (26 db.prepare calls):
- Already hoisted in persistRepoData: insertFile, insertModule, insertEvent, insertEventFile, insertService, insertEdge (lines 195-289) -- GOOD
- `clearRepoEntities()` lines 87, 95, 103: 3 SELECT queries, each followed by removeEntity loop -- HOIST
- `clearRepoEntities()` lines 113, 118, 119, 120, 121: 5 DELETE statements -- HOIST
- `clearRepoFiles()` lines 136, 140, 145, 148, 153, 157, 162, 165: 8 prepare calls inside filePath loop -- HOIST
- `clearRepoEdges()` lines 317, 321, 326, 330, 331: 5 prepare calls with loop -- HOIST
- `upsertRepo()` lines 53, 73: 2 prepare calls per-call (moderate frequency)
- Already hoisted in persistSurgicalData: insertFile, insertModule, insertEvent, insertService (lines 359-427) -- GOOD

**entity.ts** (11 db.prepare calls):
- `getEntitiesByExactName()` lines 206, 220, 233, 248: 4 dynamic SQL queries per type -- these are branched by switch, not looped
- `getEntityById()` lines 267, 275, 287, 298: 4 queries per type -- called in FTS result hydration loop
- `getRelationships()` lines 326, 349: 2 edge queries -- called per-entity in result building
- `resolveEntityName()` line 383: dynamic table name query -- called per-edge in getRelationships

**dependencies.ts** (8 db.prepare calls):
- `findLinkedRepos()` lines 114, 120, 124, 129, 145, 150, 155, 160: ALL inside BFS traversal loop -- HOIST

**status.ts (CLI)**: Uses inline `count()` helper with template literal table name -- not in a hot loop, skip.
**status.ts (MCP)**: 8 db.prepare calls but each called once -- not hot loops, skip.

### V5 Migration Schema
```sql
-- Additive B-tree indexes
CREATE INDEX IF NOT EXISTS idx_modules_name ON modules(name);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
CREATE INDEX IF NOT EXISTS idx_services_name ON services(name);
CREATE INDEX IF NOT EXISTS idx_modules_repo_file ON modules(repo_id, file_id);
CREATE INDEX IF NOT EXISTS idx_events_repo_file ON events(repo_id, file_id);

-- FTS5 rebuild with prefix (after saving + dropping old table)
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  name,
  description,
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  tokenize = 'unicode61',
  prefix = '2,3'
);
```

### initializeFts Update
After V5 migration, `initializeFts()` in fts.ts must also include `prefix = '2,3'` in its CREATE statement so fresh databases get the prefix config:
```typescript
export function initializeFts(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      name,
      description,
      entity_type UNINDEXED,
      entity_id UNINDEXED,
      tokenize = 'unicode61',
      prefix = '2,3'
    );
  `);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No pragma tuning | cache_size + temp_store + mmap_size | Standard practice | 10-40% speedup on read-heavy workloads |
| Prepare-per-call | Hoist + reuse statements | SQLite best practice since inception | Avoids repeated SQL parsing overhead |
| No FTS5 prefix | prefix='2,3' | FTS5 feature since SQLite 3.9.0 | Faster prefix queries (e.g., "user*" searches) |
| No post-index optimize | FTS5 optimize + WAL checkpoint | FTS5 built-in feature | Compacts FTS index, reclaims WAL disk space |

## Open Questions

1. **Async timing for pipeline.ts indexAllRepos**
   - What we know: `indexAllRepos` is async (uses p-limit for parallel extraction). `performance.mark()`/`measure()` works fine with async code -- marks are just timestamps.
   - What's unclear: Whether to time individual repo extraction (parallel phase) or just the overall pipeline.
   - Recommendation: Time the three pipeline phases (prep, extraction, persistence) separately, plus overall wall-clock. Per-repo timing would be noisy with parallel execution.

2. **FTS prefix value choice: '2,3' vs '2,3,4'**
   - What we know: prefix='2,3' adds indexes for 2-char and 3-char prefixes. Module names like "User*" benefit from prefix=4 too.
   - What's unclear: Whether the index size increase from adding prefix=4 is worth it for this dataset size.
   - Recommendation: Stick with '2,3' as decided in CONTEXT.md. Can always re-evaluate later.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERF-01 | Pragmas set after openDatabase | unit | `npx vitest run tests/db/database.test.ts -t "pragma" -x` | Extend existing |
| PERF-02 | No db.prepare() in hot loops | unit | `npx vitest run tests/indexer/writer.test.ts -x && npx vitest run tests/search/entity.test.ts -x` | Existing tests validate behavior |
| PERF-03 | V5 migration adds indexes | unit | `npx vitest run tests/db/schema.test.ts -t "v5" -x` | Extend existing |
| PERF-04 | FTS optimize after bulk index | integration | `npx vitest run tests/indexer/pipeline.test.ts -x` | Extend existing |
| PERF-05 | WAL checkpoint after index | integration | `npx vitest run tests/indexer/pipeline.test.ts -x` | Extend existing |
| PERF-06 | FTS5 has prefix config | unit | `npx vitest run tests/db/schema.test.ts -t "prefix" -x` | Extend existing |
| PERF-07 | Timing output on --timing flag | unit | `npx vitest run tests/cli/snapshots.test.ts -x` | Extend existing |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/db/database.test.ts tests/db/schema.test.ts tests/indexer/writer.test.ts tests/search/entity.test.ts tests/search/dependencies.test.ts -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/db/database.test.ts` -- add pragma verification tests (cache_size, temp_store, mmap_size)
- [ ] `tests/db/schema.test.ts` -- add V5 migration tests (indexes exist, FTS prefix config, data preserved)
- [ ] Existing Phase 11 safety net tests (contracts, golden, snapshots) serve as regression guards -- no new gaps

## Sources

### Primary (HIGH confidence)
- [SQLite pragma documentation](https://sqlite.org/pragma.html) -- cache_size, temp_store, mmap_size syntax and semantics
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html) -- prefix option syntax, optimize command, tokenize config
- [Node.js perf_hooks API](https://nodejs.org/api/perf_hooks.html) -- performance.mark(), measure(), getEntriesByType()
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) -- db.prepare(), statement lifecycle, db.pragma()

### Secondary (MEDIUM confidence)
- [SQLite performance tuning guide](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) -- pragma value recommendations verified against official docs
- [SQLite recommended PRAGMAs](https://highperformancesqlite.com/articles/sqlite-recommended-pragmas) -- production pragma recommendations

### Tertiary (LOW confidence)
None -- all findings verified with official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- already using better-sqlite3, perf_hooks is Node.js built-in
- Architecture: HIGH -- all changes are to existing files with established patterns; full source code audit completed
- Pitfalls: HIGH -- FTS5 prefix syntax, statement lifecycle, migration ordering all verified against official docs
- Statement hoisting inventory: HIGH -- all 60 db.prepare() calls across 5 target files audited line-by-line

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable domain, SQLite/Node APIs rarely change)
