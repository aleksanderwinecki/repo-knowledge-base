# Phase 2: Indexing Pipeline - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Repo scanning, metadata extraction, Elixir module parsing, proto/event parsing, and incremental indexing with per-repo error isolation. This phase populates the database from Phase 1 — no search, no CLI, no MCP.

</domain>

<decisions>
## Implementation Decisions

### Repo Discovery
- Scan all directories under configurable root (default: ~/Documents/Repos/)
- A directory is a repo if it has .git AND at least one of: mix.exs, package.json
- Repos without project files (forks, experiments, empty) are skipped

### Repo Metadata Sources
- README.md is the primary source for repo description and purpose
- CLAUDE.md enriches with AI-specific context (if present)
- Tech stack detection: language from file presence (mix.exs → Elixir, package.json → Node, Gemfile → Ruby) PLUS key dependencies parsed from dep files (Phoenix, Absinthe, Broadway, Ecto, etc.)
- Key files: hardcoded list (README, CLAUDE.md, AGENTS.md, mix.exs/package.json, config/) plus top-level directory listing snapshot (lib/, priv/, test/, proto/)

### Elixir Module Extraction
- Focus on architecturally significant modules: *Context, *Commands, *Queries patterns
- Extract @moduledoc content as the module description/responsibility
- Extract public function names as capabilities (create_booking/2, cancel/1, etc.)
- Multiple contexts per service — a service (repo) contains multiple context subdomains
- Also extract Ecto schema names + table names (lightweight, maps data ownership) — module name and table only, no field extraction

### Proto & Event Extraction
- Proto files exist in both a shared proto repo AND local proto directories in individual services
- Extract message names, field names, and gRPC service/rpc definitions from .proto files
- Producer detection: if a service owns (defines) a proto message schema, it's the producer
- Consumer detection: look for event handler modules with handle_event/handle_message pattern matching on specific event types

### Incremental Indexing
- Track last_indexed_commit SHA per repo (from Phase 1 schema)
- On re-index: use git diff to find changed files, only re-extract those
- Deleted files: remove all entities that were extracted from that file (clean data, no stale entries)
- Support --force flag to bypass commit SHA check and do full re-index of all repos
- Per-repo error isolation: one repo failing extraction does not block others

### Progress Reporting
- Per-repo status line: "Indexing repo-name... done (23 modules, 5 protos)"
- Errors reported inline per repo, with summary at end

### Claude's Discretion
- Exact regex/AST patterns for detecting Context, Command, Query modules
- Proto file parser choice (regex vs protobuf library)
- Git diff parsing implementation
- How to detect event handler modules reliably
- Error recovery strategy per extractor

</decisions>

<specifics>
## Specific Ideas

- The shared proto repo should be indexed like any other repo but its protos link to the services that import them
- Context modules in Fresha follow DDD patterns: BookingContext.Commands.CreateBooking, AvailabilityContext.Queries.GetSlots
- Event handlers pattern-match on proto message types — this is the consumer signal
- Ecto schemas are lightweight additions: just module name + table name, no deep field parsing

</specifics>

<deferred>
## Deferred Ideas

- Full Ecto schema extraction with fields and associations — v2 (EXT-03)
- GraphQL schema extraction — v2 (EXT-01)
- gRPC service extraction beyond proto definitions — v2 (EXT-02)
- Module-level relationship tracking (which module calls which) — noted in Phase 1 context

</deferred>

---

*Phase: 02-indexing-pipeline*
*Context gathered: 2026-03-05*
