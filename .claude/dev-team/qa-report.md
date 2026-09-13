# QA Report
**Task:** Item A — shell + home for the SB Command Center rebuild (header, popups, date range, home grid, stub pages, design tokens)
**Branch:** feat/shell-home
**Date:** 2026-09-12
**Gate mode:** tests+behavioral

## VERDICT: PASS

## Criteria Checked
- No sidebar/nav, no Ask bar/agent strip — `tests/qa-shell-home.test.mjs` greps `app/layout.tsx` for `.app-nav`/"Ask the"/agent-strip; browser: `document.querySelectorAll('.app-nav').length` on `/` returned `0`, `body.innerText` contains no "Ask the" text — PASS.
- Header title/tagline + Financial Information/Content Library buttons reaching `/financials`/`/library`, active state, carrying `?from&to` — browser: clicked the "Financial Information" `page-btn` (`href="/financials?from=2026-08-01&to=2026-08-07"`) with `waitNav`, landed on `/financials?from=2026-08-01&to=2026-08-07`; on `/financials`, `page-btn[href^="/financials"]` had class `page-btn is-active` and the library button did not — PASS.
- Integrations popup lists Shopify/Meta Ads/Monday.com/Google Meet/Google Drive with a status each — browser: navigated `/?popup=integrations`, `details.popup` `open` was `true`, `.integration-row__label` read exactly `["Shopify","Meta Ads","Monday.com","Google Meet","Google Drive"]`, each row a `.badge` — PASS.
- Settings popup shows signed-in email, client "SB", `America/New_York`, sign out — browser: `/?popup=settings` showed `dl` text `Signed in as smoke+sb@bcn-services.com Client SB Timezone America/New_York`; submitting the popup's sign-out form (`requestSubmit()` + `waitNav`) navigated to `/login` — PASS.
- Date pill shows range label, presets + custom from/to write `?from&to` — browser: pill label read "Sep 7 – 13, 2026" on the default range; opened `details.popup--range`, clicked the "Last 30 days" preset link, landed on `/?from=2026-08-15&to=2026-09-13` and the label updated to match; custom form is `method="get"` with inputs named `from`/`to` — PASS.
- `?from&to` invalid/reversed/>366 days falls back to last 7 days — unit: `tests/overview.test.mjs` `parseRange` cases for bad YMD, reversed, and >366-day spans all assert `usedDefault: true` and the default 7-day window (pre-existing, re-run and passing); live: `/?from=bogus&to=2026-09-07`, `/?from=2026-09-10&to=2026-09-01`, and `/?from=2020-01-01&to=2026-09-12` each rendered the pill label "Sep 7 – 13, 2026" (the same last-7-days default) — PASS.
- `/integrations` 404s; `?popup=integrations`/`?popup=settings` arrive open — browser: signed-in GET `/integrations` returned page text "404 This page could not be found."; signed-out `curl` to `/integrations` redirects to `/login` (auth gate in front of the 404, expected); `/?popup=integrations` and `/?popup=settings` both loaded with their `details.popup` `open === true` — PASS.
- Home grid order 6 metrics → Shopify/Meta Ads/Financial Information → Meet/Monday/Content Library/Recent Activity, all `—` and not-connected notes with a Connect link carrying `popup=integrations` — browser: `.panel__title`/`.metric-card__label` text in DOM order was exactly `["Total Revenue","Orders","Conversion Rate","ROAS","AOV","Inventory","Shopify","Meta Ads","Financial Information","Google Meet / Note AI","Monday.com","Content Library","Recent Activity"]`; all 6 `.metric-card__value` read `—`; every `.state-note__link` href ended in `&popup=integrations` — PASS.
- Service buttons external with `target=_blank`/`rel=noopener noreferrer`; Financials/Library internal links correct — browser: `View Shopify Dashboard`→`https://admin.shopify.com/`, `View Ads Manager`→`https://adsmanager.facebook.com/adsmanager/`, `Join Meeting`→`https://meet.google.com/`, `Open Monday.com`→`https://monday.com/`, all with `target="_blank" rel="noopener noreferrer"`; `Open Financials`→`/financials?...` with no target; Content Library "View All →"→`/library?...` — PASS. Unit: `tests/qa-shell-home.test.mjs` asserts every `lib/links.ts` `SERVICE_LINKS` value is a real `https://` URL (not localhost) and `EXTERNAL_LINK_PROPS` is `{target:"_blank", rel:"noopener noreferrer"}`.
- Sign out → `/login`; signed-out `/` → `/login` — browser: sign-out form submit landed on `/login`; `curl` to `/` with no session cookie returned `307` to `http://localhost:3101/login` — PASS.
- `typecheck`/`lint`/`test` green — `corepack pnpm typecheck` exit 0 no output; `corepack pnpm lint` exit 0 no output; `corepack pnpm test` → 76 tests / 75 pass / 0 fail / 1 skipped (the pre-existing 70 assertions plus 6 new from `tests/qa-shell-home.test.mjs`) — PASS.

## Failures
none

## Tests Added
- `tests/qa-shell-home.test.mjs` — layout has no `.app-nav`/Ask/agent-strip surface; `app/integrations/page.tsx` is deleted; `parsePopup` whitelists only `integrations`/`settings`; `SERVICE_LINKS` are real `https://` URLs; `EXTERNAL_LINK_PROPS` carries `target=_blank`/`rel=noopener noreferrer`. No new test infra — extends the existing `tsx --test` convention and is registered in `package.json`'s `test` script.

## Not Verifiable
none
