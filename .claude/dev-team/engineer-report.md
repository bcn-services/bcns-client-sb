# Engineer Report

**Task:** Item B — Financial Information page (`/financials`) + home Financial panel, per DESIGN.md
**Branch:** `feat/financials` (worktree `.claude/worktrees/financials`, off `feat/shell-home` @ 6653b70)
**Date:** 2026-09-13

## Design Decisions

- All pure logic lives in `lib/financials.ts` (validation, totals, tiles, daily merge, home rows) so `tests/financials.test.mjs` covers it without a DB; the page and the server action are thin.
- Validation is server-side in `parseEntryInput`; HTML `required`/`step`/`maxlength` are convenience only. A rejected submit never reaches `save_record`.
- No client JS: the form is a plain `<form action={serverAction}>`. Errors come back as `redirect('/financials?error=<code>&f_*=…')` — a fixed code set mapped to messages server-side (`entryErrorMessage` returns `null` for anything unknown), so a crafted query string cannot render arbitrary text. `f_*` params re-fill the form.
- Entries are filtered on `attributes->>date` (the `YYYY-MM-DD` string written in `client_v1.timezone`), not on `occurred_at` (timestamptz), so range membership matches what the user typed rather than a UTC-shifted day.
- `deleteFinancialEntry` re-reads `records_v1` for the posted id constrained to `kind='financial_entry'` + `source='dashboard'` before calling `delete_record` — the id arrives from a form, so a Shopify/Meta row id can't be deleted through it.
- Null vs `$0`: `sumPresent` returns `null` only when every input is absent, so an unconnected source renders `—` and a genuine zero renders `$0`. Manual figures are `null` only when the period has no entries at all.
- Money is integer cents end to end; `parseAmountToCents` parses the decimal string with a regex (no float math), caps at 1,000,000,000 major units and rejects non-positive values.
- Panels size to content (`.fin-grid { align-items: start }`) — the equal-height default left the Daily Breakdown panel with ~500px of empty space in the screenshots.

## Files Changed

- `lib/financials.ts` — rewritten as the pure core: entry validation/shaping, `sumEntries`, `computeProfit`, `computeFinancialTotals`, `computeFinancialTiles` (the 7 DESIGN.md tiles), `computeDailyRows`, `financialRecordsQuery`, and the corrected home `computeFinancialRows`.
- `lib/overview.ts` — exported the existing `isValidYmd` so the entry parser and the action reuse it instead of a second date regex.
- `app/financials/actions.ts` — new: `createFinancialEntry` (`save_record('financial_entry', …, external_id=uuid, title=category, occurred_at=date)`) and `deleteFinancialEntry` (ownership-checked `delete_record`), both revalidating `/financials` and `/`.
- `app/financials/page.tsx` — rewritten from the item A stub: 7 metric tiles with previous-period deltas, Daily Breakdown table (days with nothing omitted, empty state otherwise), Manual Entries panel (error banner, form, newest-first list with delete, "No entries yet.").
- `app/page.tsx` — additive: `records_v1` joins the existing `Promise.allSettled`, manual income/expense totals feed `computeFinancialRows` for both periods, and the panel shows `data` whenever entries exist even with no connector.
- `app/globals.css` — appended `/* === item B: financials === */` only: `.metric-row--7`, `.fin-grid`, `.fin-table`, `.entry-form`, `.entry-list`, `.form-error`, `.btn-link-danger`, all on existing tokens.
- `tests/financials.test.mjs` — 7 tests → 24, covering amount parsing (incl. no float drift and the `<script>` error-code case), per-field rejection, entry shaping/range/order, profit identity, tile order/labels/origins, daily merge, and Expenses = manual only.

## Conflicts with DESIGN.md

- Item A's `computeFinancialRows` computed `Expenses = ad spend + manual expenses` and `Profit = revenue − expenses`. DESIGN.md says the home rows are Revenue / Ad Spend / **Expenses (manual)** / Profit, and `Profit = revenue + manual income − ad spend − manual expenses`. DESIGN.md wins: both are now as specified, and the double-count of ad spend in Expenses is gone. No other conflict found; no bcns-data change is needed (`records_v1.source` exists with `dashboard` in the enum).

## Verification

- `corepack pnpm typecheck` → `$ tsc --noEmit`, no output, exit 0
- `corepack pnpm lint` → `$ eslint .`, no output, exit 0
- `corepack pnpm test` → `# tests 101 / # pass 100 / # fail 0 / # skipped 1`
- `corepack pnpm build` → `✓ Compiled successfully`, `✓ Generating static pages (7/7)`, routes `ƒ /`, `ƒ /financials`, `ƒ /library`, `ƒ /login`, `ƒ /api/health` (run before the dev server started; the only change since is CSS)
- Signed-in smoke as `smoke+sb@bcn-services.com` via `shot.mjs` on `http://localhost:3102`, screenshots in `~/.claude/jobs/8d474d1e/tmp/b-engineer/shots`:
  - valid save (`smoke-test` / expense / 12.34) → row appears, tiles show Manual Expenses `$12`, Profit `-$12`, daily table shows Sep 13 with per-cell `—` for the unconnected sources
  - `12.345`, `-3`, empty category, 501-char note, empty date → each redirects with its `error=` code, renders the matching `[role=alert]` message, creates nothing, and preserves the typed values
  - home panel text `Revenue — / Ad Spend — / Expenses $12 / Profit -$12` — confirms Expenses is manual-only
  - delete → list empty, all 7 tiles `—`, "Not connected yet." empty state
- Hosted writes: 2 `financial_entry` rows created as smoke+sb with category `smoke-test`, both deleted through the UI's Delete. Net zero.
- Dev server left running for QA on port 3102 — pid 36512, log `~/.claude/jobs/8d474d1e/tmp/dev-3102.log`.

## Deferred / Out of Scope

- Editing an existing entry (DESIGN.md specifies create + delete only).
- Pagination of manual entries: capped at `ENTRY_ROW_LIMIT = 500` per range, which no realistic range reaches.
- Currency is taken from whichever source row supplies one (`pickCurrency`), defaulting to USD; there is no per-entry currency in the spec.

## Flags for Reviewer

- `app/financials/actions.ts` — the trust boundary. Both actions take raw `FormData`; `deleteFinancialEntry` relies on the kind+source re-read for authorization on top of RLS.
- `financialRecordsQuery` filters on a JSON path (`attributes->>date`), which cannot use a plain b-tree index; fine at this row count, worth an expression index if `records_v1` grows large.
- `campaign_daily_v1` is read with `limit(1000)` and summed in the app — marked with a `ponytail:` comment; a range longer than ~3 years of campaigns would truncate.
- `save_record` uses a fresh `crypto.randomUUID()` as `external_id`, so a retried submit creates a second row rather than being idempotent.
- Three sources are read in one `Promise.allSettled`; a failing source logs and degrades to `—` rather than failing the page.
