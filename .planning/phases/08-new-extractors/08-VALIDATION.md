---
phase: 8
slug: new-extractors
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/indexer/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/indexer/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 0 | EXT-03 | unit | `npx vitest run tests/indexer/graphql.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 0 | EXT-05 | unit | `npx vitest run tests/indexer/catalog.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 0 | EXT-02 | unit | `npx vitest run tests/indexer/elixir.test.ts -t "ecto"` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 0 | EXT-04 | unit | `npx vitest run tests/indexer/elixir.test.ts -t "absinthe"` | ❌ W0 | ⬜ pending |
| 08-01-05 | 01 | 0 | EXT-06 | unit | `npx vitest run tests/indexer/elixir.test.ts -t "grpc"` | ❌ W0 | ⬜ pending |
| 08-01-06 | 01 | 0 | EXT-01 | unit | `npx vitest run tests/indexer/pipeline.test.ts -t "grpc"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/indexer/graphql.test.ts` — stubs for EXT-03 (parseGraphqlFile, extractGraphqlDefinitions)
- [ ] `tests/indexer/catalog.test.ts` — stubs for EXT-05 (parseFrontmatter, enrichFromEventCatalog, matching)
- [ ] Add Ecto field/association tests to `tests/indexer/elixir.test.ts` — stubs for EXT-02
- [ ] Add Absinthe macro tests to `tests/indexer/elixir.test.ts` — stubs for EXT-04
- [ ] Add gRPC stub detection tests to `tests/indexer/elixir.test.ts` — stubs for EXT-06
- [ ] Add gRPC service persistence tests to `tests/indexer/pipeline.test.ts` — stubs for EXT-01
- [ ] Add service cleanup tests to `tests/indexer/writer.test.ts` — covers surgical mode

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EventCatalog match rate | EXT-05 | Depends on actual catalog data alignment | Run full index with catalog, check match/miss counts in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
