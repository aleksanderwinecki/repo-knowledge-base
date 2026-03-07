# Technology Stack: v1.2 Hardening & Optimization

**Project:** repo-knowledge-base
**Researched:** 2026-03-07
**Focus:** Stack-level optimizations for the existing Node.js/TypeScript/SQLite/FTS5 stack. No new dependencies recommended.

---

## 1. SQLite Pragma Tuning

### Current State

```typescript
// database.ts — existing pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
```

This is already a solid baseline. WAL + synchronous=NORMAL is the correct choice for a single-writer local tool.

### Recommended Additions

| Pragma | Value | Why | Impact | Confidence |
|--------|-------|-----|--------|------------|
| `cache_size` | `-32000` (32 MB) | Default is -2000 (2 MB). With ~50 repos of indexed data, a larger page cache keeps more of the DB in memory, reducing disk reads during search hydration and dependency traversal | **MEDIUM** — search queries that JOIN across repos/modules/events will hit cache more often | HIGH |
| `temp_store` | `memory` | Temp tables and sort spills go to RAM instead of disk. Relevant during large indexing transactions that create intermediate results | **LOW-MEDIUM** — only matters during indexing, not search | HIGH |
| `mmap_size` | `268435456` (256 MB) | Memory-maps the DB file, letting the OS manage page caching via virtual memory instead of syscalls. For a DB that's likely 5-50 MB, this maps the entire file | **MEDIUM** — reduces syscall overhead on reads. Most impactful for repeated search queries | HIGH |
| `optimize` | Run on close | `PRAGMA optimize` analyzes which tables would benefit from updated statistics, then runs ANALYZE selectively. Since SQLite 3.46.0, this is fast even on large DBs | **LOW-MEDIUM** — helps query planner pick optimal paths for JOINs in entity.ts and dependencies.ts | HIGH |

### Pragmas to NOT Add

| Pragma | Why Not |
|--------|---------|
| `synchronous = OFF` | Risks corruption on power loss. NORMAL is already safe + fast in WAL mode |
| `locking_mode = EXCLUSIVE` | Would prevent concurrent reads (e.g., MCP server + CLI simultaneously) |
| `journal_mode = MEMORY` | WAL is strictly better for this workload |

### Implementation

```typescript
// database.ts — updated openDatabase()
export function openDatabase(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // NEW: Memory and cache tuning
  db.pragma('cache_size = -32000');    // 32 MB page cache
  db.pragma('temp_store = memory');     // Temp tables in RAM
  db.pragma('mmap_size = 268435456');   // 256 MB mmap

  initializeSchema(db);
  return db;
}

// UPDATED: Run PRAGMA optimize before closing
export function closeDatabase(db: Database.Database): void {
  if (db.open) {
    db.pragma('optimize');
    db.close();
  }
}
```

**Confidence:** HIGH. These are well-established SQLite best practices from official docs and multiple production guides.

**Sources:**
- [SQLite PRAGMA official docs](https://sqlite.org/pragma.html)
- [SQLite Performance Tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [SQLite Pragma Cheatsheet (cj.rs)](https://cj.rs/blog/sqlite-pragma-cheatsheet-for-performance-and-consistency/)
- [Forward Email SQLite Optimization Guide](https://forwardemail.net/en/blog/docs/sqlite-performance-optimization-pragma-chacha20-production-guide)

---

## 2. Prepared Statement Reuse

### Current Problem

better-sqlite3 does **not** cache prepared statements internally. Every `db.prepare()` call compiles the SQL string into a new statement object. The codebase has **72 `db.prepare()` calls across 11 files**, many inside functions that run per-entity or per-result.

Worst offenders (called in tight loops):

| File | Function | Calls Per Invocation | Issue |
|------|----------|---------------------|-------|
| `fts.ts` | `indexEntity()` | 2x per entity (DELETE + INSERT) | Called for every module, event, service during indexing. With ~2000 entities across 50 repos, that's ~4000 unnecessary prepare() calls |
| `fts.ts` | `removeEntity()` | 1x per entity | Called during clearRepoEntities loops |
| `writer.ts` | `clearRepoFiles()` | 5-6x per file path | Nested loop: per-file, then per-entity-type |
| `search/entity.ts` | `getRelationships()` | 2x per entity card | Called for every search result — outgoing + incoming edge queries |
| `search/dependencies.ts` | `findLinkedRepos()` | 3-4x per BFS hop | Nested: per-edge, then per-event, then per-repo |
| `mcp/tools/status.ts` | handler | 8x per invocation | 7 COUNT queries + 1 repo list, all separately prepared every call |

### Recommended Fix: Hoist Statements Out of Hot Loops

**Pattern A: Factory function (for write paths with multiple cooperating statements)**

```typescript
// fts.ts — BEFORE: prepares 2 statements per entity call
export function indexEntity(db, entity) {
  const upsert = db.transaction(() => {
    db.prepare('DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?')
      .run(`${entity.type}:%`, entity.id);
    db.prepare('INSERT INTO knowledge_fts ...')
      .run(processedName, processedDescription, compositeType, entity.id);
  });
  upsert();
}

// fts.ts — AFTER: create once, call many times
export function createFtsWriter(db: Database.Database) {
  const deleteStmt = db.prepare(
    'DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?'
  );
  const insertStmt = db.prepare(
    'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)'
  );
  const upsertTxn = db.transaction(
    (type: string, id: number, name: string, desc: string | null, compositeType: string) => {
      deleteStmt.run(`${type}:%`, id);
      insertStmt.run(name, desc, compositeType, id);
    }
  );

  return {
    indexEntity(entity: { type: string; id: number; name: string;
                          description?: string | null; subType?: string }) {
      const processedName = tokenizeForFts(entity.name);
      const processedDesc = entity.description ? tokenizeForFts(entity.description) : null;
      const compositeType = entity.subType
        ? `${entity.type}:${entity.subType}`
        : `${entity.type}:${entity.type}`;
      upsertTxn(entity.type, entity.id, processedName, processedDesc, compositeType);
    },
    removeEntity(entityType: string, entityId: number) {
      deleteStmt.run(`${entityType}:%`, entityId);
    },
  };
}
```

**Pattern B: Pre-compile at registration (for MCP tools called repeatedly)**

```typescript
// mcp/tools/status.ts — prepare statements ONCE at registration
export function registerStatusTool(server: McpServer, db: Database.Database): void {
  const countRepos = db.prepare('SELECT COUNT(*) as c FROM repos');
  const countModules = db.prepare('SELECT COUNT(*) as c FROM modules');
  const countEvents = db.prepare('SELECT COUNT(*) as c FROM events');
  const countServices = db.prepare('SELECT COUNT(*) as c FROM services');
  const countEdges = db.prepare('SELECT COUNT(*) as c FROM edges');
  const countFiles = db.prepare('SELECT COUNT(*) as c FROM files');
  const countFacts = db.prepare('SELECT COUNT(*) as c FROM learned_facts');
  const listRepos = db.prepare(
    'SELECT name, path, last_indexed_commit FROM repos LIMIT ?'
  );

  server.tool('kb_status', '...', {}, async () => {
    const counts = {
      repos: (countRepos.get() as { c: number }).c,
      modules: (countModules.get() as { c: number }).c,
      // ... reuse pre-compiled statements
    };
    // ...
  });
}
```

**Pattern C: Hoist within function scope (for search paths called per-query)**

```typescript
// search/dependencies.ts — prepare statements once per queryDependencies() call
export function queryDependencies(db, entityName, options) {
  // Prepare all statements used in the BFS loop ONCE
  const findConsumedEdges = db.prepare(
    "SELECT target_id FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'consumes_event'"
  );
  const findEventName = db.prepare('SELECT name FROM events WHERE id = ?');
  const findProducerEdges = db.prepare(
    "SELECT source_id FROM edges WHERE target_type = 'event' AND target_id = ? AND relationship_type = 'produces_event'"
  );
  const findRepoById = db.prepare('SELECT id, name FROM repos WHERE id = ?');

  // BFS loop now reuses these statements instead of preparing each iteration
  // ...
}
```

### Impact Estimate

| Scenario | Before (prepare calls) | After | Reduction |
|----------|----------------------|-------|-----------|
| Full index of 50 repos (~2000 entities) | ~4000 for FTS alone | ~2 total | ~2000x fewer |
| Single search query (20 results) | ~60 | ~5 | ~12x fewer |
| kb_status MCP call | 8 | 0 (pre-compiled) | Eliminated |
| Dependency query (3 hops, 10 edges) | ~40 | ~4 | ~10x fewer |

Wall-clock improvement during indexing: estimated **10-30%** on write paths. For search queries: **a few ms saved per query** (less dramatic since queries are already fast).

**Confidence:** HIGH. This is the single most impactful code-level optimization available. The pattern is well-documented and fundamental to SQLite performance.

**Sources:**
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [SQLite prepared statements performance](https://visualstudiomagazine.com/articles/2014/03/01/sqlite-performance-and-prepared-statements.aspx)

---

## 3. FTS5 Tuning

### Current FTS5 Configuration

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  name,
  description,
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  tokenize = 'unicode61'
);
```

The `entity_type UNINDEXED` decision is already smart.

### 3a. Add Prefix Index

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  name,
  description,
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  tokenize = 'unicode61',
  prefix = '2,3'
);
```

**Why:** Without prefix indexes, FTS5 prefix queries (e.g., `book*`) require a merge of all terms starting with "book". With `prefix='2,3'`, two- and three-character prefix lookups use a dedicated index. Since the tokenizer splits CamelCase into short tokens ("booking", "created"), prefix searches on short strings are common.

**Trade-off:** Increases FTS index size by ~20-40%. For a KB-sized DB, this is negligible.

**Impact:** LOW-MEDIUM. Faster prefix searches. Requires FTS table rebuild.

**Confidence:** HIGH. Official SQLite FTS5 documentation.

### 3b. Consider Porter Stemming (Layered)

```sql
tokenize = 'porter unicode61'
```

**Why:** The porter tokenizer wraps unicode61 and applies English stemming. "booking" and "booked" would match "book" queries. Since entity names are English-language identifiers, stemming improves recall.

**Trade-off:** May cause false positives for similarly-stemmed technical terms. Needs testing against the actual knowledge base before committing.

**Impact:** LOW-MEDIUM. Better recall for natural language queries. Potential false positives.

**Confidence:** MEDIUM. Beneficial in theory, needs validation with real data.

### 3c. Run FTS5 Optimize After Bulk Indexing

```typescript
// After indexAllRepos completes:
db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')");
```

**Why:** After bulk inserts, FTS5 may accumulate many small b-tree segments. The `optimize` command merges them into a single segment, reducing read amplification on subsequent searches.

**When:** Once after `indexAllRepos()`, not after every entity insert.

**Impact:** MEDIUM. Faster subsequent FTS5 queries, smaller FTS index on disk.

**Confidence:** HIGH. Official FTS5 documentation.

### 3d. NOT Recommended

| Option | Why Not |
|--------|---------|
| `detail=none` | Restricts tokens to max 3 characters. Entity names are longer. Would break search |
| `detail=column` | Limits phrase queries. Unnecessary for KB-sized data |
| `content=''` (contentless) | Current search reads name/description directly from FTS before hydrating. Contentless would force an extra JOIN per result |
| `columnsize=0` | Saves minimal space, breaks BM25 ranking accuracy |

**Sources:**
- [SQLite FTS5 Extension docs](https://www.sqlite.org/fts5.html)
- [FTS5 index structure analysis](https://darksi.de/13.sqlite-fts5-structure/)

---

## 4. Missing Database Indexes

### Current Indexes

Only the edges table has explicit indexes:
```sql
CREATE INDEX idx_edges_source ON edges(source_type, source_id);
CREATE INDEX idx_edges_target ON edges(target_type, target_id);
CREATE INDEX idx_edges_relationship ON edges(relationship_type);
```

Plus implicit indexes from UNIQUE constraints:
- `repos(name)` — UNIQUE
- `files(repo_id, path)` — UNIQUE
- `services(repo_id, name)` — UNIQUE

### Missing Indexes That Would Help

| Index | Query Pattern Used | Where Used | Priority |
|-------|-------------------|------------|----------|
| `modules(repo_id, name)` | `WHERE repo_id = ? AND name = ?` | `entity.ts:getEntitiesByExactName`, `pipeline.ts:insertEctoAssociationEdges` | **HIGH** — entity lookup is the core search path |
| `modules(name)` | `WHERE name = ?` | `entity.ts:getEntitiesByExactName` (no repo filter), `pipeline.ts:insertEctoAssociationEdges` (cross-repo fallback) | **HIGH** — cross-repo name resolution |
| `events(name, repo_id)` | `WHERE name = ? AND repo_id = ?` | `pipeline.ts:insertEventEdges` | **MEDIUM** — affects indexing speed, not search |
| `events(repo_id)` | `WHERE repo_id = ?` | `writer.ts:clearRepoEntities`, `writer.ts:persistSurgicalData` | **LOW** — only during re-index |
| `modules(repo_id)` | `WHERE repo_id = ?` | `writer.ts:clearRepoEntities` | **LOW** — only during re-index |
| `services(name)` | `WHERE name = ?` or `WHERE name LIKE ?` | `pipeline.ts:insertGrpcClientEdges` | **MEDIUM** — gRPC edge resolution |

### Recommended Migration (V5)

```sql
-- High priority: entity search path
CREATE INDEX IF NOT EXISTS idx_modules_repo_name ON modules(repo_id, name);
CREATE INDEX IF NOT EXISTS idx_modules_name ON modules(name);

-- Medium priority: indexing and edge resolution
CREATE INDEX IF NOT EXISTS idx_events_name_repo ON events(name, repo_id);
CREATE INDEX IF NOT EXISTS idx_services_name ON services(name);

-- Low priority: cleanup operations
CREATE INDEX IF NOT EXISTS idx_events_repo ON events(repo_id);
```

**Impact:** Entity exact-name lookups (`findEntity` with `--entity` flag) currently do full table scans on modules and events. With thousands of rows across 50 repos, these indexes turn O(n) scans into O(log n) lookups. The `modules(name)` index is the highest-impact single addition since `--entity` searches hit it on every call.

**Confidence:** HIGH. Standard database optimization. Query patterns are directly observable in the source code.

---

## 5. TypeScript Strict Mode Hardening

### Current tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  }
}
```

`strict: true` already enables the core strict family.

### Recommended Addition

| Option | What It Does | Why | Risk |
|--------|-------------|-----|------|
| `noUncheckedIndexedAccess` | Adds `\| undefined` to array index and record property access | Catches cases where code accesses `arr[i]` or `obj[key]` without checking for undefined. The codebase uses `as` casts on DB results which bypass this, but array access patterns and dynamic object lookups would benefit | MEDIUM effort — likely 5-15 fix sites |

### NOT Recommended

| Option | Why Not |
|--------|---------|
| `exactOptionalPropertyTypes` | Low value for this codebase. Most optional fields are simple `string \| undefined` patterns |
| `noPropertyAccessFromIndexSignature` | Codebase doesn't use many index signatures. Minimal benefit |
| `verbatimModuleSyntax` | Would require converting `import type` syntax. High churn, low value |

### Implementation

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

**Fix count estimate:** ~5-15 locations. Most DB query results use explicit `as` casts which bypass the check. The flag primarily catches array element access and dynamic property lookups.

**Confidence:** HIGH. Standard TypeScript hardening for 2025+.

**Sources:**
- [TypeScript TSConfig Reference](https://www.typescriptlang.org/tsconfig/)
- [The Strictest TypeScript Config](https://whatislove.dev/articles/the-strictest-typescript-config/)

---

## 6. Vitest Coverage Configuration

### Current State

```typescript
// vitest.config.ts — no coverage config
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

388 tests across 25 files. Zero visibility into what's covered.

### Recommended Configuration

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/types.ts',
        'src/**/index.ts',
      ],
      // Set thresholds after measuring baseline — ratchet pattern
      // thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
```

**Why V8 over Istanbul:** As of Vitest 3.2+, V8 coverage uses AST-based remapping for accuracy matching Istanbul, but runs faster because no upfront instrumentation is needed. Since the project uses Vitest 3.x, V8 is the right choice.

**Install:** `@vitest/coverage-v8` ships with vitest 3.x. Just run `npx vitest run --coverage`.

**Approach:**
1. Add coverage config, run once to get baseline numbers
2. Set thresholds at current levels (ratchet — prevent regression)
3. Add npm script: `"test:coverage": "vitest run --coverage"`

**Confidence:** HIGH.

**Sources:**
- [Vitest Coverage Guide](https://vitest.dev/guide/coverage.html)
- [Vitest Coverage Config](https://vitest.dev/config/coverage)

---

## 7. Node.js Performance Profiling

### Recommended: Built-in `perf_hooks` Instrumentation

The project's performance-critical paths are:
1. **Indexing** — `execSync` git commands (I/O bound), regex parsing (CPU bound), SQLite writes (I/O bound)
2. **Search** — FTS5 queries + hydration JOINs (SQLite I/O bound)

External profiling tools (clinic.js, 0x) are overkill for a CLI tool. The codebase already has clear pipeline phases. The right move is lightweight instrumentation with Node.js built-in APIs.

```typescript
import { performance } from 'node:perf_hooks';

// pipeline.ts — instrument the three indexing phases
performance.mark('phase1-start');
// Phase 1: Sequential preparation
performance.mark('phase1-end');
performance.measure('Phase 1: Preparation', 'phase1-start', 'phase1-end');

performance.mark('phase2-start');
// Phase 2: Parallel extraction
performance.mark('phase2-end');
performance.measure('Phase 2: Extraction', 'phase2-start', 'phase2-end');

performance.mark('phase3-start');
// Phase 3: Serial persistence
performance.mark('phase3-end');
performance.measure('Phase 3: Persistence', 'phase3-start', 'phase3-end');

// Log results
const entries = performance.getEntriesByType('measure');
for (const entry of entries) {
  console.log(`${entry.name}: ${entry.duration.toFixed(0)}ms`);
}
```

**When to reach for heavier tools:**
- `node --inspect kb index --force` + Chrome DevTools Performance tab — if `perf_hooks` shows Phase 2 (extraction) is slow and you need a CPU flame graph to identify which regex is the bottleneck
- `node --inspect kb search "booking"` — if search latency is unexpectedly high and you need to see where time is spent between FTS5 and hydration

**Not recommended:**
- `clinic.js` — designed for long-running servers, not CLI tools. The overhead of generating reports exceeds the profiling value for sub-10-second operations
- Continuous performance monitoring — this is a local dev tool, not a production service

**Confidence:** HIGH. Built-in Node.js APIs, zero dependencies.

**Sources:**
- [Node.js Performance Measurement APIs](https://nodejs.org/api/perf_hooks.html)
- [Node.js Profiling Guide](https://nodejs.org/en/learn/getting-started/profiling)

---

## 8. WAL Checkpoint After Indexing

### Recommendation

```typescript
// After indexAllRepos() completes in pipeline.ts:
db.pragma('wal_checkpoint(TRUNCATE)');
```

**Why:** After bulk indexing (~50 repos worth of writes), the WAL file can grow to several MB. SQLite auto-checkpoints at 1000 pages (~4 MB), but an explicit TRUNCATE checkpoint resets the WAL to zero length, reclaiming disk space.

**Why TRUNCATE over PASSIVE:** No concurrent readers are expected during the indexing CLI operation. TRUNCATE is safe and provides the cleanest result.

**Impact:** LOW. Disk hygiene, not performance. Prevents WAL file bloat that might confuse users looking at `~/.kb/` directory size.

**Confidence:** HIGH.

---

## 9. Dependency Updates

### Current vs Latest

| Package | Pinned Range | Recommended Action | Notes |
|---------|-------------|-------------------|-------|
| `better-sqlite3` | `^12.0.0` | Update to 12.6.2 | Bug fixes, SQLite engine updates. Semver-compatible |
| `vitest` | `^3.0.0` | Update to latest 3.x | Coverage accuracy improvements in 3.2+ (AST-based V8 coverage) |
| `typescript` | `^5.7.0` | Update to latest 5.x | tsc performance improvements |
| `@modelcontextprotocol/sdk` | `^1.27.1` | Check for latest 1.x | MCP SDK improvements |
| `zod` | `^4.3.6` | Check for latest 4.x | Zod 4 is recent |

All are semver-compatible range updates. Run `npm update` to pull latest within ranges.

### NOT Recommended

| Package | Why Not |
|---------|---------|
| Node.js built-in `node:sqlite` | Still experimental (stability 1.1 as of Node 22). Would be a regression from battle-tested better-sqlite3 |
| Bun's `bun:sqlite` | Would lock to Bun runtime |

**Confidence:** MEDIUM. Exact latest versions need verification against npm.

---

## 10. Priority-Ordered Optimization Checklist

| Priority | Optimization | Effort | Impact | Risk |
|----------|-------------|--------|--------|------|
| **P0** | Prepared statement reuse (Section 2) | Medium | **HIGH** — eliminates thousands of redundant SQL compilations during indexing | LOW |
| **P0** | Missing database indexes (Section 4) | Low | **HIGH** — O(n) to O(log n) for entity lookups | LOW |
| **P1** | SQLite pragma tuning (Section 1) | Low | **MEDIUM** — better memory utilization | LOW |
| **P1** | FTS5 optimize after indexing (Section 3c) | Low | **MEDIUM** — faster search after bulk indexing | LOW |
| **P1** | Vitest coverage setup (Section 6) | Low | **MEDIUM** — test gap visibility | LOW |
| **P2** | FTS5 prefix indexes (Section 3a) | Low | **LOW-MEDIUM** — faster prefix search | LOW (requires FTS rebuild) |
| **P2** | WAL checkpoint after indexing (Section 8) | Low | **LOW** — disk hygiene | LOW |
| **P2** | `noUncheckedIndexedAccess` (Section 5) | Medium | **LOW-MEDIUM** — compile-time bug prevention | LOW |
| **P3** | Porter stemming (Section 3b) | Low | **LOW** — better recall, needs testing | MEDIUM (false positives) |
| **P3** | `perf_hooks` instrumentation (Section 7) | Medium | **LOW** — diagnostic, not optimization | LOW |
| **P3** | Dependency updates (Section 9) | Low | **LOW** — bug fixes, marginal perf | LOW |

---

## Migration Notes

**Schema changes requiring V5 migration:**
- New indexes on modules, events, services tables
- Optionally: FTS5 table rebuild with `prefix='2,3'`

FTS5 table changes (`prefix`, `tokenize`) require **dropping and recreating** the FTS virtual table, then re-populating it. This means `kb index --force` is needed after the migration. The regular tables and their data are unaffected.

**No new dependencies.** All optimizations use existing packages or built-in Node.js APIs.

```bash
# After implementing changes:
npm run build
kb index --force   # Required if FTS5 config changes
```

---

## Sources

- [SQLite PRAGMA docs](https://sqlite.org/pragma.html)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [SQLite Performance Tuning (phiresky)](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [SQLite Pragma Cheatsheet (cj.rs)](https://cj.rs/blog/sqlite-pragma-cheatsheet-for-performance-and-consistency/)
- [Forward Email SQLite Guide](https://forwardemail.net/en/blog/docs/sqlite-performance-optimization-pragma-chacha20-production-guide)
- [Vitest Coverage Guide](https://vitest.dev/guide/coverage.html)
- [Vitest Coverage Config](https://vitest.dev/config/coverage)
- [TypeScript TSConfig Reference](https://www.typescriptlang.org/tsconfig/)
- [The Strictest TypeScript Config](https://whatislove.dev/articles/the-strictest-typescript-config/)
- [Node.js perf_hooks API](https://nodejs.org/api/perf_hooks.html)
- [Node.js Profiling Guide](https://nodejs.org/en/learn/getting-started/profiling)
- [FTS5 Index Structure](https://darksi.de/13.sqlite-fts5-structure/)
- [PowerSync SQLite Optimizations](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance)
