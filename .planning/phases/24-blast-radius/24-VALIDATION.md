---
phase: 24
slug: blast-radius
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (latest) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/search/graph.test.ts tests/search/impact.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/graph.test.ts tests/search/impact.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 24-01-01 | 01 | 1 | IMPACT-03, IMPACT-04 | unit | `npx vitest run tests/search/graph.test.ts` | ✅ (add bfsUpstream tests) | ⬜ pending |
| 24-02-01 | 02 | 1 | IMPACT-01, IMPACT-02, IMPACT-05, IMPACT-06 | unit | `npx vitest run tests/search/impact.test.ts` | ❌ W0 | ⬜ pending |
| 24-02-02 | 02 | 1 | IMPACT-07 | unit | `npx vitest run tests/search/impact.test.ts` | ❌ W0 | ⬜ pending |
| 24-03-01 | 03 | 2 | IMPACT-01 | integration | `npx vitest run tests/mcp/tools.test.ts` | ✅ (add kb_impact tests) | ⬜ pending |
| 24-03-02 | 03 | 2 | IMPACT-01 | contract | `npx vitest run tests/mcp/contracts.test.ts` | ✅ (add kb_impact contract) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/search/impact.test.ts` — stubs for IMPACT-01 through IMPACT-07 (core logic)
- [ ] `tests/search/graph.test.ts` — ADD bfsUpstream describe block (IMPACT-03, IMPACT-04)

*Existing infrastructure covers framework and fixtures.*

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
