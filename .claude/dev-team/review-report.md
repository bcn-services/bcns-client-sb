# Review Report
**Date:** 2026-09-13
**Item:** C — Content Library + Creative Folder (`/library`)
**Diff reviewed:** `git diff feat/shell-home...HEAD` (worktree `.claude/worktrees/library`)
**Files Reviewed:** 7 (`lib/library.ts`, `app/library/actions.ts`, `app/library/UploadForm.tsx`, `app/library/page.tsx`, `app/globals.css`, `app/page.tsx`, `tests/library.test.mjs`)
**Gates re-run:** `typecheck` clean · `lint` clean · `test` 124 pass / 0 fail / 1 skip
**Dimensions Swept:** Efficiency (clean) · Reliability (4) · Scalability (2) · Safety & Security (2) · Fault Tolerance (1) · Data Integrity (2) · Over-Engineering (1)
**Security battery rows swept:** Every-diff · DB query · state-changing form · renders user content · file upload · redirect from user input · quota counter

## Findings

### Critical
None.

### Important

**1. `app/library/UploadForm.tsx:95-101` — Reliability — a partly-failed batch reports success.**
The `finally` block overwrites whatever error the loop set, whenever `done > 0`: upload 3 files, #1 succeeds and #2 fails → `break` → status is replaced with a green "Uploaded 1 file." and `form.reset()` clears the picker, so the user is told the upload worked and never learns files 2–3 were skipped.
*Fix:* set `let failed = false` on each `break`; in `finally` only write the success line when `!failed`, else `Uploaded ${done} of ${files.length} — ${lastError}` with `bad: true`.

**2. `app/globals.css:1278-1294` (with `app/library/page.tsx:349`) — Reliability — every bulk operation is unreachable without CSS `:has()`.**
`.bulk-bar { display: none }` is revealed *only* by `.media-form:has(.media-check:checked)`, with no `@supports` fallback. On Safari < 15.4, Chrome < 105 or Firefox < 121 the bar stays hidden forever — Add tags, Add to set, Remove from set, Download and Delete cannot be reached at all. This is the inverse of the engineer report's flag ("always visible rather than hidden — degraded, not broken"); it is broken, not degraded.
*Fix:* add `@supports not (selector(:has(*))) { .bulk-bar { display: flex } }` — one block, and it produces exactly the always-visible degradation the report claims.

**3. `app/library/page.tsx:310` + `app/library/actions.ts:93` — Data Integrity — "Remove from set" targets the wrong set.**
`bulkAction` reads `set_id` from the bulk bar's *Choose set…* `<select>` for both `add-set` and `remove-set`; the `open_set` hidden field submitted at page.tsx:310 is never read. Viewing set A with set B selected in the dropdown removes the files from **B**, silently; with nothing selected the user gets "Choose a set first." while standing inside the set they meant.
*Fix:* in the `remove-set` branch, resolve the id as `parseIds([String(form.get("open_set") ?? "")])[0] ?? setId`.

**4. `app/library/actions.ts:59` — Reliability — the whole validation-error branch of `codeFor` is dead.**
`DataClientError` exposes `details` (data-client `dist/index.js:19`), not `detail`. Every BCNS3 raise in `bcns-data/supabase/migrations/20260912000500_api_rpcs.sql` is `message = 'validation', detail = '<field>'`, so `name_taken` / `bad_name` / `bad_tags` never match: creating a set whose name already exists shows "That didn't work. Please try again." and logs an unexpected-error line, and the user retries the same name forever. (`budget_reached` and `too_large` map correctly — those are the RAISE *message*, not the detail.)
*Fix:* `const detail = String((err as { details?: string })?.details ?? "");`

**5. `app/library/page.tsx:97-98` — Safety & Security — unvalidated `?error=` used as an object index 500s the page.**
`ERRORS[errorCode]` with attacker-chosen `errorCode`: `ERRORS["__proto__"]` returns `Object.prototype`, which React renders as a child and throws "Objects are not valid as a React child", so `/library?error=__proto__` breaks the page for any signed-in user who opens the link (`?error=constructor` returns a function and renders nothing).
*Fix:* `const errorMessage = Object.prototype.hasOwnProperty.call(ERRORS, errorCode) ? ERRORS[errorCode] : null;`

**6. `app/library/page.tsx:92-93` — Reliability — repeated query params crash the render.**
App-Router `searchParams` values are `string | string[]` at runtime, but `LibrarySearchParams` declares `string`, so TS never catches it. `?tag=a&tag=b` makes line 93 call `.toLowerCase()` on an Array → TypeError → 500; `?q=a&q=b` does the same via `matchesQuery`'s `query.trim()`. The neighbouring helpers survive only because `parsePopup` compares with `===` and `parseRange` regex-tests.
*Fix:* coerce at the boundary — `String(searchParams.q ?? "").slice(0, 120)` and `String(searchParams.tag ?? "").slice(0, 40).toLowerCase()`.

### Minor

**7. `app/library/actions.ts:41` — Reliability — `safeBack` rejects a legal search query.**
`URLSearchParams` leaves `*` unencoded (it encodes `!'()~`), and `*` is not in the allowlist, so a search for `hero*` makes every form action in that view redirect to a bare `/library`, silently dropping the date range, the open set and the open item.
*Fix:* add `*` to the character class.

**8. `app/library/actions.ts:102` — Scalability — the `?dl=` tray URL can exceed Node's header limit.**
500 ids × 37 chars ≈ 18.5 KB plus auth cookies, over Node's default 16 KB `maxHeaderSize`: the redirect lands on a 431 and the selection is lost. No select-all control exists, so reaching that count needs 400+ manual clicks — low likelihood, cheap guard.
*Fix:* `ids.slice(0, 50)` when building the tray target.

**9. `app/library/actions.ts:193` — Data Integrity — a set description can be set but never cleared.**
Rename omits `description` when the field is emptied (`...(rawDescription ? … : {})`) and `api.update_media_set` `coalesce`s, so emptying the input is a no-op with no feedback.
*Fix:* always send `description: rawDescription` on `rename`.

**10. `app/library/UploadForm.tsx:87-90` — Fault Tolerance — a failed registration orphans the uploaded object.**
The PUT has already landed when `registerUpload` fails; nothing references the object, no UI can see it, and `purge_after` only applies to `data.media` rows — so a user retrying against an expired session accumulates one full-size billed object per attempt.
*Fix:* `await supabase.storage.from("media").remove([path])` before the `break`.

**11. `app/library/page.tsx:42-47` — Over-Engineering / Scalability (`ponytail:` ceiling) — in-memory paging cap.**
Past 500 media rows the open-set view silently drops older members (`scope` maps member ids through `byId`, which only holds the newest 500), so a set's header count from `file_count` disagrees with the tiles rendered; `SET_ITEM_LIMIT = 5000` truncates the same way. Accepted tradeoff at SB scale and the upgrade note is already in place — recorded as the ceiling, not a defect.

**12. `app/library/page.tsx:163-165` — Reliability — upload dead-end if the egress read fails.**
`clientId` falls back to `allMedia[0].client_id`, so an empty library whose `egress_status_v1` read errored shows "Uploads are unavailable…" with no way out (no media → no fallback → no upload → no media). `api.egress_status_v1` selects from `data.clients` with a left join, so it always returns exactly one row; only an RLS/network failure reaches this path.
*Fix (if it is worth one):* fall back to `client_v1.id` rather than to a media row.

**13. `app/library/UploadForm.tsx:73-75` — Safety & Security — no content-type allow-list on upload.**
`contentType` is taken from the browser and the `media` bucket declares no `allowed_mime_types` (`bcns-data/supabase/migrations/20260912000300_storage.sql:2-4`), so a member can store an HTML/SVG payload and later mint a signed URL for it. Blast radius is limited to the `*.supabase.co` origin — never the dashboard origin — and the actor must already be a member of the client. The real fix is platform-side (`allowed_mime_types` on the bucket), not this diff.

## Verified clean

- **RPC discipline.** Every write is a named RPC through `lib/data.ts` as the signed-in user — `bulk_tag`, `set_media_set_items`, `delete_media`, `update_media`, `create/update/delete_media_set`, `download_url`, `register_upload`. No direct table write, no service-role key, no `process.env` outside `lib/env.ts` (grep-confirmed), no new dependency.
- **Id validation.** Every id reaching an RPC passes `parseIds` (UUID-shaped, de-duplicated, capped at the RPCs' own 500). `?set=`, `?item=`, `?dl=` are all validated before use.
- **`bulkAction` dispatch.** Closed `if/else` with a `failed` default; an unknown `op` cannot fall through to a write. `download` mints nothing. The first submit button in the grid form is "Add tags", so an Enter keypress cannot reach Delete.
- **`set_media_set_items` semantics.** `add`/`remove` mapped one-to-one from `op`; the platform rejects any other action (BCNS3). Remove is the delete branch, not a rewrite.
- **Egress.** Minting happens only on POST (`downloadMedia`); the tray renders per-file buttons and charges nothing on render or refresh, so a back-button or reload cannot re-spend. Controls render `disabled` from `egress_status_v1.exceeded`, `downloadMedia` re-reads the view before spending, and `api.download_url` raises `budget_reached` independently. `egressLine()`'s fail-open is **acceptable**: the only authoritative gate is the RPC, and failing closed would take downloads offline on a transient read error.
- **Cross-tenant egress.** `api.download_url` scopes by `client_id = tenant`, and `byId`/the views are RLS-scoped, so no `?dl=` value can mint a URL for another client's media.
- **Browser client construction.** `createBrowserClient(supabaseUrl, anonKey)` with both values passed as props from the server component via `getConfig()` — no `NEXT_PUBLIC_*` inlining, no service-role key, and the page still builds with no environment set.
- **Upload path (engineer flag #4 answered).** `data.register_media` builds its regex as `'^' || client || '/orig/[0-9a-f-]{36}\.[a-z0-9]{1,8}$'` where `client` is the tenant from the caller's JWT, never from the input — so a signed-in user **cannot** register a path outside their own client prefix. Independently, `media_insert` on `storage.objects` requires `foldername[1] = active_client_id()` and `foldername[2] = 'orig'`, so a tampered `clientId` prop fails the PUT itself. The regex is a sufficient gate; `registerUpload` trusting the caller for path shape is fine. Size is capped server-side twice (bucket `file_size_limit`, BCNS5 in `register_media`); the filename is never used as a path (uuid + sanitized 8-char extension).
- **Redirect safety.** `safeBack` forces a leading `?` from a character class with no `/`, so no open redirect is reachable; `redirect(url)` in `downloadMedia` uses a platform-minted Supabase signed URL. `redirect()` / `backTo()` is outside the `try` in all five actions (`actions.ts:79, 82, 110-114, 135, 163-164, 208-212`) — Next's control-flow throw is never swallowed.
- **Escaping / XSS.** Titles, tags, set names, descriptions and the search echo all render as JSX text children or `defaultValue`; no `dangerouslySetInnerHTML` or `innerHTML` anywhere in `app/` or `lib/`. `?error=` renders only from the `ERRORS` map (see finding 5 for the indexing flaw, which is a crash, not an injection).
- **Degradation.** All four reads go through `Promise.allSettled` + `unwrap`, so one failing view logs and renders empty rather than taking the page down; `thumbUrls` is wrapped in its own try. `router.refresh()` fires after a successful batch.
- **Logging.** No secret, token or PII in any log line; platform detail goes to `console.error` and a generic string to the client.
- **`app/page.tsx`.** The one-line change routes home's tiles through `mediaThumbPath()`, so both pages agree on what is signable. Correct.
- **Tests.** `tests/library.test.mjs` is in the `test` script and the run reports 124 (up from 106 pre-item); assertions are pinned to literals, not to the module's own exported constants.

## Notes for the orchestrator

- `tests/qa-library.test.mjs` is **untracked** and the `package.json` line adding it to the `test` script is **uncommitted** in this worktree. Both are lost if the branch is pushed as-is.
- Platform observation, outside this diff: `api.download_url` reads the ledger, compares to quota, then increments in a second statement — two concurrent downloads can each pass the check and overspend by one file. Belongs to `bcns-data`, not item C.
