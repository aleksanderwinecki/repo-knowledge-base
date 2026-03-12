# repo-knowledge-base

Knowledge base that indexes microservice repos and exposes search, dependency queries, and manual fact storage via MCP server and CLI. All output is JSON.

## Setup

```bash
# From repo root
npm install && npm run build && npm link
```

## Using kb with Claude Code

### MCP server (recommended)

The MCP server is the primary integration — Claude Code calls tools directly with structured I/O, no shell overhead.

```bash
# Add to Claude Code (use absolute paths for nvm users)
claude mcp add kb -- node /path/to/repo-knowledge-base/dist/mcp/server.js

# Verify connection
claude mcp get kb
```

Use `/mcp` inside a session to check server status. Available MCP tools:

- `kb_search` — Full-text search across indexed repos
- `kb_entity` — Structured entity card with relationships
- `kb_deps` — Service dependency graph. Filter: `mechanism`, `direction`, `depth`
- `kb_impact` — Blast radius: what breaks if this service changes. Filter: `mechanism`, `depth`
- `kb_trace` — Shortest path between two services with per-hop mechanism labels
- `kb_explain` — Structured service overview card (connections, events, modules, hints)
- `kb_learn` — Store a persistent fact
- `kb_forget` — Delete a fact by ID
- `kb_status` — Database stats
- `kb_list_types` — List available entity types with counts
- `kb_reindex` — Reindex specific repos with optional git refresh
- `kb_cleanup` — Detect deleted repos and stale facts
- `kb_field_impact` — Trace a field name across service boundaries with nullability and consumer confidence (inferred/confirmed via topic subscription chains)

Read tools (`kb_search`, `kb_entity`, `kb_deps`, `kb_impact`, `kb_trace`, `kb_explain`, `kb_field_impact`) auto-sync stale repos before returning results.

### CLI fallback

If MCP isn't configured, the `kb` CLI works directly:

- `kb search "query"` — Full-text search across indexed repos
- `kb search "Name" --entity` — Structured entity card with relationships
- `kb search --list-types` — List available entity types with counts
- `kb deps <repo-name>` — Service dependency graph (direct neighbors)
- `kb deps <repo-name> --mechanism grpc` — Filter by communication type (grpc, http, kafka, event, gateway)
- `kb impact <repo-name>` — Blast radius: what breaks if this service changes. `--mechanism`, `--depth`
- `kb trace <from> <to>` — Shortest path between two services with per-hop mechanism labels
- `kb explain <repo-name>` — Structured service overview card (connections, events, modules, hints)
- `kb learn "fact" --repo name` — Teach a persistent fact
- `kb learned` — List learned facts
- `kb forget <id>` — Delete a fact
- `kb status` — Database stats
- `kb index --force` — Re-index all repos
- `kb index --repo app-foo app-bar` — Re-index specific repos only
- `kb index --repo app-foo --refresh` — Git fetch + reset to latest before indexing
- `kb field-impact "field_name"` — Trace a field across service boundaries with nullability at each hop
- `kb search "field_name" --type field` — Search for fields across all indexed repos

### Skill

Install the `/kb` skill for CLI integration in any Claude Code session:

```bash
cp -r /path/to/repo-knowledge-base/skill ~/.claude/skills/kb
```

## Database location

Default: `~/.kb/knowledge.db`
Override: `KB_DB_PATH=/path/to/db.sqlite`

## Development

- `npm test` — 856 tests
- `npm run build` — compile TypeScript
- Source: `src/` (db, indexer, search, knowledge, cli, mcp)
