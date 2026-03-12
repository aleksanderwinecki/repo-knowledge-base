---
phase: 37
slug: event-consumer-tracking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (latest) |
| **Config file** | vitest.config.ts (implicit via package.json) |
| **Quick run command** | `npx vitest run tests/search/field-impact.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/field-impact.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 37-01-01 | 01 | 1 | ECT-01 | unit | `npx vitest run tests/search/field-impact.test.ts` | Needs new tests | ⬜ pending |
| 37-01-02 | 01 | 1 | ECT-02 | unit | `npx vitest run tests/indexer/topology/kafka.test.ts` | Existing, extend if needed | ⬜ pending |
| 37-01-03 | 01 | 1 | ECT-03 | unit | `npx vitest run tests/search/field-impact.test.ts` | Needs new tests | ⬜ pending |
| 37-01-04 | 01 | 1 | ECT-04 | unit | `npx vitest run tests/search/field-impact.test.ts` | Existing (8 tests) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases in `tests/search/field-impact.test.ts` for topic-inferred consumers (no ecto match)
- [ ] New test cases for confirmed consumers (topic + ecto match, upgraded confidence)
- [ ] New test cases for `via` chain in consumer output
- [ ] New test cases for compact formatter with new consumer shape

*Existing infrastructure covers framework needs. Only new test cases required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Kafka pattern coverage | ECT-02 | Requires indexing real repos | Run `kb_search "Broadway"` after deployment to spot-check non-Kafkaesque patterns |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
