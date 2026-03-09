---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Design-Time Intelligence
status: in-progress
stopped_at: Completed 20-01-PLAN.md
last_updated: "2026-03-09T09:10:48Z"
last_activity: 2026-03-09 — Completed 20-01 targeted repo reindex with git refresh
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 11
  completed_plans: 10
  percent: 91
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-08)

**Core value:** Eliminate repeated cost of AI agents re-learning codebase architecture every session
**Current focus:** Phase 20 - Targeted Repo Reindex with Git Refresh

## Current Position

Phase: 20 of 20 (Targeted Repo Reindex with Git Refresh)
Plan: 20-01 of 20-02
Status: Plan 20-01 Complete
Last activity: 2026-03-09 — Completed 20-01 targeted repo reindex with git refresh

Progress: [█████████░] 91%

## Performance Metrics

**Velocity:**
- Total plans completed: 32 (across v1.0-v1.2)
- v2.0 plans completed: 9
- 16-01: 5min (2 tasks, 10 files)
- 16-03: 4min (2 tasks, 4 files)
- 17-01: 5min (1 task TDD, 4 files)
- 17-02: 2min (2 tasks, 3 files)
- 18-01: 6min (2 tasks TDD, 10 files)
- 18-02: 6min (2 tasks TDD, 6 files)
- 19-01: 5min (2 tasks TDD, 7 files)
- 19-02: 5min (2 tasks TDD, 6 files)
- 20-01: 4min (2 tasks TDD, 5 files)

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

Recent decisions affecting current work:
- gitRefresh uses fetch+reset (not pull) to avoid merge conflicts
- Refresh step runs before Phase 1 pipeline loop so commit comparison sees updated branch tips
- --repo and --refresh are independent composable CLI flags
- nomic-embed-text-v1.5 over all-MiniLM-L6-v2 (research recommendation)
- 256d Matryoshka truncation from 768d for storage efficiency
- V7 migration for topology (edges.metadata), V8 for embeddings (vec0, conditional on sqlite-vec)
- Embeddings run as post-persistence Phase 4 step, not inside extractors
- vec0 entity_id uses text type (integer metadata columns have binding bugs with better-sqlite3)
- Buffer.from(float32Array.buffer) for vector insertion into vec0
- MECHANISM_FILTER_MAP maps grpc/http/gateway/kafka/event to relationship_type arrays
- VALID_MECHANISMS cast to tuple type for zod .enum() compatibility
- (pipeline as any)() cast for TS2590 union type complexity in @huggingface/transformers
- Model cached at ~/.kb/models/ for stability across npm reinstalls
- SKIP_EMBEDDING_MODEL env var for CI environments without model access
- RRF k=60 constant per original paper, 1-indexed ranks via 1/(k+i+1)
- FTS-only degradation preserves original FTS relevance (no RRF wrapping)
- searchSemantic over-fetches limit*2 for post-hydration filtering headroom
- CLI --semantic uses searchSemantic directly (pure vector), default uses searchHybrid (RRF fusion)
- kb_semantic MCP tool uses searchHybrid for best AI agent results (keyword+vector combined)

### Pending Todos

None.

### Roadmap Evolution

- Phase 20 added: Targeted Repo Reindex with Git Refresh

### Blockers/Concerns

- sqlite-vec macOS ARM64 compatibility CONFIRMED working (resolved in 18-01)
- Transformers.js ESM compatibility with project's "type": "module" CONFIRMED working (resolved in 18-02)

## Session Continuity

Last session: 2026-03-09T09:07:09Z
Stopped at: Completed 20-01-PLAN.md
Resume file: Continue with 20-02-PLAN.md
