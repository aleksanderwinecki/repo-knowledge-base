---
phase: 31
slug: field-edges-field-impact
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 31 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/search/field-impact.test.ts tests/indexer/writer.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~25 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/search/field-impact.test.ts tests/indexer/writer.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 31-01-01 | 01 | 1 | FEDGE-01 | integration | `npx vitest run tests/indexer/writer.test.ts` | ✅ (add tests) | ⬜ pending |
| 31-01-02 | 01 | 1 | FEDGE-02 | unit | `npx vitest run tests/search/field-impact.test.ts` | ❌ W0 | ⬜ pending |
| 31-02-01 | 02 | 2 | FIMPACT-01, FIMPACT-02 | unit | `npx vitest run tests/search/field-impact.test.ts` | ❌ W0 | ⬜ pending |
| 31-02-02 | 02 | 2 | FIMPACT-03 | integration | `npx vitest run tests/mcp/tools.test.ts` | ✅ (add tests) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/search/field-impact.test.ts` — field impact analysis tests (BFS traversal, output structure, nullability)
- [ ] Field edge tests in `tests/indexer/writer.test.ts` — maps_to edge creation during persistence
- [ ] MCP tool test in `tests/mcp/tools.test.ts` — kb_field_impact tool registration and response

*One new test file, two existing files need new test cases.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
