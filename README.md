# repo-knowledge-base

Persistent knowledge base that indexes your entire microservice ecosystem so AI agents can instantly query architecture, service relationships, event flows, and module responsibilities — without re-scanning repos every session.

## What it does

- **Indexes** all repos under a root directory, extracting Elixir modules, proto definitions, and Kafka event relationships
- **Searches** across all indexed content with full-text search (FTS5) and structured entity queries
- **Maps dependencies** between services via shared events (produces/consumes)
- **Learns** facts you teach it manually, persistently stored alongside indexed data
- **Incremental** — only re-indexes repos with new commits since last scan

## Quick start

```bash
# Install
npm install
npm run build
npm link          # makes `kb` available globally

# Index your repos (first run takes a few minutes)
kb index --root ~/Documents/Repos

# Search
kb search "booking cancellation"
kb search "BookingCreated" --entity
kb deps app-auth

# Teach it
kb learn "payments-service owns the billing domain" --repo payments-service
```

## Stats (real-world)

| Metric | Value |
|--------|-------|
| Repos indexed | 400 |
| Elixir modules | 111,000+ |
| Events/protos | 7,300+ |
| Cross-service deps | 16 linked event chains |
| Learned facts | unlimited |

## Commands

All output is JSON. Designed for AI agent consumption, not human reading.

| Command | Description |
|---------|-------------|
| `kb index` | Scan and index repos. `--root`, `--force` |
| `kb search <query>` | Full-text search. `--entity`, `--repo`, `--type`, `--limit` |
| `kb deps <name>` | Service dependency graph (direct neighbors). `--direction` |
| `kb learn <text>` | Store a fact. `--repo` to associate with a service |
| `kb learned` | List learned facts. `--repo` to filter |
| `kb forget <id>` | Delete a learned fact |
| `kb status` | Database statistics |
| `kb docs` | Full command documentation |

## How it works

### Indexing pipeline

1. **Scanner** discovers git repos with project files (`mix.exs`, `package.json`, etc.)
2. **Metadata extractor** pulls repo name, description, tech stack from README/CLAUDE.md
3. **Elixir extractor** parses `defmodule`, `@moduledoc`, public functions, Ecto schemas
4. **Proto extractor** parses `.proto` files for messages, fields, services, RPCs
5. **Event detector** identifies Kafka relationships:
   - **Producers**: repos that define proto messages
   - **Consumers**: repos using `Kafkaesque.Consumer` with `handle_decoded_message`, topic configs, decoder schemas
6. **Writer** persists everything to SQLite with FTS5 indexing

### Search

- **Text search**: FTS5 with CamelCase/snake_case tokenizer — `"booking"` matches `BookingCreated`, `booking_service`
- **Entity search**: Structured cards with relationships — find a module/event and see what connects to it
- **Dependency query**: BFS graph traversal over edges — "what does this service depend on?"

### Storage

Single SQLite file at `~/.kb/knowledge.db` (override with `KB_DB_PATH` env var). Uses WAL mode, FTS5 virtual tables, and a generic edges table for the relationship graph.

## Using with Claude Code

See [CLAUDE.md](CLAUDE.md) for setup instructions, or install the `kb` skill for automatic integration.

## Architecture

```
src/
  db/          # SQLite database, schema, migrations, FTS5, tokenizer
  indexer/     # Scanner, metadata, elixir, proto, events extractors, pipeline
  search/      # Text search, entity queries, dependency traversal
  knowledge/   # Learned facts store
  cli/         # Commander.js CLI with all subcommands
```

## Development

```bash
npm test          # Run 197 tests
npm run build     # Compile TypeScript
npm test -- --watch  # Watch mode
```

## Limitations

- Event dependency graph links are based on shared event names between producers and consumers. Many events use different naming conventions (proto message name vs Kafka topic name vs Elixir module alias), so not all cross-service dependencies are detected yet.
- Only extracts from Elixir, proto, and Kafkaesque patterns. No GraphQL, gRPC service, or Ecto schema extraction yet.
- No semantic/embedding search — relies on FTS5 keyword matching.
