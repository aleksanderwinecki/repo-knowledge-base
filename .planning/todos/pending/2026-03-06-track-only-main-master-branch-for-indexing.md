---
created: "2026-03-06T11:08:18.239Z"
title: Track only main/master branch for indexing
area: indexer
files:
  - src/indexer/git.ts:7-18
  - src/indexer/pipeline.ts:90-113
  - src/mcp/sync.ts:27-72
---

## Problem

`getCurrentCommit()` uses `git rev-parse HEAD` which tracks whatever branch is checked out. In a large org where engineers frequently checkout PR branches, this causes wasteful re-indexing churn:

1. Checkout PR branch → HEAD changes → full wipe-and-rewrite re-index triggered
2. Switch back to main → HEAD changes again → another full re-index

The canonical architecture of each service is on `main`/`master`, not transient PR branches. Indexing PR state pollutes the knowledge base with temporary changes.

## Solution

Change `getCurrentCommit()` to resolve `origin/main` or `origin/master` instead of `HEAD`:

1. In `git.ts`: detect whether `origin/main` or `origin/master` exists, use that ref
2. `getChangedFiles()` diff base should also use the same default branch ref
3. `checkAndSyncRepos()` in `sync.ts` already calls `getCurrentCommit` — no changes needed there
4. Consider: may need `git fetch` to pick up remote changes, but devs pull regularly so likely fine
5. Fallback: if neither `origin/main` nor `origin/master` exists, fall back to `HEAD`
