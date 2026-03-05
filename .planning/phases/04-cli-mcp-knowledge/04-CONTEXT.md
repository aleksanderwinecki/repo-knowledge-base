# Phase 4: CLI + Knowledge - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Wrap existing storage, indexing, and search layers in a CLI tool. Add manual knowledge injection and relationship graph queries. No MCP server -- Claude uses the CLI via Bash with JSON output.

</domain>

<decisions>
## Implementation Decisions

### CLI output & format
- JSON-only output (no human-readable mode) -- this tool is for AI consumption
- Plain text, no color/chalk -- unnecessary for JSON output
- No response size limits -- return everything, let the caller decide
- Subcommand pattern: `kb index`, `kb search`, `kb learn`, `kb deps`, `kb status`

### Interface surface
- CLI only, no MCP server
- Claude calls the CLI via Bash and parses JSON output
- Auto-generated documentation (CLAUDE.md section or `kb docs` command) describing each command with examples so Claude knows how to use the tool

### Knowledge injection
- Free-form text input: `kb learn 'payments-service owns the billing domain'`
- Optional `--repo` tag to associate facts with a specific repo
- Management commands: `kb learned` (list all), `kb forget <id>` (delete one)
- Stored persistently, searchable alongside indexed data via FTS

### Graph queries
- Direct neighbors only (no transitive/depth traversal)
- Always include provenance: repo, file path, and line where relationship was detected
- Entity queries return the mechanism (kafka, grpc, etc.) alongside the relationship

### Claude's Discretion
- Whether learned facts need optional categories/tags beyond repo association
- Whether to include a `kb map` command for full service topology
- JSON response structure and field naming
- Dependency output grouping (flat vs grouped by direction)

</decisions>

<specifics>
## Specific Ideas

- Tool is AI-only -- no need for human-friendly formatting, just clean JSON
- Claude should be able to discover and use the tool by reading auto-generated docs
- Provenance in search results so Claude can navigate to actual code

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 04-cli-mcp-knowledge*
*Context gathered: 2026-03-05*
