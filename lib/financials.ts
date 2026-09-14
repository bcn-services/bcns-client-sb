/**
 * financials.ts — the pure logic behind the home Financial Information panel
 * and the /financials page: manual-entry validation, records_v1 shaping, the
 * daily merge of Shopify / Meta / manual figures, and the profit identity
 * DESIGN.md fixes as
 *
 *     profit = revenue + manual income − ad spend − manual expenses
 *
 * Everything here is pure except `financialRecordsQuery`, which only builds a
 * PostgREST query (the caller awaits it). Covered by tests/financials.test.mjs.
 */

import type { DataClient } from "@bcn-services/data-client";
import { isValidYmd, pctDeltaOrNull } from "./overview";

export const FINANCIAL_ENTRY_KIND = "financial_entry";
export const FINANCIAL_ENTRY_SOURCE = "dashboard";

/** Manual entries are hand-typed; a client with a decade of them still fits.
 *  ponytail: one page of rows, no cursor — add paging if a range ever exceeds
 *  this many entries. */
export const ENTRY_ROW_LIMIT = 500;

export const MAX_CATEGORY_CHARS = 64;
export const MAX_NOTE_CHARS = 500;
/** Largest accepted amount in major units (DESIGN.md), i.e. 1e11 cents. */
export const MAX_AMOUNT_MAJOR = 1_000_000_000;

export type EntryType = "income" | "expense";

/* ------------------------------------------------------------------ *
 * Validation — the server-side gate. The form's own attributes are only
 * convenience; every rule below is re-checked before any RPC is issued.
 * ------------------------------------------------------------------ */

export type EntryErrorCode = "date" | "type" | "category" | "amount" | "note" | "missing" | "save" | "delete";

const ERROR_MESSAGES: Record<EntryErrorCode, string> = {
  date: "Pick a valid date (YYYY-MM-DD).",
  type: "Choose either Income or Expense.",
  category: `Category is required and must be ${MAX_CATEGORY_CHARS} characters or fewer.`,
  amount: `Amount must be a positive number with at most 2 decimals, up to ${MAX_AMOUNT_MAJOR.toLocaleString("en-US")}.`,
  note: `Note must be ${MAX_NOTE_CHARS} characters or fewer.`,
  missing: "That entry could not be found.",
  save: "Could not save the entry. Please try again.",
  delete: "Could not delete the entry. Please try again.",
};

/** Message for an `?error=` code. Unknown codes render nothing, so a crafted
 *  query string cannot put arbitrary text on the page. */
export function entryErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code as EntryErrorCode] ?? null;
}

/** Positive decimal with at most 2 places -> integer cents. null when the
 *  string is not exactly that (empty, signed, 3+ decimals, exponent, NaN,
 *  zero, or over the cap). Parsed digit-wise so no float rounding is involved. */
export function parseAmountToCents(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const major = Number(m[1]);
  const cents = major * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  if (cents > MAX_AMOUNT_MAJOR * 100) return null;
  return cents;
}

export interface EntryDraft {
  date: string;
  type: EntryType;
  category: string;
  amountCents: number;
  note: string | null;
}

export type EntryParseResult = { ok: true; value: EntryDraft } | { ok: false; code: EntryErrorCode };

/** The whole server-side gate for a manual entry. Field order is the form's,
 *  so the first thing a user sees flagged is the first thing they typed. */
export function parseEntryInput(input: {
  date?: unknown;
  type?: unknown;
  category?: unknown;
  amount?: unknown;
  note?: unknown;
}): EntryParseResult {
  const date = typeof input.date === "string" ? input.date.trim() : "";
  if (!isValidYmd(date)) return { ok: false, code: "date" };

  const type = typeof input.type === "string" ? input.type.trim() : "";
  if (type !== "income" && type !== "expense") return { ok: false, code: "type" };

  const category = typeof input.category === "string" ? input.category.trim() : "";
  if (category.length < 1 || category.length > MAX_CATEGORY_CHARS) return { ok: false, code: "category" };

  const amountCents = parseAmountToCents(typeof input.amount === "string" ? input.amount : "");
  if (amountCents === null) return { ok: false, code: "amount" };

  const noteRaw = typeof input.note === "string" ? input.note.trim() : "";
  if (noteRaw.length > MAX_NOTE_CHARS) return { ok: false, code: "note" };

  return { ok: true, value: { date, type, category, amountCents, note: noteRaw || null } };
}

/** The exact `save_record` attributes DESIGN.md specifies. */
export function entryAttributes(draft: EntryDraft) {
  return {
    date: draft.date,
    type: draft.type,
    category: draft.category,
    amount_cents: draft.amountCents,
    note: draft.note,
  };
}

/* ------------------------------------------------------------------ *
 * records_v1 -> entries
 * ------------------------------------------------------------------ */

export interface RecordLike {
  id?: string | null;
  kind?: string | null;
  source?: string | null;
  title?: string | null;
  attributes?: unknown;
  occurred_at?: string | null;
  updated_at?: string | null;
}

export interface FinancialEntry {
  id: string;
  date: string;
  type: EntryType;
  category: string;
  amountCents: number;
  note: string | null;
  updatedAt: string | null;
}

function attr(row: RecordLike): Record<string, unknown> {
  return row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes)
    ? (row.attributes as Record<string, unknown>)
    : {};
}

/** One records_v1 row -> an entry, or null when it is not a well-formed
 *  dashboard financial entry. Rows are platform data, so nothing here trusts
 *  a field's presence or type. */
export function toFinancialEntry(row: RecordLike): FinancialEntry | null {
  if (!row.id || row.kind !== FINANCIAL_ENTRY_KIND) return null;
  const a = attr(row);
  // No occurred_at fallback: financialRecordsQuery filters on attributes->>date,
  // so a row without one never reaches here.
  const date = typeof a.date === "string" ? a.date : "";
  if (!isValidYmd(date)) return null;
  const type = a.type === "income" || a.type === "expense" ? a.type : null;
  if (!type) return null;
  // Another save_record caller (an agent tool) could write a financial_entry
  // that never passed the form's rules, so re-apply them here.
  const amountCents = Number(a.amount_cents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_MAJOR * 100) return null;
  const category = typeof a.category === "string" && a.category.trim() ? a.category.trim() : (row.title ?? "Uncategorised");
  return {
    id: row.id,
    date,
    type,
    category,
    amountCents,
    note: typeof a.note === "string" && a.note.trim() ? a.note.trim() : null,
    updatedAt: row.updated_at ?? null,
  };
}

/** Entries inside [from, to] (inclusive, on the entry's own `date`), newest
 *  first, ties broken by last write then id so the order is stable. */
export function shapeEntries(rows: RecordLike[], from: string, to: string): FinancialEntry[] {
  return rows
    .map(toFinancialEntry)
    .filter((e): e is FinancialEntry => e !== null && e.date >= from && e.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id));
}

export interface EntryTotals {
  incomeMinor: number;
  expensesMinor: number;
  count: number;
}

export function sumEntries(entries: FinancialEntry[]): EntryTotals {
  let incomeMinor = 0;
  let expensesMinor = 0;
  for (const e of entries) {
    if (e.type === "income") incomeMinor += e.amountCents;
    else expensesMinor += e.amountCents;
  }
  return { incomeMinor, expensesMinor, count: entries.length };
}

/* ------------------------------------------------------------------ *
 * Totals, tiles and the daily table
 * ------------------------------------------------------------------ */

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Sum of the present components; null only when every one is absent. A
 *  missing Shopify connection must not turn into a fake $0 line. */
function sumPresent(...parts: (number | null | undefined)[]): number | null {
  let total = 0;
  let any = false;
  for (const p of parts) {
    if (typeof p === "number" && Number.isFinite(p)) {
      total += p;
      any = true;
    }
  }
  return any ? total : null;
}

function neg(v: number | null): number | null {
  return v === null ? null : -v;
}

/** DESIGN.md: profit = revenue + manual income − ad spend − manual expenses. */
export function computeProfit(
  revenueMinor: number | null | undefined,
  manualIncomeMinor: number | null | undefined,
  adSpendMinor: number | null | undefined,
  manualExpensesMinor: number | null | undefined,
): number | null {
  return sumPresent(revenueMinor ?? null, manualIncomeMinor ?? null, neg(adSpendMinor ?? null), neg(manualExpensesMinor ?? null));
}

export interface SummaryRowLike {
  day?: string | null;
  revenue_minor?: unknown;
  orders?: unknown;
  currency?: unknown;
}

export interface SpendRowLike {
  day?: string | null;
  spend_minor?: unknown;
  currency?: unknown;
}

export interface FinancialTotals {
  revenueMinor: number | null;
  orders: number | null;
  aovMinor: number | null;
  adSpendMinor: number | null;
  manualIncomeMinor: number | null;
  manualExpensesMinor: number | null;
  profitMinor: number | null;
}

/** Period totals for the seven tiles. A source with no rows in the period
 *  stays null (renders "—"); manual figures are null only when the period has
 *  no entries at all, since the dashboard always knows that answer. */
export function computeFinancialTotals(
  summaryRows: SummaryRowLike[],
  spendRows: SpendRowLike[],
  entries: FinancialEntry[],
): FinancialTotals {
  const revenueMinor = summaryRows.length ? summaryRows.reduce((a, r) => a + num(r.revenue_minor), 0) : null;
  const orders = summaryRows.length ? summaryRows.reduce((a, r) => a + num(r.orders), 0) : null;
  const adSpendMinor = spendRows.length ? spendRows.reduce((a, r) => a + num(r.spend_minor), 0) : null;
  const totals = sumEntries(entries);
  const manualIncomeMinor = totals.count ? totals.incomeMinor : null;
  const manualExpensesMinor = totals.count ? totals.expensesMinor : null;
  return {
    revenueMinor,
    orders,
    aovMinor: revenueMinor !== null && orders ? revenueMinor / orders : null,
    adSpendMinor,
    manualIncomeMinor,
    manualExpensesMinor,
    profitMinor: computeProfit(revenueMinor, manualIncomeMinor, adSpendMinor, manualExpensesMinor),
  };
}

export type FinancialTileKey = "revenue" | "orders" | "aov" | "adSpend" | "manualIncome" | "manualExpenses" | "profit";

export interface FinancialTile {
  key: FinancialTileKey;
  label: string;
  /** Which connector the figure comes from — drives the not-connected state. */
  origin: "shopify" | "meta" | "manual" | "mixed";
  format: "money" | "count";
  value: number | null;
  deltaPct: number | null;
}

const TILE_SPECS: {
  key: FinancialTileKey;
  label: string;
  origin: FinancialTile["origin"];
  format: FinancialTile["format"];
  pick: (t: FinancialTotals) => number | null;
}[] = [
  { key: "revenue", label: "Revenue", origin: "shopify", format: "money", pick: (t) => t.revenueMinor },
  { key: "orders", label: "Orders", origin: "shopify", format: "count", pick: (t) => t.orders },
  { key: "aov", label: "AOV", origin: "shopify", format: "money", pick: (t) => t.aovMinor },
  { key: "adSpend", label: "Ad Spend", origin: "meta", format: "money", pick: (t) => t.adSpendMinor },
  { key: "manualIncome", label: "Manual Income", origin: "manual", format: "money", pick: (t) => t.manualIncomeMinor },
  { key: "manualExpenses", label: "Manual Expenses", origin: "manual", format: "money", pick: (t) => t.manualExpensesMinor },
  { key: "profit", label: "Profit", origin: "mixed", format: "money", pick: (t) => t.profitMinor },
];

/** The seven /financials tiles in DESIGN.md order, with a delta against the
 *  previous period wherever both sides have a figure. */
export function computeFinancialTiles(current: FinancialTotals, previous: FinancialTotals): FinancialTile[] {
  return TILE_SPECS.map(({ key, label, origin, format, pick }) => ({
    key,
    label,
    origin,
    format,
    value: pick(current),
    deltaPct: pctDeltaOrNull(pick(current), pick(previous)),
  }));
}

export interface DailyFinancialRow {
  day: string;
  revenueMinor: number | null;
  orders: number | null;
  adSpendMinor: number | null;
  manualIncomeMinor: number | null;
  manualExpensesMinor: number | null;
  profitMinor: number | null;
}

/** One row per day that any source has something for, newest first. Days with
 *  nothing at all are omitted (DESIGN.md); a cell whose source has no row that
 *  day stays null so it renders "—" rather than $0. */
export function computeDailyRows(
  summaryRows: SummaryRowLike[],
  spendRows: SpendRowLike[],
  entries: FinancialEntry[],
  from: string,
  to: string,
): DailyFinancialRow[] {
  const inRange = (day: string | null | undefined): day is string => Boolean(day) && day! >= from && day! <= to;
  const byDay = new Map<string, { revenue: number | null; orders: number | null; spend: number | null; income: number | null; expenses: number | null }>();
  const slot = (day: string) => {
    let s = byDay.get(day);
    if (!s) {
      s = { revenue: null, orders: null, spend: null, income: null, expenses: null };
      byDay.set(day, s);
    }
    return s;
  };

  for (const r of summaryRows) {
    if (!inRange(r.day)) continue;
    const s = slot(r.day);
    s.revenue = (s.revenue ?? 0) + num(r.revenue_minor);
    s.orders = (s.orders ?? 0) + num(r.orders);
  }
  for (const r of spendRows) {
    if (!inRange(r.day)) continue;
    const s = slot(r.day);
    s.spend = (s.spend ?? 0) + num(r.spend_minor);
  }
  for (const e of entries) {
    if (!inRange(e.date)) continue;
    const s = slot(e.date);
    if (e.type === "income") s.income = (s.income ?? 0) + e.amountCents;
    else s.expenses = (s.expenses ?? 0) + e.amountCents;
  }

  return [...byDay.entries()]
    .map(([day, s]) => ({
      day,
      revenueMinor: s.revenue,
      orders: s.orders,
      adSpendMinor: s.spend,
      manualIncomeMinor: s.income,
      manualExpensesMinor: s.expenses,
      profitMinor: computeProfit(s.revenue, s.income, s.spend, s.expenses),
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/** Currency for the page: whatever the platform rows report, else USD. */
export function pickCurrency(...rowSets: { currency?: unknown }[][]): string {
  for (const rows of rowSets) {
    const hit = rows.find((r) => typeof r.currency === "string" && r.currency);
    if (hit) return hit.currency as string;
  }
  return "USD";
}

/* ------------------------------------------------------------------ *
 * Home panel rows
 * ------------------------------------------------------------------ */

export interface FinancialInputs {
  /** Shopify revenue for the period, minor units. */
  revenueMinor: number | null;
  /** Meta ad spend for the period, minor units. */
  adSpendMinor: number | null;
  /** Manual income from records_v1, minor units. */
  manualIncomeMinor?: number | null;
  /** Manual expenses from records_v1, minor units. */
  manualExpensesMinor?: number | null;
}

export interface FinancialRow {
  key: "revenue" | "adSpend" | "expenses" | "profit";
  label: string;
  valueMinor: number | null;
  deltaPct: number | null;
}

/** Revenue / Ad Spend / Expenses / Profit for a period, with deltas against
 *  the previous one. DESIGN.md: Expenses is the manual expenses alone (ad
 *  spend already has its own row) and Profit = revenue + manual income − ad
 *  spend − manual expenses. */
export function computeFinancialRows(current: FinancialInputs, previous: FinancialInputs): FinancialRow[] {
  return ([
    ["revenue", "Revenue", (i: FinancialInputs) => i.revenueMinor],
    ["adSpend", "Ad Spend", (i: FinancialInputs) => i.adSpendMinor],
    ["expenses", "Expenses", (i: FinancialInputs) => i.manualExpensesMinor ?? null],
    [
      "profit",
      "Profit",
      (i: FinancialInputs) => computeProfit(i.revenueMinor, i.manualIncomeMinor, i.adSpendMinor, i.manualExpensesMinor),
    ],
  ] as const).map(([key, label, pick]) => ({
    key,
    label,
    valueMinor: pick(current),
    deltaPct: pctDeltaOrNull(pick(current), pick(previous)),
  }));
}

/* ------------------------------------------------------------------ *
 * The one read both pages need (query only — the caller awaits it).
 * ------------------------------------------------------------------ */

/** Dashboard-sourced financial entries whose own `date` attribute falls in
 *  [from, to]. Filtering on the attribute, not `occurred_at`, keeps the range
 *  in the client's timezone rather than UTC. */
export function financialRecordsQuery(client: DataClient, from: string, to: string) {
  return client.views
    .records_v1("id,kind,source,title,attributes,occurred_at,updated_at")
    .eq("kind", FINANCIAL_ENTRY_KIND)
    .eq("source", FINANCIAL_ENTRY_SOURCE)
    .gte("attributes->>date", from)
    .lte("attributes->>date", to)
    .order("occurred_at", { ascending: false })
    .limit(ENTRY_ROW_LIMIT);
}
