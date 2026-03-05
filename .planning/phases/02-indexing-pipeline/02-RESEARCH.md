# Phase 2: Indexing Pipeline - Research

**Researched:** 2026-03-05
**Domain:** File system scanning, git operations, Elixir/proto parsing, incremental indexing
**Confidence:** HIGH

## Summary

Phase 2 builds the indexing pipeline: scan directories for repos, extract metadata (README, CLAUDE.md, tech stack, key files), parse Elixir modules for context/command/query patterns and `@moduledoc` content, parse `.proto` files for message/service definitions, detect Kafka producer/consumer relationships, and implement incremental indexing via git commit SHA tracking.

The entire pipeline needs zero new dependencies beyond what Phase 1 already provides. Node.js built-ins (`fs`, `path`, `child_process`) handle directory scanning and git operations. Regex-based parsing handles Elixir module extraction and proto file parsing — these are well-bounded, read-only operations where regex is the pragmatic choice over full AST parsing.

The critical design decision is the extractor pipeline architecture: a main orchestrator iterates repos, calls extractors in sequence per repo, wraps each repo in try/catch for error isolation, and commits all DB writes per repo in a single transaction.

**Primary recommendation:** Use a pipeline of pure-function extractors (repo scanner -> metadata extractor -> elixir extractor -> proto extractor -> event extractor) that each return structured data, with a single database writer that persists everything in one transaction per repo. Zero new npm dependencies.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Scan all directories under configurable root (default: ~/Documents/Repos/)
- A directory is a repo if it has .git AND at least one of: mix.exs, package.json
- Repos without project files (forks, experiments, empty) are skipped
- README.md is the primary source for repo description and purpose
- CLAUDE.md enriches with AI-specific context (if present)
- Tech stack detection: language from file presence (mix.exs -> Elixir, package.json -> Node, Gemfile -> Ruby) PLUS key dependencies parsed from dep files (Phoenix, Absinthe, Broadway, Ecto, etc.)
- Key files: hardcoded list (README, CLAUDE.md, AGENTS.md, mix.exs/package.json, config/) plus top-level directory listing snapshot (lib/, priv/, test/, proto/)
- Focus on architecturally significant modules: *Context, *Commands, *Queries patterns
- Extract @moduledoc content as the module description/responsibility
- Extract public function names as capabilities (create_booking/2, cancel/1, etc.)
- Multiple contexts per service -- a service (repo) contains multiple context subdomains
- Also extract Ecto schema names + table names (module name and table only, no field extraction)
- Proto files exist in both a shared proto repo AND local proto directories in individual services
- Extract message names, field names, and gRPC service/rpc definitions from .proto files
- Producer detection: if a service owns (defines) a proto message schema, it's the producer
- Consumer detection: look for event handler modules with handle_event/handle_message pattern matching on specific event types
- Track last_indexed_commit SHA per repo (from Phase 1 schema)
- On re-index: use git diff to find changed files, only re-extract those
- Deleted files: remove all entities that were extracted from that file (clean data, no stale entries)
- Support --force flag to bypass commit SHA check and do full re-index of all repos
- Per-repo error isolation: one repo failing extraction does not block others
- Per-repo status line: "Indexing repo-name... done (23 modules, 5 protos)"
- Errors reported inline per repo, with summary at end

### Claude's Discretion
- Exact regex/AST patterns for detecting Context, Command, Query modules
- Proto file parser choice (regex vs protobuf library)
- Git diff parsing implementation
- How to detect event handler modules reliably
- Error recovery strategy per extractor

### Deferred Ideas (OUT OF SCOPE)
- Full Ecto schema extraction with fields and associations -- v2 (EXT-03)
- GraphQL schema extraction -- v2 (EXT-01)
- gRPC service extraction beyond proto definitions -- v2 (EXT-02)
- Module-level relationship tracking (which module calls which) -- noted in Phase 1 context
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IDX-01 | Scan all repos under a configurable root directory (default ~/Documents/Repos/) | fs.readdirSync + .git detection pattern |
| IDX-02 | Extract repo metadata: name, description (from README/CLAUDE.md), tech stack, key files | File reading + regex for dep parsing |
| IDX-03 | Extract Elixir module definitions and their responsibilities | Regex patterns for defmodule, @moduledoc, def/defp |
| IDX-04 | Extract proto file definitions (event schemas, service definitions) | Regex patterns for message, service, rpc in .proto files |
| IDX-05 | Extract Kafka event producer/consumer relationships from code | Producer = proto owner, Consumer = handle_event pattern matching |
| IDX-06 | Incremental re-indexing: only process repos with new commits since last index | git rev-parse HEAD + git diff --name-only |
| IDX-07 | Per-repo error isolation: one repo failing doesn't block others | try/catch per repo in main loop |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.x | Database operations (from Phase 1) | Already installed, synchronous API |
| Node.js fs | built-in | Directory scanning, file reading | No dependency needed |
| Node.js path | built-in | Path manipulation | No dependency needed |
| Node.js child_process | built-in | Git command execution | Simpler than git libraries for read-only ops |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.x | Testing (from Phase 1) | Unit tests for extractors |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| child_process for git | simple-git / isomorphic-git | Adds dependency for 3 git commands; child_process is sufficient for rev-parse, diff, log |
| Regex for Elixir parsing | tree-sitter-elixir | Full AST is overkill -- we only need defmodule, @moduledoc, def names |
| Regex for proto parsing | protobufjs | Full proto compiler is overkill -- we only need message/service/rpc names and field names |
| fs.readdirSync | glob / fast-glob | Adds dependency for single-level directory listing; readdir is sufficient |

**Installation:**
```bash
# No new dependencies needed -- Phase 1 stack covers everything
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── db/                    # Phase 1 (existing)
│   ├── database.ts
│   ├── schema.ts
│   ├── migrations.ts
│   ├── tokenizer.ts
│   └── fts.ts
├── indexer/               # Phase 2 (new)
│   ├── scanner.ts         # Repo discovery: find repos under root dir
│   ├── metadata.ts        # Repo metadata extraction (README, tech stack, key files)
│   ├── elixir.ts          # Elixir module/context/schema extraction
│   ├── proto.ts           # Proto message/service/rpc extraction
│   ├── events.ts          # Kafka producer/consumer relationship detection
│   ├── git.ts             # Git operations (HEAD SHA, diff, changed files)
│   ├── writer.ts          # Database writer: persists extracted data in transactions
│   └── pipeline.ts        # Main orchestrator: ties extractors together per repo
├── types/
│   └── entities.ts        # Phase 1 (existing)
└── index.ts               # Public API exports
```

### Pattern 1: Extractor Pipeline
**What:** Each extractor is a pure function that takes a repo path and returns structured data. No DB access in extractors.
**When to use:** Always -- separation of extraction from persistence makes testing trivial.
**Example:**
```typescript
// Each extractor returns a plain data structure
interface RepoMetadata {
  name: string;
  path: string;
  description: string | null;
  techStack: string[];
  keyFiles: string[];
}

interface ElixirModule {
  name: string;           // e.g., "BookingContext.Commands.CreateBooking"
  type: string;           // "context" | "command" | "query" | "schema" | "module"
  filePath: string;       // relative path within repo
  moduledoc: string | null;
  functions: string[];    // ["create_booking/2", "cancel/1"]
  tableName: string | null; // for Ecto schemas only
}

// Extractor is a pure function -- no side effects
function extractElixirModules(repoPath: string): ElixirModule[] {
  const exFiles = findFiles(repoPath, '**/*.ex');
  return exFiles.flatMap(file => parseElixirFile(file));
}
```

### Pattern 2: Transaction-Per-Repo Persistence
**What:** All extracted data for one repo is written to the database in a single transaction. If any write fails, the entire repo's data is rolled back cleanly.
**When to use:** Always -- ensures data consistency per repo.
**Example:**
```typescript
// Source: better-sqlite3 docs
const persistRepo = db.transaction((repo: RepoMetadata, modules: ElixirModule[], protos: ProtoDefinition[], events: EventRelationship[]) => {
  // Upsert repo
  const repoId = upsertRepo(db, repo);

  // Clear old data for this repo (full re-extract)
  clearRepoEntities(db, repoId);

  // Insert new data
  for (const mod of modules) insertModule(db, repoId, mod);
  for (const proto of protos) insertEvent(db, repoId, proto);
  for (const event of events) insertEdge(db, repoId, event);

  // Update FTS index
  syncFtsForRepo(db, repoId);

  // Update last_indexed_commit
  updateRepoCommit(db, repoId, repo.currentCommit);
});
```

### Pattern 3: Per-Repo Error Isolation
**What:** The main loop wraps each repo in try/catch. Failures are logged but don't stop processing.
**When to use:** Always -- critical for IDX-07.
**Example:**
```typescript
interface IndexResult {
  repo: string;
  status: 'success' | 'error';
  stats?: { modules: number; protos: number; events: number };
  error?: string;
}

function indexAllRepos(rootDir: string, db: Database, options: { force: boolean }): IndexResult[] {
  const repos = discoverRepos(rootDir);
  const results: IndexResult[] = [];

  for (const repoPath of repos) {
    try {
      const stats = indexSingleRepo(repoPath, db, options);
      console.log(`Indexing ${path.basename(repoPath)}... done (${stats.modules} modules, ${stats.protos} protos)`);
      results.push({ repo: repoPath, status: 'success', stats });
    } catch (error) {
      console.error(`Indexing ${path.basename(repoPath)}... ERROR: ${error.message}`);
      results.push({ repo: repoPath, status: 'error', error: error.message });
    }
  }

  return results;
}
```

### Pattern 4: Incremental Indexing via Git Diff
**What:** Compare stored commit SHA with current HEAD. If different, use `git diff` to find changed files and only re-extract those.
**When to use:** On normal re-index (not --force).
**Example:**
```typescript
import { execSync } from 'child_process';

function getCurrentCommit(repoPath: string): string {
  return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
}

function getChangedFiles(repoPath: string, sinceCommit: string): { added: string[]; modified: string[]; deleted: string[] } {
  const output = execSync(
    `git diff --name-status ${sinceCommit}..HEAD`,
    { cwd: repoPath, encoding: 'utf-8' }
  ).trim();

  const added: string[] = [], modified: string[] = [], deleted: string[] = [];
  for (const line of output.split('\n').filter(Boolean)) {
    const [status, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    if (status === 'A') added.push(filePath);
    else if (status === 'M') modified.push(filePath);
    else if (status === 'D') deleted.push(filePath);
  }
  return { added, modified, deleted };
}
```

### Anti-Patterns to Avoid
- **Writing to DB inside extractors:** Keep extractors pure -- they return data, the writer persists it. This makes extractors trivially testable without a database.
- **Processing all files on every re-index:** Use git diff to identify changes. Only re-extract modified/added files, delete entities from removed files.
- **Global try/catch around entire indexing loop:** Each repo MUST have its own try/catch. A parse error in one repo must not prevent indexing of others.
- **Using exec() instead of execSync():** The indexer is a CLI tool running sequentially. Async git operations add complexity without benefit here.
- **Parsing Elixir/proto files with full AST parsers:** Regex is sufficient for the limited extraction scope (module names, docs, function signatures, message names). Full AST parsers add dependencies and complexity for no benefit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git commit SHA | Custom .git parsing | `git rev-parse HEAD` via execSync | .git format is complex, git CLI is reliable |
| Git diff | Custom diff algorithm | `git diff --name-status` via execSync | Standard, handles all edge cases |
| File discovery | Recursive directory walker | `fs.readdirSync` + simple recursion for specific patterns | Controlled depth, no glob dependency needed |
| Mix.exs dep parsing | Elixir AST parser | Regex on `{:dep_name,` patterns | Mix.exs deps list has a consistent format |
| package.json dep parsing | Custom parser | `JSON.parse(fs.readFileSync(...))` | It's JSON, just parse it |

**Key insight:** Every external tool interaction in this phase is read-only. We're scanning, not modifying. This means we can use the simplest possible approach for each operation.

## Common Pitfalls

### Pitfall 1: Not Handling Missing .git Directory
**What goes wrong:** `git rev-parse HEAD` fails with error on directories that look like repos but have corrupted/missing .git.
**Why it happens:** Some directories have `.git` as a file (submodules) or `.git` exists but is empty/corrupted.
**How to avoid:** Check both `fs.existsSync(path.join(dir, '.git'))` AND wrap git commands in try/catch. A git failure means "skip this repo," not "crash the indexer."
**Warning signs:** Unhandled ENOENT or git errors crashing the pipeline.

### Pitfall 2: Symlink Loops in Directory Scanning
**What goes wrong:** `fs.readdirSync` follows symlinks, potentially creating infinite loops.
**Why it happens:** Some repos have symlinks pointing to parent directories.
**How to avoid:** Use `fs.lstatSync` to check if an entry is a symlink before recursing. For repo discovery (top-level only), this is rarely an issue but should be guarded.
**Warning signs:** Indexer hangs or runs out of memory during scanning.

### Pitfall 3: Regex Greediness in Elixir Module Extraction
**What goes wrong:** A greedy `@moduledoc """..."""` regex captures across multiple module definitions, merging docs from different modules.
**Why it happens:** Elixir heredoc strings (`"""..."""`) can span many lines and multiple `defmodule` blocks can exist in one file.
**How to avoid:** Parse files module-by-module. Split on `defmodule` boundaries first, then extract docs within each boundary.
**Warning signs:** Module descriptions contain content from other modules.

### Pitfall 4: Forgetting to Clean Stale FTS Entries
**What goes wrong:** Deleted or re-extracted entities still appear in search results because FTS index wasn't updated.
**Why it happens:** FTS5 is a separate virtual table -- deleting from source tables doesn't auto-clean FTS.
**How to avoid:** When clearing a repo's entities before re-indexing, also clear the corresponding FTS entries. The Phase 1 `removeEntity()` function handles this.
**Warning signs:** Search returns entities that no longer exist in source tables.

### Pitfall 5: Large File Handling
**What goes wrong:** Reading a 50MB generated proto file or vendor directory file causes memory issues.
**Why it happens:** Some repos contain generated code, vendored dependencies, or large binary proto files.
**How to avoid:** Skip files over a reasonable size threshold (e.g., 1MB). Skip common non-source directories (node_modules, _build, deps, vendor, dist).
**Warning signs:** Memory spikes during indexing, slow processing of individual files.

### Pitfall 6: Git Diff With Non-Existent Commit
**What goes wrong:** `git diff old_sha..HEAD` fails because old_sha was garbage collected, rebased away, or from a force-push.
**Why it happens:** Stored last_indexed_commit may reference a commit that no longer exists after force-push or gc.
**How to avoid:** Wrap git diff in try/catch. If it fails, fall back to full re-index for that repo. Log a warning.
**Warning signs:** Git errors mentioning "unknown revision" or "bad object".

## Code Examples

### Repo Discovery
```typescript
import fs from 'fs';
import path from 'path';

const PROJECT_MARKERS = ['mix.exs', 'package.json', 'Gemfile', 'Cargo.toml', 'go.mod'];
const SKIP_DIRS = ['node_modules', '.git', '_build', 'deps', 'vendor', 'dist', '.elixir_ls'];

export function discoverRepos(rootDir: string): string[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const repos: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;

    const dirPath = path.join(rootDir, entry.name);
    const hasGit = fs.existsSync(path.join(dirPath, '.git'));
    const hasProjectFile = PROJECT_MARKERS.some(marker =>
      fs.existsSync(path.join(dirPath, marker))
    );

    if (hasGit && hasProjectFile) {
      repos.push(dirPath);
    }
  }

  return repos.sort();
}
```

### Elixir Module Extraction
```typescript
// Regex patterns for Elixir module detection
const DEFMODULE_RE = /defmodule\s+([\w.]+)\s+do/g;
const MODULEDOC_RE = /@moduledoc\s+"""([\s\S]*?)"""/;
const MODULEDOC_FALSE_RE = /@moduledoc\s+false/;
const DEF_RE = /^\s+def\s+(\w+)\((.*?)\)/gm;
const SCHEMA_RE = /schema\s+"(\w+)"/;

// Context/Command/Query classification
function classifyModule(name: string): string {
  if (/Context$/.test(name) || /\.Contexts?\./.test(name)) return 'context';
  if (/\.Commands?\./.test(name) || /Command$/.test(name)) return 'command';
  if (/\.Queries?\./.test(name) || /Query$/.test(name)) return 'query';
  if (SCHEMA_RE.test(name)) return 'schema'; // determined by file content, not name
  return 'module';
}

function parseElixirFile(filePath: string, content: string): ElixirModule[] {
  const modules: ElixirModule[] = [];
  let match;

  while ((match = DEFMODULE_RE.exec(content)) !== null) {
    const moduleName = match[1];
    const moduleStart = match.index;

    // Find module boundary (next defmodule or end of file)
    const nextModule = DEFMODULE_RE.exec(content);
    const moduleEnd = nextModule ? nextModule.index : content.length;
    DEFMODULE_RE.lastIndex = nextModule ? nextModule.index : content.length;

    const moduleContent = content.slice(moduleStart, moduleEnd);

    // Extract @moduledoc
    const docMatch = moduleContent.match(MODULEDOC_RE);
    const docFalse = MODULEDOC_FALSE_RE.test(moduleContent);
    const moduledoc = docMatch ? docMatch[1].trim() : (docFalse ? null : null);

    // Extract public functions
    const functions: string[] = [];
    let defMatch;
    const defRe = /^\s+def\s+(\w+)\(([^)]*)\)/gm;
    while ((defMatch = defRe.exec(moduleContent)) !== null) {
      const fname = defMatch[1];
      const arity = defMatch[2] ? defMatch[2].split(',').length : 0;
      functions.push(`${fname}/${arity}`);
    }

    // Check for Ecto schema
    const schemaMatch = moduleContent.match(/schema\s+"(\w+)"/);

    modules.push({
      name: moduleName,
      type: schemaMatch ? 'schema' : classifyModule(moduleName),
      filePath,
      moduledoc,
      functions: [...new Set(functions)], // dedupe
      tableName: schemaMatch ? schemaMatch[1] : null,
    });
  }

  return modules;
}
```

### Proto File Extraction
```typescript
const MESSAGE_RE = /^message\s+(\w+)\s*\{/gm;
const FIELD_RE = /^\s+(?:repeated\s+|optional\s+|required\s+)?(\w+)\s+(\w+)\s*=\s*\d+/gm;
const SERVICE_RE = /^service\s+(\w+)\s*\{/gm;
const RPC_RE = /^\s+rpc\s+(\w+)\s*\((\w+)\)\s+returns\s+\((\w+)\)/gm;

interface ProtoDefinition {
  filePath: string;
  messages: { name: string; fields: { type: string; name: string }[] }[];
  services: { name: string; rpcs: { name: string; input: string; output: string }[] }[];
}

function parseProtoFile(filePath: string, content: string): ProtoDefinition {
  const messages: ProtoDefinition['messages'] = [];
  const services: ProtoDefinition['services'] = [];

  // Extract messages with their fields
  let msgMatch;
  while ((msgMatch = MESSAGE_RE.exec(content)) !== null) {
    const msgName = msgMatch[1];
    const msgStart = msgMatch.index;
    const braceEnd = findMatchingBrace(content, msgStart);
    const msgBody = content.slice(msgStart, braceEnd);

    const fields: { type: string; name: string }[] = [];
    let fieldMatch;
    const fieldRe = /^\s+(?:repeated\s+|optional\s+|required\s+)?(\w+)\s+(\w+)\s*=\s*\d+/gm;
    while ((fieldMatch = fieldRe.exec(msgBody)) !== null) {
      fields.push({ type: fieldMatch[1], name: fieldMatch[2] });
    }

    messages.push({ name: msgName, fields });
  }

  // Extract services with their RPCs
  let svcMatch;
  while ((svcMatch = SERVICE_RE.exec(content)) !== null) {
    const svcName = svcMatch[1];
    const svcStart = svcMatch.index;
    const braceEnd = findMatchingBrace(content, svcStart);
    const svcBody = content.slice(svcStart, braceEnd);

    const rpcs: { name: string; input: string; output: string }[] = [];
    let rpcMatch;
    const rpcRe = /^\s+rpc\s+(\w+)\s*\((\w+)\)\s+returns\s+\((\w+)\)/gm;
    while ((rpcMatch = rpcRe.exec(svcBody)) !== null) {
      rpcs.push({ name: rpcMatch[1], input: rpcMatch[2], output: rpcMatch[3] });
    }

    services.push({ name: svcName, rpcs });
  }

  return { filePath, messages, services };
}
```

### Kafka Event Relationship Detection
```typescript
// Producer: a repo that defines a proto message is the producer of that event
// Consumer: a repo with handle_event/handle_message matching on a specific event type

const EVENT_HANDLER_RE = /def\s+handle_(?:event|message)\s*\(%?(\w+(?:\.\w+)*)\{/gm;
const HANDLE_INFO_RE = /def\s+handle_info\s*\(\{:(\w+),\s*%?(\w+(?:\.\w+)*)/gm;

function detectConsumers(repoPath: string, exFiles: string[]): { eventName: string; handlerFile: string; handlerModule: string }[] {
  const consumers: { eventName: string; handlerFile: string; handlerModule: string }[] = [];

  for (const file of exFiles) {
    const content = fs.readFileSync(file, 'utf-8');

    // Pattern 1: def handle_event(%EventName{...})
    let match;
    while ((match = EVENT_HANDLER_RE.exec(content)) !== null) {
      const moduleMatch = content.match(/defmodule\s+([\w.]+)/);
      consumers.push({
        eventName: match[1],
        handlerFile: path.relative(repoPath, file),
        handlerModule: moduleMatch ? moduleMatch[1] : 'unknown',
      });
    }
  }

  return consumers;
}
```

### Tech Stack Detection from Dependency Files
```typescript
const ELIXIR_KEY_DEPS = ['phoenix', 'ecto', 'absinthe', 'broadway', 'oban', 'commanded', 'eventstore', 'grpc'];
const NODE_KEY_DEPS = ['express', 'fastify', 'nestjs', 'next', 'react', 'vue', 'angular'];

function detectTechStack(repoPath: string): string[] {
  const stack: string[] = [];

  // Elixir
  const mixPath = path.join(repoPath, 'mix.exs');
  if (fs.existsSync(mixPath)) {
    stack.push('elixir');
    const mixContent = fs.readFileSync(mixPath, 'utf-8');
    for (const dep of ELIXIR_KEY_DEPS) {
      // Match {:dep_name, "~> x.x"} or {:dep_name, ">= x.x"}
      if (new RegExp(`\\{:${dep},`).test(mixContent)) {
        stack.push(dep);
      }
    }
  }

  // Node.js
  const pkgPath = path.join(repoPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    stack.push('node');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const dep of NODE_KEY_DEPS) {
        if (allDeps[dep] || allDeps[`@${dep}/core`]) {
          stack.push(dep);
        }
      }
    } catch { /* corrupted package.json */ }
  }

  // Ruby
  if (fs.existsSync(path.join(repoPath, 'Gemfile'))) stack.push('ruby');

  return stack;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full AST parsing for extraction | Regex for bounded extraction | Always (for tools like this) | 10x less code, zero dependencies, sufficient for name/doc extraction |
| Async git operations | execSync for CLI tools | Standard for sequential pipelines | Simpler code, no callback/promise overhead |
| Separate git library dep | child_process.execSync | When only 3-4 git commands needed | Zero dependency cost |

**Deprecated/outdated:**
- None relevant -- the technologies used (fs, child_process, regex, SQLite) are all stable and current.

## Open Questions

1. **Handling nested git repos (monorepos with submodules)**
   - What we know: Some repos contain `.git` files (not dirs) indicating submodules
   - What's unclear: Should we index submodules separately?
   - Recommendation: No. Only index top-level directories under the root. `fs.existsSync('.git')` returns true for both files and directories, which is fine -- we'll catch submodule git failures in the try/catch.

2. **Proto import resolution across repos**
   - What we know: The shared proto repo defines messages, individual services import them
   - What's unclear: How to link a service's proto imports to the shared repo's definitions
   - Recommendation: Phase 2 indexes each repo independently. Cross-repo proto linking happens at query time (Phase 3) by matching message names across repos via the events table.

3. **Elixir umbrella app structure**
   - What we know: Some Elixir projects are umbrella apps with `apps/` containing sub-applications
   - What's unclear: Whether to treat each umbrella child as a separate service
   - Recommendation: Treat the umbrella as one repo. Scan `apps/*/lib/**/*.ex` in addition to `lib/**/*.ex`. The repo name stays the same -- umbrella children are contexts within the service.

## Sources

### Primary (HIGH confidence)
- better-sqlite3 official docs (Context7) - Transaction patterns, prepared statements, batch operations
- Node.js fs docs - readdirSync, readFileSync, existsSync, lstatSync
- Node.js child_process docs - execSync with encoding and cwd options

### Secondary (MEDIUM confidence)
- Elixir module patterns from Phase 2 CONTEXT.md - DDD patterns: BookingContext.Commands.CreateBooking
- Proto file format from Protocol Buffers Language Guide - message, service, rpc syntax

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all Node.js built-ins, no new dependencies
- Architecture: HIGH - pipeline pattern is well-established, matches Phase 1 patterns
- Elixir parsing: MEDIUM - regex patterns cover common cases but edge cases exist (nested modules, multi-line function heads)
- Proto parsing: HIGH - proto syntax is strict and regular, regex works reliably
- Git operations: HIGH - standard git commands, well-tested

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable domain, 30 days)
