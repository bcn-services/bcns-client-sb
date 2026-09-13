# Review Report
**Date:** 2026-09-13
**Files Reviewed:** 8 (`lib/financials.ts`, `lib/overview.ts`, `app/financials/actions.ts`, `app/financials/page.tsx`, `app/page.tsx`, `app/globals.css`, `tests/financials.test.mjs`, `.claude/dev-team/engineer-report.md`)
**Reviewer:** dt-review (Claude Opus 5), read-only. Scope = `git diff feat/shell-home..HEAD`.
**Dimensions Swept:** Efficiency — clean · Reliability — 2 · Scalability — 2 · Safety & Security — clean · Fault Tolerance — 1 · Data Integrity — 1 · Over-Engineering — 1

## Findings

### Critical
None.

### Important

`lib/financials.ts:320` — Reliability — Profit is the first signed metric fed to `pctDeltaOrNull`; when the previous period's profit is negative the division flips the sign, so a loss that shrank renders `↓ 50.0%` in the down tone and a loss that grew renders `↑` in the up tone (`Delta` derives arrow and colour from the same sign, `app/_components/Panel.tsx:38`). — Fix: for signed metrics divide by `Math.abs(previous)`, or return `null` when `previous < 0`. Same call site for the home Profit row at `lib/financials.ts:435`.

`app/financials/actions.ts:72` — Fault Tolerance — `external_id: crypto.randomUUID()` is minted per invocation, so a double-clicked "Add Entry" or any retried POST writes a second identical ledger row and silently doubles Manual Income/Expenses and Profit for the range. — Fix: render a per-form idempotency token into a hidden field and pass it as `external_id`, so `save_record` upserts on the retry instead of inserting.

### Minor

`lib/financials.ts:159` — Data Integrity — `Number(a.amount_cents)` accepts any finite non-negative value (fractional, `1e300`) from a `records_v1` row, so a `financial_entry` written by another `save_record` caller (e.g. `agentTools`) bypasses the cent/bound rules the form enforces and can push period sums past `Number.MAX_SAFE_INTEGER`. — Fix: require `Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= MAX_AMOUNT_MAJOR * 100`, else return `null`.

`app/financials/page.tsx:80` — Reliability — `campaign_daily_v1(...).limit(ROW_LIMIT)` has no `.order`, so which 1000 rows survive truncation is arbitrary and Ad Spend/Profit can be wrong unpredictably; the sibling `daily_summary_v1` query on line 76 does order. — Fix: add `.order("day", { ascending: false })` so the current period survives truncation ahead of the previous one.

`lib/financials.ts:454` — Scalability — `.limit(ENTRY_ROW_LIMIT)` with `.order("occurred_at", desc)` spans `prevFrom..to`, so past 500 entries the *previous* period is dropped first and every manual/profit delta skews with no signal, rather than only the list truncating (deferred item, listed for the ceiling only). — Fix: when paging lands, fetch the two windows as separate bounded queries.

`lib/financials.ts:446` — Scalability — the `attributes->>date` range predicate cannot use a b-tree index (engineer-flagged), and this query now runs on every home render as well as every `/financials` render. — Fix: an expression index on `(attributes->>'date')` in bcns-data, or filter on `occurred_at` with a timezone-widened window and keep the exact bound check in `shapeEntries`.

`lib/financials.ts:155` — Over-Engineering — the `row.occurred_at.slice(0, 10)` fallback for a missing `attributes.date` is unreachable: `financialRecordsQuery` filters on `attributes->>date`, which is NULL for exactly the rows the fallback exists to rescue. — Fix: drop the fallback, or move the range check out of the query so those rows can reach it.

## Verified OK

- **Money path.** `parseAmountToCents` (`lib/financials.ts:59`) is regex + integer arithmetic, no `parseFloat`/`Number(x)*100`. Probed directly: `1e3`, `1,000`, `+5`, `.5`, `12.`, `0`, `00`, `-3`, `0.005`, `999999999999`, `1000000000.01`, `NaN`, `Infinity`, `1.2.3`, Arabic-Indic `٣`, fullwidth `１２`, and a trailing zero-width space all return `null`; `0.01`→1, `12.34`→1234, `\t7\n`→700, cap `1000000000`→1e11 accepted. `\d` without the `u` flag keeps unicode digits out. `Number.isSafeInteger` guard present. 100k summed cents stay an exact safe integer.
- **Delta ÷ 0.** `pctDeltaOrNull` returns `null` when `previous === 0` or either side is `null`; AOV guards `orders` truthiness at `lib/financials.ts:275` and `:116`.
- **Formatting at render only.** Every division-to-major-units happens in `formatMoney`/`formatMoneyWhole` via `Intl` `maximumFractionDigits`, never in the totals.
- **Server-side gate.** `parseEntryInput` re-checks date, type, category length, amount and note before any RPC; non-string `FormData` values (multipart `File`) fall through to rejection. HTML `required`/`step`/`max` are convenience only.
- **`save_record` shape** matches DESIGN.md exactly: `external_id` a fresh UUID minted server-side (never client-supplied), `title` = category, `occurred_at` = the validated date, attributes `{date, type, category, amount_cents, note}`.
- **Delete authorization.** `deleteFinancialEntry` re-reads `records_v1` for the posted id constrained to `kind='financial_entry'` + `source='dashboard'` under the signed-in user's RLS before calling `delete_record`, and passes the *same* id it verified — no TOCTOU gap and no path to another client's or another source's row. A non-UUID id errors the lookup and degrades to the `delete` message.
- **Error path.** RPC failures are caught, logged server-side, and surfaced as a fixed `EntryErrorCode`; `entryErrorMessage` returns `null` for unknown codes, so a crafted `?error=` cannot render arbitrary text. No raw RPC error reaches the user.
- **Redirect safety.** Every redirect target is the literal `/financials` plus a `URLSearchParams` query; `from`/`to` are `isValidYmd`-gated and `f_*` values are encoded — no open redirect from any form field.
- **Reads.** `records_v1` is filtered server-side by `kind` + `source` + date range (not fetch-all-then-filter), bounded at 500 rows; the three `/financials` reads and the seven home reads are one `Promise.allSettled` each with per-source `unwrap` degrading to `—` rather than failing the page; no N+1; home and `/financials` each read `records_v1` once, in separate requests.
- **Guardrails.** No `process.env` in the diff; `package.json`/`pnpm-lock.yaml` unchanged (no new deps); no service-role reference; writes are `save_record`/`delete_record` only; `export const dynamic = "force-dynamic"` keeps nothing at build time; zero client components or `"use client"` added.
- **CSS/markup.** `app/globals.css` is +247 / −0 — a single appended `/* === item B: financials === */` block on existing tokens. No `dangerouslySetInnerHTML` anywhere in `app/` or `lib/`; user-entered category and note render as React children (escaped), and echoed `f_*` values render as `defaultValue` attributes (escaped).
- **DESIGN.md conformance.** Seven tiles in spec order, Profit = revenue + manual income − ad spend − manual expenses (`computeProfit`), daily table omits empty days, "No entries yet." empty state, home Expenses row is manual-only with the item A ad-spend double-count removed.

## Commands Run

```
git log --oneline -5
git diff feat/shell-home..HEAD --stat
git status --short
git diff feat/shell-home..HEAD -- app/page.tsx lib/overview.ts
git diff feat/shell-home..HEAD -- package.json pnpm-lock.yaml
git diff feat/shell-home..HEAD -- app/globals.css
git diff feat/shell-home..HEAD --numstat -- app/globals.css
git diff feat/shell-home..HEAD | grep -n "process\.env"
cat -n lib/financials.ts lib/overview.ts lib/data.ts lib/panels.ts
cat -n app/financials/actions.ts app/financials/page.tsx app/_components/MetricCard.tsx
awk '/^## Financial Information/,/^## Content Library/' DESIGN.md
grep -rn "dangerouslySetInnerHTML" app lib
grep -rn "SERVICE_ROLE\|service_role" app lib
grep -n "save_record\|delete_record\|records_v1" node_modules/@bcn-services/data-client/dist/index.d.ts
node amt.mjs   # standalone probe of parseAmountToCents against 24 hostile inputs (run outside the worktree)
```

No build, no dev server, no hosted call, no git state touched.

## STANDARDS.md Updates

`STANDARDS.md` does not exist in this repo and was **not created**: the spawn scope for this review is "write ONLY `.claude/dev-team/review-report.md`" while dt-qa works the same worktree. Candidate project-specific rules for the orchestrator to land:

## Money
- **Integer minor units end to end**: amounts are parsed string→integer cents by regex (`lib/financials.ts parseAmountToCents`), summed as integers, and divided to major units only inside `formatMoney`/`formatMoneyWhole` via `Intl` `maximumFractionDigits`. Never `parseFloat`, never `* 100`.

## Data access
- **Form-supplied row ids are re-read before a write RPC**: a `delete_record`/mutating RPC taking an id from a form first re-reads the `*_v1` view for that id constrained to the expected `kind` + `source`, so RLS is not the only gate (`app/financials/actions.ts deleteFinancialEntry`).

## Server actions
- **Errors redirect with a fixed code, never free text**: failures `redirect('/<page>?error=<code>&f_*=…')`; the page maps the code through a closed `Record` that returns `null` for anything unknown, and echoes `f_*` back into `defaultValue` only. No raw RPC error string reaches the URL or the page.

## Panels
- **`null` means "no source", `0` means "a real zero"**: a sum returns `null` only when every component is absent (`sumPresent`), so an unconnected connector renders `—` and a genuine zero renders `$0`.

## Styling
- **`app/globals.css` is append-only per item**: each work item adds one `/* === item X: name === */` block at the end using existing tokens; existing rules are never edited.
