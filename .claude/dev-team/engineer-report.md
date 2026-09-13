# Engineer Report
**Task:** Item C — Content Library + Creative Folder page (`/library`)
**Branch:** `feat/library` (worktree `.claude/worktrees/library`, off `feat/shell-home` @ 6653b70)
**Date:** 2026-09-13

## Design Decisions
- **Upload path: browser-side storage PUT + a `register_upload` server action.** `app/library/UploadForm.tsx` (the page's only client component) builds a `createBrowserClient` on the same cookie session and PUTs each file to `media/<client_id>/orig/<uuid>.<ext>`, then posts *only that path* to `registerUpload`; bytes never enter a server action body and `serverActions.bodySizeLimit` is untouched.
- **`client.media.upload()` cannot be used in the browser** — it decodes the JWT with `Buffer.from(token, "base64url")`, and Next 14 aliases the client bundle's `Buffer` to `next/dist/compiled/buffer`, which throws `Unknown encoding: base64url` (verified empirically; the `buffer` npm package is not installed, and adding it would be a new dependency). The two halves the form performs are byte-for-byte the calls data-client would have made.
- **Public URL + anon key reach the browser as props**, read through `lib/env.ts` `getConfig()` at request time in the server component — no `NEXT_PUBLIC_*` inlining, so the app still builds with no environment set.
- **`client_id` comes free from `egress_status_v1.client_id`** (already read for the egress line), so the upload path needs no extra query.
- **Zero client JS for selection.** The grid is one `<form>` of checkboxes whose submit buttons carry `name="op"`; the bulk bar reveals itself with CSS `.media-form:has(.media-check:checked)`. One server action (`bulkAction`) dispatches to `bulk_tag` / `set_media_set_items` / `delete_media`.
- **Bulk download renders a tray of per-file mint-on-click buttons** (`?dl=<ids>`), not auto-triggered downloads. Minting is what spends egress, so it must happen on a POST: minting on render would re-charge the client on every refresh or back-button.
- **Egress is enforced twice.** The page server-renders every download control `disabled` when `egress_status_v1.exceeded`, and `downloadMedia` re-reads the view and refuses before calling `download_url` (which also raises `budget_reached` on its own). `egressLine()` fails open when the row is unreadable.
- **Actions redirect instead of returning errors** (a server component can't read a return value): they `redirect("/library<back>&error=<code>")` and the page renders `.lib-alert`. `back` is validated against `/^\?[A-Za-z0-9=&%,.:_+-]*$/` before being used as a redirect target.
- **Thumbnails sign `thumb_path` only** — see Conflicts; the original is deliberately not a fallback.
- All pure logic lives in `lib/library.ts`; the page and actions hold every I/O call. Styling is one appended `/* === item C: library === */` block.

## Files Changed
- `lib/library.ts` — new. Tag parsing to the platform's own rules, search/tag filtering, byte formatting, bulk-id validation, egress gate, storage path, set grouping/cover, labels.
- `app/library/actions.ts` — new. `bulkAction`, `saveMedia`, `downloadMedia`, `setAction`, `registerUpload`; every write a named RPC through `lib/data.ts` as the signed-in user.
- `app/library/UploadForm.tsx` — new. The only client component: multi-file browser-side upload + `registerUpload`, then `router.refresh()`.
- `app/library/page.tsx` — replaced the stub with the real page: toolbar (search, tag filter, Upload, New set), media grid + bulk bar, item view, download tray, Creative Folder sidebar, egress line, empty state.
- `app/globals.css` — appended the item C block (toolbar, grid/tile, bulk bar, set list, item view, `.sr-only`, inline/danger button variants, responsive fallbacks). Nothing above it touched.
- `app/page.tsx` — one-line additive change: home's library tiles now derive their thumb through `mediaThumbPath()` so the two pages agree on what is signable.
- `tests/library.test.mjs` — new. 18 unit tests over `lib/library.ts`.
- `package.json` — appended `tests/library.test.mjs` to the `test` script.

## Verification
All four gates run in order in the worktree (build run with the dev server stopped).

- `corepack pnpm typecheck` → `$ tsc --noEmit` (no output, exit 0)
- `corepack pnpm lint` → `$ eslint .` (no output, exit 0)
- `corepack pnpm test` → `# tests 93 / # pass 92 / # fail 0 / # skipped 1` (the 1 skip is the pre-existing hosted RLS scaffold)
- `corepack pnpm build` → `✓ Compiled successfully`, `ƒ /library  71.6 kB  166 kB First Load JS`

Signed-in smoke, 15 steps through `shot.mjs` against `http://localhost:3103` as `smoke+sb@bcn-services.com` (values are the driver's own JSON):

```
01-empty        {"tiles":0,"sets":0,"note":"No files yet. Upload your first creative."}
02-uploaded     Uploaded 1 file. | tiles=1
03-grid         {"tiles":1,"names":["smoke-test hero"],"tags":["smoke","test"]}
04-item         /library?...&item=d75c2d41-7731-4d77-b082-a1dd9458827f
05-tags-saved   saved
06-download     {"status":200,"bytes":74,"host":"cnsxbglhredokjbvudfd.supabase.co","signed":true}
07-set-created  /library?...&set=6f3ddd2c-db0b-4df6-8f81-a532c95f142e
08-bulk-tag     tagged
09-added-to-set added
11-set-members  {"tiles":1,"sets":1,"tags":["bulk","edited","smoke","test"],"counts":["1 File"]}
12-search       {"tiles":0,"note":"No files match this search."}
13-deleted-file deleted
14-deleted-set  set deleted
15-final        {"tiles":0,"sets":0,"note":"No files yet. Upload your first creative."}
```

Screenshots read and checked: `01-empty`, `04-item`, `11-set-members` in `/Users/nateseluga/.claude/jobs/8d474d1e/tmp/c-engineer/shots/`. Dev server left running on **3103**, pid from `lsof -nP -iTCP:3103 -sTCP:LISTEN -t`, log `/Users/nateseluga/.claude/jobs/8d474d1e/tmp/dev-3103.log`.

Hosted objects: one ≤10 KB `smoke-test hero` PNG (74 B) and one `smoke-test set` per run, all deleted through the UI. Confirmed clean afterwards — `data.media where deleted_at is null = 0`, `data.media_sets = 0`, `data.media_set_items = 0`.

## Conflicts with DESIGN.md
1. **Reorder inside a set is not implementable.** `data.media_set_items` has only `client_id, set_id, media_id, added_at` — no position column — and `api.set_media_set_items` accepts `action in ('add','remove')` only. DESIGN.md line 218 asks for "remove / reorder". Built everything else; reorder needs a bcns-data change (a `position` column plus a `reorder`/`set` action).
2. **Thumbnails can never render today.** `data.media.thumb_path` is null for every row (nothing derives one), and the storage policy `media_read_orig` only signs `<client>/orig/...` while a download ticket for that object exists (`data.has_download_ticket`), so the original is not a usable thumbnail source — an orig fallback showed an image for five minutes after a download and a placeholder the rest of the time. The grid and set covers therefore render the placeholder tile DESIGN.md specifies "on failure", for every file. Needs a bcns-data change (thumbnail generation, or a thumb-free signing policy).
3. **Egress meters bytes, not download counts.** `egress_status_v1` exposes `bytes_used` / `quota_bytes` / `exceeded`, so "Downloads this period: X of Y" renders byte sizes ("Downloads this period: 364 B of 20 GB").
4. **Bulk download is a tray of per-file links**, as the spec permits, rather than auto-triggered downloads — and deliberately so, since minting on render would double-charge egress on a refresh.

## Deferred / Out of Scope
- Reorder (blocked, above).
- Server-side search/paging: the page reads ≤500 media rows, ≤200 sets and ≤5000 set-item rows and filters in memory (`ponytail:` note in `page.tsx`). Fine at SB's scale, needs `ilike`/`contains` + paging past ~500 files.
- `restore_media` (undelete) — DESIGN.md doesn't ask for it.
- Per-file upload progress: the form reports "Uploading <name> (n of m)" but no byte progress; supabase-js's upload has no progress callback.

## Flags for Reviewer
- **`registerUpload` is the one action that returns instead of redirecting** — it's called imperatively from the client component. It validates `path` and `bytes` but trusts the caller for the path shape; the platform's own `data.register_media` regex is the real gate.
- **Storage PUT is unretried.** A failed object leaves no `data.media` row (registration is the second half), so the orphan is an unreferenced storage object, not a broken library row.
- **`media_set_items_v1` is read unfiltered up to 5000 rows** on every page load, to group members and pick set covers. This is the query most likely to grow unbounded.
- **`?dl=` tray ids come from the URL** — validated as UUIDs by `parseIds`, capped at 500, and each mint still goes through `download_url` as the signed-in user.
- **Selection UI depends on CSS `:has()`** (Safari 15.4+ / Chrome 105+). On an older browser the bulk bar is always visible rather than hidden — degraded, not broken.
- **`redirect()` inside try/catch**: every action calls `backTo`/`redirect` outside its `try`, so Next's control-flow throw is never swallowed. Worth a second pair of eyes.
- **`/library` ships 71.6 kB of client JS** (supabase-js, pulled in by the upload form). Could be trimmed with a dynamic import of the form behind the Upload `<details>`.
