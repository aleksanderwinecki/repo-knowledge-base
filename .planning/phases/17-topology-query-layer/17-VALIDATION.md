---
phase: 17
slug: topology-query-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/search/dependencies.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/dependencies.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | TOPO-05 | unit | `npx vitest run tests/search/dependencies.test.ts -t "all edge types"` | Partially | ⬜ pending |
| 17-01-02 | 01 | 1 | TOPO-05 | unit | `npx vitest run tests/search/dependencies.test.ts -t "direct edges"` | ❌ W0 | ⬜ pending |
| 17-01-03 | 01 | 1 | TOPO-05 | unit | `npx vitest run tests/search/dependencies.test.ts -t "unresolved"` | ❌ W0 | ⬜ pending |
| 17-01-04 | 01 | 1 | TOPO-06 | unit | `npx vitest run tests/search/dependencies.test.ts -t "mechanism filter"` | ❌ W0 | ⬜ pending |
| 17-01-05 | 01 | 1 | TOPO-06 | unit | `npx vitest run tests/search/dependencies.test.ts -t "invalid mechanism"` | ❌ W0 | ⬜ pending |
| 17-01-06 | 01 | 1 | TOPO-06 | unit | `npx vitest run tests/mcp/deps.test.ts` | ❌ W0 | ⬜ pending |
| 17-01-07 | 01 | 1 | TOPO-07 | unit | `npx vitest run tests/search/dependencies.test.ts -t "confidence"` | ❌ W0 | ⬜ pending |
| 17-01-08 | 01 | 1 | TOPO-07 | unit | `npx vitest run tests/search/dependencies.test.ts -t "null confidence"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases in `tests/search/dependencies.test.ts` for direct edges, mechanism filter, confidence, unresolved targets
- [ ] Test data setup: existing beforeEach only creates event edges; needs topology edges with metadata JSON
- [ ] MCP deps test coverage (either new `tests/mcp/deps.test.ts` or verify via CLI tests + hygiene test)

*Existing infrastructure covers framework setup; new test stubs needed for topology-specific behaviors.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
