---
phase: 26-service-explanation
verified: 2026-03-09T17:44:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 26: Service Explanation Verification Report

**Phase Goal:** Agents can get a structured overview card for any service, replacing manual exploration
**Verified:** 2026-03-09T17:44:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Agent can run `kb_explain <service>` (MCP) or `kb explain <service>` (CLI) and get a structured service card | VERIFIED | MCP tool registered in server.ts (line 43), CLI command in cli/index.ts (line 37), integration test confirms JSON output with all fields (explain-wiring.test.ts:82-103) |
| 2 | Card includes identity, description, inbound/outbound connections grouped by mechanism, events produced/consumed, and entity counts | VERIFIED | explainService returns ExplainResult with name/description/path/talks_to/called_by/events/modules/counts -- 28 unit tests cover each section (explain.test.ts) |
| 3 | Card includes "talks to" / "called by" summaries and top modules by type | VERIFIED | buildConnectionSummary produces "Talks to N services (...). Called by M services." format (explain.ts:360-378), modules grouped by type with top 5 names (explain.ts:410-433), tested in explain.test.ts:278-330 and 378-410 |
| 4 | Card includes actionable next-step hints for agents | VERIFIED | Static AGENT_HINTS array with kb_impact, kb_trace, kb_deps suggestions, placeholder substitution (explain.ts:37-41, 106), tested in explain.test.ts:445-458 |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/search/explain.ts` | Core module: ExplainResult type + explainService function | VERIFIED | 453 lines, exports explainService and ExplainResult, full SQL aggregation across repos/edges/events/modules/files/services tables |
| `tests/search/explain.test.ts` | Unit tests for all card sections | VERIFIED | 578 lines, 28 tests covering identity, direct/event/kafka connections, summary, events, modules, counts, hints, truncation, deduplication, self-exclusion, empty/error cases |
| `src/mcp/tools/explain.ts` | MCP tool registration | VERIFIED | 32 lines, exports registerExplainTool, uses withAutoSync and wrapToolHandler |
| `src/cli/commands/explain.ts` | CLI command registration | VERIFIED | 25 lines, exports registerExplain, try/catch with EXPLAIN_ERROR handling |
| `tests/integration/explain-wiring.test.ts` | Integration tests for MCP + CLI + barrel | VERIFIED | 125 lines, 5 tests: tool registration, known service, unknown service error, barrel function export, barrel type export |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/mcp/tools/explain.ts` | `src/search/explain.ts` | `import { explainService }` | WIRED | Line 9: `import { explainService } from '../../search/explain.js'` |
| `src/cli/commands/explain.ts` | `src/search/explain.ts` | `import { explainService }` | WIRED | Line 8: `import { explainService } from '../../search/explain.js'` |
| `src/mcp/server.ts` | `src/mcp/tools/explain.ts` | `registerExplainTool(server, db)` | WIRED | Line 24: import, Line 43: `registerExplainTool(server, db)` |
| `src/cli/index.ts` | `src/cli/commands/explain.ts` | `registerExplain(program)` | WIRED | Line 19: import, Line 37: `registerExplain(program)` |
| `src/search/index.ts` | `src/search/explain.ts` | barrel export | WIRED | Line 19: `export { explainService }`, Line 38: `export type { ExplainResult }` |
| `src/search/explain.ts` | repos table | SQL query | WIRED | Line 57: `SELECT id, name, path, description FROM repos WHERE name = ?` |
| `src/search/explain.ts` | edges table | SQL query | WIRED | Lines 139-146, 160-168: direct edge queries; Lines 181-201, 210-231: event-mediated; Lines 239-300: kafka-mediated |
| `src/search/explain.ts` | events table | SQL JOIN | WIRED | Lines 386-400: `JOIN events ev ON ev.id = e.target_id` for produces/consumes |
| `src/search/explain.ts` | modules table | SQL query | WIRED | Lines 414-416: `SELECT type, COUNT(*) ... FROM modules WHERE repo_id = ?` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXPLAIN-01 | 26-02 | Agent can get a structured service card via MCP tool `kb_explain` or CLI `kb explain` | SATISFIED | MCP tool registered in server.ts, CLI command in cli/index.ts, 5 integration tests pass |
| EXPLAIN-02 | 26-01 | Card includes service identity, description, inbound/outbound connections grouped by mechanism | SATISFIED | ExplainResult type has name/description/path/talks_to/called_by, connections grouped by mechanism (grpc/http/gateway/event/kafka), 10+ unit tests |
| EXPLAIN-03 | 26-01 | Card includes events produced/consumed, entity counts by type, and repo metadata | SATISFIED | events.produces/consumes arrays, modules Record with count+top, counts.files and counts.grpc_services, tested in explain.test.ts |
| EXPLAIN-04 | 26-01 | Card includes "talks to" / "called by" summaries and top modules by type | SATISFIED | summary field with "Talks to N services (...). Called by M services.", modules with top 5 per type |
| EXPLAIN-05 | 26-01 | Card includes next-step hints for agents | SATISFIED | hints array with kb_impact, kb_trace, kb_deps suggestions, service name substituted |

No orphaned requirements found. All 5 EXPLAIN requirements mapped in REQUIREMENTS.md traceability table with Phase 26 and marked Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | - |

No TODOs, FIXMEs, placeholders, empty implementations, or stub patterns detected in any phase 26 file.

### Human Verification Required

### 1. End-to-End CLI Output

**Test:** Run `kb explain <known-service>` against a real indexed database
**Expected:** Well-structured JSON with populated talks_to, called_by, events, modules, counts, and hints
**Why human:** Integration tests use synthetic data; real-world service cards may expose edge cases in SQL aggregation

### 2. MCP Tool via Claude Code

**Test:** Ask an agent to explain a service via `kb_explain`
**Expected:** Agent receives structured card and can use hints for follow-up queries
**Why human:** Verifies MCP transport and agent usability, not just unit-level correctness

### Gaps Summary

No gaps found. All four success criteria from ROADMAP.md are verified through code inspection and test execution. The full test suite passes at 672 tests with zero regressions. All 5 EXPLAIN requirements are covered by the two plans and verified in the codebase.

---

_Verified: 2026-03-09T17:44:00Z_
_Verifier: Claude (gsd-verifier)_
