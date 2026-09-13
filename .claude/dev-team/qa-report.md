# QA Report
**Task:** Item D — Monday.com + Google Meet home panels for the SB Command Center rebuild
**Branch:** feat/monday-meet-panels
**Date:** 2026-09-13
**Gate mode:** tests+behavioral

## VERDICT: PASS

## Criteria Checked
- Home reads `jobs_v1`(`kind='task'`)/`messages_v1`(`kind='meeting_note'`) inside `Promise.allSettled`, degrades via `unwrap` — `tests/qa-monday-meet.test.mjs` inspects `app/page.tsx` for the allSettled block, the `unwrap` function body, and the `taskRows`/`noteRows` `[] `fallback on `.error` — PASS
- Monday: ≤5 rows, not-done first then `due_on` asc nulls-last, badge tone rules — `tests/panels.test.mjs` (existing) + `tests/qa-monday-meet.test.mjs` new cases: duplicate `due_on` tiebreak by title, all-done batch, mixed-case "In PROGRESS"/"WORKING on it", >5 tasks capped keeping priority order — PASS
- Meet: ≤3 notes newest-first, title/date/excerpt, link only when `url` present w/ external-link props — `tests/panels.test.mjs` (existing, >3 batch cap) + `tests/qa-monday-meet.test.mjs`: multi-line/whitespace body excerpt, occurred_at ties; missing-`url` → no link covered by `tests/overview.test.mjs`'s `isSafeHttpsUrl` (gates `MeetPanel`'s `<a>` render) — PASS
- Three states, connection = health-row presence not data-row presence — `tests/qa-monday-meet.test.mjs`: `panelState([], [...], true)` → `not_connected` (rows w/o health row), `panelState(health, [...], false)` → `empty` (health w/o rows); confirmed live at 3104 (no monday/meet health rows → both panels render "Not connected yet") — PASS
- typecheck/lint/test green — see Gate outputs below — PASS

## Behavioral Evidence
- Live smoke on `:3104` signed in as `smoke+sb@bcn-services.com` via `shot.mjs`:
  - `home`: 7 panels rendered incl. "Google Meet / Note AI" and "Monday.com"; both show `"Not connected yet. Connect …"`; `alertCount: 0`; connect hrefs `?from=2026-09-07&to=2026-09-13&popup=integrations`.
  - Clicked Meet's "Connect Google Meet" link (`state-note__link`) → URL gained `popup=integrations`, and the Integrations `<details>` (`popup-panel__title === "Integrations"`) `open === true`, listing Monday.com/Google Meet rows as "Not connected".
  - Screenshots read (Read tool): `/Users/nateseluga/.claude/jobs/8d474d1e/tmp/qa-d/shots/home.png` (grid renders correctly, both panels' not-connected chrome matches DESIGN.md) and `home-meet-connect-result.png` (Integrations popup open, correct rows).
  - `grep -iE "error|warn" dev-3104.log` → only the pre-existing `.npmrc` pnpm registry warning, no app errors from the two new reads or navigation.
- Data-state (live rows in `jobs_v1`/`messages_v1`) not exercised live — no such rows exist in this SB account (engineer report flagged this too); covered instead by the unit fixtures above, which is the interpretation tested.

## Gate Outputs
- `corepack pnpm typecheck` → `$ tsc --noEmit`, no output, exit 0
- `corepack pnpm lint` → `$ eslint .`, no output, exit 0
- `corepack pnpm test` → `# tests 88 / # pass 87 / # fail 0 / # skipped 1` (10 new assertions added in `tests/qa-monday-meet.test.mjs`, all passing; 1 pre-existing skip unrelated to this item)

## Tests Added
- `tests/qa-monday-meet.test.mjs` — mixed-case progress detection, all-done tone, duplicate-`due_on` tiebreak, >5-task cap with priority order, multi-line/whitespace excerpt collapsing, `occurred_at` ties + >3 cap, `panelState` connection-vs-data-presence distinction, and static assertions on `app/page.tsx`'s allSettled/unwrap/state-derivation wiring. No new test infra — reuses the existing `tsx --test` harness.
- `package.json` — registered `tests/qa-monday-meet.test.mjs` in the `test` script.

## Not Verifiable
none
