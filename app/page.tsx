/**
 * Home — the Command Center grid from DESIGN.md "Home": metric row, then
 * Shopify / Meta Ads / Financial Information, then Google Meet / Monday.com /
 * Content Library / Recent Activity.
 *
 * Everything range-bound follows ?from&to (lib/overview.ts parseRange); every
 * panel derives its not-connected / empty / data state from
 * connector_health_v1 (lib/panels.ts).
 */

import { getDataClient } from "@/lib/data";
import { getSignedInEmail, loadShellData } from "@/lib/header";
import { SERVICE_LINKS } from "@/lib/links";
import { computeFinancialRows } from "@/lib/financials";
import { panelState } from "@/lib/panels";
import {
  aggregateCampaigns,
  bestCreative,
  computeMetaMetrics,
  computeOverviewMetrics,
  formatCompact,
  formatCount,
  formatMoney,
  formatMoneyWhole,
  formatPercent,
  formatRelativeTime,
  formatRoas,
  parseRange,
  rangeQuery,
  splitPeriods,
  todayInTimezone,
  type MetaMetrics,
  type OverviewMetrics,
} from "@/lib/overview";
import { AppHeader, parsePopup } from "@/app/_components/AppHeader";
import { MeetPanel } from "@/app/_components/MeetPanel";
import { MondayPanel } from "@/app/_components/MondayPanel";
import { MetricCard } from "@/app/_components/MetricCard";
import { Panel, PanelButton, PanelHead, StateNote, Unconfigured, ViewAll, Delta } from "@/app/_components/Panel";
import { ActivityIcon, FinanceIcon, LibraryIcon, MetaIcon, SourceTile } from "@/app/_components/icons";

export const dynamic = "force-dynamic";

const PANEL_ROW_LIMIT = 1000;

type Settled<T> = { data: T[] | null; error: unknown };

function unwrap<T>(r: PromiseSettledResult<{ data: T[] | null; error: unknown }>): Settled<T> {
  if (r.status === "fulfilled") return r.value;
  return { data: null, error: r.reason };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; popup?: string };
}) {
  const client = await getDataClient();
  if (!client) return <Unconfigured />;

  const [shell, email] = await Promise.all([loadShellData(client), getSignedInEmail()]);
  const today = todayInTimezone(shell.timezone);
  const range = parseRange(searchParams, today);
  const query = rangeQuery(range);
  const connectHref = `${query}&popup=integrations`;

  const [summaryR, campaignR, creativeR, mediaSetsR, mediaR, activityR, tasksR, notesR] = await Promise.allSettled([
    client.views.daily_summary_v1().gte("day", range.prevFrom).lte("day", range.to).order("day"),
    // ponytail: rows capped at 1000 (PostgREST's default); a large account over
    // a long range gets partial rollups. Upgrade: a per-range aggregate RPC in
    // bcns-data.
    client.views.campaign_daily_v1().gte("day", range.prevFrom).lte("day", range.to).limit(PANEL_ROW_LIMIT),
    client.views.creative_daily_v1().gte("day", range.from).lte("day", range.to).limit(PANEL_ROW_LIMIT),
    client.views.media_sets_v1().order("created_at", { ascending: false }).limit(6),
    client.views.media_v1().is("deleted_at", null).order("created_at", { ascending: false }).limit(6),
    client.views.activity_v1().order("occurred_at", { ascending: false }).limit(5),
    // ponytail: capped at 50 (well above the panel's top-5), sorting/tone stay
    // in lib/panels.ts so the DB just narrows the row count.
    client.views.jobs_v1().eq("kind", "task").order("due_on", { ascending: true, nullsFirst: false }).limit(50),
    client.views.messages_v1().eq("kind", "meeting_note").order("occurred_at", { ascending: false }).limit(50),
  ]);

  const summary = unwrap(summaryR);
  const campaigns = unwrap(campaignR);
  const creatives = unwrap(creativeR);
  const mediaSets = unwrap(mediaSetsR);
  const media = unwrap(mediaR);
  const activity = unwrap(activityR);
  const tasks = unwrap(tasksR);
  const notes = unwrap(notesR);

  for (const [name, r] of [
    ["daily_summary_v1", summary],
    ["campaign_daily_v1", campaigns],
    ["creative_daily_v1", creatives],
    ["media_sets_v1", mediaSets],
    ["media_v1", media],
    ["activity_v1", activity],
    ["jobs_v1", tasks],
    ["messages_v1", notes],
  ] as const) {
    if (r.error) console.error(`home: ${name} read failed`, r.error instanceof Error ? r.error.message : r.error);
  }

  const summarySplit = splitPeriods(summary.data ?? [], range.from, range.to, range.prevFrom, range.prevTo);
  const metrics = computeOverviewMetrics(summarySplit.current, summarySplit.previous);

  const campaignSplit = splitPeriods(campaigns.data ?? [], range.from, range.to, range.prevFrom, range.prevTo);
  const meta = computeMetaMetrics(campaignSplit.current, campaignSplit.previous);
  const topCampaigns = aggregateCampaigns(campaignSplit.current);
  const topCreative = bestCreative(creatives.data ?? []);

  const financialRows = computeFinancialRows(
    { revenueMinor: metrics.revenue.value, adSpendMinor: meta.spend.value },
    {
      revenueMinor: summarySplit.previous.length ? summarySplit.previous.reduce((a, r) => a + Number(r.revenue_minor ?? 0), 0) : null,
      adSpendMinor: campaignSplit.previous.length ? campaignSplit.previous.reduce((a, r) => a + Number(r.spend_minor ?? 0), 0) : null,
    },
  );

  const shopifyState = panelState(shell.health, ["shopify"], !summary.error && summarySplit.current.length > 0);
  const metaState = panelState(shell.health, ["meta"], !campaigns.error && campaignSplit.current.length > 0);
  const financialState = panelState(
    shell.health,
    ["shopify", "meta"],
    (!summary.error && summarySplit.current.length > 0) || (!campaigns.error && campaignSplit.current.length > 0),
  );
  const taskRows = tasks.error ? [] : (tasks.data ?? []);
  const noteRows = notes.error ? [] : (notes.data ?? []);
  const mondayState = panelState(shell.health, ["monday"], taskRows.length > 0);
  const meetState = panelState(shell.health, ["meet"], noteRows.length > 0);

  const setRows = mediaSets.error ? [] : (mediaSets.data ?? []);
  const mediaRows = media.error ? [] : (media.data ?? []);
  const libraryTiles = [
    ...setRows.map((s) => ({ key: `set-${s.id}`, name: s.name ?? "Untitled set", sub: `${s.file_count ?? 0} Files`, thumbPath: s.cover_thumb_path })),
    ...mediaRows.map((m) => ({ key: `media-${m.id}`, name: m.title ?? m.filename ?? "Untitled", sub: m.kind ?? "File", thumbPath: m.thumb_path })),
  ].slice(0, 6);

  const thumbPaths = [
    ...(topCreative?.thumbPath ? [topCreative.thumbPath] : []),
    ...libraryTiles.map((t) => t.thumbPath).filter((p): p is string => Boolean(p)),
  ];
  let thumbUrls: Record<string, string | null> = {};
  if (thumbPaths.length) {
    try {
      thumbUrls = await client.media.thumbUrls(thumbPaths);
    } catch (err) {
      console.error("home: thumbUrls failed", err instanceof Error ? err.message : err);
    }
  }
  const creativeThumbUrl = topCreative?.thumbPath ? (thumbUrls[topCreative.thumbPath] ?? null) : null;

  const activityRows = activity.error ? [] : (activity.data ?? []);

  return (
    <>
      <AppHeader
        active="home"
        range={range}
        today={today}
        clientName={shell.clientName}
        timezone={shell.timezone}
        email={email}
        health={shell.health}
        healthError={shell.healthError}
        openPopup={parsePopup(searchParams.popup)}
      />

      <div className="metric-row">
        <MetricCard label="Total Revenue" value={formatMoneyWhole(metrics.revenue.value, metrics.currency)} deltaPct={metrics.revenue.deltaPct} series={metrics.revenue.series} hasData={metrics.revenue.hasData} />
        <MetricCard label="Orders" value={formatCount(metrics.orders.value)} deltaPct={metrics.orders.deltaPct} series={metrics.orders.series} hasData={metrics.orders.hasData} />
        <MetricCard label="Conversion Rate" value={formatPercent(metrics.conversionRate.value, 2)} deltaPct={metrics.conversionRate.deltaPct} series={metrics.conversionRate.series} hasData={metrics.conversionRate.hasData} />
        <MetricCard label="ROAS" value={formatRoas(metrics.roas.value)} deltaPct={metrics.roas.deltaPct} series={metrics.roas.series} hasData={metrics.roas.hasData} />
        <MetricCard label="AOV" value={formatMoney(metrics.aov.value, metrics.currency)} deltaPct={metrics.aov.deltaPct} series={metrics.aov.series} hasData={metrics.aov.hasData} />
        <MetricCard label="Inventory" value={formatCount(metrics.inventory.value)} deltaPct={metrics.inventory.deltaPct} series={metrics.inventory.series} hasData={metrics.inventory.hasData} />
      </div>

      <div className="grid-primary">
        <ShopifyPanel state={shopifyState} metrics={metrics} connectHref={connectHref} />
        <MetaPanel
          state={metaState}
          meta={meta}
          topCampaign={topCampaigns[0]?.name ?? null}
          creative={topCreative}
          creativeThumbUrl={creativeThumbUrl}
          connectHref={connectHref}
        />
        <Panel>
          <PanelHead tile={<FinanceIcon />} title="Financial Information" />
          {financialState === "data" ? (
            <div className="rows">
              {financialRows.map((row) => (
                <div className="row row--roomy" key={row.key}>
                  <span className="row__label">{row.label}</span>
                  <span className="row__value">{formatMoneyWhole(row.valueMinor, metrics.currency)}</span>
                  <Delta deltaPct={row.deltaPct} />
                </div>
              ))}
            </div>
          ) : (
            <StateNote state={financialState} label="Shopify and Meta" connectHref={connectHref} />
          )}
          <PanelButton href={`/financials${query}`} label="Open Financials" />
        </Panel>
      </div>

      <div className="grid-secondary">
        <MeetPanel state={meetState} notes={noteRows} connectHref={connectHref} />
        <MondayPanel state={mondayState} tasks={taskRows} connectHref={connectHref} />

        <Panel className="panel--column">
          <PanelHead tile={<LibraryIcon />} title="Content Library" small right={<ViewAll href={`/library${query}`} />} />
          {libraryTiles.length ? (
            <div className="thumb-grid">
              {libraryTiles.map((tile) => {
                const url = tile.thumbPath ? thumbUrls[tile.thumbPath] : null;
                return (
                  <div className="thumb-tile" key={tile.key}>
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived thumbnail URLs; next/image would proxy every one
                      <img className="thumb-tile__img" src={url} alt="" />
                    ) : (
                      <div className="thumb-tile__img thumb-tile__img--placeholder" aria-hidden="true" />
                    )}
                    <div className="thumb-tile__name">{tile.name}</div>
                    <div className="thumb-tile__sub">{tile.sub}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="state-note">No files yet. Upload your first creative.</p>
          )}
        </Panel>

        <Panel className="panel--column">
          <PanelHead tile={<ActivityIcon />} title="Recent Activity" small />
          <div className="panel__fill">
            {activityRows.length ? (
              <div className="activity-list">
                {activityRows.map((row, i) => (
                  <div className="activity-row" key={`${row.source ?? ""}-${row.occurred_at ?? ""}-${i}`}>
                    <SourceTile source={row.source} />
                    <span className="activity-row__text">{row.title ?? row.detail ?? row.kind ?? "Activity"}</span>
                    <span className="activity-row__time">{row.occurred_at ? formatRelativeTime(row.occurred_at) : "—"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <StateNote state={activity.error ? "empty" : "not_connected"} label="a source" connectHref={connectHref} />
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

function ShopifyPanel({ state, metrics, connectHref }: { state: ReturnType<typeof panelState>; metrics: OverviewMetrics; connectHref: string }) {
  const rows = [
    { label: "Total Revenue", value: formatMoneyWhole(metrics.revenue.value, metrics.currency), deltaPct: metrics.revenue.deltaPct },
    { label: "Orders", value: formatCount(metrics.orders.value), deltaPct: metrics.orders.deltaPct },
    { label: "AOV", value: formatMoney(metrics.aov.value, metrics.currency), deltaPct: metrics.aov.deltaPct },
    { label: "Conversion Rate", value: formatPercent(metrics.conversionRate.value, 2), deltaPct: metrics.conversionRate.deltaPct },
    { label: "Inventory", value: formatCount(metrics.inventory.value), deltaPct: metrics.inventory.deltaPct },
  ];
  return (
    <Panel>
      <PanelHead tile={<span className="brand-tile__letter">S</span>} title="Shopify" />
      {state === "data" ? (
        <div className="rows">
          {rows.map((row) => (
            <div className="row" key={row.label}>
              <span className="row__label">{row.label}</span>
              <span className="row__value">{row.value}</span>
              <Delta deltaPct={row.deltaPct} />
            </div>
          ))}
        </div>
      ) : (
        <StateNote state={state} label="Shopify" connectHref={connectHref} />
      )}
      <PanelButton href={SERVICE_LINKS.shopifyAdmin} label="View Shopify Dashboard" external />
    </Panel>
  );
}

function MetaPanel({
  state,
  meta,
  topCampaign,
  creative,
  creativeThumbUrl,
  connectHref,
}: {
  state: ReturnType<typeof panelState>;
  meta: MetaMetrics;
  topCampaign: string | null;
  creative: ReturnType<typeof bestCreative>;
  creativeThumbUrl: string | null;
  connectHref: string;
}) {
  const rows = [
    { label: "Spend", value: formatMoneyWhole(meta.spend.value, meta.currency), deltaPct: meta.spend.deltaPct },
    { label: "ROAS", value: formatRoas(meta.roas.value), deltaPct: meta.roas.deltaPct },
    { label: "CPC", value: formatMoney(meta.cpc.value, meta.currency), deltaPct: meta.cpc.deltaPct },
    { label: "CPP", value: formatMoney(meta.cpp.value, meta.currency), deltaPct: meta.cpp.deltaPct },
    { label: "Impressions", value: formatCompact(meta.impressions.value), deltaPct: meta.impressions.deltaPct },
  ];
  return (
    <Panel>
      <PanelHead tile={<MetaIcon />} title="Meta Ads" />
      {state === "data" ? (
        <div className="meta-split">
          <div className="rows">
            {rows.map((row) => (
              <div className="row row--tight" key={row.label}>
                <span className="row__label">{row.label}</span>
                <span className="row__value">{row.value}</span>
                <Delta deltaPct={row.deltaPct} />
              </div>
            ))}
          </div>
          <div>
            <div className="subhead__label">Top Performing Creative</div>
            <div className="creative">
              {creativeThumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived thumbnail URL
                <img className="creative__thumb" src={creativeThumbUrl} alt={creative?.name ?? ""} />
              ) : (
                <div className="creative__thumb creative__thumb--placeholder" aria-hidden="true" />
              )}
              <div className="creative__stats">
                <div className="creative__label">ROAS</div>
                <div className="creative__value">{creative ? formatRoas(creative.roas) : "—"}</div>
                <div className="creative__label creative__label--spaced">Spend</div>
                <div className="creative__value creative__value--sm">{creative ? formatMoneyWhole(creative.spendMinor, meta.currency) : "—"}</div>
              </div>
            </div>
            {topCampaign ? <div className="creative__caption">Top campaign by spend: {topCampaign}</div> : null}
          </div>
        </div>
      ) : (
        <StateNote state={state} label="Meta Ads" connectHref={connectHref} />
      )}
      <PanelButton href={SERVICE_LINKS.metaAdsManager} label="View Ads Manager" external />
    </Panel>
  );
}
