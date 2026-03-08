# Feature Landscape: v2.0 Design-Time Intelligence

**Domain:** Service topology, ownership, and semantic search for microservice knowledge base
**Researched:** 2026-03-08

---

## Table Stakes

Features that make v2.0 feel complete. Missing any = partial delivery.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| gRPC client edge extraction | Already partially exists (grpcStubs in elixir.ts). Users expect service-to-service gRPC calls to show in `kb deps` | Low | Enhance existing extraction, add metadata |
| Kafka producer/consumer edges | Already partially exists (events.ts). Users expect Kafka wiring in dependency graph | Low | Enhance existing extraction, add topic metadata |
| CODEOWNERS parsing | Core promise of "who owns what". Simple file format, well-defined semantics | Low | Standard locations: CODEOWNERS, .github/CODEOWNERS, docs/CODEOWNERS |
| Team-based ownership queries | "What does @org/team own?" across all repos | Low | Simple GROUP BY on owners table |
| File-level ownership resolution | "Who owns this file?" with last-match-wins CODEOWNERS semantics | Medium | Requires gitignore-style glob matching (picomatch) |
| Embedding-based semantic search | Core promise of "natural language queries". Users type "which services handle payments" and get relevant results | High | sqlite-vec + transformers.js + new pipeline phase |
| Incremental embedding updates | Don't re-embed 5000 entities on every index | Medium | text_hash comparison to skip unchanged entities |
| Graceful degradation when sqlite-vec unavailable | Don't crash if native extension fails to load | Low | Conditional schema init, feature flag check |

## Differentiators

Features that add significant value beyond the minimum promise.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| HTTP client edge extraction | Maps service-to-service HTTP calls (Tesla, HTTPoison patterns) | Medium | Regex-based, confidence varies. High value for understanding service mesh |
| Gateway routing extraction | Maps URL paths to upstream services through gateway config | Medium | Depends on gateway technology. May need to support multiple config formats |
| Edge metadata (endpoint, topic, method) | Rich context on HOW services communicate, not just THAT they do | Low | JSON in edges.metadata column. Cheap to add, high value in query results |
| Dependency mechanism filter | `kb deps booking --mechanism grpc` to filter by communication type | Low | Filter on relationship_type. Trivial once topology edges exist |
| Combined FTS + semantic search | Use FTS for exact matches, semantic for fuzzy/conceptual queries. Best of both worlds | Medium | Run both, merge/rank results. Or: user chooses mode explicitly |
| Embedding text enrichment with topology | Include "calls BookingService via gRPC" in embedding text so semantic search understands service relationships | Low | Build richer embedding text from entity + edges. Requires topology data first |
| Owner information in entity cards | Entity card for a module shows its CODEOWNERS owner | Low | JOIN through file path matching at query time |
| `kb status` enhanced with v2 stats | Show topology edge counts, owner counts, embedding coverage in status output | Low | Additional COUNT queries |

## Anti-Features

Features to explicitly NOT build in v2.0.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time embedding updates on file save | Adds complexity (file watching), not needed for on-demand tool | Re-embed during `kb index`, not on file change |
| Cloud-hosted embedding model API | Violates local-only constraint | Use @huggingface/transformers with local ONNX model |
| Interactive ownership editing | CODEOWNERS files are the source of truth, not our DB | Parse and query, never write back |
| Automatic CODEOWNERS generation | Out of scope -- we index existing ownership, not suggest new ownership | Could be a future feature |
| Multi-model embedding support | One model is enough for 5000 entities | Hardcode all-MiniLM-L6-v2. Add model selection if users request it |
| Embedding similarity threshold auto-tuning | Over-engineering for the scale we operate at | Fixed cosine distance threshold, tunable via config if needed |
| Graph visualization / ASCII art | Nice but not the core value. CLI outputs JSON | Defer to future. External tools can consume the JSON |
| Cross-repo CODEOWNERS inheritance | CODEOWNERS is per-repo. No inheritance semantics exist in GitHub's spec | Each repo's CODEOWNERS is independent |

## Feature Dependencies

```
gRPC client extraction ─────────┐
HTTP client extraction ──────────┤
Gateway routing extraction ──────┼──> Topology edges in DB ──> Enhanced dependency queries
Kafka wiring extraction ─────────┘                          ──> Richer embedding text

CODEOWNERS parsing ──> owners table ──> Ownership queries
                                     ──> Owner info in entity cards
                                     ──> Richer embedding text

sqlite-vec loading ──> vec_entities table ──> Embedding pipeline ──> Semantic search
                                                                  ──> kb_semantic MCP tool
                                                                  ──> kb search --semantic CLI
```

## MVP Recommendation

Prioritize (delivers core value with least risk):

1. **gRPC + Kafka topology edges** -- Low complexity, extends existing extractors, immediate value in `kb deps`
2. **CODEOWNERS parsing + team queries** -- Low complexity, new table, independent of other pillars
3. **Embedding semantic search** -- High complexity but core differentiator. Build last, benefit from topology data

Defer to v2.1:
- **HTTP client extraction** -- Medium confidence regex patterns, can iterate
- **Gateway routing extraction** -- Config format dependent, needs real gateway config examples
- **Combined FTS + semantic ranking** -- Get semantic search working first, optimize ranking later
