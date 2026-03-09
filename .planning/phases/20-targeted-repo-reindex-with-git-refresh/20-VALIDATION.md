---
phase: 20
slug: targeted-repo-reindex-with-git-refresh
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/indexer/git.test.ts tests/indexer/pipeline.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/indexer/git.test.ts tests/indexer/pipeline.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | RIDX-01 | unit | `npx vitest run tests/indexer/git.test.ts -t "gitRefresh"` | ❌ W0 | ⬜ pending |
| 20-01-02 | 01 | 1 | RIDX-02 | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "targeted"` | ❌ W0 | ⬜ pending |
| 20-01-03 | 01 | 1 | RIDX-03 | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "refresh"` | ❌ W0 | ⬜ pending |
| 20-01-04 | 01 | 1 | RIDX-04 | unit | `npx vitest run tests/indexer/git.test.ts -t "refresh error"` | ❌ W0 | ⬜ pending |
| 20-02-01 | 02 | 1 | RIDX-05 | unit | `npx vitest run tests/mcp/tools.test.ts -t "reindex"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases in `tests/indexer/git.test.ts` for gitRefresh()
- [ ] New test cases in `tests/indexer/pipeline.test.ts` for targeted repo filtering + refresh integration
- [ ] New test cases in `tests/mcp/tools.test.ts` for kb_reindex MCP tool

*Existing infrastructure covers framework setup — only new test files/cases needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Git fetch from real remote | RIDX-02 | Requires network access | Run `kb index --repo app-resources --refresh` on a real repo |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
