# Stack Research

**Domain:** Local codebase knowledge base with semantic search
**Researched:** 2026-03-05
**Confidence:** MEDIUM (versions unverified — WebSearch/WebFetch/Bash unavailable during research)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | ~5.5+ | Language | PROJECT.md constraint. Strong typing catches shape mismatches in embeddings/DB schemas early. |
| Node.js | 20 LTS or 22 LTS | Runtime | Required for MCP SDK, good native module support for SQLite bindings. Use LTS for stability. |
| better-sqlite3 | ~11.x | SQLite driver | Synchronous API is simpler for CLI tools. Best perf of Node SQLite drivers. Required by sqlite-vec. |
| sqlite-vec | ~0.1.x | Vector search extension | SQLite extension for vector similarity search. Zero infrastructure — just a loadable extension on top of better-sqlite3. Stores embeddings alongside relational data in one file. Alex Garcia's project, actively maintained. |
| @modelcontextprotocol/sdk | ~1.x | MCP server | Official Anthropic SDK for building MCP servers. Required for Claude Code integration — the core value prop. |
| commander | ~12.x | CLI framework | Battle-tested, zero-config, good TypeScript support. Simpler than yargs for this use case. |

### Embedding Strategy

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| OpenAI API (text-embedding-3-small) | API | Primary embeddings | Best quality-per-token for code. 1536 dimensions. ~$0.02/1M tokens — indexing 50 repos costs pennies. Hackathon timeline means don't fight local model setup. |
| @xenova/transformers (fallback) | ~2.x | Offline embeddings | Runs ONNX models in Node.js. Use `all-MiniLM-L6-v2` or `nomic-embed-text-v1.5` for offline mode. Slower but zero API dependency. |

**Key decision: API embeddings for MVP.** Local embedding models (Ollama, transformers.js) add 30+ minutes of setup time and produce lower quality embeddings for code. For a hackathon with ~50 repos, the API cost is negligible (<$0.10 total). Add offline fallback in a later phase.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| glob / fast-glob | ~3.x / ~5.x | File discovery | Scanning repos for proto files, schemas, configs |
| simple-git | ~3.x | Git operations | Incremental indexing via `git diff --name-only` since last indexed commit |
| tree-sitter / @tree-sitter/node | ~0.x | AST parsing | Extracting function signatures, module exports, type definitions from code |
| zod | ~3.x | Schema validation | Validating CLI input, config files, stored knowledge entries |
| tiktoken | ~1.x | Token counting | Chunking documents to fit embedding model context windows |
| chalk | ~5.x | CLI output | Colored terminal output for search results, progress |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsx | Run TypeScript directly | No build step during development. `tsx watch` for dev mode. |
| tsup | Bundle for distribution | Single-file output for CLI binary. ESM output. |
| vitest | Testing | Fast, TypeScript-native, good for unit testing extractors |
| eslint + prettier | Linting/formatting | Standard |

## Installation

```bash
# Core
npm install better-sqlite3 sqlite-vec @modelcontextprotocol/sdk commander openai zod

# File/Git operations
npm install fast-glob simple-git chalk

# Optional: local embeddings
npm install @xenova/transformers

# Optional: code parsing
npm install tree-sitter tree-sitter-typescript tree-sitter-elixir tree-sitter-protobuf

# Dev dependencies
npm install -D typescript tsx tsup vitest @types/better-sqlite3 @types/node
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Vector DB | sqlite-vec | ChromaDB | ChromaDB requires a separate server process. Overkill for ~50 repos. sqlite-vec keeps everything in one SQLite file — zero infra, trivially debuggable with any SQLite client. |
| Vector DB | sqlite-vec | LanceDB | LanceDB is impressive but adds a dependency on Apache Arrow/Lance format. sqlite-vec integrates natively with the SQLite we already need for relational metadata. One fewer moving part. |
| Vector DB | sqlite-vec | pgvector | Requires PostgreSQL. Violates the "zero infrastructure" constraint. |
| Embeddings | OpenAI API | Ollama + nomic-embed | Adds 30min+ setup (install Ollama, pull model, configure). Lower code embedding quality. Not worth it for hackathon MVP. Good Phase 2 addition. |
| Embeddings | OpenAI API | Voyage AI | Better code embeddings than OpenAI arguably, but another API key to manage. OpenAI key is likely already available. |
| Embeddings | OpenAI API | @huggingface/transformers | Successor to @xenova/transformers. Still maturing for Node.js. ONNX model download is 100MB+. Fine for fallback, not for primary path. |
| CLI | commander | yargs | Yargs is more powerful but more complex. Commander's simplicity wins for a hackathon tool with ~5 commands. |
| CLI | commander | oclif | Enterprise CLI framework. Way too much scaffolding for this project. |
| SQLite driver | better-sqlite3 | node:sqlite (built-in) | Node 22.5+ has built-in SQLite but it's still experimental and sqlite-vec compatibility is unverified. better-sqlite3 is proven. |
| Git | simple-git | isomorphic-git | isomorphic-git is pure JS but slower for operations we need. simple-git wraps native git which is already on the machine. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| ChromaDB | Separate server process, Python-native, overkill for this scale | sqlite-vec |
| Pinecone/Weaviate/Qdrant | Cloud vector DBs. Violates local-only constraint. | sqlite-vec |
| LangChain | Massive abstraction layer for simple embedding + search. Adds 50+ transitive deps. You don't need chains, agents, or retrievers — just embed and query. | Direct OpenAI SDK + sqlite-vec |
| Prisma/Drizzle | ORM overhead for ~5 tables. Raw better-sqlite3 queries are simpler and faster for this use case. | better-sqlite3 directly |
| Express/Fastify | No HTTP server needed. MCP uses stdio transport. CLI is direct. | @modelcontextprotocol/sdk handles transport |
| node-fetch/axios | Node 18+ has native fetch. OpenAI SDK handles its own HTTP. | Built-in fetch / OpenAI SDK |

## Stack Patterns

**For the MCP server:**
- Use stdio transport (not SSE). Claude Code communicates with MCP servers via stdin/stdout.
- The MCP server and CLI can share the same core library — the MCP server is just a thin wrapper exposing search/index functions as MCP tools.

**For embedding chunking:**
- Chunk code files by logical boundaries (functions, classes, modules) not arbitrary character limits.
- Store chunk metadata (file path, line range, repo name) alongside the vector for result context.
- Use tiktoken to ensure chunks fit within embedding model's context window (8191 tokens for text-embedding-3-small).

**For SQLite schema:**
- One DB file at a known path (e.g., `~/.repo-knowledge-base/index.db`).
- Tables: `repos`, `documents` (chunks), `embeddings` (vectors via sqlite-vec virtual table), `knowledge` (manual entries), `events` (extracted event relationships).
- sqlite-vec creates a virtual table that you JOIN against your documents table.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| sqlite-vec | better-sqlite3 | sqlite-vec loads as an extension via `db.loadExtension()`. Verify the sqlite-vec npm package includes prebuilt binaries for your platform (macOS arm64). |
| @modelcontextprotocol/sdk | Node 18+ | Uses modern JS features. Requires ESM or bundler. |
| @xenova/transformers | Node 18+ | Downloads ONNX models on first use (~100-400MB). Cache at a known location. |
| tree-sitter | Node 18+ | Native addon, needs node-gyp build tools. May require `python3` on path. |

## Confidence Notes

| Component | Confidence | Rationale |
|-----------|------------|-----------|
| better-sqlite3 + sqlite-vec | MEDIUM | sqlite-vec is the right approach but version numbers and exact API may have changed. Verify `npm view sqlite-vec` before installing. |
| @modelcontextprotocol/sdk | MEDIUM | MCP SDK is actively evolving. API surface may have changed. Check current docs at modelcontextprotocol.io before implementing. |
| OpenAI text-embedding-3-small | HIGH | Stable, widely used, well-documented. Pricing and dimensions are established. |
| commander | HIGH | Extremely stable, rarely has breaking changes. |
| tree-sitter | MEDIUM | Node.js bindings have had stability issues. May need to use web-tree-sitter (WASM) instead of native bindings if build fails. |
| @xenova/transformers | MEDIUM | Package may have been superseded by @huggingface/transformers. Check npm before installing. |

## Sources

- Training data (May 2025 cutoff) — all recommendations based on pre-cutoff knowledge
- sqlite-vec: https://github.com/asg017/sqlite-vec — Alex Garcia's vector extension for SQLite
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- OpenAI embeddings: https://platform.openai.com/docs/guides/embeddings
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3

**NOTE:** Versions marked above are approximate. WebSearch, WebFetch, and Bash were all unavailable during this research session. Run `npm view <package> version` to verify current versions before installing.

---
*Stack research for: local codebase knowledge base with semantic search*
*Researched: 2026-03-05*
