---
phase: 23
slug: graph-infrastructure
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-09
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.0.0 |
| **Config file** | `vitest.config.ts` (exists, `tests/**/*.test.ts` pattern) |
| **Quick run command** | `npx vitest run tests/search/graph.test.ts tests/search/edge-utils.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/graph.test.ts tests/search/edge-utils.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 23-01-01 | 01 | 1 | GRAPH-05 | unit | `npx vitest run tests/search/edge-utils.test.ts` | Wave 0 | pending |
| 23-01-02 | 01 | 1 | GRAPH-05 | regression | `npx vitest run tests/search/dependencies.test.ts` | Exists | pending |
| 23-02-01 | 02 | 2 | GRAPH-01, GRAPH-04 | unit (RED) | `npx vitest run tests/search/graph.test.ts 2>&1 \| tail -5 \| grep -q "FAIL"` | Wave 0 | pending |
| 23-02-02 | 02 | 2 | GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04 | unit (GREEN) | `npx vitest run tests/search/graph.test.ts` | Task 1 creates | pending |
| 23-02-03 | 02 | 2 | GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04 | regression | `npm run build && npx vitest run` | Exists | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/search/graph.test.ts` — created in Plan 02 Task 1 (RED phase, TDD)
- [ ] `tests/search/edge-utils.test.ts` — created in Plan 01 Task 1 (TDD)

*Existing `tests/search/dependencies.test.ts` covers regression safety for the refactor.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 8s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
