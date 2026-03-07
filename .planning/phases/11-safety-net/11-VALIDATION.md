---
phase: 11
slug: safety-net
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/mcp/contracts.test.ts tests/search/golden.test.ts tests/cli/snapshots.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/mcp/contracts.test.ts tests/search/golden.test.ts tests/cli/snapshots.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | SAFE-01 | unit | `npx vitest run tests/mcp/contracts.test.ts -x` | -- W0 | pending |
| 11-01-02 | 01 | 1 | SAFE-02 | unit | `npx vitest run tests/search/golden.test.ts -x` | -- W0 | pending |
| 11-01-03 | 01 | 1 | SAFE-03 | unit | `npx vitest run tests/cli/snapshots.test.ts -x` | -- W0 | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] `tests/mcp/contracts.test.ts` — MCP tool contract tests for SAFE-01
- [ ] `tests/search/golden.test.ts` — FTS golden query tests for SAFE-02
- [ ] `tests/cli/snapshots.test.ts` — CLI output snapshot tests for SAFE-03
- [ ] `tests/fixtures/seed.ts` — shared seed data module (optional)

*(These ARE the deliverables — this phase is entirely test creation)*

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
