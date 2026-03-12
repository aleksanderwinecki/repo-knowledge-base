# repo-knowledge-base

> Index your microservice repos once. Any Claude Code session gets instant architectural answers from the cached index — no re-scanning on every conversation.

Indexes 400+ repos into a single SQLite file. When repos change, an incremental re-index picks up only what's new (full index of 400+ repos takes ~8 minutes; incremental runs in seconds per changed repo). Between re-indexes, any AI agent queries service topology, event flows, field-level data contracts, and blast radius in under 2 seconds.

## The problem

Every time you open a new Claude Code session and ask an architectural question, the AI starts from zero. It greps repos, reads protos, follows imports — re-discovering what it figured out last week.

We ran a benchmark on a 423-repo codebase. Same question, two approaches, measured everything.

**"How does resource capacity work? Which services own it, how does it flow, and how does the availability engine use it?"**

---

### Without kb — manual repo exploration

```
→ Glob app-resources/lib/**/*.ex
→ Grep "capacity" across schemas, changesets, protos
→ Read Resources.Schemas.Resource migration to find DB constraints
→ Read proto definitions (ResourceCreated, ResourceUpdated)
→ Grep for Kafka consumers across app-availability
→ Read ResourcesTimelinesManager.MessagesHandler
→ Read ResourceCapacity sweep-line algorithm
→ Grep app-shedul-umbrella for capacity handling
→ Check event catalog for remaining consumers
... (40 tool calls across 4 repos)
```

| Metric | Without kb |
|--------|-----------|
| Tool calls | **40** |
| Tokens used | **101,855** |
| Time | **~10 minutes** |
| Repos covered | **4** (of 423) |
| Gaps remaining | 3 known unknowns |

---

### With kb — knowledge base query

```
kb_field_impact("capacity")        → origins, proto boundaries, consumers with confidence tiers
kb_explain("app-resources")        → service overview, connections, events
kb_explain("app-availability")     → how it uses capacity in scheduling
kb_search("ResourceCapacity")      → sweep-line algorithm module
```

| Metric | With kb |
|--------|---------|
| Tool calls | **17** |
| Tokens used | **34,735** |
| Time | **~95 seconds** |
| Repos covered | **423** (full index) |
| Gaps remaining | 4 noted edge cases |

---

**2.4× fewer tool calls. 3× fewer tokens. 6× faster.**

And that's just session one. The second time someone asks about resource capacity — a new teammate, a different project, next week — kb answers from the index. The manual approach starts over every time.

## What it does

- **Indexes** all repos under a root directory: Elixir modules, Ecto schemas, GraphQL types, proto definitions, gRPC services, Kafka events, and field-level data with nullability
- **Searches** with FTS5 full-text search, entity queries, and field search across all schemas/protos/GraphQL types
- **Maps dependencies** between services via gRPC calls, HTTP clients, gateway routing, Kafka topics, and shared events
- **Learns** facts you add manually, stored alongside indexed data
- **Incremental** — only re-indexes repos with new commits since last scan
- **Targeted** — reindex specific repos with optional git refresh

## Quick start

```bash
# Build
npm install && npm run build && npm link

# Index your repos (~8 min for 400+ repos; incremental runs are much faster)
kb index --root ~/Documents/Repos

# Add to Claude Code as MCP server (recommended)
claude mcp add kb -- node /path/to/repo-knowledge-base/dist/mcp/server.js
```

> **nvm users**: Claude Code doesn't load nvm's PATH, so use absolute paths:
> `claude mcp add kb -- /path/to/.nvm/versions/node/vX.Y.Z/bin/node /path/to/repo-knowledge-base/dist/mcp/server.js`

Once connected, Claude Code calls `kb_search`, `kb_deps`, `kb_explain`, etc. directly — no CLI piping needed.

## Stats

Run `kb status` to see current counts (repos, modules, events, services, topology edges, fields, learned facts). Counts depend on what's checked out under your repos root.

## Commands

All output is JSON.

| Command | Description |
|---------|-------------|
| `kb index` | Scan and index repos. `--root`, `--force`, `--repo <names...>`, `--refresh` |
| `kb search <query>` | Full-text search (FTS5). `--entity`, `--repo`, `--type`, `--limit`, `--list-types` |
| `kb deps <name>` | Service dependency graph. `--direction`, `--mechanism <grpc\|http\|gateway\|kafka\|event>` |
| `kb impact <name>` | Blast radius — what breaks if this service changes. `--mechanism`, `--depth` |
| `kb trace <from> <to>` | Shortest path between two services with per-hop mechanism labels |
| `kb explain <name>` | Service overview card — identity, connections, events, modules, next-step hints |
| `kb field-impact <field>` | Trace a field across service boundaries — origins, proto/Kafka boundaries, consumers with confidence tiers, nullability |
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
6. **Field extractor** parses individual fields from Ecto schemas, proto messages, and GraphQL types with nullability metadata
7. **Writer** persists everything to SQLite with FTS5 indexing

### Search

- **Text search**: FTS5 with CamelCase/snake_case tokenizer — `"booking"` matches `BookingCreated`, `booking_service`
- **Entity search**: cards with relationships — find a module/event and see what connects to it
- **Dependency query**: graph traversal over gRPC, HTTP, gateway, Kafka, and event edges with mechanism filtering
- **Impact analysis**: what breaks if a service changes, grouped by depth tier
- **Flow tracing**: shortest path between any two services with per-hop mechanism labels
- **Service explanation**: overview cards with connections, events, modules, and agent hints
- **Field impact**: trace a field from origin schemas through proto/event boundaries to consuming services with nullability and consumer confidence (inferred via topic subscription, confirmed via local field match)

### Storage

Single SQLite file at `~/.kb/knowledge.db` (override with `KB_DB_PATH` env var). WAL mode, FTS5 virtual tables, generic edges table for the topology graph.

## MCP Server (recommended)

The MCP server is the primary way to use kb with Claude Code. Tools are called directly — no shell overhead, structured I/O, auto-sync for stale repos.

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

- **Local** (default): Available in the current project only
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
| `kb_entity` | Entity card with relationships by name |
| `kb_deps` | Service dependency graph with mechanism filtering (gRPC, HTTP, Kafka, etc.) |
| `kb_list_types` | List available entity types with counts for filtering |
| `kb_reindex` | Reindex specific repos with optional git refresh |
| `kb_learn` | Store a fact |
| `kb_forget` | Delete a fact by ID |
| `kb_status` | Database statistics: entity counts, repo staleness, learned facts |
| `kb_cleanup` | Detect deleted repos and stale facts (dry run by default) |
| `kb_impact` | Blast radius: what services break if this service changes |
| `kb_trace` | Shortest path between two services with mechanism labels per hop |
| `kb_explain` | Service overview card with connections, events, modules, and hints |
| `kb_field_impact` | Trace a field across service boundaries — origins, proto/Kafka boundaries, consumers with confidence tiers, nullability |

Read tools (`kb_search`, `kb_entity`, `kb_deps`, `kb_impact`, `kb_trace`, `kb_explain`, `kb_field_impact`) auto-sync stale repos before returning results. Responses are capped at 4KB.

## CLI (alternative)

The `kb` CLI works when MCP isn't configured, or for manual use in the terminal.

```bash
kb search "booking cancellation"
kb deps app-auth --mechanism grpc
kb explain app-appointments
kb learn "payments owns billing" --repo app-payments
```

See [CLAUDE.md](CLAUDE.md) for the full command reference. You can also install the `/kb` skill for Claude Code CLI integration:

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
  mcp/         # MCP server, 13 tool handlers, auto-sync, formatting, hygiene
```

## Development

```bash
npm test          # Run 863 tests
npm run build     # Compile TypeScript
npm test -- --watch  # Watch mode
```

## Limitations

- Topology extraction uses regex patterns, not AST parsing. Most gRPC/HTTP/Kafka patterns are caught, but unusual client wrappers may be missed.
