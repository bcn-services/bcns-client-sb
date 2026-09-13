# DESIGN.md — SB Command Center build spec

The contract every page, panel and PR is built and checked against. CLIENT.md
is the business brief; this file is the build-level spec. When the two
disagree, this file wins and the disagreement gets reported, not reinterpreted.

## Source

Claude Design project (visual source of truth; wins over
`~/os/clients/sb/SB_Reference.PNG` and over prose here on any visual question):

```
Use the claude_design MCP (https://api.anthropic.com/v1/design/mcp, auth via /design-login) to import this project:
https://claude.ai/design/p/6968fc6c-e8d6-46e8-978c-350b212979f9?file=Saunaboy+Command+Center.dc.html

Focus on these files (the whole project is readable):
- `Saunaboy Command Center.dc.html`

Also read these files the selection imports:
- `support.js`

Implement: `Saunaboy Command Center.dc.html`
```

Local copies: `design/Saunaboy Command Center.dc.html` (the artboard: one
home page at desktop width, inline styles, sample data) and
`design/support.js` (the Claude Design canvas runtime the file loads; not
product code). Pulled via DesignSync 2026-09-13; re-pull to refresh, never
hand-edit. Open the `.dc.html` in a browser to see the target.

The design has **one artboard: home**. `/financials` and `/library` have no
artboard; build them from the same tokens and panel anatomy. Header page
buttons are Nate's amendment (2026-09-13), not in the artboard.

## Visual

Read `design/Saunaboy Command Center.dc.html` for exact values; this is the
digest.

**Tokens** (put in `app/globals.css` as CSS variables):

| Role | Value |
| --- | --- |
| page bg | `#f4f4f5` |
| panel bg | `#fff` |
| panel border | `#e8e8ea`; controls `#e4e4e7`; note cards `#eeeef0` |
| hairline (row dividers) | `#f1f1f3` (rows), `#f4f4f5` (lists) |
| text | `#18181b`; secondary `#3f3f46`; body `#27272a`; muted `#52525b`; faint `#71717a`; placeholder `#a1a1aa` |
| accent (links, "View All", icons) | `#e4638a`, hover `#c94d73` |
| accent button | bg `#f9c3d4`, hover `#f6aec5`, text `#18181b` |
| accent soft (icon tiles, segmented bg) | `#fde8ef`, `#fbe7ee`; hover chrome `#fdf2f6` / border `#f4bfd2`; task ring `#f3a9c0` |
| sparkline | `#f0879f` |
| up / down | `#16a34a` / `#dc2626` |
| status badges | In Progress `#a16207` on `#fef3c7`; Done `#15803d` on `#dcfce7`; To Do `#3f3f46` on `#f1f1f3` |
| brand tiles | Shopify `#5a9e45` on `#e8f6ea`; Meta `#1877f2` on `#e8f0fd`; Meet `#4285f4`/`#34a853` on `#eaf2fd`; Monday dots `#f2545b #ffcb00 #00c875` on `#fff3ea` |
| font | `Inter Tight` 400/500/600/700 (load via `next/font/google`, fallback `system-ui, sans-serif`), antialiased |
| radii | panel/card 11px; controls/buttons 9px; icon tile, badges, inner 8px; small 6–7px |
| shadows | none (borders only) |
| page padding | `22px 26px 34px`; header margin-bottom 18px; grid gaps 14px (metric row) / 16px (panels) |

**Type scale**: page title 23px/700/-0.02em; tagline 12.5px `#71717a`;
metric value 22px/700/-0.02em; metric label 12.5px/600 `#3f3f46`; panel title
17px/700/-0.01em (16.5px in the bottom row); row label 13px `#3f3f46`; row
value 13.5px/700; delta 12–12.5px/600 with `↑`/`↓`; list subtitle 14px/700;
"View All →" 12px/600 accent; button 13.5px/600; small button 12.5px/600;
meta text 11–11.5px `#a1a1aa`.

**Header**: left = title + tagline "Data. Creativity. Wellness. Growth.".
Right = a 10px-gap row: page buttons (amendment), Integrations icon button,
Settings icon button, date-range pill. Icon buttons 38×38, white, 1px
`#e4e4e7`, radius 9, 17px stroked icon `#3f3f46` 1.7; hover bg `#fdf2f6`
border `#f4bfd2`. Page buttons use the same chrome at 38px tall with a 13.5/600
label; the current page's button is filled `#fde8ef` with border `#f4bfd2`.
Date pill: white, 1px `#e4e4e7`, radius 9, padding 9px 14px, min-width 250px,
pink calendar icon + "May 26 – Jun 1, 2025" 13.5/500 + grey chevron.

**Metric tile**: white card radius 11 padding `14px 16px 12px`; label; value
row (value left, delta right, baseline aligned); sparkline `<svg viewBox="0 0
200 34">` 30px tall, polyline stroke `#f0879f` 1.8.

**Panel**: white card radius 11 padding `16px 18px 18px`. Header row (margin-
bottom 14px): 30px rounded brand tile + title; optional right control. Rows:
3-col grid `1fr auto 74px` (Meta `66px`), padding 9px 0 (Financial 11px 0),
divider `#f1f1f3` except last. Full-width accent button margin-top 12–14px,
padding 11px, label ends with two spaces and `→`.

**Grid**: metric row `repeat(6, 1fr)`; row 2 `1fr 1.18fr 1.02fr` (Shopify /
Meta Ads / Financial Information), align start; row 3 `1.18fr 1fr 1.06fr
1.16fr` (Meet / Monday / Content Library / Recent Activity), align stretch,
panels flex-column so buttons sit at the bottom. Below ~1100px stack row 2 to
2 columns and row 3 to 2 columns; below 720px one column and metric row 2
columns.

**Deviations from the artboard (decided, don't re-argue)**:
- Per-panel period controls (Shopify Day/Week, Meta "Last 7 days", Financial
  "This Month") are omitted; the header date range drives every panel.
- Home Financial panel rows are Revenue / Ad Spend / Expenses / Profit
  (artboard shows Revenue / Expenses / Profit / Cash Flow; there is no cash-
  flow source).
- "View All →": Content Library → `/library`; Meet and Monday → the service's
  site (no in-dashboard page); Recent Activity has none.
- Note cards' `···` menu is omitted.

## Global rules

- Next.js 14 App Router, server components by default; client components only
  where a browser interaction needs them (upload, selection, popups if
  `<details>` can't do it).
- Data only through `lib/data.ts` (`api.*_v1` views, RPCs) as the signed-in
  user. No env reads outside `lib/env.ts`. Nothing at build time. No
  service-role key. No new dependencies without asking.
- Styling: `app/globals.css` tokens + classes. No Tailwind, no
  `@bcn-services/ui`. Icons inline SVG copied from the artboard.
- Page logic lives in `lib/<page>.ts` (pure functions) so `tests/*.test.mjs`
  stays unit-only.
- Money is cents (integer) in data, formatted at render (`$142,540`,
  `$114.20`). Dates are `YYYY-MM-DD` in the client's timezone
  (`client_v1.timezone`).
- Every panel has three states: **not connected** (no `connector_health_v1`
  row for its source → "Not connected yet" + a link that opens the
  Integrations popup), **connected, empty in range** ("No data for this
  range"), **data**. Metric tiles show `—` and no delta when empty.
- Links to services open in a new tab. Targets live in `lib/links.ts`
  (constants; generic landing pages until SB's store handle / act_id /
  Monday slug are known).
- No sidebar, no tab bar, no "Ask the Command Center" bar, no agent strip, no
  quick actions.

## Header (every page)

- Title "Saunaboy Command Center" (links to `/`) + tagline.
- **Date range control**: URL `?from=YYYY-MM-DD&to=YYYY-MM-DD`; default last
  7 days; presets 7d / 30d / this month + custom from/to inside the pill's
  popup; max span 366 days (`lib/overview.ts parseRange`). Pill label shows
  the range like the artboard ("May 26 – Jun 1, 2025"). Every range-bound
  number on the page follows it. Deltas compare against the previous period
  of equal length; the range carries across page links.
- **Page buttons**: "Financial Information" → `/financials`; "Content
  Library" → `/library`. Current page's button shows the active state.
- **Integrations** icon button → popup: one row per expected source
  (shopify, meta, monday, meet, drive) from `connector_health_v1`: status
  badge (`ok | stale | auth_failed | error | never_ran`, or "Not connected"
  when no row), last success, last error. Replaces the old `/integrations`
  route (deleted).
- **Settings** icon button → popup: signed-in email, client name + timezone
  (`client_v1`), sign out.

## Home `/`

Grid per design: metric row → Shopify / Meta Ads / Financial Information →
Google Meet / Monday.com / Content Library / Recent Activity.

- **Metric row (6 tiles)**: Total Revenue, Orders, Conversion Rate, ROAS, AOV,
  Inventory. Each: value, delta vs previous period, sparkline of the daily
  series across the range. Source: `daily_summary_v1` via `lib/overview.ts`.
- **Shopify panel**: rows Total Revenue, Orders, AOV, Conversion Rate,
  Inventory with deltas (same source). Button "View Shopify Dashboard  →".
- **Meta Ads panel**: two columns. Left rows Spend, ROAS, CPC, CPP,
  Impressions with deltas (`campaign_daily_v1`). Right "Top Performing
  Creative": thumb, ROAS, Spend for the best-ROAS creative in range
  (`creative_daily_v1`); placeholder tile when none. Button "View Ads
  Manager  →".
- **Financial Information panel**: rows Revenue (Shopify), Ad Spend (Meta),
  Expenses (manual), Profit (see `/financials`), each with delta where the
  source has a previous period. Button "Open Financials  →" → `/financials`.
- **Google Meet / Note AI panel**: header has a small accent "Join Meeting"
  button (links out). Subheader "Recent Meeting Notes" + "View All →" (links
  out). Three note cards: title, date, one-line excerpt of `body`, each
  linking to its `url` when present. Source `messages_v1` where
  `kind='meeting_note'`, newest `occurred_at` first.
- **Monday.com panel**: subheader "Priority Tasks" + "View All →" (links
  out). Five rows: ring, title, status badge; not-done first, then by
  `due_on`. Source `jobs_v1` where `kind='task'`. Badge text = `status`;
  colour by `is_done` (Done) / status containing "progress" (In Progress) /
  else (To Do). Button "Open Monday.com  →".
- **Content Library panel**: header "View All →" → `/library`. 3×2 tiles:
  sets (`media_sets_v1`: cover thumb, name, "N Files") first, then latest
  media (`media_v1`) if fewer than 6 sets.
- **Recent Activity panel**: latest 5 rows of `activity_v1`: source tile,
  text, relative time ("2m ago").

## Financial Information `/financials`

Header (with its button active) + a page title row, then:

- Metric tiles for the range: Revenue, Orders, AOV (Shopify), Ad Spend
  (Meta), Manual Income, Manual Expenses, **Profit = revenue + manual income −
  ad spend − manual expenses**. Delta vs previous period where the source has
  one.
- Daily table panel for the range: date, revenue, orders, ad spend, manual
  income, manual expenses, profit. Days with nothing are omitted; no data →
  empty state.
- **Manual entries panel** (figures the connected apps don't track):
  - Form: date, type (`income | expense`), category (1–64 chars), amount
    (positive, ≤ 2 decimals, ≤ 1,000,000,000), note (≤ 500 chars, optional).
  - Save = server action → `save_record('financial_entry', {date, type,
    category, amount_cents, note}, external_id=<uuid>, title=category,
    occurred_at=date)`. Server-side validation is the gate; client-side is
    convenience.
  - List in range from `records_v1` where `kind='financial_entry'` and
    `source='dashboard'`, newest first, with delete (`delete_record`).
  - Empty → "No entries yet".

## Content Library + Creative Folder `/library`

Header (with its button active) + a page title row, then:

- Toolbar: search (title, filename, tags), tag filter, **Upload** (multi-
  file), **New set**.
- Media grid: `media_v1` not deleted, newest first; thumb (`thumbUrls`),
  title/filename, tags, byte size. Checkbox select → bulk bar: **Add tags**
  (`bulk_tag`), **Add to set** (`set_media_set_items`), **Download** (each
  file full-quality via `downloadUrl`), **Delete** (`delete_media`, soft).
- Item view: title + tags edit (`update_media`), full-quality download
  (`download_url`), delete.
- **Creative Folder = sets**: list of `media_sets_v1` (cover, name,
  description, file count); open a set → its items (`media_set_items_v1`)
  with remove / reorder; rename / delete set (`update_media_set`,
  `delete_media_set`).
- Upload: `client.media.upload(file, {title, tags})`. Files are full-quality
  creatives (tens of MB): the upload must not go through a Next server action
  body (1 MB default). Use the browser session (`@supabase/ssr` browser
  client) to build the data client client-side for the upload step only, or
  raise `serverActions.bodySizeLimit`; document the choice in the PR. Hosted
  probe as smoke+sb (2026-09-13) passed: upload → `media_v1` row →
  `downloadUrl` 200 → `delete_media` soft-deletes (`deleted_at` set).
- Egress: show "Downloads this period: X of Y" from `egress_status_v1` and
  disable downloads when exhausted.
- Empty → "No files yet. Upload your first creative."

## Out of scope (this build)

Daily Briefing (chunk 4), any chat/agent, writes back to Shopify/Meta/
Monday/Meet, Meet or Monday pages, Drive indexing UI, QuickBooks.
