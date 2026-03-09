# v3.0 Graph Intelligence — Design

**Date:** 2026-03-09
**Status:** Approved
**Goal:** Three new MCP tools that give AI agents instant answers to the questions they waste the most time researching: blast radius, request flows, and service overviews.

## Philosophy

Pre-computed graph answers via SQLite recursive CTEs. No new dependencies. Every response under 2 seconds. Agent-first design — optimized for MCP consumption, not human reading.

## Decisions

- **SQLite only** — no Neo4j. Graph has ~12K edges across ~400 repos. Recursive CTEs handle this in <50ms. Revisit if we hit a wall.
- **Query router** — new graph commands use recursive CTEs, existing commands stay unchanged. No abstraction layer.
- **Three tools only** — focused milestone. Architecture rules and file watcher deferred to future.

## New Tools

### kb_impact (blast radius)

**Input:** service/repo name, optional `--mechanism` filter, optional `--depth` (default: all)

**Query:** Recursive CTE walks all downstream edges from the service — gRPC callers, Kafka consumers, event subscribers, gateway dependents.

**Output:** Flat list of affected services with mechanism, confidence, and hop distance.

**Agent use case:** "I'm about to change app-payments. What services might break?"

### kb_trace (flow tracing)

**Input:** two service/repo names

**Query:** Shortest path between them across all edge types, using recursive CTE with path tracking.

**Output:** Ordered list of hops: `app-gateway -[routes_to]-> app-checkout -[calls_grpc]-> app-payments -[produces_kafka]-> topic.payment.completed -[consumes_kafka]-> app-notifications`

**Agent use case:** "How does a request get from the gateway to notifications?"

### kb_explain (service summary)

**Input:** service/repo name

**Query:** Aggregates from entities table (modules, schemas, events, protos) + all edges (inbound + outbound) + metadata.

**Output:** Structured card — what the service does (from metadata/README), what it talks to (grouped by mechanism), what events it produces/consumes, key modules.

**Agent use case:** "What is app-payments and how does it fit into the architecture?"

Each tool also gets a CLI command: `kb impact`, `kb trace`, `kb explain`.

## Query Implementation

### Recursive CTEs replace BFS loops

The current `queryDependencies` in `dependencies.ts` uses a manual BFS queue. For v3.0, the core graph traversal moves to SQL recursive CTEs.

Three query modules:
- `src/search/impact.ts` — downstream traversal, blast radius aggregation
- `src/search/trace.ts` — bidirectional shortest path with path tracking
- `src/search/explain.ts` — multi-table aggregation (repos + entities + edges), no recursion needed

### Event/Kafka-mediated paths

Current edges go `repo->event->repo` and `repo->topic->repo` (two hops). The CTE needs to handle these intermediate nodes transparently so the agent sees `app-checkout -[kafka: payment.completed]-> app-notifications` not the raw two-hop path.

### Performance

With ~12K edges, even unoptimized recursive CTEs complete in <50ms. The existing indexes on `(source_type, source_id)` and `(target_type, target_id)` cover the join patterns.

## MCP Integration

Three new MCP tools: `kb_impact`, `kb_trace`, `kb_explain`. Same pattern as existing tools — `wrapToolHandler` HOF, auto-sync, JSON output capped at 4KB.

## What's NOT in v3.0

- Neo4j integration (revisit if SQLite hits limits)
- Architecture rules engine
- File watcher / auto-reindex
- Dead code detection
- Multi-language AST parsing (tree-sitter)

## Inspiration

Nomik (nomik.co) — open source AI-native code intelligence graph. Key ideas adapted:
- Impact analysis over topology graph (NOM-01 from our requirements)
- Flow tracing across service boundaries (NOM-02)
- Service explanation cards for agent onboarding
