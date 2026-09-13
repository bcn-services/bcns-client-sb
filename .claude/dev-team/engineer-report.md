# Engineer Report
**Task:** Item D — Monday.com + Google Meet home panels for the SB Command Center rebuild
**Branch:** feat/monday-meet-panels (worktree `.claude/worktrees/monday-meet-panels`, stacked on feat/shell-home @ 6653b70)
**Date:** 2026-09-13

## Design Decisions
- Item A already built full panel chrome, all three states, and every shaping helper (`sortPriorityTasks`, `taskBadge`, `sortRecentNotes`, `noteExcerpt` in `lib/panels.ts`) — this item is pure wiring: two reads + props, no new logic.
- DB query narrows to `kind='task'` / `kind='meeting_note'`, ordered, `limit(50)` (well above the panels' top-5/top-3); final sort/tone/nulls-last stays entirely in `lib/panels.ts`, called inside `MeetPanel`/`MondayPanel` — DB order is only a coarse pre-cap, not the display order.
- `mondayState`/`meetState` now derive from real row presence (`taskRows.length > 0` / `noteRows.length > 0`) instead of the hardcoded `false` item A left as the seam marker.
- A failed `jobs_v1`/`messages_v1` read degrades to `[]` (not-connected/empty rendering) via the same `unwrap`/`Promise.allSettled` pattern as every other home read — it cannot blank the page.
- No CSS changes: item A's panel chrome already renders all three states correctly for Meet/Monday, confirmed live.

## Files Changed
- `app/page.tsx` — added `jobs_v1` (`kind='task'`, ordered `due_on` asc nullsFirst:false, limit 50) and `messages_v1` (`kind='meeting_note'`, ordered `occurred_at` desc, limit 50) to the home `Promise.allSettled`; unwrapped alongside the existing six reads; `mondayState`/`meetState` computed from row presence; `MeetPanel`/`MondayPanel` now receive real `notes`/`tasks` rows instead of `[]`.
- `tests/panels.test.mjs` — added two tests: `sortPriorityTasks` defaults to a 5-row cap and `sortRecentNotes` defaults to a 3-row cap, each from a synthetic 50-row batch (matching the new server-side cap). Sort order, nulls-last, tone rule, and excerpt trimming were already covered by item A's tests and needed no changes.

## Verification
- `corepack pnpm typecheck` → `$ tsc --noEmit` (no output, exit 0)
- `corepack pnpm lint` → `$ eslint .` (no output, exit 0)
- `corepack pnpm test` → `# tests 78 / # pass 77 / # fail 0 / # skipped 1`
- `corepack pnpm build` → `✓ Compiled successfully`, `✓ Generating static pages (7/7)`, routes `ƒ /`, `ƒ /financials`, `ƒ /library`, `ƒ /login`, `ƒ /api/health`
- Signed-in smoke via `shot.mjs` on `:3104` as smoke+sb: home renders the full grid; Meet and Monday both show their not-connected state ("Not connected yet. Connect Google Meet" / "Not connected yet. Connect Monday.com") — correct, since `connector_health_v1` has no rows for `monday`/`meet` on this SB account (matches every other panel). Integrations popup, Settings popup, and the range pill all opened correctly; `/financials` and `/library` reached. Dev log (`dev-3104.log`) has no errors from the two new reads (or anywhere else) across all navigations.

## Deferred / Out of Scope
- Live "data" state for Meet/Monday is unverified end-to-end against real rows (no `jobs_v1`/`messages_v1` rows exist in this SB account yet) — the shaping logic itself (sort, tone, excerpt, caps) is unit-tested in `tests/panels.test.mjs` by item A and this item, and the query/prop wiring is now live; QA can seed rows via the data client to exercise the data state if desired.
- Everything else (Financial Information, Content Library, header, shell) is out of scope per DESIGN.md — items B/C.

## Flags for Reviewer
- `jobs_v1`/`messages_v1` reads have no date-range filter (Monday/Meet panels are not range-bound per DESIGN.md — "Priority Tasks" and "Recent Meeting Notes" are point-in-time, not range metrics), only a `limit(50)` cap; a board/inbox with heavy task/note churn could still see a stale top-5/3 if the 50-row window rolls past the true priority set. Upgrade: a `kind`+`is_done`/`occurred_at`-aware server-side pre-sort if this becomes visible in practice.
- Same PostgREST-default-limit caveat item A flagged for `campaign_daily_v1`/`creative_daily_v1` applies here in spirit, but at a much smaller, deliberately-chosen cap (50 vs the display need of 5/3), so the risk surface is small.

## Conflicts with DESIGN.md
None found — item A's seam (props, states, chrome) matched the spec exactly; this item only needed to supply real data.
