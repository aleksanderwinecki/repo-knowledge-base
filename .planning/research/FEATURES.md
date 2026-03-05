# Feature Research

**Domain:** Codebase knowledge base / code intelligence for local microservice indexing
**Researched:** 2026-03-05
**Confidence:** MEDIUM (based on training data knowledge of Sourcegraph, Greptile, Continue.dev, Bloop; no live verification possible)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Full-text code search** | Every code intelligence tool has it. Without search, it's just a data dump nobody can query. | LOW | Regex + literal. SQLite FTS5 handles this well for ~50 repos. |
| **Service metadata extraction** | If indexing microservices, users expect to see what each service is (language, framework, purpose, key deps). Basic inventory. | MEDIUM | Parse package.json/mix.exs, README, directory structure. Elixir-specific parsers needed. |
| **Incremental re-indexing** | Nobody wants to wait 10 minutes every time one file changes. Git-diff-based indexing is the baseline expectation. | MEDIUM | `git diff --name-only <last-indexed-sha>..HEAD` per repo, re-index only changed files. |
| **CLI query interface** | The tool must be queryable from the terminal. Engineers live in terminals. | LOW | Standard CLI with subcommands: `rkb search`, `rkb index`, `rkb show`. |
| **MCP tool integration** | This is the core value prop -- any Claude session can query mid-conversation. Without MCP, it's just another CLI tool. | MEDIUM | MCP server exposing search/query tools. Sourcegraph Cody and Continue.dev both proved that IDE/agent integration is where the value lives. |
| **Persistent storage** | Data must survive process restarts. Obvious, but worth stating. | LOW | SQLite. Zero-config, single file, fast enough for this scale. |
| **Service dependency graph** | "Who calls whom?" is the first question anyone asks about microservices. Sourcegraph's dependency graph and Greptile's codebase understanding both center on this. | HIGH | Parse proto files, Kafka configs, HTTP clients, gRPC stubs. The parsing is the hard part -- many implicit dependencies. |
| **Event/message flow mapping** | In a Kafka-heavy ecosystem, "which services produce/consume BookingCreated?" is the canonical query. | HIGH | Parse proto definitions, Kafka consumer/producer configs. Fresha-specific patterns. |

### Differentiators (Competitive Advantage)

Features that set the product apart from generic code search. These align with the "persistent, self-improving" vision.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Learned patterns from past tasks** | No competitor does this for local tooling. "To add an event field, touch these files in these repos" is gold -- it's institutional knowledge that currently lives in engineers' heads. | HIGH | Needs a mechanism to record task context + files touched. Could start manual, automate later. |
| **Manual knowledge injection ("learn" command)** | Lets engineers teach the tool facts that can't be parsed from code. "Service X is being deprecated, use Y instead." Bloop and Sourcegraph don't do this -- they're read-only indexes. | LOW | Store key-value or freetext facts in SQLite, make them searchable alongside code knowledge. |
| **Natural language semantic search** | "Which services handle payments?" requires understanding, not just text matching. Greptile's core differentiator is semantic understanding of codebases. | HIGH | Requires embeddings (local or API). Could use ollama locally or OpenAI API. Significant complexity vs. value tradeoff for hackathon. |
| **Cross-repo relationship awareness** | Most tools index repos in isolation. Understanding that service-a's proto is consumed by service-b, service-c, and service-d is cross-repo intelligence. This is what Sourcegraph's cross-repo navigation does, but for architectural knowledge rather than symbol navigation. | MEDIUM | Build on top of event/dependency extraction. The indexer already has the data -- this is about the query layer surfacing cross-repo connections. |
| **Schema/API surface extraction** | Index GraphQL schemas, gRPC service definitions, Ecto schemas per service. Know the API surface of every service without opening the repo. | MEDIUM | Parse .graphql files, .proto files, Ecto schema modules. Structured extraction into queryable format. |
| **Stale knowledge detection** | Flag when indexed knowledge is outdated (repo changed significantly since last index). Sourcegraph does this with precise code intel staleness indicators. | LOW | Compare current HEAD sha to indexed sha per repo. Show age/drift metrics. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Real-time file watching** | "Always up to date!" sounds appealing. | Massive complexity for negligible value. 50+ repos with file watchers = resource hog. Incremental re-index on demand is sufficient and the PROJECT.md already calls this out of scope. | On-demand `rkb index` or pre-commit hook trigger. |
| **Full AST parsing for every language** | "Deep code understanding!" | Maintaining AST parsers for Elixir, JS, proto, GraphQL is an enormous surface area. Sourcegraph has a whole team for this (SCIP/LSIF). For a hackathon tool, regex + file-pattern heuristics get 80% of the value for 5% of the cost. | Pattern-based extraction (regex on well-known file patterns) supplemented with targeted parsers only for high-value extractions. |
| **Vector database for embeddings** | "Semantic search needs a vector DB!" | Adds infrastructure dependency (Chroma, Qdrant, etc.) that violates the zero-infrastructure constraint. For ~50 repos, you don't need ANN search. | SQLite + simple cosine similarity on stored embedding arrays, or skip embeddings entirely for v1 and use keyword search + structured queries. |
| **UI dashboard** | "Visualize the dependency graph!" | Scope creep. A web UI is a whole project in itself. Already out of scope per PROJECT.md. | CLI output + JSON export that can be piped to other visualization tools if needed. |
| **Code generation / PR creation** | "If it understands the code, it should be able to modify it!" | This is an action layer, not a knowledge layer. Mixing concerns turns a focused tool into a sprawling platform. PROJECT.md explicitly excludes this. | Expose knowledge via MCP so that Claude Code (the action layer) can use it to make informed changes. Clean separation. |
| **Multi-user / team sync** | "Share the knowledge base across the team!" | Adds auth, conflict resolution, sync infrastructure. Way beyond hackathon scope. | Each engineer runs their own local instance. Knowledge files can be checked into repos if sharing is needed. |
| **Embedding-based code search as primary search** | Greptile-style semantic-only search. | Embedding search without a fallback to exact text match is frustrating. "Find all uses of BookingCreated" should be exact, not fuzzy. | Text search as primary. Semantic search as a supplementary mode for natural language queries. |

## Feature Dependencies

```
Persistent Storage (SQLite)
    |
    +---> Service Metadata Extraction
    |         |
    |         +---> Service Dependency Graph
    |         |         |
    |         |         +---> Cross-repo Relationship Queries
    |         |         +---> Event/Message Flow Mapping
    |         |
    |         +---> Schema/API Surface Extraction
    |
    +---> Full-text Code Search
    |         |
    |         +---> Natural Language Semantic Search (enhances)
    |
    +---> Manual Knowledge Injection
    |
    +---> Learned Patterns from Past Tasks
    |
    +---> Incremental Re-indexing
              |
              +---> Stale Knowledge Detection

CLI Query Interface --requires--> All of the above (it's the access layer)

MCP Tool Integration --requires--> CLI Query Interface (or at minimum, the same query logic)
```

### Dependency Notes

- **Service Dependency Graph requires Service Metadata Extraction:** You need to know what services exist before you can map their relationships.
- **Event/Message Flow requires Dependency Graph:** Event flows are a subset of the dependency graph -- producer/consumer relationships are dependencies.
- **Cross-repo Relationship Queries require Dependency Graph:** This is the query layer on top of the graph data.
- **Natural Language Semantic Search enhances Full-text Search:** Semantic search is additive. Text search must work first.
- **MCP Tool Integration requires query logic:** MCP exposes the same query capabilities as CLI, just over a different transport.
- **Learned Patterns requires only Persistent Storage:** Independent track -- can be built in parallel with indexing.

## MVP Definition

### Launch With (v1 -- Hackathon Demo)

- [ ] **Persistent Storage (SQLite)** -- foundation for everything
- [ ] **Service Metadata Extraction** -- basic inventory of all repos (name, language, framework, purpose)
- [ ] **Full-text Code Search** -- FTS5-based search across indexed content
- [ ] **Event/Message Flow Mapping** -- proto file parsing for producer/consumer relationships (the canonical "which services consume BookingCreated?" query)
- [ ] **CLI Query Interface** -- `rkb index`, `rkb search`, `rkb show <service>`, `rkb events <event-name>`
- [ ] **MCP Tool Integration** -- expose search and query as MCP tools for Claude Code
- [ ] **Incremental Re-indexing** -- git-diff-based, only re-index changed files

### Add After Validation (v1.x)

- [ ] **Service Dependency Graph** -- full graph including gRPC, HTTP, and Kafka dependencies (beyond just events)
- [ ] **Schema/API Surface Extraction** -- GraphQL schemas, Ecto schemas per service
- [ ] **Manual Knowledge Injection** -- `rkb learn "Service X is deprecated, migrate to Y"`
- [ ] **Stale Knowledge Detection** -- show which repos are outdated in the index
- [ ] **Cross-repo Relationship Queries** -- "what would break if I change this proto?"

### Future Consideration (v2+)

- [ ] **Learned Patterns from Past Tasks** -- needs a task recording mechanism, significant design work
- [ ] **Natural Language Semantic Search** -- requires embedding infrastructure, evaluate after v1 keyword search proves insufficient
- [ ] **Dependency impact analysis** -- "if I change X, what services are affected?" (requires complete dependency graph)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Service Metadata Extraction | HIGH | MEDIUM | P1 |
| Full-text Code Search (FTS5) | HIGH | LOW | P1 |
| Event/Message Flow Mapping | HIGH | HIGH | P1 |
| CLI Query Interface | HIGH | LOW | P1 |
| MCP Tool Integration | HIGH | MEDIUM | P1 |
| Incremental Re-indexing | HIGH | MEDIUM | P1 |
| Persistent Storage (SQLite) | HIGH | LOW | P1 |
| Service Dependency Graph | HIGH | HIGH | P2 |
| Schema/API Surface Extraction | MEDIUM | MEDIUM | P2 |
| Manual Knowledge Injection | MEDIUM | LOW | P2 |
| Stale Knowledge Detection | LOW | LOW | P2 |
| Cross-repo Relationship Queries | HIGH | MEDIUM | P2 |
| Learned Patterns | HIGH | HIGH | P3 |
| Natural Language Semantic Search | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for hackathon demo
- P2: Should have, add when possible post-hackathon
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Sourcegraph | Greptile | Continue.dev | Bloop | Our Approach |
|---------|-------------|----------|--------------|-------|--------------|
| Code search | Regex, structural, symbol search across all repos | Semantic search via embeddings | @codebase context provider with embeddings | Natural language + regex code search | FTS5 keyword search, structured queries for known entities |
| Cross-repo navigation | SCIP/LSIF-based precise go-to-definition | API-based codebase Q&A | Limited to open files + indexed workspace | Single-repo focused | Relationship graph built from proto/config parsing |
| Dependency mapping | Repository dependency graph | Implicit via semantic understanding | Not a focus | Not a focus | Explicit extraction from proto, Kafka, gRPC configs |
| Event flow tracking | Not built-in (code search can find it) | Not built-in | Not built-in | Not built-in | **Core differentiator**: first-class event producer/consumer mapping |
| Incremental indexing | Yes (precise indexers) | Yes (webhook-triggered) | Yes (on file save) | Yes | Git-diff-based per repo |
| Knowledge injection | No (read-only index) | No | No | No | **Differentiator**: `rkb learn` command for manual facts |
| Learned patterns | No | No | No | No | **Differentiator**: record task patterns for future reference |
| AI agent integration | Cody (their own AI) | API for external AI tools | Built into Continue IDE extension | Built-in chat | MCP tool for any Claude Code session |
| Hosting model | Cloud or self-hosted server | Cloud API | Local (IDE extension) | Cloud or local | Local only, zero infrastructure |
| Scale target | Millions of repos | Thousands of repos | Single workspace | Single repo to medium orgs | ~50 repos, local machine |

**Key takeaway from competitor analysis:** Nobody does local-first, persistent, Elixir-microservice-aware knowledge indexing with manual knowledge injection. Sourcegraph is the closest in capability but is a heavy server deployment. Greptile is cloud-only API. Continue.dev is IDE-bound. Our niche is clear: lightweight local tool that knows your specific microservice ecosystem deeply.

## Sources

- Sourcegraph documentation and product features (training data, MEDIUM confidence)
- Greptile product description and API documentation (training data, MEDIUM confidence)
- Continue.dev documentation on context providers (training data, MEDIUM confidence)
- Bloop product features (training data, LOW confidence -- Bloop pivoted/changed significantly)
- PROJECT.md requirements and constraints (HIGH confidence, direct source)

**Note:** WebSearch and WebFetch were both unavailable during this research session. All competitor analysis is based on training data (cutoff ~early 2025). Specific feature claims about competitors should be verified before making strategic decisions based on them. The feature categorization for *our* product is HIGH confidence since it's derived from the PROJECT.md requirements and well-understood patterns in the domain.

---
*Feature research for: Codebase knowledge base / code intelligence*
*Researched: 2026-03-05*
