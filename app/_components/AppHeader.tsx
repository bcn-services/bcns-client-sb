/**
 * AppHeader.tsx — the shell every page renders: title + tagline, the page
 * buttons, the Integrations and Settings popups, and the date-range pill.
 *
 * It lives here rather than in app/layout.tsx because an App Router layout
 * never receives `searchParams`, and the header is entirely driven by the
 * ?from&to range and the active route. Each page passes both.
 *
 * Popups are native <details>. `openPopup` seeds the open state from the URL
 * so a panel's "Connect …" link can open the Integrations popup without any
 * client JavaScript; the summary toggles it natively after that.
 */

import Link from "next/link";
import { formatDayLabel, formatRangeLabel, rangePresets, rangeQuery, type ParsedRange } from "@/lib/overview";
import { integrationRows, type HealthLike } from "@/lib/panels";
import { signOut } from "@/app/login/actions";
import { CalendarIcon, ChevronDownIcon, IntegrationsIcon, SettingsIcon } from "./icons";

export type ActivePage = "home" | "financials" | "library";
export type OpenPopup = "integrations" | "settings" | undefined;

/** The value `?popup=` must hold for a link to open a popup on arrival. */
export function parsePopup(value: string | undefined): OpenPopup {
  return value === "integrations" || value === "settings" ? value : undefined;
}

const PAGES: { key: ActivePage; href: string; label: string }[] = [
  { key: "financials", href: "/financials", label: "Financial Information" },
  { key: "library", href: "/library", label: "Content Library" },
];

export function AppHeader({
  active,
  range,
  today,
  clientName,
  timezone,
  email,
  health,
  healthError,
  openPopup,
}: {
  active: ActivePage;
  range: ParsedRange;
  today: string;
  clientName: string | null;
  timezone: string;
  email: string | null;
  health: HealthLike[];
  healthError: boolean;
  openPopup: OpenPopup;
}) {
  const query = rangeQuery(range);
  const presets = rangePresets(today);
  const rows = integrationRows(health);

  return (
    <header className="app-header">
      <div>
        <Link className="app-title" href={`/${query}`}>
          Saunaboy Command Center
        </Link>
        <div className="app-tagline">Data. Creativity. Wellness. Growth.</div>
      </div>

      <div className="app-header__controls">
        {PAGES.map((page) => (
          <Link
            key={page.key}
            className={`page-btn${active === page.key ? " is-active" : ""}`}
            href={`${page.href}${query}`}
            aria-current={active === page.key ? "page" : undefined}
          >
            {page.label}
          </Link>
        ))}

        <details className="popup" open={openPopup === "integrations"}>
          <summary className="icon-btn" title="Integrations" aria-label="Integrations">
            <IntegrationsIcon />
          </summary>
          <div className="popup-panel popup-panel--wide">
            <div className="popup-panel__title">Integrations</div>
            {healthError ? (
              <p className="state-note">Couldn&apos;t load integration status.</p>
            ) : (
              <ul className="integration-list">
                {rows.map((row) => (
                  <li className="integration-row" key={row.source}>
                    <span className="integration-row__label">{row.label}</span>
                    <span className={`badge badge--${row.tone}`}>{row.statusLabel}</span>
                    <span className="integration-row__meta">
                      {row.lastSuccessAt ? `Last success ${formatDayLabel(row.lastSuccessAt)}` : "No successful run yet"}
                    </span>
                    {row.lastError ? <span className="integration-row__error">{row.lastError}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        <details className="popup" open={openPopup === "settings"}>
          <summary className="icon-btn" title="Settings" aria-label="Settings">
            <SettingsIcon />
          </summary>
          <div className="popup-panel">
            <div className="popup-panel__title">Settings</div>
            <dl className="settings-list">
              <dt>Signed in as</dt>
              <dd>{email ?? "—"}</dd>
              <dt>Client</dt>
              <dd>{clientName ?? "—"}</dd>
              <dt>Timezone</dt>
              <dd>{timezone}</dd>
            </dl>
            <form action={signOut}>
              <button className="btn-plain" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </details>

        <details className="popup popup--range">
          <summary className="range-pill" title="Change the date range">
            <span className="range-pill__label">
              <CalendarIcon />
              <span>{formatRangeLabel(range.from, range.to)}</span>
            </span>
            <ChevronDownIcon />
          </summary>
          <div className="popup-panel">
            <div className="popup-panel__title">Date range</div>
            <div className="preset-row">
              {presets.map((preset) => {
                const isActive = preset.from === range.from && preset.to === range.to;
                return (
                  <Link
                    key={preset.key}
                    className={`preset${isActive ? " is-active" : ""}`}
                    href={`?${new URLSearchParams({ from: preset.from, to: preset.to }).toString()}`}
                  >
                    {preset.label}
                  </Link>
                );
              })}
            </div>
            <form className="range-form" method="get">
              <label htmlFor="range-from">From</label>
              <input id="range-from" type="date" name="from" defaultValue={range.from} required />
              <label htmlFor="range-to">To</label>
              <input id="range-to" type="date" name="to" defaultValue={range.to} required />
              <button className="btn-plain" type="submit">
                Apply
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
