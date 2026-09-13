// qa-financials.test.mjs — item B QA gaps: adversarial money parsing not in
// tests/financials.test.mjs (unicode digits, -0, embedded whitespace),
// daily-merge income+expense same day, tile deltas against a zero/empty
// previous period, the records_v1 query shape (kind/source/range/order/
// limit), and the delete-ownership filter in app/financials/actions.ts.
//
// actions.ts calls getDataClient()/save_record/delete_record directly (no
// injection seam), so createFinancialEntry/deleteFinancialEntry themselves
// are not unit-testable without a live client. Per the QA brief we instead
// test the validator that gates them (parseEntryInput, already exercised in
// tests/financials.test.mjs) and assert statically that deleteFinancialEntry
// re-reads records_v1 filtered by kind+source before calling delete_record —
// documented as an interpretation in qa-report.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ENTRY_ROW_LIMIT,
  FINANCIAL_ENTRY_KIND,
  FINANCIAL_ENTRY_SOURCE,
  computeDailyRows,
  computeFinancialTiles,
  computeFinancialTotals,
  financialRecordsQuery,
  parseAmountToCents,
} from "../lib/financials.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* --------------------------------------------------- adversarial amounts */

test("parseAmountToCents: rejects unicode digits, -0, and embedded whitespace", () => {
  for (const bad of ["１２", "-0", "1 2", "12 .34", "12. 34"]) {
    assert.equal(parseAmountToCents(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("parseAmountToCents: leading/trailing whitespace around an otherwise-valid amount is trimmed", () => {
  assert.equal(parseAmountToCents("  12.50 "), 1250);
  assert.equal(parseAmountToCents("\t9.05\n"), 905);
});

test("parseAmountToCents: no float drift summing classic 0.1+0.2 style inputs", () => {
  // Each parses independently to exact cents; summing the results (not the
  // floats) must land on the exact integer, not 30 +/- epsilon.
  assert.equal(parseAmountToCents("0.10") + parseAmountToCents("0.20"), 30);
  assert.equal(parseAmountToCents("1000000000") , 100_000_000_000);
});

/* ------------------------------------------------------- daily-merge gaps */

const entry = (over = {}) => ({ id: "e1", date: "2026-09-10", type: "expense", category: "x", amountCents: 1000, note: null, updatedAt: null, ...over });

test("computeDailyRows: income and expense entries on the same day both land in that day's row", () => {
  const rows = computeDailyRows(
    [],
    [],
    [entry({ id: "i", date: "2026-09-10", type: "income", amountCents: 40_00 }), entry({ id: "e", date: "2026-09-10", type: "expense", amountCents: 15_00 })],
    "2026-09-07",
    "2026-09-13",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].manualIncomeMinor, 40_00);
  assert.equal(rows[0].manualExpensesMinor, 15_00);
  assert.equal(rows[0].profitMinor, 40_00 - 15_00);
});

test("computeDailyRows: an entry exactly on the range boundary is included, one day past it is excluded", () => {
  const rows = computeDailyRows(
    [],
    [],
    [entry({ id: "in", date: "2026-09-13", amountCents: 1_00 }), entry({ id: "out", date: "2026-09-14", amountCents: 2_00 })],
    "2026-09-07",
    "2026-09-13",
  );
  assert.deepEqual(rows.map((r) => r.day), ["2026-09-13"]);
});

/* ---------------------------------------- tile deltas: zero/empty previous */

test("computeFinancialTiles: previous period entirely empty yields no deltas", () => {
  const current = computeFinancialTotals([{ day: "2026-09-10", revenue_minor: 100_00, orders: 2 }], [], []);
  const previous = computeFinancialTotals([], [], []);
  const tiles = computeFinancialTiles(current, previous);
  for (const t of tiles) assert.equal(t.deltaPct, null, `${t.key} should have no delta against an empty previous period`);
});

test("computeFinancialTiles: previous revenue of exactly zero yields no delta (would be a division by zero)", () => {
  const current = computeFinancialTotals([{ day: "2026-09-10", revenue_minor: 100_00, orders: 2 }], [], []);
  const previous = computeFinancialTotals([{ day: "2026-09-03", revenue_minor: 0, orders: 0 }], [], []);
  const tiles = computeFinancialTiles(current, previous);
  const revenue = tiles.find((t) => t.key === "revenue");
  assert.equal(revenue.value, 100_00);
  assert.equal(revenue.deltaPct, null);
});

/* ------------------------------------------------------------ query shape */

// Minimal chainable fake standing in for DataClient's PostgREST-style query
// builder: each call is recorded and returns `this` so financialRecordsQuery
// can be exercised without a live client.
function fakeQuery() {
  const calls = [];
  const chain = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "calls") return calls;
        return (...args) => {
          calls.push([prop, args]);
          return chain;
        };
      },
    },
  );
  return chain;
}

test("financialRecordsQuery: filters by kind + source, range, newest-first order, and the row cap", () => {
  const q = fakeQuery();
  const fakeClient = { views: { records_v1: (...args) => { q.calls.push(["records_v1", args]); return q; } } };
  financialRecordsQuery(fakeClient, "2026-09-01", "2026-09-30");
  const calls = q.calls;
  assert.deepEqual(calls.find((c) => c[0] === "eq" && c[1][0] === "kind")[1], ["kind", FINANCIAL_ENTRY_KIND]);
  assert.deepEqual(calls.find((c) => c[0] === "eq" && c[1][0] === "source")[1], ["source", FINANCIAL_ENTRY_SOURCE]);
  assert.deepEqual(calls.find((c) => c[0] === "gte")[1], ["attributes->>date", "2026-09-01"]);
  assert.deepEqual(calls.find((c) => c[0] === "lte")[1], ["attributes->>date", "2026-09-30"]);
  assert.deepEqual(calls.find((c) => c[0] === "order")[1], ["occurred_at", { ascending: false }]);
  assert.deepEqual(calls.find((c) => c[0] === "limit")[1], [ENTRY_ROW_LIMIT]);
});

/* ---------------------------------------------- delete ownership (static) */

test("deleteFinancialEntry re-reads records_v1 filtered by kind + source before delete_record (ownership gate)", () => {
  const src = readFileSync(join(root, "app/financials/actions.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function deleteFinancialEntry"));
  const readIdx = fn.indexOf("records_v1(");
  const deleteIdx = fn.indexOf("delete_record(");
  assert.ok(readIdx >= 0 && deleteIdx > readIdx, "expected a records_v1 read before delete_record");
  const between = fn.slice(readIdx, deleteIdx);
  assert.match(between, /\.eq\("kind",\s*FINANCIAL_ENTRY_KIND\)/);
  assert.match(between, /\.eq\("source",\s*FINANCIAL_ENTRY_SOURCE\)/);
});
