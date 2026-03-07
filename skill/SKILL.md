---
name: kb
description: Query the repo knowledge base — search across all indexed microservices, find dependencies, look up modules and events. Use when you need to understand the codebase architecture or find which service handles something.
argument-hint: <search query or command>
allowed-tools: Bash(kb:*)
---

# Repository Knowledge Base

Query a persistent knowledge base that indexes all microservice repos. Use this to find services, modules, events, dependencies, and learned facts without re-scanning repos.

## Arguments

`$ARGUMENTS` is interpreted as follows:

- **A search query** (default): `booking cancellation`, `PaymentProcessed`, `checkout flow`
- **`deps <name>`**: Show service dependencies — `deps app-auth`, `deps payments-service`
- **`entity <name>`**: Structured entity card — `entity BookingCreated`, `entity ShedulAPI.Calendar.Booking`
- **`learn <fact>`**: Teach a new fact — `learn "payments owns billing" --repo payments-service`
- **`status`**: Show database stats
- **`index`**: Re-index all repos (use `index --force` to force full re-index)

## Execution

Parse `$ARGUMENTS` and run the appropriate `kb` command:

### Search (default)
```bash
kb search "$ARGUMENTS"
```

If results seem too broad, try adding `--repo <name>` or `--type module|event`.
For granular filtering, use sub-types: `--type schema`, `--type grpc`, `--type graphql_query`.
To discover available types: `kb search --list-types`.

### Dependencies
```bash
kb deps "<entity_name>"
```

### Entity lookup
```bash
kb search "$ENTITY_NAME" --entity
```

### Learn
```bash
kb learn "$FACT_TEXT" [--repo <name>]
```

### Status
```bash
kb status
```

## Interpreting results

All output is JSON. Key fields:

**Search results** — array of matches:
- `entityType`: module, event, learned_fact
- `name`: entity name
- `repoName`: which repo it belongs to
- `filePath`: file where it was found
- `snippet`: description or content

**Entity cards** — structured info:
- `name`, `type`, `repoName`, `filePath`, `description`
- `relationships[]`: incoming/outgoing edges with direction, type, target

**Dependencies** — graph neighbors:
- `entity`: the queried service
- `dependencies[]`: connected services with mechanism (Kafka, etc.) and path

## When to use this skill

- "Which service handles X?" → `kb search "X"`
- "What does service Y depend on?" → `kb deps Y`
- "What is BookingCreated?" → `kb search "BookingCreated" --entity`
- "What modules exist for billing?" → `kb search "billing" --type module`
- "Remember that X does Y" → `kb learn "X does Y" --repo X`

## Prerequisites

The `kb` CLI must be built and linked:
```bash
cd ~/Documents/Repos/repo-knowledge-base && npm run build && npm link
```

Database must be indexed at least once:
```bash
kb index --root ~/Documents/Repos
```
