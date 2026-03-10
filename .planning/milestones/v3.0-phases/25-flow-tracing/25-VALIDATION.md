---
phase: 25
slug: flow-tracing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/search/trace.test.ts tests/integration/trace-wiring.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/trace.test.ts tests/integration/trace-wiring.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 1 | TRACE-01 | unit | `npx vitest run tests/search/trace.test.ts -t "returns result"` | ❌ W0 | ⬜ pending |
| 25-01-02 | 01 | 1 | TRACE-02 | unit | `npx vitest run tests/search/trace.test.ts -t "path_summary"` | ❌ W0 | ⬜ pending |
| 25-01-03 | 01 | 1 | TRACE-02 | unit | `npx vitest run tests/search/trace.test.ts -t "via"` | ❌ W0 | ⬜ pending |
| 25-01-04 | 01 | 1 | TRACE-03 | unit | `npx vitest run tests/search/trace.test.ts -t "not found"` | ❌ W0 | ⬜ pending |
| 25-01-05 | 01 | 1 | TRACE-03 | unit | `npx vitest run tests/search/trace.test.ts -t "no path"` | ❌ W0 | ⬜ pending |
| 25-01-06 | 01 | 1 | TRACE-03 | unit | `npx vitest run tests/search/trace.test.ts -t "both"` | ❌ W0 | ⬜ pending |
| 25-01-07 | 01 | 1 | TRACE-04 | unit | `npx vitest run tests/search/trace.test.ts -t "confidence"` | ❌ W0 | ⬜ pending |
| 25-02-01 | 02 | 1 | TRACE-01 | integration | `npx vitest run tests/integration/trace-wiring.test.ts -t "tool is registered"` | ❌ W0 | ⬜ pending |
| 25-02-02 | 02 | 1 | TRACE-01 | integration | `npx vitest run tests/integration/trace-wiring.test.ts -t "CLI"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/search/trace.test.ts` — stubs for TRACE-01 through TRACE-04
- [ ] `tests/integration/trace-wiring.test.ts` — stubs for MCP tool registration, CLI command, barrel exports

*Existing infrastructure covers test framework and fixtures.*

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
