# Research Summary: v2.0 Design-Time Intelligence

**Domain:** Service topology extraction, CODEOWNERS parsing, and embedding-based semantic search for microservice knowledge base
**Researched:** 2026-03-08
**Overall confidence:** HIGH

## Executive Summary

v2.0 adds three pillars to the existing repo-knowledge-base: service topology edges (gRPC clients, HTTP clients, gateway routing, Kafka wiring), CODEOWNERS-based ownership queries, and embedding-powered semantic search. The existing architecture -- three-phase pipeline, polymorphic edges table, FTS5 search, extractor pattern -- extends naturally for all three. No architectural restructuring is needed.

The technology additions are minimal and well-validated: **sqlite-vec** (v0.1.7-alpha.2) loads as a native extension into better-sqlite3 for vector storage and KNN search, **@huggingface/transformers** (v3.8.1) runs **nomic-embed-text-v1.5** locally via ONNX for embedding generation (256d via Matryoshka truncation from 768d), and CODEOWNERS parsing requires no library at all (the format is trivially simple -- a ~15-line custom parser handles it). Total new dependency weight: ~17MB in node_modules plus ~130MB ONNX model cached on first use.

The primary risk is sqlite-vec platform compatibility on macOS ARM64. Prebuilt binaries exist on npm (`sqlite-vec-darwin-arm64`), but this is a "validate first, build second" situation. The mitigation is clear: smoke-test native extension loading as the very first task in the embedding phase. If it fails, a brute-force cosine distance fallback on a regular BLOB column provides degraded-but-functional semantic search. The other two pillars (topology, CODEOWNERS) have zero new dependencies and carry low risk.

Build order is driven by dependencies and risk: topology first (pure extraction extending existing patterns, provides richer data for later embedding text), CODEOWNERS second (independent simple parsing, new table, new CLI/MCP commands), and embeddings last (most complex, benefits from having all entity data including topology edges for richer embedding text construction).

## Key Findings

**Stack:** sqlite-vec for vector storage, @huggingface/transformers v3.8.1 with nomic-embed-text-v1.5 (256d Matryoshka, q8 quantized ONNX) for local embeddings, no library needed for CODEOWNERS, no new dependencies for topology extraction.

**Architecture:** Three pillars extend existing extractor -> writer -> search -> tool patterns with no restructuring. Topology and CODEOWNERS fit into Phase 2 extraction / Phase 3 persistence. Embeddings require a new Phase 4 post-persistence step (CPU-bound ONNX inference must not block the p-limit parallel extraction pool). Two schema migrations: V7 (edges.metadata column + owners table) and V8 (vec0 virtual table + entity_embeddings, conditional on sqlite-vec).

**Critical pitfall:** sqlite-vec native extension failing to load on macOS ARM64 kills the entire semantic search pillar. Must validate before building any embedding pipeline code.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Service Topology Extraction** - No new dependencies, extends existing extractors and edge model
   - Addresses: TOPO-01..04 (gRPC clients, HTTP clients, gateway routing, Kafka wiring)
   - Delivers: topology extractors in `src/indexer/topology/`, edges.metadata column (V7), generalized dependency traversal, `--mechanism` filter on `kb deps`
   - Avoids: Pitfall #3 (new edges invisible in queries) by generalizing `findLinkedRepos()`
   - Risk: LOW -- pure regex extraction following established patterns

2. **CODEOWNERS Parsing & Ownership Queries** - Independent of topology, simple file parsing
   - Addresses: OWN-01..03 (parsing, team queries, file-level ownership)
   - Delivers: CODEOWNERS parser, owners table (V7), ownership search functions, `kb owners` CLI, `kb_owners` MCP tool, 'owner' entity type in FTS
   - Avoids: Pitfall #4 (last-match-wins semantics) by storing line_number and resolving at query time
   - Risk: LOW -- well-defined file format, well-understood semantics

3. **Embedding Infrastructure & Semantic Search** - sqlite-vec + Transformers.js, most complex pillar
   - Addresses: SEM-01..02 (semantic search, code-aware embeddings)
   - Delivers: sqlite-vec integration, nomic-embed-text-v1.5 embedding pipeline (Phase 4 post-persistence), vec_entities + entity_embeddings (V8 migration), KNN semantic search, `kb_semantic` MCP tool, `kb search --semantic` CLI flag, graceful degradation
   - Avoids: Pitfall #1 (platform failure) by smoke-testing first; Pitfall #2 (embedding in wrong phase) by running as Phase 4; Pitfall #5 (model download blocks) with progress output and graceful skip
   - Risk: MEDIUM -- sqlite-vec platform compatibility, model download UX

**Phase ordering rationale:**
- Topology first: no dependencies, extends proven patterns, enriches embedding text for later phases
- CODEOWNERS second: independent of topology, small scope, immediate user value
- Embeddings last: most complex, most risk (sqlite-vec platform), benefits from having all data available for richer embedding text ("BookingService calls PaymentService via gRPC, owned by @org/payments-team" is a better embedding than just "BookingService")
- V7 migration groups topology + CODEOWNERS (pure SQL DDL, no new dependencies). V8 migration (vec0) is conditional on sqlite-vec loading, enabling graceful degradation

**Research flags for phases:**
- Phase 1 (Topology): May need phase-specific research on actual gateway config format used by Fresha repos. HTTP client regex patterns need real-world validation.
- Phase 2 (CODEOWNERS): Standard patterns, unlikely to need additional research. picomatch for glob matching is well-documented.
- Phase 3 (Embeddings): Needs early platform validation (sqlite-vec on macOS ARM64). Transformers.js ESM compatibility with the project's `"type": "module"` setup needs validation. If sqlite-vec smoke test fails, evaluate brute-force fallback approach.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | sqlite-vec verified via official docs + npm. nomic-embed-text-v1.5 verified on HuggingFace with ONNX + Transformers.js tags. CODEOWNERS format documented by GitHub. All versions current as of 2026-03-08. |
| Features | HIGH | Feature landscape based on direct codebase analysis of all 46 source files. Feature dependencies mapped against actual pipeline interfaces. |
| Architecture | HIGH | Three-pillar extension maps cleanly onto existing three-phase pipeline. Schema migrations are additive (ALTER TABLE + CREATE TABLE). No existing code restructuring required. |
| Pitfalls | HIGH | 11 pitfalls identified through codebase analysis + library documentation. Platform risk (sqlite-vec) flagged with concrete mitigation. Pipeline phase isolation concern verified against actual extractRepoData() / persistExtractedData() code. |

## Known Discrepancy

ARCHITECTURE.md (written by a parallel researcher or earlier run) references `all-MiniLM-L6-v2` (384d embeddings) as the embedding model. STACK.md (this research cycle) recommends **nomic-embed-text-v1.5** (768d, truncated to 256d via Matryoshka) based on superior retrieval accuracy, task prefix support, 8K context length, and Matryoshka dimension flexibility. **STACK.md should be treated as authoritative for model choice.** ARCHITECTURE.md vector dimensions and model references need updating during roadmap/planning to align with STACK.md (256d instead of 384d, nomic-embed-text-v1.5 instead of all-MiniLM-L6-v2).

## Gaps to Address

- **sqlite-vec macOS ARM64 runtime validation:** Prebuilt binary exists on npm but has not been smoke-tested on the actual development machine. This is the single most important validation task before building any embedding code.
- **Gateway config format:** The actual gateway technology and config format used across Fresha repos is unknown. Phase A may need to defer gateway extraction (TOPO-03) or narrow scope to the specific format encountered.
- **HTTP client regex accuracy:** HTTP client detection via regex is inherently lower-confidence than gRPC stub detection. The `confidence` field on topology edges mitigates this, but real-world false positive rates are unknown until tested against actual repos.
- **Embedding quality for code/architecture descriptions:** nomic-embed-text-v1.5 is a general-purpose model. Its retrieval accuracy on microservice architecture descriptions (module names, Elixir terminology) is theoretically good (MTEB 61.04 at 256d) but unvalidated with project-specific data.
- **Transformers.js ESM compatibility:** The project uses `"type": "module"` with ESNext modules and bundler moduleResolution. Transformers.js v3 supports ESM, but the exact import patterns and potential resolution issues with ONNX runtime native bindings need validation.
- **ARCHITECTURE.md alignment:** Model choice and vector dimensions need updating to match STACK.md recommendations (see Known Discrepancy above).

## Files Created

| File | Purpose |
|------|---------|
| `.planning/research/SUMMARY.md` | This file -- executive summary with roadmap implications |
| `.planning/research/STACK.md` | Technology recommendations for v2.0 additions (sqlite-vec, nomic-embed-text-v1.5, Transformers.js) |
| `.planning/research/FEATURES.md` | Feature landscape: table stakes, differentiators, anti-features, dependency graph |
| `.planning/research/ARCHITECTURE.md` | Detailed integration architecture: schema, pipeline, data flow, component map |
| `.planning/research/PITFALLS.md` | 11 domain pitfalls with prevention strategies, phase-specific warnings |

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all 46 source files in `src/`
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec) -- v0.1.7-alpha.2, vec0 API
- [sqlite-vec Node.js docs](https://alexgarcia.xyz/sqlite-vec/js.html) -- better-sqlite3 integration
- [nomic-embed-text-v1.5 HuggingFace](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) -- 137M params, Matryoshka, task prefixes
- [Transformers.js v3](https://huggingface.co/docs/transformers.js/en/index) -- @huggingface/transformers, ONNX runtime
- [GitHub CODEOWNERS docs](https://docs.github.com/articles/about-code-owners) -- format specification

### Secondary (MEDIUM confidence)
- [Embedding model benchmarks](https://supermemory.ai/blog/best-open-source-embedding-models-benchmarked-and-ranked/) -- nomic vs MiniLM comparison
- [Best code embedding models](https://modal.com/blog/6-best-code-embedding-models-compared) -- evaluation methodology
- [Transformers.js dtypes guide](https://huggingface.co/docs/transformers.js/en/guides/dtypes) -- q8 quantization
- [Embedding model discussion (HN)](https://news.ycombinator.com/item?id=46081800) -- "Don't use all-MiniLM-L6-v2 for new datasets"

---
*Research completed: 2026-03-08*
*Ready for roadmap: yes*
