# Pitfalls Research

**Domain:** Codebase knowledge base / semantic code search (local, ~50 Elixir microservices)
**Researched:** 2026-03-05
**Confidence:** MEDIUM (training data only -- no web search available to verify current state)

## Critical Pitfalls

### Pitfall 1: Treating Code Like Prose When Embedding

**What goes wrong:**
You embed code files using the same strategy you'd use for documentation -- stuff the whole file or large blocks into a generic text embedding model. The resulting vectors are garbage for actual code search because: (a) code has structural meaning that prose embeddings miss (imports, function signatures, type definitions are semantically dense in ways that `text-embedding-3-small` doesn't capture well), (b) variable names and domain terms get tokenized into nonsense subwords, and (c) the embedding space conflates syntactically different but semantically identical patterns.

**Why it happens:**
Every RAG tutorial shows "chunk text, embed, search" and it works great for documentation. Developers assume code is just another kind of text. It isn't. A function signature like `def handle_event(event, state)` carries enormous structural meaning that a prose-trained model underweights.

**How to avoid:**
- For a hackathon MVP with ~50 repos: **skip embeddings entirely for v1**. Use structured extraction (AST-like parsing of module names, function names, event names, schema fields) stored in SQLite with full-text search (FTS5). This is faster to build, more predictable, and for a codebase you control, keyword/structured search over well-extracted metadata will outperform naive embedding search.
- If you do embeddings later: use a code-specific model (like `voyage-code-3` or similar), embed at the function/module level with metadata prepended (language, file path, module name), and combine with keyword search (hybrid retrieval).
- Never rely on embeddings alone for code -- always pair with structural/keyword search.

**Warning signs:**
- Searching for "BookingCreated event consumer" returns random files that mention "booking" somewhere
- Results feel random -- no clear correlation between query intent and returned chunks
- Exact matches (searching for a known function name) don't surface first

**Phase to address:**
Phase 1 (MVP). Get this wrong and the core value prop is broken. Start with structured extraction + FTS5, defer embeddings to a later phase.

---

### Pitfall 2: Wrong Chunking Granularity

**What goes wrong:**
You chunk by fixed token count (512 tokens, 1024 tokens) or by file. Fixed-token chunks split functions mid-body, separate a type definition from its usage, or merge unrelated code into one chunk. File-level chunks are too large for embedding models and dilute the signal. Either way, search results return chunks that are either too fragmented to be useful or too broad to be relevant.

**Why it happens:**
Fixed-token chunking is the default in every RAG framework (LangChain, LlamaIndex). It's designed for prose documents where paragraph boundaries are soft. Code has hard structural boundaries -- functions, classes, modules, type definitions -- that must be respected.

**How to avoid:**
- Chunk by structural unit: one chunk = one function, one module definition, one schema definition, one event definition, one proto message. For Elixir specifically: one chunk per module (defmodule), or per public function if modules are large.
- Store metadata alongside each chunk: file path, module name, function name, language, repo name. This metadata is often more valuable for search than the embedding itself.
- For this project specifically: the "chunks" aren't really chunks -- they're extracted knowledge artifacts (service metadata, event relationships, schema definitions). Treat them as structured records, not text blobs.

**Warning signs:**
- You're writing code to split by token count rather than by AST/structural boundaries
- A single search result contains code from two unrelated functions
- You need more than 3-4 results to find the relevant one

**Phase to address:**
Phase 1 (MVP). The extraction/chunking strategy is foundational. Changing it later means re-indexing everything and restructuring the schema.

---

### Pitfall 3: Index Staleness Without Awareness

**What goes wrong:**
The index becomes stale (someone adds a new service, changes event contracts, modifies schemas) and the knowledge base silently returns outdated information. Worse: there's no way to tell *which* results might be stale. An AI agent gets confidently wrong answers about the current state of the codebase.

**Why it happens:**
Building the indexer is the fun part. Building the staleness-tracking metadata is boring. So you index everything once, it works great for the demo, and then two weeks later it's lying to you about which services consume an event because someone refactored a consumer.

**How to avoid:**
- Store `last_indexed_commit` per repo. On every query, optionally check if HEAD has moved since last index (cheap git operation). Surface staleness in results: "This result is from repo X, last indexed 3 days ago (14 commits behind)."
- Make re-indexing trivially easy: `rkb reindex` or `rkb reindex --repo app-bookings`. If re-indexing is painful, it won't happen.
- For the MCP tool: include staleness metadata in tool responses so the LLM can caveat its answers.

**Warning signs:**
- No `last_indexed_at` or `indexed_commit` field in your data model
- You can't answer "when was this repo last indexed?" from the CLI
- Users start distrusting the tool because it gave wrong info once

**Phase to address:**
Phase 1 (MVP). The `indexed_commit` metadata is trivial to add upfront but painful to retrofit. Staleness display can be Phase 2, but the data must be captured from day one.

---

### Pitfall 4: Over-Engineering for a 1.5-Day Hackathon

**What goes wrong:**
You build a sophisticated vector database integration, multi-stage retrieval pipeline, re-ranking system, and graph-based relationship traversal. You run out of time before you have a working demo. The judges/team sees a half-finished system instead of a simple tool that actually works.

**Why it happens:**
Code knowledge bases are a technically fascinating domain. Every component (embeddings, chunking, retrieval, ranking, graph queries) has deep rabbit holes. Engineers optimize for technical elegance instead of demo impact.

**How to avoid:**
- Hard scope for MVP: structured extraction into SQLite + FTS5 + a few well-chosen queries. No embeddings. No vector DB. No re-ranking. No graph traversal.
- The demo that wins: "I ask 'which services consume BookingCreated?' and get the right answer in 200ms" beats "I have a sophisticated multi-modal retrieval pipeline that's 60% done."
- Build the dumbest thing that could work first. You can always add sophistication later.
- Timebox: if a feature isn't working in 2 hours, cut it.

**Warning signs:**
- Day 1 and you're still debating embedding model selection
- You're installing a vector database
- You have more infrastructure than features
- You can't demo the core use case yet

**Phase to address:**
Phase 1 (MVP). This is the meta-pitfall -- it's about scope discipline, not technology.

---

### Pitfall 5: Ignoring Context Window Limits When Feeding Results to LLMs

**What goes wrong:**
Your search returns 20 relevant results, you stuff them all into the LLM context as tool output, and either: (a) you blow the context window, (b) the LLM ignores results in the middle ("lost in the middle" effect), or (c) you waste tokens on marginally relevant results, leaving no room for the actual task. MCP tool responses that return 50KB of code are worse than useless.

**Why it happens:**
When building the search tool, you optimize for recall ("return everything that might be relevant"). But the consumer is an LLM with finite context, and more results != better answers.

**How to avoid:**
- Cap MCP tool responses at a reasonable size (aim for 2-4KB per response, max 8KB). Return top 5-10 results with concise summaries, not full code blocks.
- Return structured, scannable results: `{repo, file, module, relevance_summary}` -- not raw code dumps.
- Include a "drill-down" pattern: initial search returns summaries, then the LLM can request full details for specific results.
- Rank results and be aggressive about truncation. The 15th result is almost never useful.

**Warning signs:**
- MCP tool responses are >10KB
- You're returning full file contents in search results
- The LLM's follow-up responses ignore some of your search results
- Token usage spikes when the knowledge base is queried

**Phase to address:**
Phase 1 (MVP) for basic result sizing. Phase 2 for drill-down patterns and smart truncation.

---

### Pitfall 6: Flat Extraction Missing Relationships (The Graph Problem)

**What goes wrong:**
You index each repo in isolation: "service X has these modules, these schemas, these functions." But the core value of a knowledge base across 50 microservices is the *relationships*: who produces which events, who consumes them, which services call which via gRPC, what the data flow looks like for a given business operation. Without relationships, you have 50 disconnected inventories instead of an architectural map.

**Why it happens:**
Extracting per-repo metadata is straightforward (parse files, store results). Extracting cross-repo relationships requires understanding proto files, Kafka consumer configs, gRPC client stubs, and stitching them together. It's a harder problem, so it gets deferred -- and then the tool can't answer the most valuable questions.

**How to avoid:**
- Design the data model around relationships from day one, even if you populate them incrementally. Tables/records for: `services`, `events`, `event_producers`, `event_consumers`, `grpc_services`, `grpc_clients`.
- Start with the easiest relationship to extract: event producer/consumer from proto files and Kafka configs. This alone makes the tool 10x more valuable than per-repo metadata.
- Accept that relationship extraction will be imperfect. 80% coverage of event flows is infinitely more valuable than 0%.

**Warning signs:**
- Your schema has no foreign keys or relationship tables
- You can answer "what modules does service X have?" but not "what events does service X produce?"
- Every query returns results from a single repo

**Phase to address:**
Phase 1 (MVP) for the data model and basic event relationships. Phase 2 for gRPC and GraphQL relationship extraction.

---

## Moderate Pitfalls

### Pitfall 7: Elixir/BEAM-Specific Parsing Traps

**What goes wrong:**
You try to parse Elixir code with generic AST tools or regex and miss: macros that generate modules at compile time (like `use GenServer`), protocol implementations, behaviour callbacks, dynamic module names, and the overall pattern where an Elixir "module" can define event handlers via macro DSLs that don't look like normal function definitions. Kafka consumer setup via Broadway/GenStage often uses macros that hide the event topic configuration.

**Why it happens:**
Most code parsing tools and examples are built for Python/JavaScript. Elixir's macro system means the "source code as written" and "what actually exists at runtime" can be very different.

**How to avoid:**
- Don't try to build a full Elixir AST parser. Instead, use targeted regex/pattern matching for the specific constructs you care about: `defmodule`, `schema`, `field`, `@topic`, proto file imports, etc.
- Start with the simplest extraction that works: parse `mix.exs` for dependencies, `README.md`/`CLAUDE.md` for descriptions, proto files for event definitions (proto is much easier to parse than Elixir).
- Accept some false negatives. Missing 10% of modules is fine if you correctly capture 90%.

**Warning signs:**
- You're trying to install an Elixir AST parser in Node.js
- Your extractor misses modules generated by macros
- Broadway/GenStage consumer detection returns nothing

**Phase to address:**
Phase 1 for basic extraction, Phase 2 for deeper Elixir-specific patterns.

---

### Pitfall 8: SQLite Full-Text Search Misconfiguration

**What goes wrong:**
You set up SQLite FTS5 but: (a) use default tokenizer which doesn't handle code identifiers well (CamelCase, snake_case get tokenized wrong), (b) don't configure it to search across related tables (searching events should also consider the service context), or (c) don't understand FTS5 query syntax and build queries that return nothing or everything.

**Why it happens:**
FTS5 is powerful but has quirks. Default tokenizers split on word boundaries, so `BookingCreated` might become `booking` + `created` (good) or stay as one token (bad), depending on tokenizer config. Code identifiers need special handling.

**How to avoid:**
- Use the `unicode61` tokenizer with `tokenchars` configured for underscores so `booking_created` stays meaningful.
- Store a `search_text` column that pre-processes identifiers: split CamelCase into separate words, replace underscores with spaces, include aliases. `BookingCreated` -> `"booking created BookingCreated"`.
- Test FTS queries with actual queries from your use cases before building the UI layer.

**Warning signs:**
- Searching "booking created" returns nothing even though `BookingCreated` exists
- Searching returns way too many results (every mention of "booking" across all repos)
- FTS queries are slow (likely missing the FTS index entirely, querying the raw table with LIKE)

**Phase to address:**
Phase 1 (MVP). FTS is the core search mechanism; getting tokenization right is essential.

---

### Pitfall 9: No Graceful Degradation for Partial Index

**What goes wrong:**
Indexing 50 repos takes time. If one repo fails to index (parse error, unexpected file structure, missing files), the entire indexing run fails or silently skips data. Users don't know which repos are indexed and which aren't, leading to false negatives ("the tool says no service consumes this event" when actually it just hasn't indexed the consumer yet).

**Why it happens:**
Error handling in batch processing is tedious. The happy path works great, so you ship it.

**How to avoid:**
- Index per-repo with independent error handling. One repo failing should not affect others.
- Track indexing status per repo: `indexed`, `failed`, `partial`, `not_indexed`.
- On query, note which repos are missing from the index. "Found 3 consumers. Note: 5 repos are not yet indexed."
- Log extraction failures to a `indexing_errors` table so you can debug and fix extractors incrementally.

**Warning signs:**
- A single malformed file crashes the entire indexing run
- No way to tell which repos are/aren't indexed
- `rkb status` doesn't exist

**Phase to address:**
Phase 1 (MVP). Error isolation and status tracking must be built in from the start.

---

### Pitfall 10: Trying to Be a General-Purpose Code Search Engine

**What goes wrong:**
You start building grep-with-embeddings instead of a domain-specific knowledge base. The tool can find any code anywhere but can't answer architectural questions like "what's the data flow from booking creation to payment processing?" because it's optimizing for code-level search instead of architecture-level knowledge.

**Why it happens:**
Code search is a well-understood problem (Sourcegraph, GitHub search). It's tempting to build toward that because the patterns are clear. But the project's value isn't "search code" -- it's "understand architecture across 50 services."

**How to avoid:**
- Frame every feature as: "does this help answer architectural questions?" If not, cut it.
- The queries to optimize for: "which services produce/consume X event?", "what's the schema for X?", "how do services A and B communicate?", "what does service X do?" -- NOT "find all usages of function Y."
- File-level code search already exists (grep, ripgrep, GitHub). Don't rebuild it. Build the layer above it.

**Warning signs:**
- You're building a file content search feature
- Your test queries are about finding specific code patterns rather than understanding architecture
- The tool returns file paths and line numbers instead of service names and relationships

**Phase to address:**
Phase 1 (MVP). This is a framing/scope decision that must be clear from the start.

---

## Minor Pitfalls

### Pitfall 11: MCP Tool Response Format Neglect

**What goes wrong:**
The MCP tool works but returns unstructured text that Claude struggles to incorporate into its reasoning. The tool is technically queryable but practically useless because the response format doesn't help the LLM reason about the results.

**How to avoid:**
- Return structured JSON with clear field names. Include a `summary` field that's a natural language sentence the LLM can directly quote.
- Test with actual Claude Code sessions, not just unit tests. The real question is: does Claude give better answers with this tool than without it?

**Phase to address:**
Phase 2 (post-MVP polish).

---

### Pitfall 12: Premature Abstraction of Extraction Pipelines

**What goes wrong:**
You build a generic "extractor framework" with plugins, registries, and abstract base classes before you've written a single concrete extractor. The framework adds complexity without value because you don't yet know what the extractors actually need.

**How to avoid:**
- Write 3 concrete extractors first (mix.exs parser, proto file parser, README parser). Then look for the common pattern. Abstract only what's proven to be repeated.
- For a hackathon: no abstractions. Just functions that parse files and return data.

**Phase to address:**
Phase 1. Fight the urge to architect; just build.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| No embeddings, FTS only | Ships in hours, predictable results | Can't do fuzzy semantic queries ("services related to payments") | Always acceptable for MVP; add embeddings later as enhancement |
| Regex parsing instead of AST | Works in Node.js without Elixir toolchain | Misses macro-generated code, fragile to formatting changes | Acceptable for hackathon; plan to improve extractors iteratively |
| Single SQLite file, no migrations | Fast iteration, no schema migration tooling needed | Schema changes require full re-index or manual migration | Acceptable for MVP if re-index is fast (<10 min) |
| No caching/incremental | Simpler code, full re-index each time | Wastes time on unchanged repos | Acceptable for hackathon demo; unacceptable for daily use |
| Hardcoded repo paths | Works on your machine | Can't share or configure per-environment | Acceptable for hackathon if configurable via env var |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP Server | Returning too much data in tool responses | Cap response size, return summaries with drill-down option |
| SQLite FTS5 | Using default tokenizer for code identifiers | Configure tokenizer for CamelCase/snake_case splitting |
| Git (for staleness) | Shelling out to git for every query | Cache HEAD commit per repo, check periodically, not per-query |
| Proto file parsing | Trying to build a full protobuf parser | Use regex for message/service names; full parsing is overkill |
| Elixir file parsing | Attempting full AST analysis from Node.js | Target specific patterns (defmodule, schema, field) with regex |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all indexed data into memory | Fast queries initially, OOM as index grows | Keep data in SQLite, query on demand | ~100+ repos or very large repos |
| Synchronous full re-index | CLI hangs for minutes during re-index | Show progress, index per-repo, allow partial re-index | >20 repos |
| FTS5 on unindexed columns | Queries take seconds instead of milliseconds | Ensure FTS virtual table covers all searchable fields | >10k indexed records |
| Shelling out to git per query | 200ms+ per query just for staleness check | Cache git state, refresh on explicit re-index or startup | Any scale; git operations are surprisingly slow |
| Large MCP responses | Claude context window fills up, degraded reasoning | Paginate, summarize, cap at 4KB per response | Always; even small responses waste tokens |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Indexing `.env` files or secrets | Secrets stored in SQLite, queryable via MCP | Explicit ignore list: `.env`, `*.pem`, `credentials.*`, `secrets.*` |
| No access control on MCP tool | Any Claude session can query all repos | Acceptable for local-only tool; flag if ever exposed over network |
| Storing file contents verbatim | Large DB, potential secret leakage from code comments | Store extracted metadata and summaries, not raw source code |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No feedback during indexing | User thinks tool is hung | Show per-repo progress: "Indexing app-bookings (12/47)..." |
| Binary search results (found/not found) | No sense of confidence or completeness | Include match quality and coverage metadata in results |
| Requiring full re-index for any change | Users avoid re-indexing because it's slow | Incremental: re-index only repos with new commits since last index |
| Cryptic error messages on parse failures | Users can't fix extractor issues | Log which file, which line, what was expected vs found |
| No "what do you know?" command | Users can't verify the index is correct | `rkb status` showing per-repo index state, last indexed, record counts |

## "Looks Done But Isn't" Checklist

- [ ] **Search works:** Verify it returns correct results for the 5 most important query types, not just one happy-path test
- [ ] **Event relationships:** Verify both producer AND consumer sides are captured, not just one direction
- [ ] **Cross-repo queries:** Verify a query can return results spanning multiple repos, not silently scoped to one
- [ ] **Staleness metadata:** Verify `last_indexed_commit` is stored and surfaced -- not just in the DB but in query responses
- [ ] **Error isolation:** Verify one malformed repo doesn't break indexing of the other 49
- [ ] **MCP response size:** Verify responses are under 8KB by testing with a query that has many matches
- [ ] **Ignored files:** Verify `.env`, secrets, and binary files are excluded from indexing

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong chunking strategy | MEDIUM | Redesign schema, re-extract, re-index. ~4-8 hours if extraction code is modular |
| Missing relationship model | HIGH | Schema redesign, new extractors, re-index. This is why it must be Phase 1 |
| Index staleness (no tracking) | LOW | Add `indexed_commit` column, backfill with current HEAD, re-index |
| Oversized MCP responses | LOW | Add truncation/pagination to response formatting. ~1-2 hours |
| Wrong search approach (embeddings instead of structured) | HIGH | Fundamental architecture change. Easier to start with structured and add embeddings |
| Secret leakage into index | MEDIUM | Add ignore list, delete and re-index affected repos. Audit what was exposed |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Code-as-prose embedding trap | Phase 1 | Search returns structurally relevant results for test queries |
| Wrong chunking granularity | Phase 1 | Each indexed record maps to one logical unit (module, event, schema) |
| Index staleness | Phase 1 (data capture), Phase 2 (display) | `indexed_commit` exists in DB for every repo |
| Over-engineering | Phase 1 | Working demo exists by end of day 1 |
| Context window overflow | Phase 1 (basic), Phase 2 (refinement) | MCP responses under 8KB for worst-case queries |
| Missing relationships | Phase 1 | Can answer "who produces/consumes event X?" correctly |
| Elixir parsing traps | Phase 1 (basic), Phase 2 (advanced) | Extractors handle top 90% of module patterns |
| FTS misconfiguration | Phase 1 | CamelCase and snake_case identifiers are searchable |
| No graceful degradation | Phase 1 | Partial index failure doesn't crash full run |
| Scope creep to code search | Phase 1 | No file-content-search features in MVP |

## Sources

- Training data only (web search unavailable). Confidence: MEDIUM.
- Domain knowledge from widespread RAG/code-search projects (Cursor, Sourcegraph, Cody, Continue.dev, various open-source codebase indexers) as of early 2025.
- Elixir-specific pitfalls from general knowledge of BEAM ecosystem patterns.
- SQLite FTS5 behavior from SQLite documentation (well-established, unlikely to have changed).

---
*Pitfalls research for: Codebase knowledge base / semantic code search*
*Researched: 2026-03-05*
