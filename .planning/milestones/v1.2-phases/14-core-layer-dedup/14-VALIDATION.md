---
phase: 14
slug: core-layer-dedup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (latest via devDep) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | CORE-05 | unit | `npx vitest run tests/search/text.test.ts tests/search/entity.test.ts tests/db/fts.test.ts` | ✅ (fts helper test needed) | ⬜ pending |
| 14-01-02 | 01 | 1 | CORE-03, CORE-04 | integration | `npx vitest run tests/search/text.test.ts tests/search/entity.test.ts` | ✅ | ⬜ pending |
| 14-02-01 | 02 | 2 | CORE-07 | unit | `npx vitest run tests/indexer/writer.test.ts` | ✅ | ⬜ pending |
| 14-02-02 | 02 | 2 | CORE-01, CORE-06, CORE-08 | integration | `npx vitest run tests/indexer/pipeline.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/db/fts.test.ts` — add test for `executeFtsWithFallback()` helper (CORE-05)

*All other test coverage already exists. Existing pipeline, writer, text, and entity tests cover behaviors being refactored.*

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
