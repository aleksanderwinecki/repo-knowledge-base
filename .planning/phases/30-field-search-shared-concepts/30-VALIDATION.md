---
phase: 30
slug: field-search-shared-concepts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/search/text.test.ts tests/search/entity.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~25 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/text.test.ts tests/search/entity.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 30-01-01 | 01 | 1 | FSRCH-01, FSRCH-02 | unit+integration | `npx vitest run tests/search/text.test.ts` | ❌ W0 | ⬜ pending |
| 30-01-02 | 01 | 1 | FSRCH-03 | integration | `npx vitest run tests/search/text.test.ts` | ❌ W0 | ⬜ pending |
| 30-02-01 | 02 | 2 | SHARED-01, SHARED-02 | unit+integration | `npx vitest run tests/search/entity.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Field-specific test cases in `tests/search/text.test.ts` — field FTS search, compound name matching, type filtering
- [ ] Field-specific test cases in `tests/search/entity.test.ts` — field entity cards, shared concepts
- [ ] Field FTS cleanup tests in `tests/indexer/writer.test.ts` — clearRepoEntities/clearRepoFiles with field FTS

*Three test files need field-specific stubs.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
