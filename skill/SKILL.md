---
name: kb
description: Query the repo knowledge base — search across all indexed microservices, find dependencies, look up modules and events. Use when you need to understand the codebase architecture or find which service handles something.
argument-hint: <search query or command>
allowed-tools: Bash(kb:*)
---

# Repository Knowledge Base

Query a persistent knowledge base that indexes 400+ microservice repos. Use this to find services, modules, events, dependencies, topology edges, and learned facts without re-scanning repos.

## Arguments

`$ARGUMENTS` is interpreted as follows:

- **A search query** (default): `booking cancellation`, `PaymentProcessed`, `checkout flow`
- **`deps <name>`**: Show service dependencies — `deps app-auth`, `deps app-payments`
- **`impact <name>`**: Blast radius — what breaks if this service changes — `impact app-payments`, `impact app-auth --mechanism grpc`
- **`trace <from> <to>`**: Shortest path between services — `trace app-checkout app-notifications`
- **`explain <name>`**: Service overview card — `explain app-appointments`
- **`entity <name>`**: Structured entity card — `entity BookingCreated`, `entity Resources.Schemas.Resource`
- **`learn <fact>`**: Teach a new fact — `learn "payments owns billing" --repo app-payments`
- **`status`**: Show database stats
- **`index --repo <names...>`**: Re-index specific repos — `index --repo app-resources --refresh`
- **`index`**: Re-index all repos (use `index --force` to force full re-index)

## Execution

Parse `$ARGUMENTS` and run the appropriate `kb` command:

### Search (default)
```bash
kb search "$ARGUMENTS"
```

Refine results with:
- `--repo <name>` — filter by repo
- `--type <type>` — filter by type: coarse (`repo`, `module`, `event`, `service`) or sub-type (`schema`, `context`, `graphql_query`, `grpc`, etc.)
- `--entity` — structured entity card with relationships
- `--list-types` — discover available entity types with counts
- `--limit <n>` — max results (default 20)

### Dependencies
```bash
kb deps "<entity_name>"
```

Options:
- `--mechanism <type>` — filter by communication type: `grpc`, `http`, `gateway`, `kafka`, `event`
- `--direction <dir>` — `upstream` (default) or `downstream`

### Impact analysis
```bash
kb impact "<service_name>"
```

Options:
- `--mechanism <type>` — filter by communication type: `grpc`, `http`, `gateway`, `kafka`, `event`
- `--depth <n>` — max traversal depth (default: 3, max: 10)

### Flow tracing
```bash
kb trace "<from_service>" "<to_service>"
```

### Service explanation
```bash
kb explain "<service_name>"
```

### Entity lookup
```bash
kb search "$ENTITY_NAME" --entity
```

### Learn
```bash
kb learn "$FACT_TEXT" [--repo <name>]
```

### Index (targeted)
```bash
kb index --repo <names...> [--refresh] [--force]
```
- `--repo <names...>` — specific repos to reindex (space-separated)
- `--refresh` — git fetch + reset to latest on default branch before indexing
- `--force` — force re-index even if no new commits

### Status
```bash
kb status
```

## Interpreting results

All output is JSON. Key fields:

**Search results** — array of matches:
- `entityType`: module, event, service, repo, learned_fact
- `name`: entity name
- `repoName`: which repo it belongs to
- `filePath`: file where it was found
- `snippet`: description or content

**Entity cards** — structured info:
- `name`, `type`, `repoName`, `filePath`, `description`
- `relationships[]`: incoming/outgoing edges with direction, type, target

**Dependencies** — topology graph:
- `entity`: the queried service
- `dependencies[]`: connected services with `mechanism` (gRPC, HTTP, Kafka, gateway, event), `confidence` (high/medium/low), and `path`

**Impact analysis** — blast radius:
- `service`: queried service name
- `tiers`: `direct`, `indirect`, `transitive` — each with affected services and mechanisms
- `stats`: total affected, blast radius score, mechanism breakdown

**Flow trace** — shortest path:
- `from`, `to`: service names
- `path_summary`: arrow-chain notation (`A -[grpc]-> B -[event: OrderCreated]-> C`)
- `hops[]`: per-hop `from`, `to`, `mechanism`, optional `via`

**Service explanation** — overview card:
- `name`, `description`, `path`: service identity
- `summary`: one-liner ("Talks to 16 services. Called by 14.")
- `talks_to`, `called_by`: connections grouped by mechanism
- `events`: `produces` and `consumes` arrays
- `modules`: counts per type with top 5 names
- `hints`: suggested next commands

## When to use this skill

- "Which service handles X?" → `kb search "X"`
- "What does service Y depend on?" → `kb deps Y`
- "What gRPC services does Y call?" → `kb deps Y --mechanism grpc`
- "What breaks if I change app-payments?" → `kb impact app-payments`
- "How does a request get from checkout to notifications?" → `kb trace app-checkout app-notifications`
- "What does app-appointments do?" → `kb explain app-appointments`
- "What is BookingCreated?" → `kb search "BookingCreated" --entity`
- "What modules exist for billing?" → `kb search "billing" --type module`
- "What GraphQL types exist?" → `kb search --list-types`
- "Remember that X does Y" → `kb learn "X does Y" --repo X`
- "Reindex app-resources with latest code" → `kb index --repo app-resources --refresh`

## Prerequisites

The `kb` CLI must be built and linked:
```bash
cd ~/Documents/Repos/repo-knowledge-base && npm run build && npm link
```

Database must be indexed at least once:
```bash
kb index --root ~/Documents/Repos
```
