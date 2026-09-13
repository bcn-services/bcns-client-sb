# QA Report
**Task:** Item C — Content Library + Creative Folder page (`/library`)
**Branch:** `feat/library`
**Date:** 2026-09-13
**Gate mode:** tests+behavioral

## VERDICT: PASS

## Criteria Checked
- Tag parsing rules (valid/dedup/case-fold/space-collapse, >40-char rejected as invalid, illegal chars rejected, >MAX_TAGS truncated + flagged, null/undefined safe) — `tests/qa-library.test.mjs` — PASS.
- Search covers title/filename/tags case-insensitively; tag filter + search combine with AND; empty query matches all — `tests/qa-library.test.mjs` `matchesQuery`/`filterMedia` cases — PASS.
- Byte formatting: unit scaling, negative/NaN/Infinity/undefined all render "0 B", KB/MB boundaries — `tests/qa-library.test.mjs` `formatBytes` cases — PASS.
- Bulk-id validation: non-UUID strings rejected, duplicates deduped, 501 ids capped at `MAX_BULK_IDS` (500), `?dl=` tray parses and drops malformed entries — `tests/qa-library.test.mjs` `parseIds`/`parseIdList` cases — PASS.
- Egress gate: `exceeded:true` disables regardless of numbers; `used>=quota` counts as exceeded even if the flag is false; unreadable row (`null`/`undefined`) fails open (`label:null, exceeded:false`); label renders as byte sizes — `tests/qa-library.test.mjs` `egressLine` cases — PASS.
- Storage path shape `<client_id>/orig/<uuid>.<ext>`, extension from filename/mime/`bin` fallback — `tests/qa-library.test.mjs` `storagePath` cases — PASS.
- Set grouping (newest-first, drops rows missing ids) and cover selection (view's own cover → newest member with a thumb → null) — `tests/qa-library.test.mjs` `groupSetItems`/`setCoverPath` cases — PASS.
- Empty-state copy "No files yet. Upload your first creative." (both `/library` and home's Content Library panel) and the distinct no-match copy "No files match this search." — `tests/qa-library.test.mjs` source-grep cases — PASS.
- Empty state renders on `/library` — browser: signed-in load of `/library` showed `tiles:0, sets:0`, `.state-note` text exactly "No files yet. Upload your first creative." — PASS.
- Header Content Library button active + carries `?from&to` — browser: on `/library`, the header link matching `href^="/library"` carried class `is-active` with `href="/library?from=2026-09-07&to=2026-09-13"` — PASS.
- Upload menu + New set menu open — browser: set `details.lib-menu[0]/[1] .open = true` (native `<details>` toggle), confirmed `open:true` and the expected fields present (`input[name=files]`, `input[name=name][maxlength=80]`); screenshots `03-upload-menu.png`/`04-newset-menu.png` — PASS.
- Upload one tiny (<10 KB, 68 B) PNG named "smoke-test qa" registers and appears in the grid with its tags — browser: injected the file via CDP `DOM.setFileInputFiles` on the real `<input type=file>`, filled title/tags, `requestSubmit()`'d the real upload form (real browser-side Storage PUT + `registerUpload` RPC against the hosted project); status showed "Uploaded 1 file.", grid then showed `tiles:1`, tile name "smoke-test qa", tags `["smoke","qa"]` — PASS.
- Item view opens; title/tag edit saves — browser: clicked the tile's name link, URL gained `item=<uuid>`; edited title to "smoke-test qa edited" and tags to "smoke, qa, edited", submitted the save form; no `[role=alert]` appeared and the inputs reflected the new values after the round trip — PASS.
- Full-quality download control returns a signed URL with HTTP 200 — browser: clicked "Download full quality"; CDP `Network.responseReceived` captured the real external request to `https://cnsxbglhredokjbvudfd.supabase.co/storage/v1/object/sign/media/<client>/orig/<uuid>.png?token=...` with `status:200` — PASS.
- New set "smoke-test qa set" creates; add-to-set works; set view shows the member — browser: opened New set, submitted name "smoke-test qa set", URL gained `set=<uuid>`; selected the file's checkbox (bulk bar appeared), chose the new set in the bulk bar's select and clicked "Add to set", `sets:1` afterward; navigated to `/library?set=<uuid>` and saw `tiles:1` (the member) — PASS.
- Search with no match shows "No files match this search." — browser: `/library?q=zzz-nonexistent-smoke` showed `tiles:0`, `.state-note` text exactly "No files match this search." — PASS.
- Bulk bar appears on selection — browser: `.bulk-bar` computed `display` was `none` before checking the tile's checkbox and non-`none` immediately after (native CSS `:has()` confirmed working headless) — PASS.
- Delete file + delete set both work — browser: opened the item and submitted its "Delete file" form (danger button), state returned to the empty-state note; opened the set and submitted its "Delete set" form, `sets:0` afterward — PASS.
- Final state is the empty state again; home `/` Content Library panel shows "No files yet" with no `smoke-test` row in Recent Activity — browser: final `/library` load showed `tiles:0, sets:0`, note "No files yet. Upload your first creative."; home `/` Content Library panel text included "No files yet"; the Recent Activity panel's text ("Recent Activity Not connected yet. Connect a source") contained no "smoke-test" string — PASS.
- No panel/page state derives from data rows where DESIGN.md says `connector_health_v1` should gate it — `/library` is dashboard-sourced (media/sets), not connector-gated; `page.tsx`'s own comment ("no not-connected state — only empty and data") matches DESIGN.md, which specifies `connector_health_v1` only for the Integrations popup and home's service panels, not `/library`. No violation found in the item-C files — PASS.
- `corepack pnpm typecheck` / `lint` / `test` green — `tsc --noEmit` exit 0, no output; `eslint .` exit 0, no output; `pnpm test` → 124 tests / 123 pass / 0 fail / 1 skipped (pre-existing RLS scaffold) — PASS.

Reorder-in-set, real thumbnails, and download-count egress: accepted platform limitations per the engineer report's Conflicts section — not tested against, per orchestrator instruction.

## Failures
none

## Tests Added
- `tests/qa-library.test.mjs` — independent QA suite over `lib/library.ts` (tag parsing, search/tag filter semantics, byte formatting, bulk-id validation, egress gate, storage path shape, set grouping/cover, plus source-grep checks for the exact empty-state and no-match copy). 24 new test cases, registered in `package.json`'s `test` script. No new test infra — uses the existing `node:test` / `tsx --test` convention already in `tests/*.test.mjs`.

## Not Verifiable
none — every `done when:` criterion for item C was covered by a unit test or a live browser action against the running dev server (`http://localhost:3103`), signed in as `smoke+sb@bcn-services.com`. The behavioral driver used CDP directly (`DOM.setFileInputFiles` for the real file upload, `Network.responseReceived` to capture the download's real HTTP status) rather than static inspection.

## Hosted Cleanup
One `smoke-test qa` PNG (68 B) and one `smoke-test qa set` were created via the real upload path and the New set form, then deleted through the UI ("Delete file" / "Delete set" actions — the platform's own soft-delete for media, hard-delete for sets). Confirmed clean: final `/library` load shows `tiles:0, sets:0` and the empty-state copy; home `/` shows "No files yet" for Content Library with no `smoke-test` reference anywhere in Recent Activity. No service-role key was used; no `.env.local`/`.env.production` was read; no bcns-data change made; no new dependency added; engineer's code was not edited.

Screenshots: `/Users/nateseluga/.claude/jobs/8d474d1e/tmp/qa-c/` (01-library-empty, 03-upload-menu, 04-newset-menu, 05-uploaded, 08-item-view, 09-item-saved, 11-set-created, 12-bulk-bar, 14-set-members, 15-no-match, 18-final-empty, 19-home).
