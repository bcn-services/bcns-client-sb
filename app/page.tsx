import Link from "next/link";
import type { DataClient } from "@bcn-services/data-client";
import { getDataClient } from "@/lib/data";
import {
  parseRange,
  todayInTimezone,
  splitPeriods,
  computeOverviewMetrics,
  formatMoney,
  formatDeltaPct,
  formatPercent,
  aggregateCampaigns,
  bestCreative,
  isSafeHttpsUrl,
  formatRelativeTime,
  type OverviewMetrics,
  type MetricResult,
} from "@/lib/overview";

export const dynamic = "force-dynamic";

const DEFAULT_TIMEZONE = "America/New_York";

type Settled<T> = { data: T[] | null; error: unknown };

function unwrap<T>(r: PromiseSettledResult<{ data: T[] | null; error: unknown }>): Settled<T> {
  if (r.status === "fulfilled") return r.value;
  return { data: null, error: r.reason };
}

async function getTimezone(client: DataClient): Promise<string> {
  try {
    const { data, error } = await client.views.client_v1("timezone").single();
    if (error || !data || !("timezone" in data) || !data.timezone) return DEFAULT_TIMEZONE;
    return data.timezone as string;
  } catch (err) {
    console.error("overview: client_v1 timezone lookup failed", err instanceof Error ? err.message : err);
    return DEFAULT_TIMEZONE;
  }
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const client = await getDataClient();
  if (!client) {
    return (
      <>
        <div className="page-header">
          <h2>Overview</h2>
        </div>
        <p className="notice">Not connected to the data platform.</p>
      </>
    );
  }

  const timezone = await getTimezone(client);
  const today = todayInTimezone(timezone);
  const range = parseRange(searchParams, today);

  const [summaryR, campaignR, creativeR, mediaSetsR, mediaR, activityR] = await Promise.allSettled([
    client.views.daily_summary_v1().gte("day", range.prevFrom).lte("day", range.to).order("day"),
    // ponytail: rows capped at 1000 (Supabase's PostgREST default); a large
    // account over a long range gets partial rollups. Upgrade: a per-range
    // aggregate RPC in bcns-data.
    client.views.campaign_daily_v1().gte("day", range.from).lte("day", range.to).limit(1000),
    client.views.creative_daily_v1().gte("day", range.from).lte("day", range.to).limit(1000),
    client.views.media_sets_v1().order("created_at", { ascending: false }).limit(6),
    client.views.media_v1().is("deleted_at", null).order("created_at", { ascending: false }).limit(6),
    client.views.activity_v1().order("occurred_at", { ascending: false }).limit(10),
  ]);

  const summary = unwrap(summaryR);
  const campaigns = unwrap(campaignR);
  const creatives = unwrap(creativeR);
  const mediaSets = unwrap(mediaSetsR);
  const media = unwrap(mediaR);
  const activity = unwrap(activityR);

  for (const [name, r] of [
    ["daily_summary_v1", summary],
    ["campaign_daily_v1", campaigns],
    ["creative_daily_v1", creatives],
    ["media_sets_v1", mediaSets],
    ["media_v1", media],
    ["activity_v1", activity],
  ] as const) {
    if (r.error) console.error(`overview: ${name} read failed`, r.error instanceof Error ? r.error.message : r.error);
  }

  let metrics: OverviewMetrics | null = null;
  if (!summary.error) {
    const { current, previous } = splitPeriods(summary.data ?? [], range.from, range.to, range.prevFrom, range.prevTo);
    metrics = computeOverviewMetrics(current, previous);
  }

  const topCampaigns = !campaigns.error ? aggregateCampaigns(campaigns.data ?? []) : null;
  const topCreative = !creatives.error ? bestCreative(creatives.data ?? []) : null;

  const setThumbPaths = !mediaSets.error ? (mediaSets.data ?? []).map((s) => s.cover_thumb_path).filter((p): p is string => Boolean(p)) : [];
  const mediaThumbPaths = !media.error ? (media.data ?? []).map((m) => m.thumb_path).filter((p): p is string => Boolean(p)) : [];
  const allThumbPaths = [...(topCreative?.thumbPath ? [topCreative.thumbPath] : []), ...setThumbPaths, ...mediaThumbPaths];
  let thumbUrls: Record<string, string | null> = {};
  if (allThumbPaths.length) {
    try {
      thumbUrls = await client.media.thumbUrls(allThumbPaths);
    } catch (err) {
      console.error("overview: thumbUrls failed", err instanceof Error ? err.message : err);
    }
  }
  const creativeThumbUrl = topCreative?.thumbPath ? thumbUrls[topCreative.thumbPath] ?? null : null;

  return (
    <>
      <div className="page-header">
        <h2>Overview</h2>
        <form className="range-form" method="get">
          <label htmlFor="from">From</label>
          <input id="from" type="date" name="from" defaultValue={range.from} />
          <label htmlFor="to">To</label>
          <input id="to" type="date" name="to" defaultValue={range.to} />
          <button type="submit">Apply</button>
        </form>
      </div>

      <section className="panel">
        <h3>Key metrics</h3>
        {summary.error ? (
          <p className="error-state">Couldn&apos;t load metrics.</p>
        ) : (
          <MetricsGrid metrics={metrics!} />
        )}
      </section>

      <div className="panels-row">
        <section className="panel">
          <h3>Meta Ads — top campaigns by spend</h3>
          {campaigns.error ? (
            <p className="error-state">Couldn&apos;t load Meta Ads.</p>
          ) : !topCampaigns || topCampaigns.length === 0 ? (
            <EmptyState thing="campaign data" source="Meta Ads" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Spend</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c) => (
                  <tr key={c.campaignId}>
                    <td>{c.name}</td>
                    <td>{c.status ?? "—"}</td>
                    <td>{formatMoney(c.spendMinor, c.currency)}</td>
                    <td>{c.roas === null ? "—" : c.roas.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: "1.25rem" }}>Top performing creative</h3>
          {creatives.error ? (
            <p className="error-state">Couldn&apos;t load creative data.</p>
          ) : !topCreative ? (
            <EmptyState thing="creative data" source="Meta Ads" />
          ) : (
            <div className="creative-callout">
              {creativeThumbUrl ? <img src={creativeThumbUrl} alt={topCreative.name} /> : null}
              <div>
                <div>{topCreative.name}</div>
                <div className="empty-state">ROAS {topCreative.roas.toFixed(2)}</div>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h3>Content Library</h3>
          {mediaSets.error && media.error ? (
            <p className="error-state">Couldn&apos;t load the Content Library.</p>
          ) : (mediaSets.data ?? []).length === 0 && (media.data ?? []).length === 0 ? (
            <EmptyState thing="content" source="Drive" />
          ) : (
            <div className="thumb-grid">
              {(mediaSets.data ?? []).map((s) => (
                <div className="thumb-card" key={`set-${s.id}`}>
                  {s.cover_thumb_path && thumbUrls[s.cover_thumb_path] ? (
                    <img src={thumbUrls[s.cover_thumb_path]!} alt={s.name ?? "Set"} />
                  ) : (
                    <div style={{ width: 110, height: 80, borderRadius: 6, background: "var(--accent-weak)" }} />
                  )}
                  <div className="thumb-label">
                    {s.name ?? "Untitled set"} ({s.file_count ?? 0})
                  </div>
                </div>
              ))}
              {(media.data ?? []).map((m) => (
                <div className="thumb-card" key={`media-${m.id}`}>
                  {m.thumb_path && thumbUrls[m.thumb_path] ? (
                    <img src={thumbUrls[m.thumb_path]!} alt={m.filename ?? "File"} />
                  ) : (
                    <div style={{ width: 110, height: 80, borderRadius: 6, background: "var(--accent-weak)" }} />
                  )}
                  <div className="thumb-label">{m.filename ?? "Untitled"}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <h3>Recent activity</h3>
        {activity.error ? (
          <p className="error-state">Couldn&apos;t load recent activity.</p>
        ) : (activity.data ?? []).length === 0 ? (
          <EmptyState thing="activity" source="a connector" />
        ) : (
          <ul className="activity-list">
            {(activity.data ?? []).map((a, i) => (
              <li key={`${a.source}-${a.occurred_at}-${i}`}>
                <span>
                  <strong>{a.title ?? a.kind ?? "Activity"}</strong>
                  {a.detail ? ` — ${a.detail}` : ""}
                  {a.url && isSafeHttpsUrl(a.url) ? (
                    <>
                      {" "}
                      <a href={a.url} rel="noopener noreferrer" target="_blank">
                        link
                      </a>
                    </>
                  ) : null}
                </span>
                <span className="meta">
                  {a.source ?? "—"} · {a.occurred_at ? formatRelativeTime(a.occurred_at) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function EmptyState({ thing, source }: { thing: string; source: string }) {
  return (
    <p className="empty-state">
      No {thing} yet — connect {source} on <Link href="/integrations">Integrations</Link>.
    </p>
  );
}

function deltaClass(deltaPct: number | null): string {
  if (deltaPct === null) return "flat";
  if (deltaPct > 0) return "up";
  if (deltaPct < 0) return "down";
  return "flat";
}

function Sparkline({ series }: { series: { day: string; value: number }[] }) {
  if (series.length < 2) return null;
  const values = series.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const points = series
    .map((s, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((s.value - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

function MetricCard({
  label,
  metric,
  format,
}: {
  label: string;
  metric: MetricResult;
  format: (v: number | null) => string;
}) {
  return (
    <div className="metric-card">
      <div className="label">{label}</div>
      <div className="value">{format(metric.value)}</div>
      {metric.hasData ? (
        <>
          <span className={`delta ${deltaClass(metric.deltaPct)}`}>{formatDeltaPct(metric.deltaPct)}</span>
          <Sparkline series={metric.series} />
        </>
      ) : (
        <div className="empty-state">No data yet</div>
      )}
    </div>
  );
}

function MetricsGrid({ metrics }: { metrics: OverviewMetrics }) {
  return (
    <div className="metric-grid">
      <MetricCard label="Revenue" metric={metrics.revenue} format={(v) => formatMoney(v, metrics.currency)} />
      <MetricCard label="Orders" metric={metrics.orders} format={(v) => (v === null ? "—" : String(v))} />
      <MetricCard label="AOV" metric={metrics.aov} format={(v) => formatMoney(v, metrics.currency)} />
      <MetricCard label="ROAS" metric={metrics.roas} format={(v) => (v === null ? "—" : `${v.toFixed(2)}x`)} />
      <MetricCard label="Conversion rate" metric={metrics.conversionRate} format={(v) => formatPercent(v)} />
      <MetricCard label="Inventory" metric={metrics.inventory} format={(v) => (v === null ? "—" : String(v))} />
    </div>
  );
}
