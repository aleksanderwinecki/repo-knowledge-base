---
phase: 19
slug: semantic-search
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/search/semantic.test.ts tests/search/hybrid.test.ts -x` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/semantic.test.ts tests/search/hybrid.test.ts tests/embeddings/pipeline.test.ts -x`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | SEM-04, SEM-06 | unit | `npx vitest run tests/search/semantic.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | SEM-05, SEM-06 | unit | `npx vitest run tests/search/hybrid.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 | 2 | SEM-04, SEM-06 | unit | `npx vitest run tests/cli/search.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-02-02 | 02 | 2 | SEM-07 | unit | `npx vitest run tests/mcp/tools.test.ts -x` | Extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/search/semantic.test.ts` — KNN search with mock embeddings, graceful degradation, repo filter
- [ ] `tests/search/hybrid.test.ts` — RRF scoring logic, dedup, degradation to FTS5-only, limit enforcement
- [ ] Extend `tests/embeddings/pipeline.test.ts` — add `generateQueryEmbedding` tests
- [ ] Extend `tests/mcp/tools.test.ts` — add `kb_semantic` tool contract test

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end semantic search quality | SEM-04 | Subjective relevance | Run `kb search --semantic "which services handle payments"` on real indexed data |

---

## Test Strategy Note

Most tests use **mock embeddings** — synthetic Float32Arrays inserted directly into vec0. This avoids model downloads and tests KNN + RRF + hydration deterministically. Only Phase 18's existing integration tests need the real model.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
