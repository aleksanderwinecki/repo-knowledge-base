---
phase: 27
slug: progress-reporting-error-grouping
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/indexer/progress-reporter.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~21 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/indexer/progress-reporter.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 25 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 27-01-01 | 01 | 1 | PROG-01 | unit | `npx vitest run tests/indexer/progress-reporter.test.ts` | ❌ W0 | ⬜ pending |
| 27-01-02 | 01 | 1 | PROG-02 | unit | `npx vitest run tests/indexer/progress-reporter.test.ts` | ❌ W0 | ⬜ pending |
| 27-01-03 | 01 | 1 | PROG-03 | unit | `npx vitest run tests/indexer/progress-reporter.test.ts` | ❌ W0 | ⬜ pending |
| 27-01-04 | 01 | 1 | ERR-01 | unit | `npx vitest run tests/indexer/progress-reporter.test.ts` | ❌ W0 | ⬜ pending |
| 27-01-05 | 01 | 1 | ERR-02 | unit | `npx vitest run tests/indexer/progress-reporter.test.ts` | ❌ W0 | ⬜ pending |
| 27-02-01 | 02 | 1 | PROG-01..03 | integration | `npx vitest run tests/indexer/pipeline.test.ts` | ✅ | ⬜ pending |
| 27-02-02 | 02 | 1 | ERR-01..03 | integration | `npx vitest run tests/indexer/pipeline.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/indexer/progress-reporter.test.ts` — stubs for ProgressReporter and ErrorCollector unit tests
- [ ] Existing `tests/indexer/pipeline.test.ts` covers integration

*Existing infrastructure covers most needs — only one new test file required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `\r` overwrites on TTY | PROG-03 | TTY detection requires real terminal | Run `kb index --repo app-payments` in terminal, verify counter updates in-place |
| Plain newlines on non-TTY | PROG-03 | Pipe detection requires real pipe | Run `kb index --repo app-payments 2>&1 | cat`, verify separate lines |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
