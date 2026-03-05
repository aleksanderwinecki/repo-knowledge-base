# Phase 4: CLI + Knowledge - Research

**Researched:** 2026-03-05
**Domain:** CLI tool construction, knowledge injection, graph queries
**Confidence:** HIGH

## Summary

Phase 4 wraps the existing storage, indexing, and search layers in a CLI tool and adds manual knowledge injection. The project already has a clean TypeScript/ESM codebase with better-sqlite3 and vitest. The CLI needs commander.js for subcommand parsing, JSON-only output (per user decision — no human formatting), and a new `learned_facts` table for knowledge injection.

The existing public API (`searchText`, `findEntity`, `queryDependencies`, `indexAllRepos`) is well-structured and can be called directly from CLI action handlers. The main work is: (1) CLI scaffolding with commander.js, (2) schema migration for learned facts, (3) knowledge CRUD operations, (4) wiring everything through a `bin` entry point.

**Primary recommendation:** Use commander.js with `@commander-js/extra-typings` for type-safe CLI. Keep each subcommand in its own file. Add a V2 migration for the `learned_facts` table. Output JSON via `JSON.stringify` to stdout — no formatting libraries needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- JSON-only output (no human-readable mode) — this tool is for AI consumption
- Plain text, no color/chalk — unnecessary for JSON output
- No response size limits — return everything, let the caller decide
- Subcommand pattern: `kb index`, `kb search`, `kb learn`, `kb deps`, `kb status`
- CLI only, no MCP server
- Claude calls the CLI via Bash and parses JSON output
- Auto-generated documentation (CLAUDE.md section or `kb docs` command) describing each command with examples so Claude knows how to use the tool
- Free-form text input: `kb learn 'payments-service owns the billing domain'`
- Optional `--repo` tag to associate facts with a specific repo
- Management commands: `kb learned` (list all), `kb forget <id>` (delete one)
- Stored persistently, searchable alongside indexed data via FTS
- Direct neighbors only (no transitive/depth traversal) for graph queries
- Always include provenance: repo, file path, and line where relationship was detected
- Entity queries return the mechanism (kafka, grpc, etc.) alongside the relationship

### Claude's Discretion
- Whether learned facts need optional categories/tags beyond repo association
- Whether to include a `kb map` command for full service topology
- JSON response structure and field naming
- Dependency output grouping (flat vs grouped by direction)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTF-01 | CLI tool for indexing, querying, and learning | Commander.js subcommand pattern maps directly to `kb index`, `kb search`, `kb learn` |
| INTF-02 | MCP server exposable to Claude Code | **User locked decision: CLI only, no MCP server.** Requirement satisfied by CLI + JSON output that Claude calls via Bash |
| INTF-03 | Human-readable output formatting | **User locked decision: JSON-only output.** No human formatting needed — tool is for AI consumption |
| INTF-04 | MCP responses under 4KB | **N/A per user decision (no MCP, no size limits).** Return everything, let caller decide |
| KNOW-01 | Manual knowledge injection via CLI | `kb learn` command with free-form text + optional `--repo` tag |
| KNOW-02 | Learned facts stored persistently and searchable | New `learned_facts` table + FTS indexing of learned content |
| KNOW-03 | Service relationship graph queryable | `kb deps` command wrapping existing `queryDependencies()` + provenance from edges table |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | ^13.0.0 | CLI framework with subcommands | De facto Node.js CLI standard. 193 Context7 snippets, HIGH reputation |
| @commander-js/extra-typings | ^13.0.0 | TypeScript type inference for commander | Official companion — infers types from `.option()` and `.argument()` definitions |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | ^12.0.0 | Already in project | Database layer — no change needed |
| vitest | ^3.0.0 | Already in project | Testing — no change needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| commander | yargs | Yargs has more magic; commander is simpler and maps cleanly to subcommand pattern |
| commander | clipanion | More type-safe but less ecosystem support; extra-typings closes the gap |

**Installation:**
```bash
npm install commander @commander-js/extra-typings
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cli/
│   ├── index.ts         # Program setup, subcommand registration
│   ├── commands/
│   │   ├── index-cmd.ts # kb index [--root <path>] [--force]
│   │   ├── search.ts    # kb search <query> [--repo <name>] [--type <entity>]
│   │   ├── learn.ts     # kb learn <text> [--repo <name>]
│   │   ├── learned.ts   # kb learned [--repo <name>]
│   │   ├── forget.ts    # kb forget <id>
│   │   ├── deps.ts      # kb deps <entity> [--direction <up|down>]
│   │   ├── status.ts    # kb status
│   │   └── docs.ts      # kb docs (auto-generate usage documentation)
│   └── output.ts        # JSON output helper (stringify + write to stdout)
├── knowledge/
│   ├── store.ts         # CRUD for learned_facts table
│   └── types.ts         # LearnedFact interface
├── db/
│   └── migrations.ts    # Add V2 migration for learned_facts table
└── index.ts             # Existing public API (add knowledge exports)
```

### Pattern 1: Subcommand-per-file
**What:** Each CLI subcommand lives in its own file exporting a function that receives the `Command` parent
**When to use:** Always — keeps each command isolated and testable
**Example:**
```typescript
// src/cli/commands/search.ts
import { Command } from '@commander-js/extra-typings';
import { openDatabase, closeDatabase } from '../../db/database.js';
import { searchText } from '../../search/index.js';
import { output } from '../output.js';

export function registerSearch(program: Command) {
  program
    .command('search')
    .description('Full-text search across indexed knowledge')
    .argument('<query>', 'search query')
    .option('--repo <name>', 'filter by repo name')
    .option('--type <entity>', 'filter by entity type')
    .option('--limit <n>', 'max results', '20')
    .action((query, opts) => {
      const db = openDatabase(getDbPath());
      try {
        const results = searchText(db, query, {
          limit: parseInt(opts.limit),
          repoFilter: opts.repo,
          entityTypeFilter: opts.type,
        });
        output(results);
      } finally {
        closeDatabase(db);
      }
    });
}
```

### Pattern 2: JSON Output Helper
**What:** Centralized output function that serializes to JSON and writes to stdout
**When to use:** Every command's action handler
**Example:**
```typescript
// src/cli/output.ts
export function output(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function outputError(error: string, code?: string): void {
  process.stdout.write(JSON.stringify({ error, code }, null, 2) + '\n');
  process.exit(1);
}
```

### Pattern 3: Database Path Resolution
**What:** Consistent DB path resolution across all commands
**When to use:** Every command that touches the database
**Example:**
```typescript
// Default: ~/.kb/knowledge.db (or KB_DB_PATH env override)
export function getDbPath(): string {
  return process.env.KB_DB_PATH ?? path.join(os.homedir(), '.kb', 'knowledge.db');
}
```

### Anti-Patterns to Avoid
- **God command file:** Don't put all subcommands in one file — each gets its own module
- **Opening DB in program setup:** Open/close DB in each command's action handler, not at program level
- **Mixing stdout formats:** JSON only. Never log debug info to stdout (use stderr if needed)
- **Forgetting cleanup:** Always close DB in a finally block

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI argument parsing | Custom argv parser | commander.js | Edge cases in flag parsing, subcommands, help text |
| JSON output formatting | Custom serializer | `JSON.stringify(data, null, 2)` | Standard, handles all edge cases |
| DB path resolution | Hardcoded paths | `os.homedir()` + env override | Cross-platform, configurable |

**Key insight:** The existing codebase already handles all the hard work (FTS, entity resolution, dependency traversal). The CLI is a thin wrapper — keep it thin.

## Common Pitfalls

### Pitfall 1: ESM bin entry point
**What goes wrong:** `#!/usr/bin/env node` in a .ts file doesn't work; need compiled .js
**Why it happens:** TypeScript doesn't run directly in bin; need to compile first
**How to avoid:** Point `bin` in package.json to `dist/cli/index.js`, add shebang to the source file, ensure `tsc` preserves it
**Warning signs:** "Cannot find module" when running `kb` command

### Pitfall 2: FTS indexing of learned facts
**What goes wrong:** Learned facts aren't searchable because they weren't added to `knowledge_fts`
**Why it happens:** The existing `indexEntity` function expects entity types from the schema
**How to avoid:** Either extend `EntityType` to include `'learned_fact'` or index learned facts with a special entity type. The FTS table's `entity_type` column is untyped TEXT, so any string works.
**Warning signs:** `kb search` returns indexed data but not learned facts

### Pitfall 3: Commander action handlers are sync
**What goes wrong:** Async operations in action handlers don't await properly
**Why it happens:** Commander's `.action()` doesn't natively await async callbacks
**How to avoid:** All our DB operations (better-sqlite3) are synchronous, so this isn't an issue. If future commands need async, wrap in `.action(async (...) => { ... })` and call `program.parseAsync()`.
**Warning signs:** Process exits before async work completes

### Pitfall 4: Direct-neighbors-only constraint
**What goes wrong:** `queryDependencies` supports multi-hop traversal, but user locked decision says direct neighbors only
**Why it happens:** Existing code supports depth parameter
**How to avoid:** In the `kb deps` CLI command, hardcode `depth: 1` and don't expose a depth flag. The underlying function still supports it for future use.
**Warning signs:** User sees transitive dependencies when they only wanted direct

## Code Examples

### Schema Migration for Learned Facts (V2)
```typescript
// In migrations.ts — add to runMigrations
function migrateToV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learned_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      repo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
```

### Bin Entry Point
```typescript
// src/cli/index.ts
#!/usr/bin/env node
import { Command } from '@commander-js/extra-typings';
import { registerIndex } from './commands/index-cmd.js';
import { registerSearch } from './commands/search.js';
import { registerLearn } from './commands/learn.js';
// ... etc

const program = new Command();
program
  .name('kb')
  .description('Repository knowledge base for AI agents')
  .version('1.0.0');

registerIndex(program);
registerSearch(program);
registerLearn(program);
// ... register all commands

program.parse();
```

### package.json bin field
```json
{
  "bin": {
    "kb": "dist/cli/index.js"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| commander CommonJS | commander ESM + extra-typings | 2024 | Full TypeScript type inference |
| yargs for everything | commander for subcommand CLIs | Stable | Simpler API for subcommand pattern |

**Deprecated/outdated:**
- `program.option()` without `@commander-js/extra-typings`: Still works but loses type inference
- `commander/esm.mjs`: No longer needed — v12+ is native ESM

## Open Questions

1. **DB default location**
   - What we know: Need a consistent default path for the knowledge.db file
   - What's unclear: `~/.kb/knowledge.db` vs `~/.local/share/kb/knowledge.db` (XDG)
   - Recommendation: Use `~/.kb/knowledge.db` for simplicity, with `KB_DB_PATH` env override. Simple beats correct here.

2. **`kb docs` output format**
   - What we know: User wants auto-generated documentation for Claude to discover
   - What's unclear: Whether to output markdown to stdout or write a file
   - Recommendation: Output markdown to stdout by default. The user or a setup script can redirect to a CLAUDE.md section.

## Sources

### Primary (HIGH confidence)
- Context7 /tj/commander.js — subcommand patterns, TypeScript integration, error handling, option parsing (193 snippets, HIGH reputation, benchmark 88.7)
- Existing codebase analysis — `src/index.ts` public API, `src/search/` modules, `src/db/migrations.ts`

### Secondary (MEDIUM confidence)
- commander.js README on GitHub — ESM support, bin setup, extra-typings

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — commander.js is the established standard, verified via Context7
- Architecture: HIGH — wrapping existing well-tested API in thin CLI layer
- Pitfalls: HIGH — based on direct codebase analysis, known TypeScript/ESM patterns

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable domain, no fast-moving dependencies)
