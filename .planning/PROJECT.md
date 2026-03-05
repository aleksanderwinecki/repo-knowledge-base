# Repo Knowledge Base

## What This Is

A persistent, self-improving knowledge base that indexes Fresha's entire microservice ecosystem (~50+ repos) so any AI agent can instantly query architectural knowledge, service relationships, event flows, and implementation patterns — without re-scanning repos from scratch every session.

## Core Value

Eliminate the repeated cost of AI agents re-learning the same codebase architecture every session. One index, always fresh, queryable in milliseconds.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Index all repos under ~/Documents/Repos/ extracting service metadata, tech stack, key files, and module responsibilities
- [ ] Semantic search over indexed knowledge ("which services consume BookingCreated?")
- [ ] Incremental re-indexing based on git changes since last scan (only update what changed)
- [ ] Extract and index event relationships from proto files and Kafka configs (producers/consumers)
- [ ] Extract and index GraphQL schemas (types, queries, mutations per service)
- [ ] Extract and index gRPC service definitions
- [ ] Extract and index Ecto schemas and database structure per service
- [ ] Store service dependency graph (which service talks to which, via what mechanism)
- [ ] Store learned patterns from past tasks ("to add an event field, touch these files in these repos")
- [ ] Manual knowledge injection ("learn" command to teach it facts)
- [ ] CLI interface for querying, indexing, and learning
- [ ] Usable as a Claude Code MCP tool so any Claude session can query mid-conversation
- [ ] Persistent storage that survives process restarts (SQLite or structured files)

### Out of Scope

- Full AI orchestrator / cross-repo task executor — separate project, builds on this
- PR creation or code generation — this is a knowledge layer, not an action layer
- UI dashboard — CLI and MCP tool only
- Real-time file watching — incremental re-index on demand is sufficient
- Cloud/hosted deployment — runs locally on engineer's machine

## Context

- Fresha's backend is ~50+ Elixir microservices communicating via Kafka events, gRPC, and GraphQL
- Event Catalog exists and is auto-updated — can be used as a data source
- Each repo has varying levels of documentation (README, CLAUDE.md, AGENTS.md)
- Engineers use Claude Code daily and the biggest friction is AI agents re-learning architecture every session
- Proto definitions define event contracts, stored across repos
- The company uses a monorepo-like structure with all repos cloned under ~/Documents/Repos/
- This is being built as a hackathon project (1.5 days) so MVP scope is critical

## Constraints

- **Runtime**: Must run locally, no external infrastructure beyond what's on the dev machine
- **Storage**: SQLite or structured JSON files — zero infrastructure dependencies
- **Language**: Node.js/TypeScript for the CLI tool (broad compatibility, fast prototyping)
- **Indexing speed**: Full initial index should complete in under 10 minutes for ~50 repos
- **Query speed**: Semantic search should return results in under 2 seconds
- **Hackathon timeline**: 1.5 days to build a demoable MVP

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite + structured JSON over vector DB | Zero infrastructure, debuggable, fast enough for ~50 repos | -- Pending |
| Node.js/TypeScript over Elixir | Faster prototyping, better AI SDK support, broader hackathon team compatibility | -- Pending |
| MCP tool integration | Allows any Claude Code session to query knowledge without setup | -- Pending |
| Incremental over full re-index | Git diff since last indexed commit avoids redundant work | -- Pending |

---
*Last updated: 2026-03-05 after initialization*
