---
phase: 10
slug: search-type-filtering
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.0.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/search/ tests/db/fts.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/ tests/db/fts.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | TF-01 | unit | `npx vitest run tests/db/fts.test.ts -x` | Needs update | ⬜ pending |
| 10-01-02 | 01 | 1 | TF-02, TF-03 | unit | `npx vitest run tests/search/text.test.ts -x` | Needs update | ⬜ pending |
| 10-01-03 | 01 | 1 | TF-04 | unit | `npx vitest run tests/search/text.test.ts -x` | Needs update | ⬜ pending |
| 10-01-04 | 01 | 1 | TF-05 | unit | `npx vitest run tests/search/entity.test.ts -x` | Needs update | ⬜ pending |
| 10-02-01 | 02 | 2 | TF-06 | unit | `npx vitest run tests/search/text.test.ts -x` | New test | ⬜ pending |
| 10-02-02 | 02 | 2 | TF-07 | integration | `npx vitest run tests/mcp/ -x` | Needs update | ⬜ pending |
| 10-02-03 | 02 | 2 | TF-08 | integration | `npx vitest run tests/mcp/ -x` | New test | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Update test data in `tests/search/text.test.ts` to include modules with different sub-types (schema, graphql_query, etc.)
- [ ] Update test data in `tests/db/fts.test.ts` for parent:subtype FTS format
- [ ] Existing FTS tests need sub-type coverage

*Existing vitest infrastructure covers all phase requirements — no new framework installation needed.*

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
