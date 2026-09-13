/**
 * overview.test.mjs — pure-logic coverage for lib/overview.ts (date ranges,
 * metric aggregation/deltas, campaign/creative rollups, money formatting,
 * URL safety). Run with:
 *   corepack pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRange,
  todayInTimezone,
  pctDeltaOrNull,
  splitPeriods,
  computeOverviewMetrics,
  formatMoney,
  aggregateCampaigns,
  bestCreative,
  isSafeHttpsUrl,
  formatRelativeTime,
} from "../lib/overview.ts";

test("todayInTimezone: formats as YYYY-MM-DD for a fixed instant", () => {
  const d = new Date("2026-09-12T04:00:00Z");
  assert.equal(todayInTimezone("UTC", d), "2026-09-12");
});

test("parseRange: valid range with span <= 366 passes through, prev period matches length", () => {
  const r = parseRange({ from: "2026-09-01", to: "2026-09-07" }, "2026-09-12");
  assert.equal(r.usedDefault, false);
  assert.equal(r.from, "2026-09-01");
  assert.equal(r.to, "2026-09-07");
  assert.equal(r.prevTo, "2026-08-31");
  assert.equal(r.prevFrom, "2026-08-25"); // same 7-day span immediately before
});

test("parseRange: invalid YMD falls back to last 7 days ending today", () => {
  const r = parseRange({ from: "not-a-date", to: "2026-09-07" }, "2026-09-12");
  assert.equal(r.usedDefault, true);
  assert.equal(r.to, "2026-09-12");
  assert.equal(r.from, "2026-09-06");
});

test("parseRange: reversed range (from > to) falls back to default", () => {
  const r = parseRange({ from: "2026-09-10", to: "2026-09-01" }, "2026-09-12");
  assert.equal(r.usedDefault, true);
  assert.equal(r.to, "2026-09-12");
  assert.equal(r.from, "2026-09-06");
});

test("parseRange: span over 366 days falls back to default", () => {
  const r = parseRange({ from: "2020-01-01", to: "2026-09-12" }, "2026-09-12");
  assert.equal(r.usedDefault, true);
});

test("parseRange: missing params falls back to default", () => {
  const r = parseRange({}, "2026-09-12");
  assert.equal(r.usedDefault, true);
  assert.equal(r.from, "2026-09-06");
  assert.equal(r.to, "2026-09-12");
});

test("pctDeltaOrNull: null when previous is 0 or absent", () => {
  assert.equal(pctDeltaOrNull(100, 0), null);
  assert.equal(pctDeltaOrNull(100, null), null);
  assert.equal(pctDeltaOrNull(null, 100), null);
  assert.equal(pctDeltaOrNull(150, 100), 0.5);
});

test("splitPeriods: buckets rows by day into current vs previous windows", () => {
  const rows = [{ day: "2026-08-30" }, { day: "2026-09-01" }, { day: "2026-09-07" }];
  const { current, previous } = splitPeriods(rows, "2026-09-01", "2026-09-07", "2026-08-25", "2026-08-31");
  assert.equal(current.length, 2);
  assert.equal(previous.length, 1);
});

test("computeOverviewMetrics: AOV/ROAS/conversion are null with zero denominators", () => {
  const current = [{ day: "2026-09-01", revenue_minor: 1000, orders: 0, ad_spend_minor: 0, ad_purchase_value_minor: 0, sessions: 0 }];
  const m = computeOverviewMetrics(current, []);
  assert.equal(m.aov.value, null, "orders=0 -> AOV null");
  assert.equal(m.roas.value, null, "ad_spend=0 -> ROAS null");
  assert.equal(m.conversionRate.value, null, "sessions=0 -> conversion null");
});

test("computeOverviewMetrics: inventory uses the latest day in range, not a sum", () => {
  const current = [
    { day: "2026-09-01", inventory_units: 50 },
    { day: "2026-09-03", inventory_units: 30 },
    { day: "2026-09-02", inventory_units: 40 },
  ];
  const m = computeOverviewMetrics(current, []);
  assert.equal(m.inventory.value, 30, "latest day (09-03) wins, not sum(120) or first row");
});

test("computeOverviewMetrics: no rows -> null values, hasData false", () => {
  const m = computeOverviewMetrics([], []);
  assert.equal(m.revenue.value, null);
  assert.equal(m.revenue.hasData, false);
});

test("computeOverviewMetrics: revenue/orders delta vs previous period", () => {
  const current = [{ day: "2026-09-01", revenue_minor: 200, orders: 2 }];
  const previous = [{ day: "2026-08-25", revenue_minor: 100, orders: 1 }];
  const m = computeOverviewMetrics(current, previous);
  assert.equal(m.revenue.deltaPct, 1);
  assert.equal(m.orders.deltaPct, 1);
});

test("formatMoney: USD uses 2 fraction digits (cents)", () => {
  assert.equal(formatMoney(150000, "USD"), "$1,500.00");
});

test("formatMoney: JPY has 0 fraction digits — minor units ARE full units", () => {
  assert.equal(formatMoney(1500, "JPY"), "¥1,500");
});

test("formatMoney: null -> em dash", () => {
  assert.equal(formatMoney(null), "—");
});

test("aggregateCampaigns: sums spend/purchase value per campaign, sorts top 5 by spend", () => {
  const rows = [
    { campaign_id: "a", campaign_name: "Alpha", spend_minor: 100, purchase_value_minor: 300, day: "2026-09-01" },
    { campaign_id: "a", campaign_name: "Alpha", spend_minor: 50, purchase_value_minor: 100, day: "2026-09-02" },
    { campaign_id: "b", campaign_name: "Beta", spend_minor: 500, purchase_value_minor: 250, day: "2026-09-01" },
  ];
  const agg = aggregateCampaigns(rows);
  assert.equal(agg.length, 2);
  assert.equal(agg[0].campaignId, "b", "Beta has more spend, sorts first");
  const alpha = agg.find((c) => c.campaignId === "a");
  assert.equal(alpha.spendMinor, 150);
  assert.equal(alpha.purchaseValueMinor, 400);
  assert.equal(alpha.roas, 400 / 150);
});

test("aggregateCampaigns: zero spend -> roas null, not Infinity/NaN", () => {
  const agg = aggregateCampaigns([{ campaign_id: "z", spend_minor: 0, purchase_value_minor: 100, day: "2026-09-01" }]);
  assert.equal(agg[0].roas, null);
});

test("bestCreative: picks highest ROAS among ads with spend > 0", () => {
  const rows = [
    { ad_id: "1", ad_name: "Low", spend_minor: 100, purchase_value_minor: 100, day: "2026-09-01" },
    { ad_id: "2", ad_name: "High", spend_minor: 100, purchase_value_minor: 500, day: "2026-09-01" },
    { ad_id: "3", ad_name: "NoSpend", spend_minor: 0, purchase_value_minor: 1000, day: "2026-09-01" },
  ];
  const best = bestCreative(rows);
  assert.equal(best.adId, "2");
  assert.equal(best.roas, 5);
});

test("bestCreative: no ads with spend > 0 -> null", () => {
  assert.equal(bestCreative([{ ad_id: "1", spend_minor: 0, purchase_value_minor: 100 }]), null);
  assert.equal(bestCreative([]), null);
});

test("isSafeHttpsUrl: accepts https, rejects javascript/http/relative/garbage", () => {
  assert.equal(isSafeHttpsUrl("https://example.com/a"), true);
  assert.equal(isSafeHttpsUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpsUrl("http://example.com"), false);
  assert.equal(isSafeHttpsUrl("/relative/path"), false);
  assert.equal(isSafeHttpsUrl(null), false);
  assert.equal(isSafeHttpsUrl(undefined), false);
  assert.equal(isSafeHttpsUrl("not a url"), false);
});

test("formatRelativeTime: recent past renders as '... ago'", () => {
  const now = new Date("2026-09-12T12:00:00Z");
  const iso = new Date("2026-09-12T09:00:00Z").toISOString();
  assert.match(formatRelativeTime(iso, now), /ago/);
});

test("parseRange: rolled-over calendar date (2024-02-30) falls back to default", () => {
  const r = parseRange({ from: "2024-02-30", to: "2024-03-05" }, "2026-09-12");
  assert.equal(r.usedDefault, true);
  assert.equal(r.to, "2026-09-12");
});

test("formatMoney: malformed currency code returns — instead of throwing", () => {
  assert.equal(formatMoney(1234, "not-a-currency"), "—");
});

test("formatRelativeTime: unparsable timestamp returns — instead of throwing", () => {
  assert.equal(formatRelativeTime("garbage"), "—");
});
