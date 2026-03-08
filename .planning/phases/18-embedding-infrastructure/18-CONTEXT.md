# Phase 18: Embedding Infrastructure - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Generate and store vector embeddings for all indexed entities using local inference (nomic-embed-text-v1.5 via Transformers.js). sqlite-vec validates, V8 migration creates vec0 table, embeddings run as post-persistence step during `kb index`. Semantic search queries are Phase 19.

</domain>

<decisions>
## Implementation Decisions

### Embedding text composition
- Compose embedding input per entity type:
  - **Modules**: `"{name} {type} {summary}"` — e.g., "BookingContext.Commands.CreateBooking context Creates a booking for a customer"
  - **Events**: `"{name} {schema_definition}"` — e.g., "BookingCreated message BookingCreated { string booking_id; string customer_id }"
  - **Services**: `"{name} {description}"` — e.g., "BookingService gRPC service with RPCs: CreateBooking(CreateBookingRequest) -> CreateBookingReply"
  - **Repos**: `"{name} {description}"` — e.g., "app-bookings Booking management service"
  - **Learned facts**: `"{content} {repo}"` — e.g., "Bookings use soft deletes app-bookings"
- All text passed through `tokenizeForFts()` before feeding to model (SEM-03)
- Empty/null fields skipped (just use what's available)

### sqlite-vec loading strategy
- Conditional load at DB initialization — try `db.loadExtension('vec0')`, catch failure
- Store load success as a boolean flag accessible to pipeline code
- If sqlite-vec unavailable: skip V8 migration entirely, skip embedding step, log one warning
- No hard dependency — `kb index` works fine without it, just no embeddings
- Phase 19 (SEM-06) handles graceful search degradation; Phase 18 handles graceful indexing degradation

### Incremental vs full re-embed
- Track which entities have embeddings via presence in vec0 table
- On incremental/surgical index: embed only newly persisted or updated entities
- On `--force` full index: re-embed everything (vec0 table cleared with repo data)
- Cold start (first run after V8): embed all existing entities in one batch
- Batch size: process entities in chunks to manage Transformers.js memory

### CLI UX during embedding
- Embedding is part of `kb index`, not a separate command
- Add `embeddings` count to existing `IndexStats` output
- Print timing for embedding step when `--timing` flag is set
- Single summary line: "Generated N embeddings (Xms)" after per-repo persistence
- If sqlite-vec unavailable, print once: "sqlite-vec not available, skipping embeddings"

### Claude's Discretion
- Transformers.js initialization and model caching strategy
- vec0 table schema (entity_type + entity_id composite key vs single rowid)
- Exact chunk/batch size for embedding generation
- Error handling for individual embedding failures (skip entity vs abort batch)
- Whether to lazy-load Transformers.js (first use) or eager-load (pipeline start)
- V8 migration structure (conditional DDL based on sqlite-vec availability)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tokenizeForFts()` in `src/db/tokenizer.ts`: CamelCase/snake_case splitting — reuse for SEM-03 preprocessing
- `runMigrations()` in `src/db/migrations.ts`: Sequential V1-V7, V8 slots in naturally
- 3-phase pipeline in `src/indexer/pipeline.ts`: Post-persist embedding step goes after Phase 3 serial persistence
- `IndexStats` interface: Add `embeddings` field for embedding count reporting
- `p-limit` already a dependency: Can reuse for batched embedding if needed

### Established Patterns
- All DB operations are synchronous (better-sqlite3 is sync) — Transformers.js is async, needs bridge
- Migrations are additive ALTER/CREATE — V8 follows same pattern
- Pipeline uses `Promise.allSettled` for parallel extraction — embedding step is serial (after persist)
- Error isolation per repo — embedding failures should follow same pattern

### Integration Points
- `src/db/database.ts`: sqlite-vec extension loading at DB init
- `src/db/migrations.ts`: V8 migration for vec0 virtual table
- `src/indexer/pipeline.ts`: Embedding step after `persistExtractedData` in Phase 3 loop, or as Phase 4 after all repos
- `src/db/schema.ts`: V8 version constant bump
- `package.json`: Add `sqlite-vec` and `@huggingface/transformers` (or `@xenova/transformers`) dependencies

</code_context>

<specifics>
## Specific Ideas

No specific requirements — user deferred all decisions to Claude's discretion.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-embedding-infrastructure*
*Context gathered: 2026-03-08*
