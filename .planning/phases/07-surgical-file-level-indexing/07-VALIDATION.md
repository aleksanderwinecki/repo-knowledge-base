---
phase: 07
slug: surgical-file-level-indexing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/indexer/pipeline.test.ts tests/indexer/writer.test.ts tests/db/schema.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/indexer/pipeline.test.ts tests/indexer/writer.test.ts tests/db/schema.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | IDX2-03 | unit | `npx vitest run tests/db/schema.test.ts` | Partial | pending |
| 07-01-02 | 01 | 1 | IDX2-03 | integration | `npx vitest run tests/indexer/writer.test.ts` | Partial | pending |
| 07-02-01 | 02 | 2 | IDX2-02, IDX2-03 | integration | `npx vitest run tests/indexer/pipeline.test.ts` | Partial | pending |
| 07-02-02 | 02 | 2 | IDX2-02 | integration | `npx vitest run tests/indexer/pipeline.test.ts` | Partial | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] `tests/db/schema.test.ts` — v4 migration tests (file_id on events)
- [ ] `tests/indexer/writer.test.ts` — persistSurgicalData tests, clearRepoFiles with file_id for events
- [ ] `tests/indexer/pipeline.test.ts` — surgical mode tests (single file change, fallback, mode reporting, surgical-vs-full equivalence)

*Existing infrastructure covers test framework needs. Only new test cases needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
