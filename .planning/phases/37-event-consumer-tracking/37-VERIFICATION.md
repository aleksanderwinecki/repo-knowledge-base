---
phase: 37-event-consumer-tracking
verified: 2026-03-12T11:30:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 37: Event Consumer Tracking — Verification Report

**Phase Goal:** `kb_field_impact` shows which services consume events containing a traced field — closing the "0 consumers" blind spot by extracting Kafka topic subscriptions and linking them to published event schemas

**Verified:** 2026-03-12T11:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A service subscribing to a Kafka topic carrying an event with the traced field appears as a consumer even without a local ecto field | VERIFIED | Test "returns topic-inferred consumer when subscriber has no ecto field match" passes. `analyzeFieldImpact()` iterates forward kafka/event edges and adds subscriber repoIds to `consumerMap` regardless of ecto field presence. |
| 2 | A service that is both a topic subscriber AND has a matching ecto field gets confidence 'confirmed' | VERIFIED | Test "returns confirmed consumer with via chain when downstream repo has same field + topic subscription" passes. Step 5 upgrades existing consumerMap entries to `confidence: 'confirmed'` and adds ecto field details. |
| 3 | A service that is only a topic subscriber (no ecto match) gets confidence 'inferred' | VERIFIED | Initial consumerMap insertion sets `confidence: 'inferred'`; skipped in Step 5 upgrade if no ecto match found. |
| 4 | Each consumer entry includes a via chain showing the topic and event that linked them | VERIFIED | `via: { topic: edge.via, event: protoNames[0] }` set on every consumer insertion. Test assertions confirm `via.topic` and `via.event` are present. |
| 5 | Boundary repos do not appear as their own consumers (self-loop exclusion) | VERIFIED | `!boundaryRepoIds.has(edge.targetRepoId)` guard on line 180. Test "excludes boundary repo from consumers" passes with 0 consumers. |
| 6 | All existing field-impact tests still pass | VERIFIED | 17 tests total pass; original 8 tests (renamed/updated) all green. |
| 7 | MCP `kb_field_impact` response includes confidence and via fields for each consumer | VERIFIED | `formatFieldImpactCompact()` maps each `FieldConsumer` to compact shape with `repo`, `confidence`, optional `via`. MCP tool calls `formatFieldImpactCompact` and returns `JSON.stringify` of result. |
| 8 | CLI `field-impact` output includes consumer confidence and via | VERIFIED | CLI calls `analyzeFieldImpact()` and passes raw `FieldImpactResult` to `output()` which JSON-serializes it — `FieldConsumer[]` naturally includes all fields including `confidence` and `via`. |
| 9 | 4000 char budget still enforced | VERIFIED | `formatFieldImpactCompact()` truncates consumers then origins if `JSON.stringify(compact).length > 4000`. Budget test passes (600 line test file, test at line 572). |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/search/field-impact.ts` | `FieldConsumer` type, `FieldImpactResult` with `consumers: FieldConsumer[]`, topic-bridging in `analyzeFieldImpact()`, updated `formatFieldImpactCompact()` | VERIFIED | File is 322 lines. Exports `FieldConsumer`, `FieldImpactResult`, `FieldImpactCompact`, `analyzeFieldImpact`, `formatFieldImpactCompact`. Full implementation present — no stubs. |
| `src/mcp/tools/field-impact.ts` | MCP tool returning compact format with consumer confidence/via; description mentions confidence tiers | VERIFIED | 46 lines. Tool description: "...consuming services with nullability and consumer confidence". Calls `formatFieldImpactCompact`. |
| `src/cli/commands/field-impact.ts` | CLI command outputting full `FieldImpactResult` (which now has `FieldConsumer[]`) | VERIFIED | 26 lines. Calls `analyzeFieldImpact(db, field)` and `output(result)`. No changes needed — type flows through. |
| `tests/search/field-impact.test.ts` | New tests for topic-inferred, confirmed, via chain, self-loop, summary count; min 350 lines | VERIFIED | 600 lines. 17 tests total — 5+ new tests covering all required scenarios. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/search/field-impact.ts` | `src/search/graph.ts` | `graph.forward.get()` with `mechanism='kafka'\|'event'` | WIRED | Line 170: `graph.forward.get(boundary.repoId) ?? []`. `buildGraph` imported on line 2. `edge.mechanism === 'kafka' \|\| edge.mechanism === 'event'` on line 174. |
| `src/search/field-impact.ts` | fields table | SQL query `parent_type = 'proto_message'` for boundary classification | WIRED | Line 115: `occ.parent_type === 'proto_message'` used to classify boundaries from the query result. SQL at line 72 fetches all `parent_type` values. |
| `src/search/field-impact.ts formatFieldImpactCompact()` | `FieldConsumer` type | Maps each consumer with `confidence` and optional `via` | WIRED | Lines 283–293: maps `c.repoName → repo`, `c.confidence`, `c.via`, `c.parentName → schema`, `c.fieldType → type`, `c.nullable`. Pattern `confidence.*inferred\|confirmed` matches at lines 47, 65, 185, 225. |
| `src/mcp/tools/field-impact.ts` | `formatFieldImpactCompact()` | Calls formatter and returns JSON | WIRED | Line 9 imports `formatFieldImpactCompact`. Line 42: `return JSON.stringify(formatFieldImpactCompact(result))`. |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ECT-01 | 37-01, 37-02 | `kb_field_impact` results include a `consumers` section listing services that subscribe to Kafka topics carrying events with the traced field | SATISFIED | `FieldImpactResult.consumers: FieldConsumer[]` populated by topic-inferred detection. Verified by tests and REQUIREMENTS.md marks as `[x]`. |
| ECT-02 | 37-01 only | Kafka consumer detection uses existing Kafkaesque patterns; new extraction patterns added only if significant gaps found | DEFERRED (by design) | 37-01 PLAN claims ECT-02, but 37-01 SUMMARY explicitly defers it: "non-Kafkaesque consumer extraction deferred per research recommendation — existing patterns sufficient." REQUIREMENTS.md marks ECT-02 as `[ ]` Planned. No orphan — the deferral is intentional and documented. No new extraction patterns needed because existing graph edges suffice. |
| ECT-03 | 37-01, 37-02 | Consumer subscriptions linked to event proto schemas via same-repo co-occurrence, creating publisher->topic->consumer chain with confidence tiers | SATISFIED | `protosByBoundaryRepo` map implements same-repo co-occurrence. `via: { topic, event }` chain on each consumer. Confidence tiers `'inferred' \| 'confirmed'` implemented and tested. |
| ECT-04 | 37-01, 37-02 | Existing field impact tests continue to pass; new tests verify consumer detection for known event fields | SATISFIED | All 17 tests pass. 5+ new consumer detection tests added covering inferred, confirmed, self-loop, no-subscribers, summary count, multiple boundaries. |

**ECT-02 note:** ECT-02 is marked "Planned" in REQUIREMENTS.md (not complete) and was intentionally deferred by research findings. This is not a gap in goal achievement — the goal was to close the "0 consumers" blind spot via Kafka topic subscription detection, which ECT-01/ECT-03/ECT-04 achieve. ECT-02 covered non-Kafkaesque patterns that research determined were not worth the cost.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODO/FIXME/placeholder comments found. No stub implementations. No empty handlers. All consumer detection logic fully implemented.

---

### Human Verification Required

None. All observable behaviors are verifiable via automated test suite, source inspection, and build verification. The test suite directly exercises:

- Inferred consumer detection (topic subscription without local ecto field)
- Confirmed consumer upgrade (topic subscription + ecto field match)
- Via chain content (correct topic and event names)
- Self-loop exclusion
- Summary count accuracy
- Compact formatter shapes for both consumer types
- 4000 char budget enforcement

---

### Commit Verification

All 4 commits documented in SUMMARYs confirmed present in git history:

| Commit | Description | Status |
|--------|-------------|--------|
| `e75f617` | test(37-01): add failing tests for topic-inferred consumers | VERIFIED |
| `d0a3f36` | feat(37-01): implement topic-inferred consumer detection | VERIFIED |
| `063fc44` | test(37-02): add compact formatter tests for inferred/confirmed consumers | VERIFIED |
| `dcd85eb` | feat(37-02): update MCP field-impact tool description | VERIFIED |

---

### Build Verification

`npm run build` exits clean — zero TypeScript compilation errors.

---

## Summary

Phase 37 achieved its goal. The "0 consumers" blind spot in `kb_field_impact` is closed: services subscribing to Kafka topics whose events contain the traced field now appear in the `consumers` array with confidence tiers (`'inferred'` for topic-only, `'confirmed'` when the consumer also has a local ecto field match) and a `via` chain recording the topic and proto event that established the link.

All 9 must-have truths verified. All 4 artifacts substantive and wired. All 4 key links confirmed. ECT-02 is intentionally deferred by research recommendation, which is consistent with REQUIREMENTS.md marking it "Planned". This deferral does not affect goal achievement since the core blind spot (0 consumers) was addressed through Kafka topic bridging alone.

---

_Verified: 2026-03-12T11:30:00Z_
_Verifier: Claude (gsd-verifier)_
