---
phase: 26
slug: service-explanation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.0.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/search/explain.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/explain.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 26-01-01 | 01 | 1 | EXPLAIN-02 | unit | `npx vitest run tests/search/explain.test.ts -x` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | EXPLAIN-03 | unit | `npx vitest run tests/search/explain.test.ts -x` | ❌ W0 | ⬜ pending |
| 26-01-03 | 01 | 1 | EXPLAIN-04 | unit | `npx vitest run tests/search/explain.test.ts -x` | ❌ W0 | ⬜ pending |
| 26-01-04 | 01 | 1 | EXPLAIN-05 | unit | `npx vitest run tests/search/explain.test.ts -x` | ❌ W0 | ⬜ pending |
| 26-02-01 | 02 | 1 | EXPLAIN-01 | integration | `npx vitest run tests/integration/explain-wiring.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/search/explain.test.ts` — stubs for EXPLAIN-02, EXPLAIN-03, EXPLAIN-04, EXPLAIN-05
- [ ] `tests/integration/explain-wiring.test.ts` — stubs for EXPLAIN-01 (MCP + CLI + barrel exports)

*Existing vitest infrastructure covers all framework needs.*

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
