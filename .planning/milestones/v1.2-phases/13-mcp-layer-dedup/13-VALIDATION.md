---
phase: 13
slug: mcp-layer-dedup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (latest via npm) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/mcp/ tests/knowledge/store.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/mcp/ tests/knowledge/store.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | MCP-04 | unit | `npx vitest run tests/mcp/ -x` | ✅ | ⬜ pending |
| 13-01-02 | 01 | 1 | MCP-01 | unit | `npx vitest run tests/mcp/contracts.test.ts -x` | ✅ | ⬜ pending |
| 13-01-03 | 01 | 1 | MCP-03 | unit | `npx vitest run tests/mcp/contracts.test.ts -x` | ✅ (needs update) | ⬜ pending |
| 13-01-04 | 01 | 1 | MCP-02 | unit | `npx vitest run tests/mcp/tools.test.ts -x` | ✅ | ⬜ pending |
| 13-01-05 | 01 | 1 | MCP-05 | unit | `npx vitest run tests/knowledge/store.test.ts -x` | ✅ (needs update) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/mcp/contracts.test.ts` — update expected key sets for learn/forget/status/cleanup/list-types to include `total`, `truncated` (MCP-03)
- [ ] `tests/knowledge/store.test.ts` — update FTS entity_type assertions from `'learned_fact'` to `'learned_fact:learned_fact'` (MCP-05)

*Existing infrastructure covers all phase requirements. Only assertion updates needed, no new test files.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
