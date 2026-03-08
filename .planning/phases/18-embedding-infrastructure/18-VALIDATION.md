---
phase: 18
slug: embedding-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/db/vec.test.ts tests/embeddings/ -x` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/db/vec.test.ts tests/embeddings/ -x`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | SEM-01 | unit | `npx vitest run tests/db/vec.test.ts -x` | ❌ W0 | ⬜ pending |
| 18-01-02 | 01 | 1 | SEM-01 | unit | `npx vitest run tests/db/vec.test.ts -x` | ❌ W0 | ⬜ pending |
| 18-02-01 | 02 | 1 | SEM-02, SEM-03 | unit | `npx vitest run tests/embeddings/text.test.ts -x` | ❌ W0 | ⬜ pending |
| 18-02-02 | 02 | 1 | SEM-02 | unit | `npx vitest run tests/embeddings/pipeline.test.ts -x` | ❌ W0 | ⬜ pending |
| 18-02-03 | 02 | 1 | SEM-02 | integration | `npx vitest run tests/embeddings/integration.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/db/vec.test.ts` — sqlite-vec loading, graceful degradation, vec0 DDL
- [ ] `tests/embeddings/text.test.ts` — embedding text composition per entity type, tokenizeForFts preprocessing
- [ ] `tests/embeddings/pipeline.test.ts` — embedding generation, Matryoshka truncation, Float32Array output
- [ ] `tests/embeddings/integration.test.ts` — end-to-end: persist entities then generate and store embeddings
- [ ] `tests/db/schema.test.ts` — update existing tests for SCHEMA_VERSION = 8 assertion

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| sqlite-vec loads on macOS ARM64 | SEM-01 | Platform-specific native extension | Run `npx vitest run tests/db/vec.test.ts` on macOS ARM64 machine |
| nomic-embed-text-v1.5 model download | SEM-02 | Requires network + model cache | First run downloads ~100MB model; verify `~/.kb/models/` or default cache |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
