# Architecture Research

**Domain:** Local codebase knowledge base / code intelligence system
**Researched:** 2026-03-05
**Confidence:** MEDIUM (training data + MCP official docs; no web search available to verify ecosystem patterns)

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Interface Layer                             │
│  ┌──────────────┐  ┌──────────────────────────────────────┐     │
│  │  CLI (bin)   │  │  MCP Server (stdio transport)        │     │
│  │  index/query │  │  tools: search, graph, learn         │     │
│  │  learn/status│  │  resources: service list, schema     │     │
│  └──────┬───────┘  └──────────────┬───────────────────────┘     │
│         │                         │                              │
├─────────┴─────────────────────────┴──────────────────────────────┤
│                      Core Engine Layer                            │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐     │
│  │  Indexer     │  │ Query Engine │  │ Knowledge Manager   │     │
│  │  (pipeline)  │  │ (search +   │  │ (manual learn +     │     │
│  │             │  │  graph walk) │  │  pattern storage)   │     │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘     │
│         │                │                      │                │
├─────────┴────────────────┴──────────────────────┴────────────────┤
│                      Extraction Layer                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Proto/   │ │ GraphQL  │ │ gRPC     │ │ Ecto     │            │
│  │ Kafka    │ │ Schema   │ │ Service  │ │ Schema   │            │
│  │ Extractor│ │ Extractor│ │ Extractor│ │ Extractor│            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐             │
│  │ Metadata │ │ README/  │ │ Git Change Detector  │             │
│  │ Extractor│ │ Doc      │ │ (incremental index)  │             │
│  │ (mix.exs)│ │ Extractor│ │                      │             │
│  └──────────┘ └──────────┘ └──────────────────────┘             │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                      Storage Layer                               │
│  ┌─────────────────────┐  ┌──────────────────────┐              │
│  │  SQLite Database    │  │  Embeddings Store    │              │
│  │  - services table   │  │  (SQLite table with  │              │
│  │  - events table     │  │   vector blob or     │              │
│  │  - schemas table    │  │   separate vec file) │              │
│  │  - dependencies     │  │                      │              │
│  │  - patterns/learned │  │                      │              │
│  │  - index_state      │  │                      │              │
│  └─────────────────────┘  └──────────────────────┘              │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **CLI** | User-facing commands: `index`, `query`, `learn`, `status` | Commander.js or yargs; thin wrapper calling Core Engine |
| **MCP Server** | Expose knowledge to Claude Code sessions via MCP tools | `@modelcontextprotocol/sdk` with stdio transport; wraps same Core Engine |
| **Indexer Pipeline** | Orchestrate extraction across repos, manage incremental state | Walks repos, delegates to extractors, stores results |
| **Extractors** | Parse specific file types into structured knowledge | Individual modules per domain (proto, graphql, ecto, etc.) |
| **Git Change Detector** | Determine which files changed since last index | `git diff --name-only <last-indexed-commit>..HEAD` per repo |
| **Query Engine** | Semantic search + graph traversal over indexed knowledge | Combines embedding similarity search with structured SQL queries |
| **Knowledge Manager** | Accept manual knowledge ("learn" command), store patterns | CRUD for manually injected facts and task patterns |
| **SQLite Database** | Persistent structured storage for all extracted knowledge | better-sqlite3 (synchronous, fast, zero-config) |
| **Embeddings Store** | Vector storage for semantic search | Embeddings stored as BLOB in SQLite; cosine similarity in JS |

## Recommended Project Structure

```
src/
├── cli/                    # CLI entry point and commands
│   ├── index.ts            # Main CLI entry (commander setup)
│   ├── commands/
│   │   ├── index-cmd.ts    # index command
│   │   ├── query-cmd.ts    # query/search command
│   │   ├── learn-cmd.ts    # learn command (manual knowledge)
│   │   └── status-cmd.ts   # status/health command
│   └── formatters.ts       # Output formatting for terminal
├── mcp/                    # MCP server entry point
│   ├── server.ts           # MCP server setup, tool registration
│   └── tools/              # MCP tool handlers
│       ├── search.ts       # Semantic search tool
│       ├── graph.ts        # Dependency graph query tool
│       └── learn.ts        # Manual knowledge injection tool
├── core/                   # Core engine (shared by CLI + MCP)
│   ├── indexer.ts          # Indexing orchestrator
│   ├── query-engine.ts     # Search + graph query logic
│   └── knowledge.ts        # Manual knowledge CRUD
├── extractors/             # Domain-specific file parsers
│   ├── base.ts             # Extractor interface/base class
│   ├── proto.ts            # Proto file extractor (events, messages)
│   ├── graphql.ts          # GraphQL schema extractor
│   ├── grpc.ts             # gRPC service definition extractor
│   ├── ecto.ts             # Ecto schema extractor
│   ├── metadata.ts         # mix.exs / package.json metadata
│   └── docs.ts             # README, CLAUDE.md, AGENTS.md
├── storage/                # Data persistence
│   ├── db.ts               # SQLite setup, migrations, connection
│   ├── repos.ts            # Repository/service CRUD
│   ├── events.ts           # Event relationship CRUD
│   ├── schemas.ts          # Schema storage CRUD
│   ├── embeddings.ts       # Embedding storage + similarity search
│   └── index-state.ts      # Per-repo indexing state (last commit)
├── embedder/               # Text-to-embedding pipeline
│   ├── index.ts            # Embedder interface
│   └── local.ts            # Local embedding (transformers.js or API)
└── utils/
    ├── git.ts              # Git operations (changed files, current commit)
    ├── file-walker.ts      # Directory traversal with glob patterns
    └── logger.ts           # Structured logging
```

### Structure Rationale

- **cli/ and mcp/ are thin shells:** Both import from `core/` — the business logic lives in one place. This prevents divergence between CLI and MCP behavior.
- **extractors/ are pluggable:** Each extractor handles one file type. Adding Kafka config extraction later means adding one file, not touching the indexer.
- **storage/ wraps SQLite entirely:** No raw SQL outside this folder. If you swap storage (unlikely), you only touch this layer.
- **embedder/ is isolated:** Embedding strategy will likely change (local model vs. API vs. skip entirely for MVP). Isolating it makes swapping trivial.

## Architectural Patterns

### Pattern 1: Pipeline-Based Indexing

**What:** The indexer runs a pipeline per repository: detect changes -> walk files -> match extractors -> extract -> embed -> store. Each step is a pure function that transforms data.
**When to use:** Always during indexing. The pipeline pattern makes it easy to add/remove extractors and to test each step in isolation.
**Trade-offs:** Slightly more abstraction than a simple loop, but pays off immediately when you need to skip unchanged files or add a new extractor.

**Example:**
```typescript
interface ExtractedKnowledge {
  service: string;
  type: 'event' | 'schema' | 'grpc' | 'graphql' | 'metadata' | 'doc';
  content: string;        // Human-readable summary for embedding
  structured: Record<string, unknown>; // Machine-readable data for storage
  filePath: string;
}

interface Extractor {
  name: string;
  filePatterns: string[];  // Glob patterns this extractor handles
  extract(filePath: string, content: string, repoName: string): ExtractedKnowledge[];
}

async function indexRepo(repoPath: string, extractors: Extractor[]): Promise<void> {
  const changedFiles = await getChangedFiles(repoPath);  // git diff
  for (const file of changedFiles) {
    const matching = extractors.filter(e => matchesGlob(file, e.filePatterns));
    for (const extractor of matching) {
      const knowledge = extractor.extract(file, readFile(file), repoName);
      await store(knowledge);
      await embed(knowledge);
    }
  }
  await updateIndexState(repoPath, getCurrentCommit(repoPath));
}
```

### Pattern 2: Dual Interface, Single Core

**What:** CLI and MCP server are separate entry points that both call the same core engine functions. No logic in the interface layer.
**When to use:** Always. This is the foundational architecture decision.
**Trade-offs:** Requires discipline to keep interfaces thin. Worth it because it means fixing a bug in query logic fixes it for both CLI and MCP simultaneously.

**Example:**
```typescript
// core/query-engine.ts — the real logic
export async function search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const embedding = await embed(query);
  const candidates = await findSimilar(embedding, options?.limit ?? 10);
  const enriched = await enrichWithGraph(candidates);
  return enriched;
}

// cli/commands/query-cmd.ts — thin shell
export const queryCommand = new Command('query')
  .argument('<query>')
  .action(async (query) => {
    const results = await search(query);
    console.log(formatResults(results));
  });

// mcp/tools/search.ts — thin shell
server.tool('search', { query: z.string() }, async ({ query }) => {
  const results = await search(query);
  return { content: [{ type: 'text', text: JSON.stringify(results) }] };
});
```

### Pattern 3: Git-Based Incremental Indexing

**What:** Track the last indexed git commit per repo. On re-index, only process files changed since that commit. Fall back to full index if no prior state exists.
**When to use:** Every re-index operation. Without this, indexing 50+ repos every time is unacceptably slow.
**Trade-offs:** Requires storing per-repo state. Edge cases around rebased branches or force-pushed commits (handle by detecting if stored commit still exists; if not, full re-index).

**Example:**
```typescript
async function getChangedFiles(repoPath: string): Promise<string[]> {
  const lastCommit = await getLastIndexedCommit(repoPath);
  if (!lastCommit) {
    // Full index — return all tracked files
    return execGit(repoPath, ['ls-files']);
  }

  // Check if the stored commit still exists (handles force-push)
  const commitExists = await execGit(repoPath, ['cat-file', '-t', lastCommit])
    .then(() => true)
    .catch(() => false);

  if (!commitExists) {
    return execGit(repoPath, ['ls-files']); // Full re-index
  }

  return execGit(repoPath, ['diff', '--name-only', lastCommit, 'HEAD']);
}
```

### Pattern 4: Hybrid Search (Structured + Semantic)

**What:** Combine SQL queries on structured data (service names, event types, dependencies) with embedding-based similarity search on free-text descriptions. Structured queries answer "which services produce BookingCreated?" directly. Semantic search handles fuzzy queries like "how do services handle booking cancellation?"
**When to use:** Always at query time. The structured path is fast and precise. The semantic path handles ambiguity.
**Trade-offs:** Two query paths to maintain, but the structured path is just SQL and the semantic path is cosine similarity over embeddings. The real complexity is in merging/ranking results.

## Data Flow

### Indexing Flow

```
~/Documents/Repos/
    │
    ├── service-a/
    ├── service-b/
    └── ...
    │
    ▼
[Repo Discovery]  ── scan directory for git repos
    │
    ▼
[Per-Repo Pipeline]
    │
    ├── [Git Change Detector] ── git diff since last indexed commit
    │       │
    │       ▼
    ├── [File Walker] ── filter changed files by extractor glob patterns
    │       │
    │       ▼
    ├── [Extractor Matching] ── route files to appropriate extractors
    │       │
    │       ▼
    ├── [Extraction] ── parse files into ExtractedKnowledge objects
    │       │
    │       ├── structured data → [SQLite] (events, schemas, deps)
    │       │
    │       └── text content → [Embedder] → embedding vector → [SQLite embeddings table]
    │
    ▼
[Update Index State] ── store current HEAD commit for this repo
```

### Query Flow

```
User Query (CLI or MCP tool)
    │
    ▼
[Query Engine]
    │
    ├── Is this a structured query? (service name, event name, etc.)
    │   YES → [SQL Query] → direct lookup in services/events/schemas tables
    │
    ├── Is this a semantic query? (natural language question)
    │   YES → [Embed Query] → cosine similarity against embeddings → ranked results
    │
    └── Merge + Rank results
         │
         ▼
    [Graph Enrichment] ── optionally traverse dependency graph
         │              to add context (e.g., "BookingCreated is produced
         │              by service-a and consumed by service-b, service-c")
         ▼
    Formatted Response → CLI output or MCP tool result
```

### Key Data Flows

1. **Repo-to-Knowledge:** File content flows through extractors into structured rows (SQLite) and embedding vectors. This is a batch operation that runs on-demand via `index` command.
2. **Query-to-Answer:** User query flows through embedding (for semantic) or SQL (for structured), results are enriched with graph context, then formatted for output.
3. **Learn-to-Storage:** Manual knowledge injection bypasses extractors entirely — goes straight to a "patterns" or "facts" table in SQLite with an embedding for search.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-20 repos | Everything works as designed. Full re-index is fast enough to not even bother with incremental. |
| 20-100 repos | Incremental indexing becomes essential. Embedding computation is the bottleneck — batch embeddings. SQLite handles this volume trivially. |
| 100-500 repos | Consider parallel extraction (worker threads). Embedding API rate limits become relevant if using external API. SQLite still fine. |
| 500+ repos | Beyond the scope of this project. Would need a real vector DB and distributed indexing. |

### Scaling Priorities

1. **First bottleneck: Embedding computation.** Generating embeddings for thousands of text chunks is the slowest part. Mitigation: batch embedding calls, only re-embed changed content (incremental), consider local embedding model (transformers.js) to avoid API round-trips.
2. **Second bottleneck: Initial full index time.** First run across 50+ repos will be I/O-bound reading files + CPU-bound parsing. Mitigation: parallelize repo processing (each repo is independent), stream results to SQLite.

## Anti-Patterns

### Anti-Pattern 1: Fat Interface Layer

**What people do:** Put query logic, extraction logic, or storage access directly in CLI command handlers or MCP tool handlers.
**Why it's wrong:** Duplicated logic between CLI and MCP. Bugs get fixed in one place but not the other. Testing requires spinning up CLI or MCP server.
**Do this instead:** Keep interfaces as thin wrappers. All logic in `core/`. Test `core/` directly.

### Anti-Pattern 2: Monolithic Extractor

**What people do:** One big function that parses all file types with a cascade of if/else blocks.
**Why it's wrong:** Adding a new file type means touching a huge function. Testing one extraction type means setting up fixtures for all of them.
**Do this instead:** One extractor per domain. Each extractor declares what file patterns it handles. Indexer routes files to matching extractors.

### Anti-Pattern 3: Re-embedding Everything on Every Index

**What people do:** Generate fresh embeddings for all content every time the index runs.
**Why it's wrong:** Embedding is the most expensive operation. For 50 repos, this turns a 30-second incremental update into a 10-minute full rebuild.
**Do this instead:** Content-addressed embedding cache. Hash the text content; if the hash matches what's stored, skip re-embedding.

### Anti-Pattern 4: Storing Raw File Content Instead of Extracted Knowledge

**What people do:** Store entire file contents in the database and try to search over them.
**Why it's wrong:** Raw files are noisy. A 500-line proto file contains maybe 10 lines of interesting event metadata. Embedding the whole file dilutes relevance.
**Do this instead:** Extract structured knowledge (event names, field types, service relationships) and generate concise text summaries for embedding.

### Anti-Pattern 5: Tight Coupling to Embedding Provider

**What people do:** Hardcode OpenAI embedding calls throughout the codebase.
**Why it's wrong:** Embedding provider may change (OpenAI -> local model -> different API). Rate limits, costs, or offline usage may require switching.
**Do this instead:** Embedder interface with swappable implementations. Start with one provider, but make it trivial to swap.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude Code (MCP Host) | MCP Server via stdio transport | Claude Code spawns the MCP server as a child process. Server registers tools that Claude can call mid-conversation. |
| Embedding API (OpenAI, etc.) | HTTP API calls from embedder module | Optional — can use local model instead. Must handle rate limits and batching. |
| Git (per repo) | Shell exec (`git diff`, `git log`, `git ls-files`) | Use `simple-git` or direct exec. Must handle repos in various states (detached HEAD, dirty working tree). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| CLI <-> Core Engine | Direct function calls (same process) | CLI imports core modules. No serialization needed. |
| MCP Server <-> Core Engine | Direct function calls (same process) | MCP server imports core modules. Runs as single Node.js process. |
| Core Engine <-> Storage | Synchronous SQLite calls via better-sqlite3 | Sync is fine here — simplifies the code massively vs async DB drivers. |
| Core Engine <-> Embedder | Async (API calls or local model inference) | This is the one async boundary that matters. Must handle failures gracefully. |
| Indexer <-> Extractors | Function calls with typed interfaces | Extractor returns `ExtractedKnowledge[]`. No side effects — pure parsing. |

## Build Order (Dependencies)

This is the critical section for roadmap planning. Components must be built in dependency order:

```
Phase 1: Foundation
  Storage (SQLite setup, schema, migrations)
  └── needed by everything else

Phase 2: Core Pipeline
  Extractors (start with metadata + proto — highest value)
  Indexer (orchestrates extractors, uses storage)
  Git Change Detector (used by indexer for incremental)
  └── depends on: Storage

Phase 3: Query
  Query Engine (structured SQL queries first, semantic later)
  └── depends on: Storage (populated by indexer)

Phase 4: Interfaces
  CLI (thin wrapper over core)
  MCP Server (thin wrapper over core)
  └── depends on: Core Engine (indexer + query engine)

Phase 5: Semantic Search
  Embedder (text-to-vector)
  Embedding Storage + Similarity Search
  └── depends on: Storage, Query Engine (extends it)

Phase 6: Additional Extractors
  GraphQL, gRPC, Ecto extractors
  Knowledge Manager (manual learn)
  └── depends on: Extractor interface (Phase 2)
```

**Rationale for this order:**
- Storage first because literally everything writes to or reads from it.
- Core pipeline (indexer + first extractors) before query because you need data to query.
- CLI and MCP come after core logic exists — they're thin wrappers.
- Semantic search is deferred because structured queries (exact event/service name lookup) deliver 80% of the value with 20% of the effort. Semantic search is the polish.
- Additional extractors are independent and can be added incrementally.

## Sources

- MCP Architecture: https://modelcontextprotocol.io/docs/concepts/architecture (HIGH confidence — official docs, verified 2026-03-05)
- MCP Tools spec: https://modelcontextprotocol.io/docs/concepts/tools (HIGH confidence — official docs)
- Incremental indexing via git diff pattern: Training data (MEDIUM confidence — well-established pattern, but specific implementation details unverified)
- Extractor pipeline pattern: Training data (MEDIUM confidence — standard ETL pattern applied to code intelligence)
- better-sqlite3 for Node.js SQLite: Training data (MEDIUM confidence — widely known library, but version/API details should be verified via Context7 before implementation)
- Hybrid search (structured + semantic): Training data (MEDIUM confidence — common pattern in RAG systems)

---
*Architecture research for: Repo Knowledge Base*
*Researched: 2026-03-05*
