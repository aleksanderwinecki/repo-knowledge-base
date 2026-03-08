# repo-knowledge-base

This is a knowledge base CLI tool (`kb`) that indexes microservice repos and exposes search, dependency queries, and manual fact storage. All output is JSON.

## Setup

```bash
# From repo root
npm install && npm run build

# Link globally so `kb` is available everywhere
npm link
```

## Using kb in any Claude Code session

Add this to the project's CLAUDE.md or your global `~/.claude/CLAUDE.md`:

```markdown
## Knowledge Base

The `kb` CLI indexes all repos under ~/Documents/Repos/ into a searchable knowledge base.

Available commands (all output JSON):
- `kb search "query"` — Hybrid FTS5 + semantic search (auto-degrades to FTS-only without embeddings)
- `kb search --semantic "natural language query"` — Pure vector similarity search
- `kb search "Name" --entity` — Structured entity card with relationships
- `kb deps <repo-name>` — Service dependency graph (direct neighbors)
- `kb deps <repo-name> --mechanism grpc` — Filter by communication type (grpc, http, kafka, event, gateway)
- `kb learn "fact" --repo name` — Teach a persistent fact
- `kb learned` — List learned facts
- `kb forget <id>` — Delete a fact
- `kb status` — Database stats
- `kb index --force` — Re-index all repos
- `kb index --embed` — Re-index with vector embedding generation (slower, enables semantic search)

Use `kb search` when you need to find which service handles something, what modules exist for a domain, or how services are connected.
```

## Alternative: install as a skill

Copy the skill directory for automatic Claude Code integration:

```bash
cp -r /path/to/repo-knowledge-base/skill ~/.claude/skills/kb
```

Then use `/kb <query>` in any Claude Code session.

## Database location

Default: `~/.kb/knowledge.db`
Override: `KB_DB_PATH=/path/to/db.sqlite`

## Development

- `npm test` — 548 tests
- `npm run build` — compile TypeScript
- Source: `src/` (db, indexer, search, knowledge, cli)
