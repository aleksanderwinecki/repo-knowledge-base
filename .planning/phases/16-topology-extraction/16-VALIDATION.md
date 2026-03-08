---
phase: 16
slug: topology-extraction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | TOPO-01 | unit+integration | `npm test -- --run -t "grpc"` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 1 | TOPO-02 | unit+integration | `npm test -- --run -t "http"` | ❌ W0 | ⬜ pending |
| 16-01-03 | 01 | 1 | TOPO-04 | unit+integration | `npm test -- --run -t "kafka"` | ❌ W0 | ⬜ pending |
| 16-02-01 | 02 | 1 | TOPO-03 | unit+integration | `npm test -- --run -t "gateway"` | ❌ W0 | ⬜ pending |
| 16-XX-XX | XX | 2 | ALL | integration | `npm test -- --run -t "topology"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/indexer/__tests__/topology.test.ts` — topology extractor unit tests (gRPC, HTTP, Kafka patterns)
- [ ] `src/indexer/__tests__/gateway.test.ts` — gateway config extractor tests
- [ ] Test fixtures with sample Elixir files containing gRPC/HTTP/Kafka patterns

*Existing test infrastructure (vitest, test helpers) covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real repo indexing produces topology edges | ALL | Requires actual repo files on disk | Run `kb index --force` on 5+ repos, verify edges via `sqlite3 ~/.kb/knowledge.db "SELECT * FROM edges WHERE relationship_type LIKE 'calls_%' OR relationship_type LIKE 'routes_%' OR relationship_type LIKE '%kafka%'"` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
