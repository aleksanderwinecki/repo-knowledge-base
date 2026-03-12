# repo-knowledge-base

### Stop re-explaining Fresha's architecture to Claude every session.

kb indexes all 423 repos into a single SQLite file. Any Claude Code session — yours, a teammate's, a new joiner's — gets instant answers about service topology, event flows, data contracts, and blast radius. No re-scanning. No re-grepping. No "let me look that up."

---

## The problem

Every time you open a new Claude Code session and ask an architectural question, the AI starts from zero. It greps repos, reads protos, follows imports — re-discovering what it figured out last week.

Here's what that looks like on the Fresha codebase. Same question, two approaches, measured:

> **"How does resource capacity work? Which services own it, how does it flow, and how does the availability engine use it?"**

<table>
<tr>
<th>Without kb</th>
<th>With kb</th>
</tr>
<tr>
<td>

```
→ Glob app-resources/lib/**/*.ex
→ Grep "capacity" across schemas, protos
→ Read Resources.Schemas.Resource migration
→ Read proto definitions
→ Grep for Kafka consumers in app-availability
→ Read ResourcesTimelinesManager.MessagesHandler
→ Read ResourceCapacity sweep-line algorithm
→ Grep app-shedul-umbrella
→ Check event catalog
... (40 tool calls across 4 repos)
```

</td>
<td>

```
kb_field_impact("capacity")
kb_explain("app-resources")
kb_explain("app-availability")
kb_search("ResourceCapacity")
```

</td>
</tr>
<tr>
<td>

| | |
|---|---|
| Tool calls | **40** |
| Tokens | **101,855** |
| Time | **~10 min** |
| Repos covered | **4 of 423** |

</td>
<td>

| | |
|---|---|
| Tool calls | **17** |
| Tokens | **34,735** |
| Time | **95 seconds** |
| Repos covered | **all 423** |

</td>
</tr>
</table>

**2.4× fewer tool calls. 3× fewer tokens. 6× faster. Full codebase coverage vs 4 repos.**

And that's just session one. The second time someone asks about resource capacity — a new teammate, a different project, next week — kb answers from the index. The manual approach starts over every time.

### Why not just write a CLAUDE.md per repo?

You could. The problem is that cross-service questions can't be answered from a single file.

`app-resources`'s CLAUDE.md can describe `app-resources`. It can't tell you what `app-availability` does with its events, or what breaks if you change a shared proto field. Those answers live in other repos — and you'd need to load all of them.

You'd also need to maintain 423 files. When a new consumer appears, who updates `app-resources`'s CLAUDE.md? In practice: no one. kb re-discovers topology from code on every index run.

CLAUDE.md is great for human onboarding. kb is the queryable graph that makes cross-service AI questions fast.

---

## What it looks like

All commands work via CLI (`kb <command>`) or as MCP tools in Claude Code (`kb_<tool>`).

### "What does app-resources talk to?"

```bash
$ kb explain app-resources
```

```json
{
  "name": "app-resources",
  "summary": "Talks to 6 services (4 via grpc, 2 via kafka). Called by 3 services.",
  "talks_to": {
    "grpc": ["app-appointments", "app-resources-review", "app-shedul-umbrella", "app-waitlists"],
    "kafka": ["app-availability", "app-availability-review"]
  },
  "called_by": {
    "gateway": ["app-partners-api-gateway"],
    "grpc": ["app-receptionist", "app-referrals"]
  },
  "hints": [
    "Run kb_impact app-resources to see blast radius",
    "Run kb_deps app-resources to see direct dependencies"
  ]
}
```

### "What breaks if I change app-appointments-manager?"

```bash
$ kb deps app-appointments-manager --mechanism grpc
```

```json
{
  "dependencies": [
    { "name": "app-shedul-umbrella", "mechanism": "gRPC [high]", "depth": 1 },
    { "name": "app-auth",            "mechanism": "gRPC [high]", "depth": 1 },
    { "name": "app-waitlists",       "mechanism": "gRPC [high]", "depth": 1 },
    { "name": "app-appointments",    "mechanism": "gRPC [high]", "depth": 1 }
  ]
}
```

### "Where does this field come from and who reads it?"

```bash
$ kb field-impact capacity
```

```json
{
  "fieldName": "capacity",
  "origins": [
    { "repoName": "app-resources",            "parentName": "Resources.Schemas.Resource", "fieldType": "integer", "nullable": true  },
    { "repoName": "app-partners-api-gateway", "parentName": "Resource",                  "fieldType": "Int!",    "nullable": false }
  ],
  "boundaries": [
    { "repoName": "app-resources", "parentName": "ResourceCreated", "fieldType": "uint32", "nullable": false,
      "topics": ["resources.resource-events-v1"] }
  ],
  "consumers": [
    { "repoName": "app-availability", "confidence": "confirmed",
      "via": { "topic": "resources.resource-events-v1", "event": "CreateResourceRequest" },
      "parentName": "Availability.Schemas.ResourceProjection", "fieldType": "integer", "nullable": true }
  ],
  "summary": "capacity: 11 origins, 8 boundaries, 2 consumers across 5 repos"
}
```

> Notice the nullability shift: `integer nullable` in the Ecto schema → `uint32` non-null at the proto boundary → `integer nullable` again in the consumer's projection. That mismatch is a runtime null-handling bug waiting to happen — and `kb field-impact` surfaces it in seconds.

---

## Getting started

> [!IMPORTANT]
> kb only indexes repos that exist on your local machine. If you've cloned only the services you work on, cross-service queries will have blind spots — consumers and dependencies in repos you haven't checked out won't appear.
>
> To get the full picture, you need all repos checked out locally. The long-term fix is a shared pre-built database refreshed nightly by CI, but that's not built yet. For now: the more repos you have locally, the more complete your results.

### 1. Clone and build

```bash
git clone https://github.com/aleksanderwinecki/repo-knowledge-base.git
cd repo-knowledge-base
npm install && npm run build && npm link
```

`npm link` makes the `kb` command available globally.

### 2. Index your repos

```bash
kb index --root ~/Documents/Repos
```

The first run scans everything and builds the SQLite database at `~/.kb/knowledge.db`. On a 400+ repo codebase this takes around 8 minutes. Subsequent runs are incremental — only repos with new commits since the last scan are re-indexed.

### 3. Add to Claude Code as an MCP server

```bash
claude mcp add kb -- node /absolute/path/to/repo-knowledge-base/dist/mcp/server.js
```

> **nvm users**: Claude Code spawns MCP servers outside your shell, so nvm's PATH isn't available. Use the absolute path to node:
> ```bash
> claude mcp add kb -- ~/.nvm/versions/node/v22.20.0/bin/node ~/path/to/repo-knowledge-base/dist/mcp/server.js
> ```

Restart Claude Code after adding. Run `/mcp` inside a session to confirm the server is connected.

### 4. Verify

```bash
kb status
```

Should show repo, module, event, and edge counts. If the numbers look right, you're done.

---

## Reference

### Commands

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

### MCP tools

Available in Claude Code once the MCP server is connected. Read tools auto-sync stale repos before returning results. Responses are capped at 4KB.

| Tool | Description |
|------|-------------|
| `kb_search` | Full-text search across all indexed repos, modules, events, and learned facts |
| `kb_entity` | Entity card with relationships by name |
| `kb_explain` | Service overview card with connections, events, modules, and hints |
| `kb_deps` | Service dependency graph with mechanism filtering (gRPC, HTTP, Kafka, etc.) |
| `kb_impact` | Blast radius: what services break if this service changes |
| `kb_trace` | Shortest path between two services with mechanism labels per hop |
| `kb_field_impact` | Trace a field across service boundaries — origins, proto/Kafka boundaries, consumers with confidence tiers, nullability |
| `kb_list_types` | List available entity types with counts for filtering |
| `kb_reindex` | Reindex specific repos with optional git refresh |
| `kb_learn` | Store a fact |
| `kb_forget` | Delete a fact by ID |
| `kb_status` | Database statistics: entity counts, repo staleness, learned facts |
| `kb_cleanup` | Detect deleted repos and stale facts (dry run by default) |

### MCP scopes

- **Local** (default): Available in the current project only
- **User** (`--scope user`): Available across all projects
- **Project** (`--scope project`): Stored in `.mcp.json`, shared via version control

### Custom database path

```bash
claude mcp add kb --env KB_DB_PATH=/path/to/knowledge.db -- node /path/to/dist/mcp/server.js
```

### CLI skill for Claude Code

```bash
cp -r /path/to/repo-knowledge-base/skill ~/.claude/skills/kb
```

See [CLAUDE.md](CLAUDE.md) for the full CLI reference.

---

## How it works

<details>
<summary>Indexing pipeline</summary>

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

</details>

<details>
<summary>Search</summary>

- **Text search**: FTS5 with CamelCase/snake_case tokenizer — `"booking"` matches `BookingCreated`, `booking_service`
- **Entity search**: cards with relationships — find a module/event and see what connects to it
- **Dependency query**: graph traversal over gRPC, HTTP, gateway, Kafka, and event edges with mechanism filtering
- **Impact analysis**: what breaks if a service changes, grouped by depth tier
- **Flow tracing**: shortest path between any two services with per-hop mechanism labels
- **Service explanation**: overview cards with connections, events, modules, and agent hints
- **Field impact**: trace a field from origin schemas through proto/event boundaries to consuming services with nullability and consumer confidence (inferred via topic subscription, confirmed via local field match)

</details>

<details>
<summary>Storage</summary>

Single SQLite file at `~/.kb/knowledge.db` (override with `KB_DB_PATH` env var). WAL mode, FTS5 virtual tables, generic edges table for the topology graph.

</details>

---

## Development

```bash
npm test          # Run 863 tests
npm run build     # Compile TypeScript
npm test -- --watch  # Watch mode
```

### Architecture

```
src/
  db/          # SQLite database, schema, migrations, FTS5, tokenizer
  indexer/     # Scanner, metadata, elixir, proto, topology extractors, pipeline
  search/      # Text search, entity queries, dependency traversal
  knowledge/   # Learned facts store
  cli/         # Commander.js CLI with all subcommands
  mcp/         # MCP server, 13 tool handlers, auto-sync, formatting, hygiene
```

## Limitations

- Topology extraction uses regex patterns, not AST parsing. Most gRPC/HTTP/Kafka patterns are caught, but unusual client wrappers may be missed.
