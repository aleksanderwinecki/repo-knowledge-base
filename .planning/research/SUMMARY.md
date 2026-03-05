# Research Summary: Repo Knowledge Base

**Domain:** Local codebase knowledge base with semantic search
**Researched:** 2026-03-05
**Overall confidence:** MEDIUM

## Executive Summary

Building a local knowledge base over ~50 Elixir microservice repos is a well-understood problem. The 2025/2026 stack converges on: TypeScript + SQLite (better-sqlite3) for structured storage, an embedding model for semantic search, and MCP for Claude Code integration. The key architectural decision is sqlite-vec (vector extension for SQLite) over standalone vector DBs, keeping everything in a single file with zero infrastructure.

There is a strategic tension in approach: **structured extraction + FTS5 first** versus **embeddings + vector search first**. The PITFALLS.md research strongly argues that naive code embedding produces poor results, and that structured queries ("which services consume BookingCreated?") deliver 80% of the value. However, the PROJECT.md explicitly requires semantic search, and the embedding path is not complicated -- just an API call. **The recommendation is: build both in parallel.** Structured extraction into SQLite tables handles the known-entity queries (events, services, schemas). OpenAI embeddings via sqlite-vec handle the fuzzy queries ("how does payment processing work?"). The structured path is the foundation; embeddings are the enhancement. This is not an either/or.

MCP server integration is the killer feature. The `@modelcontextprotocol/sdk` runs as a stdio process that Claude Code spawns. Architecture: shared core library with thin CLI and MCP wrappers. No HTTP server needed.

The biggest risks are: (1) sqlite-vec platform compatibility on macOS ARM64, (2) over-engineering for a 1.5-day hackathon, and (3) chunking quality -- embedding whole files produces garbage results.

## Key Findings

**Stack:** TypeScript + better-sqlite3 + sqlite-vec + OpenAI text-embedding-3-small + @modelcontextprotocol/sdk + commander
**Architecture:** Single-process, shared core library, CLI + MCP as thin entry points, one SQLite file for relational data + vectors
**Critical pitfall:** Over-engineering is the #1 hackathon killer. Build the simplest working demo first, sophisticate later.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Foundation + Storage** - TypeScript project setup, SQLite schema (services, events, documents, embeddings), validate sqlite-vec installation
   - Addresses: Persistent storage, data model for relationships
   - Avoids: sqlite-vec binary issues (catch early, fallback to LanceDB or pure-JS cosine if needed)

2. **Indexing Pipeline** - Repo scanning, basic extractors (metadata, README/docs, proto files), structured data into SQLite
   - Addresses: Service metadata extraction, event relationship extraction
   - Avoids: Over-engineering extractors (regex, not AST)

3. **Search (Structured + Semantic)** - FTS5 for text search, OpenAI embeddings + sqlite-vec for semantic search
   - Addresses: Semantic search, structured queries
   - Avoids: Embedding-only search (always pair with structured)

4. **CLI + MCP** - Commander CLI with search/index/status/learn commands, MCP server exposing search as tool
   - Addresses: CLI interface, MCP tool integration
   - Avoids: MCP blocking on indexing (search-only via MCP)

5. **Incremental Re-index** - Git-based change detection, only re-process changed files
   - Addresses: Incremental re-indexing, staleness tracking
   - Avoids: Git state edge cases (graceful fallback to full re-index)

6. **Domain Extractors (Post-MVP)** - GraphQL schemas, gRPC service defs, Ecto schemas, cross-repo dependency graph
   - Addresses: Schema extraction, dependency mapping
   - Avoids: Scope creep during hackathon

**Phase ordering rationale:**
- Storage first: everything depends on it, and validates sqlite-vec works on the target machine
- Indexing before search: need data to query
- Search before CLI/MCP: need working search to validate CLI output formatting
- CLI and MCP together: same core functions, different transport. Build simultaneously.
- Incremental re-index is optimization -- full re-index works, just slower

**Research flags for phases:**
- Phase 1: Validate sqlite-vec on macOS ARM64 immediately. Have fallback plan.
- Phase 4: MCP SDK API evolving rapidly. Check current docs before implementing.
- Phase 6: Proto file parsing needs domain-specific research per Fresha's conventions.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core choices sound but versions unverified (no web access during research). Run `npm view` to verify before install. |
| Features | HIGH | Based directly on PROJECT.md requirements. Feature landscape well-understood from competitor analysis. |
| Architecture | HIGH | Standard pattern. Shared core + thin entry points is proven in similar tools. |
| Pitfalls | MEDIUM | Based on common failure modes. sqlite-vec and MCP SDK specifics need hands-on validation. |

## Gaps to Address

- **sqlite-vec API verification:** Virtual table creation syntax, KNN query syntax, `loadExtension()` usage with current version
- **MCP SDK current API:** Evolving rapidly. Verify tool registration and stdio transport setup before Phase 4
- **@xenova/transformers vs @huggingface/transformers:** Which is the current recommended package? Check npm.
- **Elixir-specific chunking:** How to best chunk `.ex` files needs experimentation with real Fresha code
- **Fresha proto file conventions:** What do the actual proto files look like? Extractor design depends on this.
