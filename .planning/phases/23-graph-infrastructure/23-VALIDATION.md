---
phase: 23
slug: graph-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 23-02-01 | 02 | 1 | GRAPH-01 | unit | `npx vitest run tests/search/graph.test.ts -t "buildGraph"` | Wave 0 | pending |
| 23-02-02 | 02 | 1 | GRAPH-01 | unit | `npx vitest run tests/search/graph.test.ts -t "performance"` | Wave 0 | pending |
| 23-02-03 | 02 | 1 | GRAPH-02 | unit | `npx vitest run tests/search/graph.test.ts -t "bfsDownstream"` | Wave 0 | pending |
| 23-02-04 | 02 | 1 | GRAPH-03 | unit | `npx vitest run tests/search/graph.test.ts -t "shortestPath"` | Wave 0 | pending |
| 23-02-05 | 02 | 1 | GRAPH-04 | unit | `npx vitest run tests/search/graph.test.ts -t "event\|kafka"` | Wave 0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/search/graph.test.ts` — stubs for GRAPH-01 through GRAPH-04
- [ ] `tests/search/edge-utils.test.ts` — stubs for GRAPH-05

*Existing `tests/search/dependencies.test.ts` covers regression safety for the refactor.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
