# Roadmap: Repo Knowledge Base

## Overview

Four phases deliver a working knowledge base in 1.5 days: lay down the SQLite storage layer, build the indexing pipeline that populates it, wire up search queries over indexed data, then wrap it all in a CLI and MCP server. Each phase produces something runnable and verifiable before the next begins.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Storage Foundation** - SQLite database with schema, FTS5, and incremental-index tracking
- [x] **Phase 2: Indexing Pipeline** - Repo scanning, metadata extraction, proto/event parsing, error isolation
- [x] **Phase 3: Search** - Full-text search, structured entity queries, dependency queries with contextual results (completed 2026-03-05)
- [ ] **Phase 4: CLI + MCP + Knowledge** - CLI tool, MCP server, manual knowledge injection, relationship graph queries

## Phase Details

### Phase 1: Storage Foundation
**Goal**: A single SQLite file can persistently store all knowledge entities and their relationships, with full-text search indexes ready to query
**Depends on**: Nothing (first phase)
**Requirements**: STOR-01, STOR-02, STOR-03, STOR-04
**Success Criteria** (what must be TRUE):
  1. Running the tool creates a SQLite database file that persists across process restarts
  2. The schema contains tables for repos, files, modules, events, services, and relationships between them
  3. FTS5 virtual tables exist and can be queried with match syntax
  4. Each repo record tracks a last-indexed git commit SHA
**Plans**: TBD

Plans:
- [x] 01-01: Project scaffolding and SQLite schema

### Phase 2: Indexing Pipeline
**Goal**: All repos under a root directory are scanned and their metadata, modules, proto definitions, and event relationships are extracted into the database
**Depends on**: Phase 1
**Requirements**: IDX-01, IDX-02, IDX-03, IDX-04, IDX-05, IDX-06, IDX-07
**Success Criteria** (what must be TRUE):
  1. Running the indexer against ~/Documents/Repos/ populates the database with repo metadata (name, description, tech stack, key files)
  2. Elixir module definitions and their doc-derived responsibilities are extracted and stored
  3. Proto file event schemas and Kafka producer/consumer relationships appear as queryable entities
  4. Re-running the indexer skips repos with no new commits since last index
  5. A repo with parse errors does not prevent other repos from being indexed
**Plans**: TBD

Plans:
- [x] 02-01: Repo scanner and metadata extractor
- [x] 02-02: Elixir module, proto, and Kafka extractors with incremental indexing

### Phase 3: Search
**Goal**: Users can find any indexed knowledge through text search, structured entity queries, and dependency lookups -- with useful context in results
**Depends on**: Phase 2
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04
**Success Criteria** (what must be TRUE):
  1. A text query like "booking cancellation" returns matching indexed content across all repos
  2. A structured query like "which services consume BookingCreated?" returns the correct producer and consumer services
  3. A dependency query like "what does payments-service depend on?" returns services it communicates with and the mechanisms (Kafka, gRPC)
  4. All search results include repo name, file path, and enough surrounding context to be useful
**Plans**: TBD

Plans:
- [ ] 03-01: FTS5 text search and structured entity/dependency queries

### Phase 4: CLI + MCP + Knowledge
**Goal**: The knowledge base is usable as both a standalone CLI tool and an MCP server that any Claude Code session can query, with the ability to manually teach it new facts
**Depends on**: Phase 3
**Requirements**: INTF-01, INTF-02, INTF-03, INTF-04, KNOW-01, KNOW-02, KNOW-03
**Success Criteria** (what must be TRUE):
  1. A CLI command can trigger indexing, run searches, and inject learned facts
  2. CLI output is human-readable with clear formatting (not raw JSON dumps)
  3. An MCP server exposes search as a tool that Claude Code can call mid-conversation
  4. MCP responses are under 4KB and contain well-structured summaries
  5. Manually injected knowledge ("learn" command) is stored persistently and appears in search results
**Plans**: TBD

Plans:
- [ ] 04-01: CLI with commander (index, search, learn, status commands)
- [ ] 04-02: MCP server and knowledge injection

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Storage Foundation | 1/1 | Complete | 2026-03-05 |
| 2. Indexing Pipeline | 2/2 | Complete | 2026-03-05 |
| 3. Search | 0/1 | Complete    | 2026-03-05 |
| 4. CLI + MCP + Knowledge | 0/2 | Not started | - |
