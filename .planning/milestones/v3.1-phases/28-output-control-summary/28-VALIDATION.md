---
phase: 28
slug: output-control-summary
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/cli/summary.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~21 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/cli/summary.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 25 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 28-01-01 | 01 | 1 | SUM-01, SUM-02, SUM-03 | unit | `npx vitest run tests/cli/summary.test.ts` | ❌ W0 | ⬜ pending |
| 28-02-01 | 02 | 2 | OUT-01, OUT-02, OUT-03 | integration | `npx vitest run tests/cli/index-cmd.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/cli/summary.test.ts` — stubs for formatSummary unit tests
- [ ] Existing `tests/cli/` directory may need new test file for index-cmd integration

*Existing infrastructure covers most needs — two new test files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| JSON output when piped | OUT-01 | Pipe detection requires real pipe | Run `kb index --repo app-payments \| head -1`, verify JSON output |
| Human summary on TTY | OUT-02 | TTY detection requires real terminal | Run `kb index --repo app-payments`, verify no JSON dump |
| Summary fits one screen | SUM-03 | Subjective screen size check | Run full `kb index`, verify summary is compact |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
