# Engineer Report
**Task:** Item A — shell + home for the SB Command Center rebuild (header, popups, date range, home grid, stub pages, design tokens)
**Branch:** feat/shell-home (worktree `.claude/worktrees/shell-home`)
**Date:** 2026-09-12

## Design Decisions
- Header renders per page (`AppHeader`), not in `app/layout.tsx`: App Router layouts never receive `searchParams`, and every header control is driven by `?from&to` — this deviates from the spawn prompt's literal "new header in layout.tsx" and is listed under conflicts below.
- Popups are native `<details>` + CSS with no client JS; `?popup=integrations|settings` seeds `open` server-side so a panel's "Connect …" link can open the Integrations popup (a fragment link cannot set `open`, which DESIGN.md's "link that opens the popup" otherwise requires).
- Date pill writes `?from&to` only — `lib/overview.ts parseRange` stays the single range parser; presets are pure (`rangePresets`) and the custom form is a plain `<form method="get">` with `<input type="date">`, so no date library.
- Panel state is derived from `connector_health_v1` alone (`lib/panels.ts panelState`): a panel with no health row reads not-connected even if rows exist, so an empty SB account renders the state Nate sees first rather than fake zeros.
- Meet and Monday panels take `notes` / `tasks` props and are handed `[]` today — that is item D's seam onto `jobs_v1` / `messages_v1`; full chrome and all three states already render.
- Financial rows: Expenses = ad spend + `manualExpensesMinor` (absent today), Profit = revenue − expenses. `FinancialInputs.manualExpensesMinor` is item B's seam.
- All pure logic (range labels, presets, formatters, Meta rollup, panel state, financial rows) lives in `lib/*.ts` with `tsx --test` unit tests; components stay render-only.
- Money stays in minor units to the render boundary; rates (ROAS/CPC/CPP) are recomputed from period totals, never averaged across days.

## Files Changed
- `app/layout.tsx` — sidebar removed; `Inter_Tight` via `next/font/google` (fallback `system-ui, sans-serif`) exposed as `--font-inter-tight`; body wraps children in `.page`.
- `app/globals.css` — rewritten: the full DESIGN.md token table as CSS variables plus every header/tile/panel/row/badge/popup class and the ~1100px and 720px breakpoints; old dark-mode and blue-accent template styles dropped.
- `app/_components/AppHeader.tsx` — title + tagline, page buttons with active state, Integrations popup, Settings popup (email / client / timezone / sign out), date-range pill with presets and custom form.
- `app/_components/icons.tsx` — SVG icons traced from `design/Saunaboy Command Center.dc.html`, plus `SourceTile`.
- `app/_components/Panel.tsx` — `Panel`, `PanelHead`, `DataRow`, `Delta`, `ViewAll`, `PanelButton`, `StateNote`, `Unconfigured`.
- `app/_components/MetricCard.tsx` — metric tile and the 200×34 sparkline; renders `—` with no delta when a source is empty.
- `app/_components/MeetPanel.tsx`, `app/_components/MondayPanel.tsx` — full chrome with the three states; row props are item D's seam.
- `app/page.tsx` — rewritten as the home grid: 6 metric tiles, Shopify / Meta Ads / Financial Information, Google Meet / Monday.com / Content Library / Recent Activity; six `Promise.allSettled` reads so one failing view cannot blank the page.
- `app/financials/page.tsx`, `app/library/page.tsx` — stubs with the shared header, active button, and one "this page arrives next" panel (items B and C replace them).
- `app/integrations/page.tsx` — deleted; the route now 404s and its content lives in the header popup.
- `app/login/actions.ts` — added `signOut()` reusing the existing `createSupabaseServer` + `redirect("/login")` pattern.
- `lib/overview.ts` — appended `formatRangeLabel`, `formatDayLabel`, `rangePresets`, `rangeQuery`, `formatMoneyWhole`, `formatCount`, `formatCompact`, `formatRoas`, `formatDeltaArrow`, `deltaTone`, `computeMetaMetrics`.
- `lib/panels.ts` (new) — expected sources, `panelState`, Integrations-popup rows, task/note shaping.
- `lib/financials.ts` (new) — `computeFinancialRows`.
- `lib/links.ts` (new) — outbound service targets + `EXTERNAL_LINK_PROPS` (`target=_blank`, `rel=noopener noreferrer`).
- `lib/header.ts` (new) — `loadShellData` (client name, timezone, connector health via `Promise.allSettled`) and `getSignedInEmail` (uses `auth.getUser()`, not the cookie session).
- `tests/panels.test.mjs`, `tests/financials.test.mjs` (new) and `tests/overview.test.mjs` (extended) — 70 passing assertions; registered in `package.json`'s `test` script.
- `eslint.config.mjs` — ignore `design/**` (the vendored artboard export lints with 13 pre-existing errors from commit abf8cbb and is not app source).

## Verification
- `corepack pnpm typecheck` → `$ tsc --noEmit` (no output, exit 0)
- `corepack pnpm lint` → `$ eslint .` (no output, exit 0)
- `corepack pnpm test` → `# tests 71 / # pass 70 / # fail 0 / # skipped 1`
- `corepack pnpm build` → `✓ Generating static pages (7/7)`; routes `ƒ /`, `ƒ /financials`, `ƒ /library`, `ƒ /login`, `ƒ /api/health`
- Live pass signed in as smoke+sb on `:3101`: home renders the full grid with every panel not-connected; Integrations popup lists all five sources as "Not connected"; Settings shows the email, client "SB", `America/New_York`, and sign out redirects to `/login`; the pill's "Last 30 days" wrote `?from=2026-08-15&to=2026-09-13` and the label followed; header buttons reached `/financials` and `/library` carrying the range; `?popup=integrations` opened the popup on arrival; `/integrations` 404s; console clean (one React DevTools info line).

## Deferred / Out of Scope
- Meet/Monday rows, Financial manual figures, and the real `/financials` and `/library` pages — items B, C, D.
- `lib/links.ts` targets are generic landing pages; SB's Shopify store handle, Meta `act_id`, and Monday board slug will replace them.
- `campaign_daily_v1` / `creative_daily_v1` reads are capped at 1000 rows (PostgREST default) — marked with a `ponytail:` comment; a long range on a large account would roll up partial data.
- Responsive breakpoints were written to DESIGN.md's spec but only verified at desktop width in the browser.

## Flags for Reviewer
- `app/page.tsx` issues six view reads per request with `dynamic = "force-dynamic"` and no caching; `campaign_daily_v1` and `creative_daily_v1` are the two that can grow with account size and range.
- `getSignedInEmail()` calls `auth.getUser()` on every page render — one extra auth round trip per request on top of middleware's.
- `client.media.thumbUrls()` is wrapped in try/catch and degrades to placeholder tiles; signed-URL expiry is not handled.
- Popups are `<details>` with no outside-click or Escape dismissal — they close only via their own summary.
- The range comes straight from the query string into `parseRange`; the 366-day cap and reversed-range fallback there are the only guards.
