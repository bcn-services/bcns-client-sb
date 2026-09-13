/**
 * /financials — DESIGN.md "Financial Information": the seven range tiles, the
 * daily table, and the manual entries panel (form + list + delete).
 *
 * Shopify and Meta figures follow ?from&to and the panel-state rules in
 * lib/panels.ts; manual entries are dashboard-sourced, so they work whether or
 * not a connector exists. All arithmetic lives in lib/financials.ts.
 */

import { getDataClient } from "@/lib/data";
import { getSignedInEmail, loadShellData } from "@/lib/header";
import {
  MAX_CATEGORY_CHARS,
  MAX_NOTE_CHARS,
  MAX_AMOUNT_MAJOR,
  computeDailyRows,
  computeFinancialTiles,
  computeFinancialTotals,
  entryErrorMessage,
  financialRecordsQuery,
  pickCurrency,
  shapeEntries,
  type FinancialEntry,
  type FinancialTile,
} from "@/lib/financials";
import { panelState, type PanelState } from "@/lib/panels";
import {
  formatCount,
  formatDayLabel,
  formatMoney,
  formatMoneyWhole,
  formatRangeLabel,
  isValidYmd,
  parseRange,
  rangeQuery,
  splitPeriods,
  todayInTimezone,
} from "@/lib/overview";
import { AppHeader, parsePopup } from "@/app/_components/AppHeader";
import { MetricCard } from "@/app/_components/MetricCard";
import { Panel, PanelHead, StateNote, Unconfigured } from "@/app/_components/Panel";
import { FinanceIcon } from "@/app/_components/icons";
import { createFinancialEntry, deleteFinancialEntry } from "./actions";

export const dynamic = "force-dynamic";

const ROW_LIMIT = 1000;

function unwrap<T>(r: PromiseSettledResult<{ data: T[] | null; error: unknown }>, name: string): { rows: T[]; error: boolean } {
  if (r.status === "rejected") {
    console.error(`financials: ${name} read failed`, r.reason);
    return { rows: [], error: true };
  }
  if (r.value.error) {
    console.error(`financials: ${name} read failed`, r.value.error);
    return { rows: [], error: true };
  }
  return { rows: r.value.data ?? [], error: false };
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const client = await getDataClient();
  if (!client) return <Unconfigured />;

  const [shell, email] = await Promise.all([loadShellData(client), getSignedInEmail()]);
  const today = todayInTimezone(shell.timezone);
  const range = parseRange(searchParams, today);
  const query = rangeQuery(range);
  const connectHref = `${query}&popup=integrations`;

  const [summaryR, spendR, recordsR] = await Promise.allSettled([
    client.views.daily_summary_v1("day,revenue_minor,orders,currency").gte("day", range.prevFrom).lte("day", range.to).order("day"),
    // ponytail: capped at PostgREST's 1000-row default, same as the home page;
    // a long range on a large ad account rolls up partial spend. Upgrade: a
    // per-range aggregate RPC in bcns-data.
    client.views.campaign_daily_v1("day,spend_minor,currency").gte("day", range.prevFrom).lte("day", range.to).order("day", { ascending: false }).limit(ROW_LIMIT),
    financialRecordsQuery(client, range.prevFrom, range.to),
  ]);

  const summary = unwrap(summaryR, "daily_summary_v1");
  const spend = unwrap(spendR, "campaign_daily_v1");
  const records = unwrap(recordsR, "records_v1");

  const summarySplit = splitPeriods(summary.rows, range.from, range.to, range.prevFrom, range.prevTo);
  const spendSplit = splitPeriods(spend.rows, range.from, range.to, range.prevFrom, range.prevTo);
  const entries = shapeEntries(records.rows, range.from, range.to);
  const prevEntries = shapeEntries(records.rows, range.prevFrom, range.prevTo);

  const currency = pickCurrency(summary.rows, spend.rows);
  const totals = computeFinancialTotals(summarySplit.current, spendSplit.current, entries);
  const prevTotals = computeFinancialTotals(summarySplit.previous, spendSplit.previous, prevEntries);
  const tiles = computeFinancialTiles(totals, prevTotals);
  const dailyRows = computeDailyRows(summarySplit.current, spendSplit.current, entries, range.from, range.to);

  const shopifyState = panelState(shell.health, ["shopify"], summarySplit.current.length > 0);
  const metaState = panelState(shell.health, ["meta"], spendSplit.current.length > 0);
  const tableState = panelState(shell.health, ["shopify", "meta"], dailyRows.length > 0);
  const originState: Record<FinancialTile["origin"], PanelState> = {
    shopify: shopifyState,
    meta: metaState,
    manual: entries.length ? "data" : "empty",
    mixed: dailyRows.length ? "data" : tableState,
  };

  // Sparklines read left-to-right, so they take the daily rows oldest-first.
  const chrono = [...dailyRows].reverse();
  const series = (pick: (r: (typeof chrono)[number]) => number | null) =>
    chrono.filter((r) => pick(r) !== null).map((r) => ({ day: r.day, value: pick(r) as number }));
  const TILE_SERIES: Record<FinancialTile["key"], { day: string; value: number }[]> = {
    revenue: series((r) => r.revenueMinor),
    orders: series((r) => r.orders),
    aov: series((r) => (r.revenueMinor !== null && r.orders ? r.revenueMinor / r.orders : null)),
    adSpend: series((r) => r.adSpendMinor),
    manualIncome: series((r) => r.manualIncomeMinor),
    manualExpenses: series((r) => r.manualExpensesMinor),
    profit: series((r) => r.profitMinor),
  };

  const errorMessage = entryErrorMessage(searchParams.error);
  const echo = {
    date: isValidYmd(searchParams.f_date) ? (searchParams.f_date as string) : today,
    type: searchParams.f_type === "income" ? "income" : "expense",
    category: (searchParams.f_category ?? "").slice(0, MAX_CATEGORY_CHARS),
    amount: (searchParams.f_amount ?? "").slice(0, 32),
    note: (searchParams.f_note ?? "").slice(0, MAX_NOTE_CHARS),
  };

  return (
    <>
      <AppHeader
        active="financials"
        range={range}
        today={today}
        clientName={shell.clientName}
        timezone={shell.timezone}
        email={email}
        health={shell.health}
        healthError={shell.healthError}
        openPopup={parsePopup(searchParams.popup)}
      />

      <div className="page-title-row">
        <h1 className="page-title">Financial Information</h1>
        <span className="page-title__sub">{formatRangeLabel(range.from, range.to)}</span>
      </div>

      <div className="metric-row metric-row--7">
        {tiles.map((tile) => {
          const hasData = originState[tile.origin] === "data" && tile.value !== null;
          return (
            <MetricCard
              key={tile.key}
              label={tile.label}
              value={tile.format === "count" ? formatCount(tile.value) : formatMoneyWhole(tile.value, currency)}
              deltaPct={tile.deltaPct}
              series={TILE_SERIES[tile.key]}
              hasData={hasData}
            />
          );
        })}
      </div>

      <div className="fin-grid">
        <Panel className="panel--column">
          <PanelHead tile={<FinanceIcon />} title="Daily Breakdown" />
          {dailyRows.length ? (
            <div className="table-scroll">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="fin-table__num">Revenue</th>
                    <th scope="col" className="fin-table__num">Orders</th>
                    <th scope="col" className="fin-table__num">Ad Spend</th>
                    <th scope="col" className="fin-table__num">Manual Income</th>
                    <th scope="col" className="fin-table__num">Manual Expenses</th>
                    <th scope="col" className="fin-table__num">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.map((row) => (
                    <tr key={row.day}>
                      <td>{formatDayLabel(row.day)}</td>
                      <td className="fin-table__num">{formatMoney(row.revenueMinor, currency)}</td>
                      <td className="fin-table__num">{formatCount(row.orders)}</td>
                      <td className="fin-table__num">{formatMoney(row.adSpendMinor, currency)}</td>
                      <td className="fin-table__num">{formatMoney(row.manualIncomeMinor, currency)}</td>
                      <td className="fin-table__num">{formatMoney(row.manualExpensesMinor, currency)}</td>
                      <td className={`fin-table__num fin-table__num--strong${(row.profitMinor ?? 0) < 0 ? " fin-table__num--neg" : ""}`}>
                        {formatMoney(row.profitMinor, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <StateNote state={tableState === "data" ? "empty" : tableState} label="Shopify and Meta" connectHref={connectHref} />
          )}
        </Panel>

        <Panel className="panel--column">
          <PanelHead tile={<FinanceIcon />} title="Manual Entries" />
          <p className="entry-form__hint">Income and costs the connected apps don&rsquo;t track.</p>

          {errorMessage ? (
            <p className="form-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <form className="entry-form" action={createFinancialEntry}>
            {/* Minted per render and used as save_record's external_id, which
                upserts on (client_id, source, external_id): a double-click or a
                retried POST updates this row instead of writing a second one. */}
            <input type="hidden" name="token" value={crypto.randomUUID()} />
            <input type="hidden" name="from" value={range.from} />
            <input type="hidden" name="to" value={range.to} />
            <div className="entry-form__grid">
              <label className="field">
                <span className="field__label">Date</span>
                <input className="field__input" type="date" name="date" defaultValue={echo.date} required />
              </label>
              <label className="field">
                <span className="field__label">Type</span>
                <select className="field__input" name="type" defaultValue={echo.type} required>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Category</span>
                <input
                  className="field__input"
                  type="text"
                  name="category"
                  defaultValue={echo.category}
                  maxLength={MAX_CATEGORY_CHARS}
                  placeholder="Packaging"
                  required
                />
              </label>
              <label className="field">
                <span className="field__label">Amount</span>
                <input
                  className="field__input"
                  type="number"
                  name="amount"
                  defaultValue={echo.amount}
                  step="0.01"
                  min="0.01"
                  max={MAX_AMOUNT_MAJOR}
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                />
              </label>
              <label className="field field--wide">
                <span className="field__label">
                  Note <span className="field__optional">optional</span>
                </span>
                <textarea className="field__input field__input--area" name="note" defaultValue={echo.note} maxLength={MAX_NOTE_CHARS} rows={2} />
              </label>
            </div>
            <button className="btn-accent btn-accent--sm" type="submit">
              Add Entry
            </button>
          </form>

          <div className="panel__fill">
            {entries.length ? (
              <ul className="entry-list">
                {entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} currency={currency} range={range} />
                ))}
              </ul>
            ) : (
              <p className="state-note">No entries yet.</p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

function EntryRow({
  entry,
  currency,
  range,
}: {
  entry: FinancialEntry;
  currency: string;
  range: { from: string; to: string };
}) {
  return (
    <li className="entry-row">
      <div className="entry-row__main">
        <span className="entry-row__category">{entry.category}</span>
        <span className={`badge badge--${entry.type === "income" ? "done" : "todo"}`}>{entry.type === "income" ? "Income" : "Expense"}</span>
        <span className="entry-row__date">{formatDayLabel(entry.date)}</span>
      </div>
      {entry.note ? <p className="entry-row__note">{entry.note}</p> : null}
      <div className="entry-row__tail">
        <span className={`entry-row__amount entry-row__amount--${entry.type}`}>
          {entry.type === "income" ? "+" : "−"}
          {formatMoney(entry.amountCents, currency)}
        </span>
        <form action={deleteFinancialEntry}>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="from" value={range.from} />
          <input type="hidden" name="to" value={range.to} />
          <button className="btn-link-danger" type="submit" aria-label={`Delete ${entry.category}`}>
            Delete
          </button>
        </form>
      </div>
    </li>
  );
}
