/**
 * financials.ts — pure rollup behind the home Financial Information panel.
 * The /financials page (item B) layers manual entries from records_v1 on top
 * of the same shape. Covered by tests/financials.test.mjs.
 */

import { pctDeltaOrNull } from "./overview";

export interface FinancialInputs {
  /** Shopify revenue for the period, minor units. */
  revenueMinor: number | null;
  /** Meta ad spend for the period, minor units. */
  adSpendMinor: number | null;
  /** Manual expenses from records_v1, minor units. Item B fills this in. */
  manualExpensesMinor?: number | null;
}

export interface FinancialRow {
  key: "revenue" | "adSpend" | "expenses" | "profit";
  label: string;
  valueMinor: number | null;
  deltaPct: number | null;
}

function add(...parts: (number | null | undefined)[]): number | null {
  const present = parts.filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

function sub(a: number | null, b: number | null): number | null {
  if (a === null) return null;
  return a - (b ?? 0);
}

/** Revenue / Ad Spend / Expenses / Profit for a period, with deltas against
 *  the previous one. Expenses = ad spend + manual expenses; Profit =
 *  revenue − expenses. Until item B lands there are no manual entries, so
 *  Expenses is Meta spend alone. */
export function computeFinancialRows(current: FinancialInputs, previous: FinancialInputs): FinancialRow[] {
  const rows = ([
    ["revenue", "Revenue", (i: FinancialInputs) => i.revenueMinor],
    ["adSpend", "Ad Spend", (i: FinancialInputs) => i.adSpendMinor],
    ["expenses", "Expenses", (i: FinancialInputs) => add(i.adSpendMinor, i.manualExpensesMinor)],
    ["profit", "Profit", (i: FinancialInputs) => sub(i.revenueMinor, add(i.adSpendMinor, i.manualExpensesMinor))],
  ] as const).map(([key, label, pick]) => ({
    key,
    label,
    valueMinor: pick(current),
    deltaPct: pctDeltaOrNull(pick(current), pick(previous)),
  }));
  return rows;
}
