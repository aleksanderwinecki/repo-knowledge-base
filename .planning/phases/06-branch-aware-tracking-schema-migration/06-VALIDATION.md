---
phase: 6
slug: branch-aware-tracking-schema-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/indexer/git.test.ts tests/db/schema.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/indexer/git.test.ts tests/db/schema.test.ts tests/indexer/pipeline.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 0 | IDX2-01 | unit | `npx vitest run tests/indexer/git.test.ts -t "resolveDefaultBranch"` | No - Wave 0 | ⬜ pending |
| 06-01-02 | 01 | 0 | IDX2-01 | unit | `npx vitest run tests/indexer/git.test.ts -t "getBranchCommit"` | No - Wave 0 | ⬜ pending |
| 06-01-03 | 01 | 0 | IDX2-01 | unit | `npx vitest run tests/indexer/git.test.ts -t "readBranchFile"` | No - Wave 0 | ⬜ pending |
| 06-01-04 | 01 | 0 | IDX2-01 | unit | `npx vitest run tests/indexer/git.test.ts -t "listBranchFiles"` | No - Wave 0 | ⬜ pending |
| 06-01-05 | 01 | 0 | IDX2-01 | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "branch"` | No - Wave 0 | ⬜ pending |
| 06-01-06 | 01 | 0 | IDX2-01 | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "skip"` | No - Wave 0 | ⬜ pending |
| 06-01-07 | 01 | 0 | IDX2-01 | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "detached"` | No - Wave 0 | ⬜ pending |
| 06-01-08 | 01 | 0 | IDX2-05 | unit | `npx vitest run tests/db/schema.test.ts -t "v3"` | No - Wave 0 | ⬜ pending |
| 06-01-09 | 01 | 0 | IDX2-05 | unit | `npx vitest run tests/db/schema.test.ts -t "preserv"` | No - Wave 0 | ⬜ pending |
| 06-01-10 | 01 | 0 | IDX2-05 | unit | `npx vitest run tests/indexer/writer.test.ts -t "default_branch"` | No - Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/indexer/git.test.ts` — new test cases for resolveDefaultBranch, getBranchCommit, readBranchFile, listBranchFiles
- [ ] `tests/indexer/pipeline.test.ts` — new test cases for branch-aware indexing, repo skipping, detached HEAD
- [ ] `tests/db/schema.test.ts` — new test cases for v2->v3 migration, column existence, data preservation
- [ ] `tests/indexer/writer.test.ts` — new test case for default_branch persistence
- [ ] Update existing schema tests to expect v3 columns

*Existing vitest infrastructure covers framework installation.*

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
