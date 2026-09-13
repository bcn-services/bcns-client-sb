# Fix Report
**Date:** 2026-09-13
**Item:** C — Content Library + Creative Folder (`/library`)
**Branch:** `feat/library` (worktree `.claude/worktrees/library`)
**Findings addressed:** 10 of 13 (0 QA failures — QA passed; 6 review Important + 4 review Minor); 0 disputed; 3 deferred

## Changes Made

- `app/library/UploadForm.tsx:68-105` — a part-failed batch no longer reports success: the loop records `lastError` instead of writing status, and `finally` renders `uploadStatus(done, total, lastError)` → "Uploaded 1 of 3 — b.png: …" with `bad: true` — review Important
- `app/globals.css:1276-1298` — `.bulk-bar` is now `display: flex` by default and hidden only inside `@supports selector(:has(*))` via `.media-form:not(:has(.media-check:checked))`, so a browser without `:has()` (or without the `selector()` query itself) leaves the bar permanently visible rather than unreachable — review Important
- `app/library/actions.ts:96-102` — `remove-set` resolves its target from the submitted `open_set` (falling back to `set_id`), so "Remove from set" acts on the set being viewed, not on the dropdown selection — review Important
- `app/library/actions.ts:62` — `codeFor` reads `err.details` (the field `DataClientError` actually exposes, `dist/index.js:22`), reviving the dead `name_taken` / `bad_name` / `bad_tags` branches — review Important
- `app/library/page.tsx:105` + `lib/library.ts:270` — `ERRORS` is indexed through `lookupMessage()`, which guards with `Object.prototype.hasOwnProperty.call`, so `?error=__proto__` renders normally instead of handing React `Object.prototype` — review Important
- `app/library/page.tsx:75-105,185` + `lib/library.ts:258` — every `searchParams` value goes through `firstParam()` (typed `string | string[] | undefined`) before any string method, so `?tag=a&tag=b` and friends render instead of throwing — review Important
- `app/library/actions.ts:44` — `safeBack` allows `*`, which `URLSearchParams` leaves unencoded, so searching `hero*` no longer drops the range/open set/open item on every form submit — review Minor
- `app/library/actions.ts:23,110` — the `?dl=` tray target is capped at `DL_TRAY_MAX = 50` ids, keeping the redirect inside Node's 16 KB header limit — review Minor
- `app/library/actions.ts:201` — `rename` always sends `description`, so emptying the field clears it instead of being silently coalesced away — review Minor
- `app/library/UploadForm.tsx:90-95` — a failed `registerUpload` removes the just-PUT object, so a retry can't accumulate unreferenced billed objects (`purge_after` only reaps `data.media` rows) — review Minor
- `lib/library.ts:256-283` + `tests/library.test.mjs` — new pure helpers `firstParam`, `lookupMessage`, `uploadStatus` with 3 new tests (20 in this file, 127 in the suite)

## Disputed

None.

## Deferred

- **#11 in-memory paging cap (`page.tsx:42-47`)** — recorded by the reviewer as an accepted ceiling, not a defect; the `ponytail:` upgrade note is already in place and server-side filtering is a re-architecture, not a findings fix.
- **#12 upload dead-end if the egress read fails (`page.tsx:163-165`)** — the suggested fallback needs `client_v1.id`, which `loadShellData` does not select; widening that shared loader for a path only an RLS/network failure reaches is a bigger diff than the bug. `api.egress_status_v1` always returns exactly one row.
- **#13 no content-type allow-list on upload (`UploadForm.tsx:73-75`)** — the reviewer's own conclusion: the real fix is `allowed_mime_types` on the `media` bucket in bcns-data, which this item is barred from touching. A client-side list would not gate anything, since the PUT is made by the browser.

## Verification

- `corepack pnpm typecheck` → `$ tsc --noEmit`, exit 0
- `corepack pnpm lint` → `$ eslint .`, exit 0
- `corepack pnpm test` → `# tests 127 / # pass 126 / # fail 0 / # skipped 1`
- Live, signed in on the dev server at :3103 (13 steps, `shot.mjs`): `?error=__proto__` → 200, empty state, no alert; `?tag=a&tag=b&q=x&q=y&set=p&set=q&item=i&item=j&dl=d&dl=e&error=constructor&from=z&from=w` → 200; upload → "Uploaded 1 file."; duplicate set name → "A set with that name already exists."; file added to sets A and B (`A=1 File, B=1 File`); **opened set A with set B selected in the dropdown, Remove from set → `{"rows":["smoke-test set B=1 File","smoke-test set A=0 Files"],"tilesInA":0}`** — the open set lost the file and the decoy set kept it; file and both sets deleted → `No files yet. Upload your first creative.`
- Hosted state net zero: `data.media` (live) 0, `data.media_sets` 0, `data.media_set_items` 0.
