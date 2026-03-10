---
phase: 29
slug: field-extraction-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/indexer/fields.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~21 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/indexer/fields.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 25 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 1 | FLD-04 | unit | `npx vitest run tests/db/schema.test.ts` | ✅ | ⬜ pending |
| 29-01-02 | 01 | 1 | FLD-01, NULL-01 | unit | `npx vitest run tests/indexer/fields.test.ts` | ❌ W0 | ⬜ pending |
| 29-01-03 | 01 | 1 | FLD-02, NULL-02 | unit | `npx vitest run tests/indexer/fields.test.ts` | ❌ W0 | ⬜ pending |
| 29-01-04 | 01 | 1 | FLD-03 | unit | `npx vitest run tests/indexer/fields.test.ts` | ❌ W0 | ⬜ pending |
| 29-02-01 | 02 | 2 | FLD-01..04 | integration | `npx vitest run tests/indexer/pipeline.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/indexer/fields.test.ts` — stubs for field extraction unit tests (Ecto, proto, GraphQL)
- [ ] Existing `tests/indexer/pipeline.test.ts` covers integration

*One new test file required.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
