---
phase: 37-event-consumer-tracking
plan: 01
subsystem: search
tags: [kafka, field-impact, consumer-detection, confidence-tiers, topic-bridging]

# Dependency graph
requires:
  - phase: 36-ecto-constraint-extraction
    provides: Ecto field nullability with attribute resolution
provides:
  - FieldConsumer type with confidence tiers and via chains
  - Topic-inferred consumer detection in analyzeFieldImpact()
  - Updated FieldImpactCompact consumer shape with confidence/via
affects: [37-02 compact formatter and MCP/CLI output]

# Tech tracking
tech-stack:
  added: []
  patterns: [topic-to-event same-repo co-occurrence bridging, Map-based consumer dedup with confidence upgrade]

key-files:
  created: []
  modified:
    - src/search/field-impact.ts
    - tests/search/field-impact.test.ts

key-decisions:
  - "Query-time topic-to-event bridging via same-repo co-occurrence (no schema changes needed)"
  - "Map<repoId, FieldConsumer> for dedup with in-place upgrade from inferred to confirmed"
  - "Via chain uses first proto message name from boundary repo (conservative attribution)"

patterns-established:
  - "Consumer confidence tiers: 'inferred' (topic-only) vs 'confirmed' (topic + ecto match)"
  - "Topic-event bridging: all proto messages in a boundary repo attributed to all its topics"

requirements-completed: [ECT-01, ECT-03, ECT-04]

# Metrics
duration: 4min
completed: 2026-03-12
---

# Phase 37 Plan 01: Topic-Inferred Consumer Detection Summary

**FieldConsumer type with 'inferred'/'confirmed' confidence tiers, topic-to-event bridging via same-repo co-occurrence, and via chains showing topic+event reasoning**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-12T10:15:22Z
- **Completed:** 2026-03-12T10:19:12Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Services subscribing to Kafka topics carrying events with a traced field now appear as consumers even without a local ecto field match
- Two confidence tiers: 'inferred' (topic subscription only) and 'confirmed' (topic + ecto field match)
- Each consumer entry includes a via chain ({topic, event}) explaining WHY it's listed
- All 861 tests pass including 5 new consumer detection tests and 10 existing field-impact tests

## Task Commits

Each task was committed atomically:

1. **RED: Failing tests for consumer detection** - `e75f617` (test)
2. **GREEN: Implement topic-inferred consumers** - `d0a3f36` (feat)

_TDD plan: RED wrote 5 new tests + updated 1 existing, GREEN implemented FieldConsumer type and detection logic._

## Files Created/Modified
- `src/search/field-impact.ts` - Added FieldConsumer interface, topic-inferred consumer detection in analyzeFieldImpact(), updated formatFieldImpactCompact() for new consumer shape, updated FieldImpactCompact type
- `tests/search/field-impact.test.ts` - 5 new tests: topic-inferred consumer, confirmed consumer with via chain, self-loop exclusion, no subscribers case, summary count with inferred consumers, multiple boundaries/topics

## Decisions Made
- **Query-time bridging:** Topic-to-event links computed at query time using same-repo co-occurrence (no schema changes, no new tables)
- **Map-based consumer dedup:** Using `Map<number, FieldConsumer>` keyed by repoId -- naturally deduplicates and allows in-place upgrade from inferred to confirmed when ecto match found
- **Via chain uses first proto:** When a boundary repo has multiple proto messages containing the traced field, the via chain references the first one found (conservative, deterministic)
- **Kept 4KB budget:** No increase -- the added confidence/via fields add ~60 chars per consumer, well within truncation capacity

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test expectation for "no subscribers" case**
- **Found during:** GREEN phase
- **Issue:** Test expected boundary.topics to contain 'item-events' but graph.ts only resolves kafka forward edges when both producer and consumer exist for a topic. With only a producer, no resolved edge exists.
- **Fix:** Removed the topics assertion from the "no subscribers" test -- the behavior is correct (topics derived from resolved graph edges)
- **Files modified:** tests/search/field-impact.test.ts
- **Verification:** All 15 field-impact tests pass
- **Committed in:** d0a3f36 (GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test expectation)
**Impact on plan:** Trivial test correction. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FieldConsumer type and analyzeFieldImpact() ready for plan 37-02 (compact formatter, MCP, and CLI output updates)
- FieldImpactCompact consumer shape already updated -- 37-02 may focus on CLI display and MCP description updates
- ECT-02 (non-Kafkaesque consumer extraction) deferred per research recommendation -- existing patterns sufficient

---
*Phase: 37-event-consumer-tracking*
*Completed: 2026-03-12*
