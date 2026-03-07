---
phase: 12
slug: database-performance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/db/database.test.ts tests/db/schema.test.ts tests/indexer/writer.test.ts tests/search/entity.test.ts tests/search/dependencies.test.ts -x` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/db/database.test.ts tests/db/schema.test.ts tests/indexer/writer.test.ts tests/search/entity.test.ts tests/search/dependencies.test.ts -x`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | PERF-01 | unit | `npx vitest run tests/db/database.test.ts -t "pragma" -x` | Extend existing | pending |
| 12-01-02 | 01 | 1 | PERF-03 | unit | `npx vitest run tests/db/schema.test.ts -t "v5" -x` | Extend existing | pending |
| 12-01-03 | 01 | 1 | PERF-06 | unit | `npx vitest run tests/db/schema.test.ts -t "prefix" -x` | Extend existing | pending |
| 12-02-01 | 02 | 1 | PERF-02 | unit | `npx vitest run tests/indexer/writer.test.ts -x` | Existing | pending |
| 12-02-02 | 02 | 1 | PERF-02 | unit | `npx vitest run tests/search/entity.test.ts -x` | Existing | pending |
| 12-02-03 | 02 | 1 | PERF-02 | unit | `npx vitest run tests/search/dependencies.test.ts -x` | Existing | pending |
| 12-03-01 | 03 | 2 | PERF-04 | integration | `npx vitest run tests/indexer/pipeline.test.ts -x` | Extend existing | pending |
| 12-03-02 | 03 | 2 | PERF-05 | integration | `npx vitest run tests/indexer/pipeline.test.ts -x` | Extend existing | pending |
| 12-03-03 | 03 | 2 | PERF-07 | unit | `npx vitest run tests/cli/snapshots.test.ts -x` | Extend existing | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/db/database.test.ts` — add pragma verification tests (cache_size, temp_store, mmap_size)
- [ ] `tests/db/schema.test.ts` — add V5 migration tests (indexes exist, FTS prefix config, data preserved)
- [ ] Existing Phase 11 safety net tests (contracts, golden, snapshots) serve as regression guards — no new test files needed

*Existing infrastructure covers most phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Benchmark improvement | PERF-07 | Timing values vary by machine | Run `kb index --timing` before and after, compare wall-clock times |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
