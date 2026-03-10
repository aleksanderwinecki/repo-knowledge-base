# Requirements: Repo Knowledge Base

**Defined:** 2026-03-10
**Core Value:** Eliminate the repeated cost of AI agents re-learning codebase architecture every session

## v3.1 Requirements

Requirements for Indexing UX milestone. Each maps to roadmap phases.

### Progress Reporting

- [x] **PROG-01**: Git refresh phase shows a live counter that updates in-place (`Refreshing [42/412]...`)
- [x] **PROG-02**: Extraction/indexing phase shows a live counter with current repo name (`Indexing [42/412] app-foo...`)
- [x] **PROG-03**: Progress counters use `\r` line overwrite on TTY, plain newlines on non-TTY

### Error Grouping

- [x] **ERR-01**: Git refresh failures are collected and printed as a grouped summary by failure category (worktree conflict, dirty working tree, timeout, other)
- [x] **ERR-02**: "Skipping X: no main or master branch" messages are collected and shown as a single count with repo list
- [ ] **ERR-03**: Indexing errors are listed individually at the end, not interleaved with progress

### Output Control

- [ ] **OUT-01**: JSON results array is only written to stdout when `--json` flag is passed or stdout is not a TTY (pipe detection)
- [ ] **OUT-02**: Human-readable summary replaces the JSON dump as the default TTY output
- [ ] **OUT-03**: Per-repo "Indexing X... done" lines are suppressed in favor of the progress counter (detail available via `--verbose` or `--json`)

### Summary

- [ ] **SUM-01**: Final summary shows: total repos, indexed count, skipped count, error count, and elapsed time
- [ ] **SUM-02**: Errors section lists each failed repo with its error message
- [ ] **SUM-03**: Summary is compact — fits in a single terminal screen for a 400-repo run

## Future Requirements

Deferred to post-v3.1 milestones.

### Advanced Output

- **AOUT-01**: Colorized output (green for success, red for errors, yellow for warnings)
- **AOUT-02**: Spinner animation during extraction phase
- **AOUT-03**: ETA estimation based on historical indexing times

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Colorized terminal output | Nice-to-have, not needed for v3.1 — plain text is sufficient |
| Parallel git refresh | Would complicate progress reporting; sequential is fast enough |
| Web-based progress UI | CLI only |
| Log file output | Console output is sufficient for now |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROG-01 | Phase 27 | Complete |
| PROG-02 | Phase 27 | Complete |
| PROG-03 | Phase 27 | Complete |
| ERR-01 | Phase 27 | Complete |
| ERR-02 | Phase 27 | Complete |
| ERR-03 | Phase 27 | Pending |
| OUT-01 | Phase 28 | Pending |
| OUT-02 | Phase 28 | Pending |
| OUT-03 | Phase 28 | Pending |
| SUM-01 | Phase 28 | Pending |
| SUM-02 | Phase 28 | Pending |
| SUM-03 | Phase 28 | Pending |

**Coverage:**
- v3.1 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap creation*
