/**
 * overview.ts — pure logic for the SB Command Center Overview page. No env
 * reads, no I/O: date-range parsing/defaulting, metric aggregation + deltas,
 * campaign/creative rollups, money formatting, and URL safety. Covered by
 * tests/overview.test.mjs.
 */

const MS_DAY = 86_400_000;
const MAX_SPAN_DAYS = 366;
const DEFAULT_SPAN_DAYS = 7;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string" || !YMD_RE.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  // Round-trip: rejects rolled-over dates like 2024-02-30.
  return !Number.isNaN(ms) && utcMsToYmd(ms) === s;
}

function ymdToUtcMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`);
}

function utcMsToYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  return utcMsToYmd(ymdToUtcMs(ymd) + days * MS_DAY);
}

function spanDays(from: string, to: string): number {
  return Math.round((ymdToUtcMs(to) - ymdToUtcMs(from)) / MS_DAY) + 1;
}

/** "Today" in an IANA timezone, as YYYY-MM-DD. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

export interface ParsedRange {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  usedDefault: boolean;
}

/** Parses from/to search params. Invalid, reversed, or a span over 366 days
 *  falls back to the last 7 days ending `today`. Previous period is the same
 *  number of days immediately before `from`. */
export function parseRange(params: { from?: string | null; to?: string | null }, today: string): ParsedRange {
  const { from, to } = params;
  let valid = isValidYmd(from) && isValidYmd(to);
  if (valid && from! > to!) valid = false;
  if (valid && spanDays(from!, to!) > MAX_SPAN_DAYS) valid = false;

  const resolvedTo = valid ? to! : today;
  const resolvedFrom = valid ? from! : addDaysYmd(today, -(DEFAULT_SPAN_DAYS - 1));
  const days = spanDays(resolvedFrom, resolvedTo);
  const prevTo = addDaysYmd(resolvedFrom, -1);
  const prevFrom = addDaysYmd(prevTo, -(days - 1));

  return { from: resolvedFrom, to: resolvedTo, prevFrom, prevTo, usedDefault: !valid };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(n: number, d: number): number | null {
  return d ? n / d : null;
}

/** null when either side is absent, or previous is 0 (avoids a meaningless /0 "—"). */
export function pctDeltaOrNull(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

export interface DailySummaryLike {
  day?: string | null;
  revenue_minor?: unknown;
  orders?: unknown;
  ad_purchase_value_minor?: unknown;
  ad_spend_minor?: unknown;
  sessions?: unknown;
  inventory_units?: unknown;
  currency?: unknown;
}

function sum(rows: DailySummaryLike[], key: keyof DailySummaryLike): number {
  return rows.reduce((acc, r) => acc + num(r[key]), 0);
}

/** Splits rows already covering prevFrom..to into the current and previous windows. */
export function splitPeriods<T extends { day?: string | null }>(
  rows: T[],
  from: string,
  to: string,
  prevFrom: string,
  prevTo: string,
): { current: T[]; previous: T[] } {
  const current = rows.filter((r) => r.day && r.day >= from && r.day <= to);
  const previous = rows.filter((r) => r.day && r.day >= prevFrom && r.day <= prevTo);
  return { current, previous };
}

function daySeries(rows: DailySummaryLike[], fn: (r: DailySummaryLike) => number): { day: string; value: number }[] {
  return rows
    .filter((r) => r.day)
    .map((r) => ({ day: r.day as string, value: fn(r) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function latestInventory(rows: DailySummaryLike[]): number | null {
  const withVal = rows.filter((r) => r.day && r.inventory_units !== null && r.inventory_units !== undefined);
  if (!withVal.length) return null;
  withVal.sort((a, b) => (a.day as string).localeCompare(b.day as string));
  const last = withVal[withVal.length - 1];
  return last ? num(last.inventory_units) : null;
}

export interface MetricResult {
  value: number | null;
  deltaPct: number | null;
  series: { day: string; value: number }[];
  hasData: boolean;
}

export interface OverviewMetrics {
  currency: string;
  revenue: MetricResult;
  orders: MetricResult;
  aov: MetricResult;
  roas: MetricResult;
  conversionRate: MetricResult;
  inventory: MetricResult;
}

export function computeOverviewMetrics(currentRows: DailySummaryLike[], previousRows: DailySummaryLike[]): OverviewMetrics {
  const hasCur = currentRows.length > 0;
  const hasPrev = previousRows.length > 0;

  const curRevenue = hasCur ? sum(currentRows, "revenue_minor") : null;
  const prevRevenue = hasPrev ? sum(previousRows, "revenue_minor") : null;
  const curOrders = hasCur ? sum(currentRows, "orders") : null;
  const prevOrders = hasPrev ? sum(previousRows, "orders") : null;

  const curAov = curRevenue !== null && curOrders !== null ? safeDiv(curRevenue, curOrders) : null;
  const prevAov = prevRevenue !== null && prevOrders !== null ? safeDiv(prevRevenue, prevOrders) : null;

  const curRoas = hasCur ? safeDiv(sum(currentRows, "ad_purchase_value_minor"), sum(currentRows, "ad_spend_minor")) : null;
  const prevRoas = hasPrev ? safeDiv(sum(previousRows, "ad_purchase_value_minor"), sum(previousRows, "ad_spend_minor")) : null;

  const curConv = hasCur ? safeDiv(curOrders ?? 0, sum(currentRows, "sessions")) : null;
  const prevConv = hasPrev ? safeDiv(prevOrders ?? 0, sum(previousRows, "sessions")) : null;

  const curInventory = latestInventory(currentRows);
  const prevInventory = latestInventory(previousRows);

  const currencyRow = [...currentRows, ...previousRows].find((r) => r.currency);
  const currency = (currencyRow?.currency as string) ?? "USD";

  return {
    currency,
    revenue: {
      value: curRevenue,
      deltaPct: pctDeltaOrNull(curRevenue, prevRevenue),
      series: daySeries(currentRows, (r) => num(r.revenue_minor)),
      hasData: hasCur,
    },
    orders: {
      value: curOrders,
      deltaPct: pctDeltaOrNull(curOrders, prevOrders),
      series: daySeries(currentRows, (r) => num(r.orders)),
      hasData: hasCur,
    },
    aov: {
      value: curAov,
      deltaPct: pctDeltaOrNull(curAov, prevAov),
      series: daySeries(currentRows, (r) => (num(r.orders) ? num(r.revenue_minor) / num(r.orders) : 0)),
      hasData: hasCur,
    },
    roas: {
      value: curRoas,
      deltaPct: pctDeltaOrNull(curRoas, prevRoas),
      series: daySeries(currentRows, (r) => (num(r.ad_spend_minor) ? num(r.ad_purchase_value_minor) / num(r.ad_spend_minor) : 0)),
      hasData: hasCur,
    },
    conversionRate: {
      value: curConv,
      deltaPct: pctDeltaOrNull(curConv, prevConv),
      series: daySeries(currentRows, (r) => (num(r.sessions) ? num(r.orders) / num(r.sessions) : 0)),
      hasData: hasCur,
    },
    inventory: {
      value: curInventory,
      deltaPct: pctDeltaOrNull(curInventory, prevInventory),
      series: daySeries(currentRows, (r) => num(r.inventory_units)),
      hasData: hasCur,
    },
  };
}

/** Money, minor units -> localized string. Fraction digits come from Intl for
 *  the given currency (e.g. JPY -> 0), not hardcoded /100. */
export function formatMoney(minorUnits: number | null, currency = "USD"): string {
  if (minorUnits === null) return "—";
  try {
    const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(minorUnits / 10 ** digits);
  } catch {
    return "—"; // malformed currency code from a row must not crash the page
  }
}

export function formatPercent(ratio: number | null, fractionDigits = 1): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

export function formatDeltaPct(deltaPct: number | null): string {
  if (deltaPct === null) return "—";
  const sign = deltaPct >= 0 ? "+" : "";
  return `${sign}${(deltaPct * 100).toFixed(1)}%`;
}

export interface CampaignDailyLike {
  campaign_id?: string | null;
  campaign_name?: string | null;
  campaign_status?: string | null;
  spend_minor?: unknown;
  purchase_value_minor?: unknown;
  currency?: unknown;
  day?: string | null;
}

export interface CampaignAgg {
  campaignId: string;
  name: string;
  status: string | null;
  spendMinor: number;
  purchaseValueMinor: number;
  roas: number | null;
  currency: string;
}

/** Aggregates campaign_daily_v1 rows by campaign_id over the range and
 *  returns the top 5 by spend, using the latest day's name/status/currency. */
export function aggregateCampaigns(rows: CampaignDailyLike[]): CampaignAgg[] {
  const byId = new Map<string, CampaignAgg & { latestDay: string }>();
  for (const r of rows) {
    if (!r.campaign_id) continue;
    const spend = num(r.spend_minor);
    const pv = num(r.purchase_value_minor);
    const day = r.day ?? "";
    const existing = byId.get(r.campaign_id);
    if (!existing) {
      byId.set(r.campaign_id, {
        campaignId: r.campaign_id,
        name: r.campaign_name ?? r.campaign_id,
        status: r.campaign_status ?? null,
        spendMinor: spend,
        purchaseValueMinor: pv,
        roas: null,
        currency: (r.currency as string) ?? "USD",
        latestDay: day,
      });
      continue;
    }
    existing.spendMinor += spend;
    existing.purchaseValueMinor += pv;
    if (day >= existing.latestDay) {
      existing.latestDay = day;
      existing.name = r.campaign_name ?? existing.name;
      existing.status = r.campaign_status ?? existing.status;
      existing.currency = (r.currency as string) ?? existing.currency;
    }
  }
  return Array.from(byId.values())
    .map(({ latestDay: _latestDay, ...c }) => ({ ...c, roas: safeDiv(c.purchaseValueMinor, c.spendMinor) }))
    .sort((a, b) => b.spendMinor - a.spendMinor)
    .slice(0, 5);
}

export interface CreativeDailyLike {
  ad_id?: string | null;
  ad_name?: string | null;
  thumb_path?: string | null;
  spend_minor?: unknown;
  purchase_value_minor?: unknown;
  day?: string | null;
}

export interface CreativeAgg {
  adId: string;
  name: string;
  thumbPath: string | null;
  spendMinor: number;
  purchaseValueMinor: number;
  roas: number;
}

/** Aggregates creative_daily_v1 rows by ad_id and returns the one with the
 *  highest ROAS among ads with spend > 0 (null when none qualify). */
export function bestCreative(rows: CreativeDailyLike[]): CreativeAgg | null {
  const byId = new Map<string, CreativeAgg & { latestDay: string }>();
  for (const r of rows) {
    if (!r.ad_id) continue;
    const spend = num(r.spend_minor);
    const pv = num(r.purchase_value_minor);
    const day = r.day ?? "";
    const existing = byId.get(r.ad_id);
    if (!existing) {
      byId.set(r.ad_id, {
        adId: r.ad_id,
        name: r.ad_name ?? r.ad_id,
        thumbPath: r.thumb_path ?? null,
        spendMinor: spend,
        purchaseValueMinor: pv,
        roas: 0,
        latestDay: day,
      });
      continue;
    }
    existing.spendMinor += spend;
    existing.purchaseValueMinor += pv;
    if (day >= existing.latestDay) {
      existing.latestDay = day;
      existing.name = r.ad_name ?? existing.name;
      existing.thumbPath = r.thumb_path ?? existing.thumbPath;
    }
  }
  let best: (CreativeAgg & { latestDay: string }) | null = null;
  for (const c of byId.values()) {
    if (c.spendMinor <= 0) continue;
    c.roas = c.purchaseValueMinor / c.spendMinor;
    if (!best || c.roas > best.roas) best = c;
  }
  if (!best) return null;
  const { latestDay: _latestDay, ...rest } = best;
  return rest;
}

/** true only for a well-formed https: URL — never javascript:/http:/relative. */
export function isSafeHttpsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** Coarse relative time ("3 hours ago", "in 2 days") for activity timestamps. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  if (!Number.isFinite(diffSec)) return "—";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(diffSec, "second");
}

/* ------------------------------------------------------------------ *
 * Header date range: labels, presets, query strings.
 * ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ymdParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

/** Pill label for a range: "May 26 – Jun 1, 2025", collapsing a shared month/year. */
export function formatRangeLabel(from: string, to: string): string {
  const a = ymdParts(from);
  const b = ymdParts(to);
  const aMon = MONTHS[a.m - 1] ?? "";
  const bMon = MONTHS[b.m - 1] ?? "";
  if (from === to) return `${aMon} ${a.d}, ${a.y}`;
  if (a.y !== b.y) return `${aMon} ${a.d}, ${a.y} – ${bMon} ${b.d}, ${b.y}`;
  if (a.m === b.m) return `${aMon} ${a.d} – ${b.d}, ${b.y}`;
  return `${aMon} ${a.d} – ${bMon} ${b.d}, ${b.y}`;
}

/** "May 30, 2025" for a single day (note cards, activity). */
export function formatDayLabel(ymdOrIso: string): string {
  const ymd = ymdOrIso.slice(0, 10);
  if (!YMD_RE.test(ymd)) return "—";
  const { y, m, d } = ymdParts(ymd);
  return `${MONTHS[m - 1] ?? ""} ${d}, ${y}`;
}

export interface RangePreset {
  key: "7d" | "30d" | "month";
  label: string;
  from: string;
  to: string;
}

/** The three header presets, resolved against the client's "today". */
export function rangePresets(today: string): RangePreset[] {
  const { y, m } = ymdParts(today);
  return [
    { key: "7d", label: "Last 7 days", from: addDaysYmd(today, -6), to: today },
    { key: "30d", label: "Last 30 days", from: addDaysYmd(today, -29), to: today },
    { key: "month", label: "This month", from: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`, to: today },
  ];
}

/** "?from=…&to=…" — appended to every link so the range survives navigation. */
export function rangeQuery(range: { from: string; to: string }): string {
  return `?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;
}

/* ------------------------------------------------------------------ *
 * Extra formatters matching the artboard's number styles.
 * ------------------------------------------------------------------ */

/** Money with no fractional part ("$142,540") — headline sums in the artboard. */
export function formatMoneyWhole(minorUnits: number | null, currency = "USD"): string {
  if (minorUnits === null) return "—";
  try {
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(minorUnits / 10 ** digits);
  } catch {
    return "—";
  }
}

/** Thousands-separated integer ("1,248"). */
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

/** Compact integer ("1.2M") — impressions. */
export function formatCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatRoas(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}x`;
}

/** Delta as the artboard writes it: "↑ 18.6%" / "↓ 6.1%" / "—". */
export function formatDeltaArrow(deltaPct: number | null): string {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return "—";
  return `${deltaPct < 0 ? "↓" : "↑"} ${(Math.abs(deltaPct) * 100).toFixed(1)}%`;
}

export type DeltaTone = "up" | "down" | "flat";

export function deltaTone(deltaPct: number | null): DeltaTone {
  if (deltaPct === null || !Number.isFinite(deltaPct) || deltaPct === 0) return "flat";
  return deltaPct > 0 ? "up" : "down";
}

/* ------------------------------------------------------------------ *
 * Meta Ads panel rollup (campaign_daily_v1, current vs previous period).
 * ------------------------------------------------------------------ */

export interface MetaDailyLike extends CampaignDailyLike {
  clicks?: unknown;
  purchases?: unknown;
  impressions?: unknown;
}

export interface SimpleMetric {
  value: number | null;
  deltaPct: number | null;
}

export interface MetaMetrics {
  currency: string;
  hasData: boolean;
  spend: SimpleMetric;
  roas: SimpleMetric;
  cpc: SimpleMetric;
  cpp: SimpleMetric;
  impressions: SimpleMetric;
}

function metaTotals(rows: MetaDailyLike[]) {
  let spend = 0;
  let purchaseValue = 0;
  let clicks = 0;
  let purchases = 0;
  let impressions = 0;
  for (const r of rows) {
    spend += num(r.spend_minor);
    purchaseValue += num(r.purchase_value_minor);
    clicks += num(r.clicks);
    purchases += num(r.purchases);
    impressions += num(r.impressions);
  }
  return { spend, purchaseValue, clicks, purchases, impressions };
}

/** Rates are recomputed from the period totals, not averaged across days. */
export function computeMetaMetrics(currentRows: MetaDailyLike[], previousRows: MetaDailyLike[]): MetaMetrics {
  const hasCur = currentRows.length > 0;
  const hasPrev = previousRows.length > 0;
  const cur = metaTotals(currentRows);
  const prev = metaTotals(previousRows);
  const pair = (c: number | null, p: number | null): SimpleMetric => ({
    value: hasCur ? c : null,
    deltaPct: hasCur && hasPrev ? pctDeltaOrNull(c, p) : null,
  });
  const currencyRow = [...currentRows, ...previousRows].find((r) => r.currency);
  return {
    currency: (currencyRow?.currency as string) ?? "USD",
    hasData: hasCur,
    spend: pair(cur.spend, prev.spend),
    roas: pair(safeDiv(cur.purchaseValue, cur.spend), safeDiv(prev.purchaseValue, prev.spend)),
    cpc: pair(safeDiv(cur.spend, cur.clicks), safeDiv(prev.spend, prev.clicks)),
    cpp: pair(safeDiv(cur.spend, cur.purchases), safeDiv(prev.spend, prev.purchases)),
    impressions: pair(cur.impressions, prev.impressions),
  };
}
