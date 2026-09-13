/**
 * financials.test.mjs — pure-logic coverage for lib/financials.ts: the four
 * Financial Information rows and their deltas, including the null handling
 * that keeps an empty account from rendering a fake $0.00. Run with:
 *   corepack pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialRows } from "../lib/financials.ts";

const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

test("computeFinancialRows: four rows in DESIGN.md order with labels", () => {
  const rows = computeFinancialRows({ revenueMinor: 0, adSpendMinor: 0 }, { revenueMinor: 0, adSpendMinor: 0 });
  assert.deepEqual(rows.map((r) => r.key), ["revenue", "adSpend", "expenses", "profit"]);
  assert.deepEqual(rows.map((r) => r.label), ["Revenue", "Ad Spend", "Expenses", "Profit"]);
});

test("computeFinancialRows: expenses is ad spend alone until manual entries land", () => {
  const rows = byKey(computeFinancialRows({ revenueMinor: 500_00, adSpendMinor: 120_00 }, { revenueMinor: 0, adSpendMinor: 0 }));
  assert.equal(rows.expenses.valueMinor, 120_00);
  assert.equal(rows.profit.valueMinor, 380_00);
});

test("computeFinancialRows: manual expenses add into expenses and subtract from profit", () => {
  const rows = byKey(
    computeFinancialRows({ revenueMinor: 500_00, adSpendMinor: 120_00, manualExpensesMinor: 80_00 }, { revenueMinor: 0, adSpendMinor: 0 }),
  );
  assert.equal(rows.expenses.valueMinor, 200_00);
  assert.equal(rows.profit.valueMinor, 300_00);
});

test("computeFinancialRows: deltas compare against the previous period", () => {
  const rows = byKey(computeFinancialRows({ revenueMinor: 200_00, adSpendMinor: 50_00 }, { revenueMinor: 100_00, adSpendMinor: 25_00 }));
  // pctDeltaOrNull returns a fraction: 1 === +100%.
  assert.equal(rows.revenue.deltaPct, 1);
  assert.equal(rows.adSpend.deltaPct, 1);
  assert.equal(rows.profit.deltaPct, 1);
});

test("computeFinancialRows: an empty account stays null rather than showing 0", () => {
  const rows = byKey(computeFinancialRows({ revenueMinor: null, adSpendMinor: null }, { revenueMinor: null, adSpendMinor: null }));
  assert.equal(rows.revenue.valueMinor, null);
  assert.equal(rows.expenses.valueMinor, null);
  assert.equal(rows.profit.valueMinor, null);
  assert.ok(rows.profit.deltaPct === null);
});

test("computeFinancialRows: revenue with no spend still yields a profit", () => {
  const rows = byKey(computeFinancialRows({ revenueMinor: 90_00, adSpendMinor: null }, { revenueMinor: null, adSpendMinor: null }));
  assert.equal(rows.expenses.valueMinor, null);
  assert.equal(rows.profit.valueMinor, 90_00);
  assert.equal(rows.profit.deltaPct, null);
});

test("computeFinancialRows: negative profit when spend exceeds revenue", () => {
  const rows = byKey(computeFinancialRows({ revenueMinor: 10_00, adSpendMinor: 40_00 }, { revenueMinor: 10_00, adSpendMinor: 20_00 }));
  assert.equal(rows.profit.valueMinor, -30_00);
});
