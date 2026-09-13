/**
 * financials.test.mjs — pure-logic coverage for lib/financials.ts: the home
 * panel rows, the seven /financials tiles, the daily merge, records_v1 entry
 * shaping, and the server-side validation gate for manual entries (the part
 * that must reject before any RPC is issued). Run with:
 *   corepack pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AMOUNT_MAJOR,
  computeDailyRows,
  computeFinancialRows,
  computeFinancialTiles,
  computeFinancialTotals,
  computeProfit,
  entryAttributes,
  entryErrorMessage,
  parseAmountToCents,
  parseEntryInput,
  pickCurrency,
  shapeEntries,
  sumEntries,
  toFinancialEntry,
} from "../lib/financials.ts";

const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));
const entry = (over = {}) => ({ id: "e1", date: "2026-09-10", type: "expense", category: "Packaging", amountCents: 1000, note: null, updatedAt: null, ...over });

/* ------------------------------------------------------------- validation */

test("parseAmountToCents: accepts a positive amount with at most 2 decimals", () => {
  assert.equal(parseAmountToCents("12"), 1200);
  assert.equal(parseAmountToCents("12.3"), 1230);
  assert.equal(parseAmountToCents("12.34"), 1234);
  assert.equal(parseAmountToCents(" 0.01 "), 1);
  assert.equal(parseAmountToCents(String(MAX_AMOUNT_MAJOR)), MAX_AMOUNT_MAJOR * 100);
});

test("parseAmountToCents: rejects everything else", () => {
  for (const bad of ["12.345", "-3", "-0.01", "0", "0.00", "", "  ", "abc", "1e3", "+5", "1,000", "12.", ".5", "$5", "Infinity", "NaN"]) {
    assert.equal(parseAmountToCents(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.equal(parseAmountToCents(`${MAX_AMOUNT_MAJOR}.01`), null);
  assert.equal(parseAmountToCents(12.34), null, "non-strings never parse");
  assert.equal(parseAmountToCents(null), null);
});

test("parseAmountToCents: no float drift on cent boundaries", () => {
  assert.equal(parseAmountToCents("0.29"), 29);
  assert.equal(parseAmountToCents("1.10"), 110);
  assert.equal(parseAmountToCents("8.11"), 811);
  assert.equal(parseAmountToCents("1234567.89"), 123456789);
});

test("parseEntryInput: a valid entry becomes the exact save_record attributes", () => {
  const r = parseEntryInput({ date: "2026-09-13", type: "expense", category: " Packaging ", amount: "12.34", note: " boxes " });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { date: "2026-09-13", type: "expense", category: "Packaging", amountCents: 1234, note: "boxes" });
  assert.deepEqual(entryAttributes(r.value), {
    date: "2026-09-13",
    type: "expense",
    category: "Packaging",
    amount_cents: 1234,
    note: "boxes",
  });
});

test("parseEntryInput: an omitted note is null, not an empty string", () => {
  const r = parseEntryInput({ date: "2026-09-13", type: "income", category: "Refund", amount: "5" });
  assert.equal(r.ok, true);
  assert.equal(r.value.note, null);
});

test("parseEntryInput: rejects a bad date", () => {
  for (const date of ["", "2026-13-01", "2026-02-30", "13/09/2026", "2026-9-3", null, undefined, 20260913]) {
    assert.deepEqual(parseEntryInput({ date, type: "expense", category: "c", amount: "1" }), { ok: false, code: "date" });
  }
});

test("parseEntryInput: rejects a type outside income|expense", () => {
  for (const type of ["", "Income", "profit", "INCOME", null, 1]) {
    assert.deepEqual(parseEntryInput({ date: "2026-09-13", type, category: "c", amount: "1" }), { ok: false, code: "type" });
  }
});

test("parseEntryInput: rejects an empty or over-length category", () => {
  const long = "x".repeat(65);
  assert.deepEqual(parseEntryInput({ date: "2026-09-13", type: "expense", category: "   ", amount: "1" }), { ok: false, code: "category" });
  assert.deepEqual(parseEntryInput({ date: "2026-09-13", type: "expense", category: long, amount: "1" }), { ok: false, code: "category" });
  assert.equal(parseEntryInput({ date: "2026-09-13", type: "expense", category: "x".repeat(64), amount: "1" }).ok, true);
});

test("parseEntryInput: rejects a bad amount", () => {
  for (const amount of ["12.345", "-3", "0", "", "abc", null]) {
    assert.deepEqual(parseEntryInput({ date: "2026-09-13", type: "expense", category: "c", amount }), { ok: false, code: "amount" });
  }
});

test("parseEntryInput: rejects a note over 500 characters", () => {
  assert.deepEqual(parseEntryInput({ date: "2026-09-13", type: "expense", category: "c", amount: "1", note: "n".repeat(501) }), {
    ok: false,
    code: "note",
  });
  assert.equal(parseEntryInput({ date: "2026-09-13", type: "expense", category: "c", amount: "1", note: "n".repeat(500) }).ok, true);
});

test("entryErrorMessage: known codes render, unknown text does not", () => {
  assert.match(entryErrorMessage("amount"), /positive/i);
  assert.equal(entryErrorMessage("<script>alert(1)</script>"), null);
  assert.equal(entryErrorMessage(""), null);
  assert.equal(entryErrorMessage(undefined), null);
});

/* ---------------------------------------------------------- entry shaping */

test("toFinancialEntry: reads a well-formed records_v1 row", () => {
  const e = toFinancialEntry({
    id: "r1",
    kind: "financial_entry",
    source: "dashboard",
    title: "Packaging",
    attributes: { date: "2026-09-10", type: "expense", category: "Packaging", amount_cents: 4200, note: "boxes" },
    occurred_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-11T10:00:00Z",
  });
  assert.deepEqual(e, { id: "r1", date: "2026-09-10", type: "expense", category: "Packaging", amountCents: 4200, note: "boxes", updatedAt: "2026-09-11T10:00:00Z" });
});

test("toFinancialEntry: drops rows that are not usable entries", () => {
  const base = { id: "r1", kind: "financial_entry", attributes: { date: "2026-09-10", type: "expense", category: "c", amount_cents: 1 } };
  assert.equal(toFinancialEntry({ ...base, id: null }), null);
  assert.equal(toFinancialEntry({ ...base, kind: "order" }), null);
  assert.equal(toFinancialEntry({ ...base, attributes: { ...base.attributes, type: "refund" } }), null);
  assert.equal(toFinancialEntry({ ...base, attributes: { ...base.attributes, date: "nope" }, occurred_at: null }), null);
  assert.equal(toFinancialEntry({ ...base, attributes: { ...base.attributes, amount_cents: "abc" } }), null);
  assert.equal(toFinancialEntry({ ...base, attributes: null, occurred_at: null }), null);
  assert.equal(toFinancialEntry({ ...base, attributes: [1, 2] , occurred_at: null }), null);
});

test("toFinancialEntry: falls back to the row title, but never to occurred_at", () => {
  const e = toFinancialEntry({
    id: "r2",
    kind: "financial_entry",
    title: "Shipping",
    attributes: { date: "2026-09-09", type: "income", amount_cents: 500 },
    occurred_at: "2026-09-09T14:30:00Z",
  });
  assert.equal(e.category, "Shipping");
  assert.equal(e.note, null);
  // The query filters on attributes->>date, so a row without one is not ours
  // to guess at from a UTC timestamp.
  assert.equal(
    toFinancialEntry({ id: "r3", kind: "financial_entry", title: "Shipping", attributes: { type: "income", amount_cents: 500 }, occurred_at: "2026-09-09T14:30:00Z" }),
    null,
  );
});

test("toFinancialEntry: rejects amounts the form could never have produced", () => {
  const base = { id: "r1", kind: "financial_entry", attributes: { date: "2026-09-10", type: "expense", category: "c" } };
  const amount = (amount_cents) => toFinancialEntry({ ...base, attributes: { ...base.attributes, amount_cents } });
  // Another save_record caller (an agent tool) bypasses the form's rules.
  assert.equal(amount(0), null, "zero is not an entry");
  assert.equal(amount(-100), null);
  assert.equal(amount(12.5), null, "cents are integers");
  assert.equal(amount(1e300), null, "past MAX_SAFE_INTEGER a sum stops being exact");
  assert.equal(amount(MAX_AMOUNT_MAJOR * 100 + 1), null, "over the form's cap");
  assert.equal(amount(MAX_AMOUNT_MAJOR * 100).amountCents, MAX_AMOUNT_MAJOR * 100, "the cap itself is fine");
});

test("computeFinancialTiles: a loss that shrank is a rise, not a fall", () => {
  // Profit is the one signed tile: dividing by a negative previous would flip
  // the arrow and the colour on every loss-to-loss period.
  const totals = (profitMinor) => ({
    revenueMinor: 0,
    orders: null,
    aovMinor: null,
    adSpendMinor: 0,
    manualIncomeMinor: 0,
    manualExpensesMinor: -profitMinor,
    profitMinor,
    entryCount: 1,
    currency: "USD",
  });
  const shrank = computeFinancialTiles(totals(-5000), totals(-10000)).find((t) => t.key === "profit");
  assert.equal(shrank.value, -5000);
  assert.ok(shrank.deltaPct > 0, `a loss halving should read as +50%, got ${shrank.deltaPct}`);
  assert.equal(shrank.deltaPct, 0.5);

  const grew = computeFinancialTiles(totals(-20000), totals(-10000)).find((t) => t.key === "profit");
  assert.ok(grew.deltaPct < 0, `a loss doubling should read as -100%, got ${grew.deltaPct}`);
  assert.equal(grew.deltaPct, -1);

  const intoProfit = computeFinancialTiles(totals(5000), totals(-10000)).find((t) => t.key === "profit");
  assert.ok(intoProfit.deltaPct > 0, "a loss turning into a profit is a rise");
});

test("shapeEntries: keeps the range, newest first, stable on ties", () => {
  const row = (id, date, updated) => ({
    id,
    kind: "financial_entry",
    attributes: { date, type: "expense", category: id, amount_cents: 100 },
    updated_at: updated,
  });
  const rows = [
    row("a", "2026-09-08", "2026-09-08T00:00:00Z"),
    row("b", "2026-09-10", "2026-09-10T00:00:00Z"),
    row("c", "2026-09-10", "2026-09-11T00:00:00Z"),
    row("old", "2026-09-01", "2026-09-01T00:00:00Z"),
    row("future", "2026-09-30", "2026-09-30T00:00:00Z"),
  ];
  const shaped = shapeEntries(rows, "2026-09-07", "2026-09-13");
  assert.deepEqual(shaped.map((e) => e.id), ["c", "b", "a"]);
});

test("sumEntries: splits income from expenses", () => {
  const totals = sumEntries([
    entry({ id: "1", type: "income", amountCents: 5000 }),
    entry({ id: "2", type: "expense", amountCents: 1200 }),
    entry({ id: "3", type: "expense", amountCents: 800 }),
  ]);
  assert.deepEqual(totals, { incomeMinor: 5000, expensesMinor: 2000, count: 3 });
  assert.deepEqual(sumEntries([]), { incomeMinor: 0, expensesMinor: 0, count: 0 });
});

/* -------------------------------------------------------------- the maths */

test("computeProfit: DESIGN.md identity revenue + income - spend - expenses", () => {
  assert.equal(computeProfit(100_00, 20_00, 30_00, 10_00), 80_00);
  assert.equal(computeProfit(100_00, null, 30_00, null), 70_00);
  assert.equal(computeProfit(null, 20_00, null, 5_00), 15_00);
  assert.equal(computeProfit(null, null, null, null), null, "nothing at all stays null, not $0");
  assert.equal(computeProfit(0, null, null, null), 0, "a real zero is not null");
  assert.equal(computeProfit(10_00, null, 40_00, null), -30_00);
});

test("computeFinancialTotals: per-source nulls when a source has no rows", () => {
  const t = computeFinancialTotals([], [], []);
  assert.deepEqual(t, {
    revenueMinor: null,
    orders: null,
    aovMinor: null,
    adSpendMinor: null,
    manualIncomeMinor: null,
    manualExpensesMinor: null,
    profitMinor: null,
  });
});

test("computeFinancialTotals: sums each source and derives AOV and profit", () => {
  const t = computeFinancialTotals(
    [
      { day: "2026-09-10", revenue_minor: 300_00, orders: 2 },
      { day: "2026-09-11", revenue_minor: 100_00, orders: 2 },
    ],
    [{ day: "2026-09-10", spend_minor: 50_00 }],
    [entry({ id: "1", type: "income", amountCents: 25_00 }), entry({ id: "2", type: "expense", amountCents: 15_00 })],
  );
  assert.equal(t.revenueMinor, 400_00);
  assert.equal(t.orders, 4);
  assert.equal(t.aovMinor, 100_00);
  assert.equal(t.adSpendMinor, 50_00);
  assert.equal(t.manualIncomeMinor, 25_00);
  assert.equal(t.manualExpensesMinor, 15_00);
  assert.equal(t.profitMinor, 400_00 + 25_00 - 50_00 - 15_00);
});

test("computeFinancialTotals: manual entries alone still yield a profit", () => {
  const t = computeFinancialTotals([], [], [entry({ type: "expense", amountCents: 900 })]);
  assert.equal(t.revenueMinor, null);
  assert.equal(t.manualExpensesMinor, 900);
  assert.equal(t.profitMinor, -900);
});

test("computeFinancialTiles: the seven DESIGN.md tiles, in order, with deltas", () => {
  const cur = computeFinancialTotals([{ day: "2026-09-10", revenue_minor: 200_00, orders: 2 }], [{ day: "2026-09-10", spend_minor: 40_00 }], [
    entry({ type: "expense", amountCents: 20_00 }),
  ]);
  const prev = computeFinancialTotals([{ day: "2026-09-03", revenue_minor: 100_00, orders: 2 }], [{ day: "2026-09-03", spend_minor: 20_00 }], [
    entry({ date: "2026-09-03", type: "expense", amountCents: 10_00 }),
  ]);
  const tiles = computeFinancialTiles(cur, prev);
  assert.deepEqual(tiles.map((t) => t.key), ["revenue", "orders", "aov", "adSpend", "manualIncome", "manualExpenses", "profit"]);
  assert.deepEqual(tiles.map((t) => t.label), ["Revenue", "Orders", "AOV", "Ad Spend", "Manual Income", "Manual Expenses", "Profit"]);
  assert.deepEqual(tiles.map((t) => t.origin), ["shopify", "shopify", "shopify", "meta", "manual", "manual", "mixed"]);
  const t = byKey(tiles);
  assert.equal(t.revenue.deltaPct, 1);
  assert.equal(t.orders.deltaPct, 0);
  assert.equal(t.manualExpenses.deltaPct, 1);
  assert.equal(t.manualIncome.value, 0, "the period has entries, so a zero income total is a real figure, not a gap");
  assert.equal(t.profit.value, 200_00 - 40_00 - 20_00);
  assert.equal(t.profit.deltaPct, 1);
});

test("computeFinancialTiles: an untouched account has no values and no deltas", () => {
  const empty = computeFinancialTotals([], [], []);
  for (const tile of computeFinancialTiles(empty, empty)) {
    assert.equal(tile.value, null, tile.key);
    assert.equal(tile.deltaPct, null, tile.key);
  }
});

/* ------------------------------------------------------------ daily table */

test("computeDailyRows: one row per day with something, newest first", () => {
  const rows = computeDailyRows(
    [{ day: "2026-09-10", revenue_minor: 100_00, orders: 1 }],
    [{ day: "2026-09-11", spend_minor: 20_00 }],
    [entry({ date: "2026-09-12", type: "income", amountCents: 5_00 })],
    "2026-09-07",
    "2026-09-13",
  );
  assert.deepEqual(rows.map((r) => r.day), ["2026-09-12", "2026-09-11", "2026-09-10"]);
  assert.equal(rows[2].revenueMinor, 100_00);
  assert.equal(rows[2].adSpendMinor, null, "a day Meta has no row for stays null, not $0");
  assert.equal(rows[2].profitMinor, 100_00);
  assert.equal(rows[1].profitMinor, -20_00);
  assert.equal(rows[0].profitMinor, 5_00);
});

test("computeDailyRows: days outside the range are dropped and same-day rows merge", () => {
  const rows = computeDailyRows(
    [
      { day: "2026-09-01", revenue_minor: 999_00, orders: 9 },
      { day: "2026-09-10", revenue_minor: 100_00, orders: 1 },
    ],
    [
      { day: "2026-09-10", spend_minor: 10_00 },
      { day: "2026-09-10", spend_minor: 5_00 },
    ],
    [
      entry({ id: "a", date: "2026-09-10", type: "expense", amountCents: 3_00 }),
      entry({ id: "b", date: "2026-09-10", type: "expense", amountCents: 2_00 }),
      entry({ id: "c", date: "2026-09-20", type: "expense", amountCents: 77_00 }),
    ],
    "2026-09-07",
    "2026-09-13",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].adSpendMinor, 15_00);
  assert.equal(rows[0].manualExpensesMinor, 5_00);
  assert.equal(rows[0].manualIncomeMinor, null);
  assert.equal(rows[0].profitMinor, 100_00 - 15_00 - 5_00);
});

test("computeDailyRows: nothing anywhere means no rows at all", () => {
  assert.deepEqual(computeDailyRows([], [], [], "2026-09-07", "2026-09-13"), []);
});

test("pickCurrency: first reported currency wins, else USD", () => {
  assert.equal(pickCurrency([], []), "USD");
  assert.equal(pickCurrency([{ currency: null }], [{ currency: "CAD" }]), "CAD");
  assert.equal(pickCurrency([{ currency: "GBP" }], [{ currency: "CAD" }]), "GBP");
});

/* -------------------------------------------------------- home panel rows */

test("computeFinancialRows: four rows in DESIGN.md order with labels", () => {
  const rows = computeFinancialRows({ revenueMinor: 0, adSpendMinor: 0 }, { revenueMinor: 0, adSpendMinor: 0 });
  assert.deepEqual(rows.map((r) => r.key), ["revenue", "adSpend", "expenses", "profit"]);
  assert.deepEqual(rows.map((r) => r.label), ["Revenue", "Ad Spend", "Expenses", "Profit"]);
});

test("computeFinancialRows: Expenses is manual expenses alone, never ad spend", () => {
  const rows = byKey(computeFinancialRows({ revenueMinor: 500_00, adSpendMinor: 120_00 }, { revenueMinor: 0, adSpendMinor: 0 }));
  assert.equal(rows.expenses.valueMinor, null, "no manual entries means no Expenses figure");
  assert.equal(rows.profit.valueMinor, 380_00);

  const withManual = byKey(
    computeFinancialRows(
      { revenueMinor: 500_00, adSpendMinor: 120_00, manualIncomeMinor: 30_00, manualExpensesMinor: 80_00 },
      { revenueMinor: 0, adSpendMinor: 0 },
    ),
  );
  assert.equal(withManual.expenses.valueMinor, 80_00);
  assert.equal(withManual.profit.valueMinor, 500_00 + 30_00 - 120_00 - 80_00);
});

test("computeFinancialRows: deltas compare against the previous period", () => {
  const rows = byKey(
    computeFinancialRows(
      { revenueMinor: 200_00, adSpendMinor: 50_00, manualExpensesMinor: 20_00 },
      { revenueMinor: 100_00, adSpendMinor: 25_00, manualExpensesMinor: 10_00 },
    ),
  );
  // pctDeltaOrNull returns a fraction: 1 === +100%.
  assert.equal(rows.revenue.deltaPct, 1);
  assert.equal(rows.adSpend.deltaPct, 1);
  assert.equal(rows.expenses.deltaPct, 1);
  assert.equal(rows.profit.deltaPct, 1);
});

test("computeFinancialRows: an empty account stays null rather than showing 0", () => {
  const rows = byKey(computeFinancialRows({ revenueMinor: null, adSpendMinor: null }, { revenueMinor: null, adSpendMinor: null }));
  assert.equal(rows.revenue.valueMinor, null);
  assert.equal(rows.expenses.valueMinor, null);
  assert.equal(rows.profit.valueMinor, null);
  assert.equal(rows.profit.deltaPct, null);
});

test("computeFinancialRows: manual entries alone render without a connector", () => {
  const rows = byKey(
    computeFinancialRows({ revenueMinor: null, adSpendMinor: null, manualIncomeMinor: 40_00, manualExpensesMinor: 15_00 }, { revenueMinor: null, adSpendMinor: null }),
  );
  assert.equal(rows.revenue.valueMinor, null);
  assert.equal(rows.expenses.valueMinor, 15_00);
  assert.equal(rows.profit.valueMinor, 25_00);
});

test("computeFinancialRows: negative profit when spend exceeds revenue", () => {
  const rows = byKey(computeFinancialRows({ revenueMinor: 10_00, adSpendMinor: 40_00 }, { revenueMinor: 10_00, adSpendMinor: 20_00 }));
  assert.equal(rows.profit.valueMinor, -30_00);
});
