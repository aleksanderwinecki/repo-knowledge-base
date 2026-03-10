# repo-knowledge-base

Persistent knowledge base that indexes your entire microservice ecosystem so AI agents can instantly query architecture, service relationships, event flows, and module responsibilities — without re-scanning repos every session.

## What it does

- **Indexes** all repos under a root directory, extracting Elixir modules, Ecto schemas, GraphQL types, proto definitions, gRPC services, and Kafka events
- **Searches** across all indexed content with full-text search (FTS5) and structured entity queries
- **Maps dependencies** between services via gRPC calls, HTTP clients, gateway routing, Kafka topics, and shared events
- **Learns** facts you teach it manually, persistently stored alongside indexed data
- **Incremental** — only re-indexes repos with new commits since last scan
- **Targeted** — reindex specific repos with optional git refresh to pull latest code

## Quick start

```bash
# Build
npm install && npm run build && npm link

# Index your repos (first run takes a few minutes)
kb index --root ~/Documents/Repos

# Add to Claude Code as MCP server (recommended)
claude mcp add kb -- node /path/to/repo-knowledge-base/dist/mcp/server.js
```

> **nvm users**: Claude Code doesn't load nvm's PATH, so use absolute paths:
> `claude mcp add kb -- /path/to/.nvm/versions/node/vX.Y.Z/bin/node /path/to/repo-knowledge-base/dist/mcp/server.js`

Once connected, Claude Code can call `kb_search`, `kb_deps`, `kb_explain`, etc. directly — no CLI piping needed.

## Stats (real-world)

| Metric | Value |
|--------|-------|
| Repos indexed | 400 |
| Modules | 125,000+ |
| Events/protos | 8,400+ |
| Services | 127 |
| Topology edges | 11,700+ |
| Learned facts | unlimited |

## Commands

All output is JSON. Designed for AI agent consumption, not human reading.

| Command | Description |
|---------|-------------|
| `kb index` | Scan and index repos. `--root`, `--force`, `--repo <names...>`, `--refresh` |
| `kb search <query>` | Full-text search (FTS5). `--entity`, `--repo`, `--type`, `--limit`, `--list-types` |
| `kb deps <name>` | Service dependency graph. `--direction`, `--mechanism <grpc\|http\|gateway\|kafka\|event>` |
| `kb impact <name>` | Blast radius analysis — what breaks if this service changes. `--mechanism`, `--depth` |
| `kb trace <from> <to>` | Shortest path between two services with per-hop mechanism labels |
| `kb explain <name>` | Structured service overview card — identity, connections, events, modules, next-step hints |
| `kb learn <text>` | Store a fact. `--repo` to associate with a service |
| `kb learned` | List learned facts. `--repo` to filter |
| `kb forget <id>` | Delete a learned fact |
| `kb status` | Database statistics |
| `kb docs` | Full command documentation |

## How it works

### Indexing pipeline

1. **Scanner** discovers git repos with project files (`mix.exs`, `package.json`, etc.)
2. **Metadata extractor** pulls repo name, description, tech stack from README/CLAUDE.md
3. **Elixir extractor** parses `defmodule`, `@moduledoc`, public functions, Ecto schemas, GraphQL types/queries
4. **Proto extractor** parses `.proto` files for messages, fields, services, RPCs
5. **Topology extractors** detect service-to-service communication:
   - **gRPC**: client stubs calling remote proto services
   - **HTTP**: Tesla/HTTPoison base_url patterns
   - **Gateway**: routing config linking gateways to upstream services
   - **Kafka**: producer/consumer topic matching
6. **Writer** persists everything to SQLite with FTS5 indexing

### Search

- **Text search**: FTS5 with CamelCase/snake_case tokenizer — `"booking"` matches `BookingCreated`, `booking_service`
- **Entity search**: Structured cards with relationships — find a module/event and see what connects to it
- **Dependency query**: Topology graph traversal over gRPC, HTTP, gateway, Kafka, and event edges with mechanism filtering
- **Impact analysis**: Blast radius — what breaks if a service changes, with depth-grouped severity tiers
- **Flow tracing**: Shortest path between any two services with per-hop mechanism labels
- **Service explanation**: Structured overview cards with connections, events, modules, and agent hints

### Storage

Single SQLite file at `~/.kb/knowledge.db` (override with `KB_DB_PATH` env var). Uses WAL mode, FTS5 virtual tables, and a generic edges table for the topology graph.

## MCP Server (recommended)

The knowledge base ships as an MCP server — the primary way to integrate with Claude Code. Tools are called directly, no shell overhead, structured I/O, and auto-sync for stale repos.

### Setup

```bash
# Build (if you haven't already)
npm install && npm run build && npm link

# Add to Claude Code
claude mcp add kb -- node /absolute/path/to/repo-knowledge-base/dist/mcp/server.js

# Verify
claude mcp get kb
```

> **nvm users**: Claude Code spawns MCP servers outside your shell, so nvm's PATH isn't available. Use the absolute path to node:
> ```bash
> claude mcp add kb -- ~/.nvm/versions/node/v22.20.0/bin/node ~/Documents/Repos/repo-knowledge-base/dist/mcp/server.js
> ```

Restart Claude Code after adding. Use `/mcp` inside a session to verify the server is connected.

### Scopes

- **Local** (default): Available to you in the current project only
- **User** (`--scope user`): Available across all projects
- **Project** (`--scope project`): Stored in `.mcp.json`, shared via version control

### Custom database path

```bash
claude mcp add kb --env KB_DB_PATH=/path/to/knowledge.db -- node /path/to/dist/mcp/server.js
```

### Available tools

| Tool | Description |
|------|-------------|
| `kb_search` | Full-text search across all indexed repos, modules, events, and learned facts |
| `kb_entity` | Structured entity card with relationships by name |
| `kb_deps` | Service dependency graph with mechanism filtering (gRPC, HTTP, Kafka, etc.) |
| `kb_list_types` | List available entity types with counts for filtering |
| `kb_reindex` | Reindex specific repos with optional git refresh to pull latest code |
| `kb_learn` | Store a new fact for future reference |
| `kb_forget` | Delete a learned fact by ID |
| `kb_status` | Database statistics: entity counts, repo staleness, learned facts |
| `kb_cleanup` | Detect deleted repos and stale facts (dry run by default) |
| `kb_impact` | Blast radius analysis: what services break if this service changes |
| `kb_trace` | Shortest path between two services with mechanism labels per hop |
| `kb_explain` | Structured service overview card with connections, events, modules, and hints |

Read tools (`kb_search`, `kb_entity`, `kb_deps`, `kb_impact`, `kb_trace`, `kb_explain`) auto-sync stale repos before returning results. Responses are capped at 4KB per MCP protocol limits.

## CLI (alternative)

The `kb` CLI is available as a fallback when MCP isn't configured, or for manual use in the terminal.

```bash
kb search "booking cancellation"
kb deps app-auth --mechanism grpc
kb explain app-appointments
kb learn "payments owns billing" --repo app-payments
```

See [CLAUDE.md](CLAUDE.md) for full command reference. You can also install the `/kb` skill for Claude Code CLI integration:

```bash
cp -r /path/to/repo-knowledge-base/skill ~/.claude/skills/kb
```

## Architecture

```
src/
  db/          # SQLite database, schema, migrations, FTS5, tokenizer
  indexer/     # Scanner, metadata, elixir, proto, topology extractors, pipeline
  search/      # Text search, entity queries, dependency traversal
  knowledge/   # Learned facts store
  cli/         # Commander.js CLI with all subcommands
  mcp/         # MCP server, 12 tool handlers, auto-sync, formatting, hygiene
```

## Development

```bash
npm test          # Run 672 tests
npm run build     # Compile TypeScript
npm test -- --watch  # Watch mode
```

## Limitations

- Topology extraction uses regex patterns, not AST parsing. Most gRPC/HTTP/Kafka patterns are caught, but unusual client wrappers may be missed.
