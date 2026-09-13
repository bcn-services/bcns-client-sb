# Fix Report
**Date:** 2026-09-13
**Findings addressed:** 5 of 7 (0 QA failures — QA passed at 162faeb — + 2 review Important, 3 of 5 review Minor applied, 2 Minor deferred)

## Changes Made

- `lib/overview.ts:77` `pctDeltaOrNull` — divides by `Math.abs(previous)`, so a signed metric keeps the direction of the real change (a loss halving reads `↑ 50%`, a loss doubling `↓ 100%`) — review Important. Fixed in the shared helper rather than at the two Profit call sites: identical output for every non-negative metric, and no sibling caller left wrong.
- `tests/financials.test.mjs:172` — new test `computeFinancialTiles: a loss that shrank is a rise, not a fall` covers prev<0 shrinking, prev<0 growing, and loss→profit — review Important (test requested).
- `app/financials/actions.ts:35` + `app/financials/page.tsx:218` — the form renders a per-render `crypto.randomUUID()` in a hidden `token` field and `createFinancialEntry` passes it as `external_id` via `entryToken()`, which accepts it only if it matches a UUID and otherwise mints one server-side — review Important. Confirmed upsert first: `~/bcns-data/supabase/migrations/20260912000500_api_rpcs.sql:64`, `api.save_record` inserts `on conflict on constraint records_client_id_source_external_id_key do update set attributes…, deleted_at = null`, so a resubmit updates the same row.
- `lib/financials.ts:159` `toFinancialEntry` — `amount_cents` must now be a safe integer in `(0, MAX_AMOUNT_MAJOR * 100]`, so a `financial_entry` written by another `save_record` caller can't bypass the form's rules or push a period sum past `Number.MAX_SAFE_INTEGER`; dropped the now-redundant `Math.round` — review Minor.
- `app/financials/page.tsx:80` — `campaign_daily_v1` gained `.order("day", { ascending: false })`, so when the 1000-row cap bites the current period survives ahead of the previous one instead of an arbitrary slice — review Minor.
- `lib/financials.ts:155` — removed the unreachable `row.occurred_at.slice(0, 10)` date fallback (`financialRecordsQuery` filters on `attributes->>date`, which is NULL for exactly those rows); the test that asserted the fallback now asserts such a row is dropped — review Minor.

## Disputed

None. Both Important findings reproduced as described.

## Deferred

- `lib/financials.ts:454` — the 500-row cap spanning `prevFrom..to` drops the previous period first. Left as the existing `ponytail:` comment on `ENTRY_ROW_LIMIT` per the coordinator; splitting into two bounded queries belongs with paging.
- `lib/financials.ts:446` — the `attributes->>date` predicate can't use a b-tree index. Left as a `ponytail:`-style note; the fix is an expression index in bcns-data, which is out of scope (no bcns-data changes).

## Note for the reviewer

`external_id` is now client-influenced (UUID-shaped only). `save_record` forces `source='dashboard'` and the conflict key is `(client_id, source, external_id)`, so the worst a signed-in user can do with a crafted token is overwrite one of their *own* dashboard records — which they can already delete through the UI. No cross-tenant or cross-source reach.

## Verification

- `corepack pnpm typecheck` → `$ tsc --noEmit`, no output, exit 0
- `corepack pnpm lint` → `$ eslint .`, no output, exit 0
- `corepack pnpm test` → `# tests 112 / # pass 111 / # fail 0 / # skipped 1` (was 101; +11 from the new cases and QA's file)
- Live on the dev server already up on :3102, signed in as smoke+sb: one `smoke-test` / expense / 7.77 entry submitted with `f.requestSubmit()` called twice on the same rendered form. `dev-3102.log` shows **two** `POST /financials 303`; the page then showed **one** `.entry-row` and Manual Expenses `$8` / Profit `-$8` — the retry upserted. Deleted through the UI's Delete button; reload shows 0 rows, "No entries yet.", all seven tiles `—`. Hosted rows net zero.
- No `next build` run (dev server left up on 3102, pid 36512).
