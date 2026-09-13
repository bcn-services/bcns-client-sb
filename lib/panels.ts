/**
 * panels.ts — pure state derivation for the home panels: which of the three
 * DESIGN.md states a panel is in, how connector_health_v1 reads in the
 * Integrations popup, and the Monday / Meet row shaping item D will feed with
 * real jobs_v1 / messages_v1 rows. Covered by tests/panels.test.mjs.
 */

export const EXPECTED_SOURCES = [
  { source: "shopify", label: "Shopify" },
  { source: "meta", label: "Meta Ads" },
  { source: "monday", label: "Monday.com" },
  { source: "meet", label: "Google Meet" },
  { source: "drive", label: "Google Drive" },
] as const;

export type ExpectedSource = (typeof EXPECTED_SOURCES)[number]["source"];

export interface HealthLike {
  source?: string | null;
  status?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
}

/** not_connected: no connector_health_v1 row at all for the panel's sources.
 *  empty: connected, but nothing landed in the selected range.
 *  data: rows to render. */
export type PanelState = "not_connected" | "empty" | "data";

export function healthFor(rows: HealthLike[], source: string): HealthLike | null {
  return rows.find((r) => r.source === source) ?? null;
}

/** A panel is connected when every source it reads from has a health row. */
export function isConnected(rows: HealthLike[], sources: readonly string[]): boolean {
  return sources.length > 0 && sources.every((s) => healthFor(rows, s) !== null);
}

export function panelState(rows: HealthLike[], sources: readonly string[], hasRows: boolean): PanelState {
  if (!isConnected(rows, sources)) return "not_connected";
  return hasRows ? "data" : "empty";
}

const STATUS_LABELS: Record<string, string> = {
  ok: "Connected",
  stale: "Stale",
  auth_failed: "Auth failed",
  error: "Error",
  never_ran: "Never ran",
};

export type StatusTone = "ok" | "warn" | "bad" | "idle";

const STATUS_TONES: Record<string, StatusTone> = {
  ok: "ok",
  stale: "warn",
  auth_failed: "bad",
  error: "bad",
  never_ran: "idle",
};

/** One Integrations-popup row, whether or not the source has ever run. */
export function integrationRow(rows: HealthLike[], source: string, label: string) {
  const health = healthFor(rows, source);
  if (!health) return { source, label, connected: false as const, statusLabel: "Not connected", tone: "idle" as StatusTone, lastSuccessAt: null, lastError: null };
  const status = health.status ?? "never_ran";
  return {
    source,
    label,
    connected: true as const,
    statusLabel: STATUS_LABELS[status] ?? status,
    tone: STATUS_TONES[status] ?? "idle",
    lastSuccessAt: health.last_success_at ?? null,
    lastError: health.last_error ?? null,
  };
}

export function integrationRows(rows: HealthLike[]) {
  return EXPECTED_SOURCES.map(({ source, label }) => integrationRow(rows, source, label));
}

/* ---------------- Monday.com tasks (jobs_v1, kind='task') ---------------- */

export interface TaskLike {
  id?: string | null;
  title?: string | null;
  status?: string | null;
  is_done?: boolean | null;
  due_on?: string | null;
  url?: string | null;
}

export type TaskTone = "done" | "progress" | "todo";

/** Badge text is the board's own status; the colour is derived, because
 *  Monday status names are per-board free text. */
export function taskBadge(task: TaskLike): { label: string; tone: TaskTone } {
  const status = (task.status ?? "").trim();
  if (task.is_done) return { label: status || "Done", tone: "done" };
  if (/progress|doing|working/i.test(status)) return { label: status, tone: "progress" };
  return { label: status || "To Do", tone: "todo" };
}

/** Not-done first, then soonest due date; undated tasks sort last. */
export function sortPriorityTasks<T extends TaskLike>(tasks: T[], limit = 5): T[] {
  return [...tasks]
    .sort((a, b) => {
      const doneDiff = Number(Boolean(a.is_done)) - Number(Boolean(b.is_done));
      if (doneDiff !== 0) return doneDiff;
      const aDue = a.due_on ?? "9999-12-31";
      const bDue = b.due_on ?? "9999-12-31";
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      return (a.title ?? "").localeCompare(b.title ?? "");
    })
    .slice(0, limit);
}

/* ------------- Google Meet notes (messages_v1, kind='meeting_note') ------------- */

export interface NoteLike {
  id?: string | null;
  title?: string | null;
  body?: string | null;
  occurred_at?: string | null;
  url?: string | null;
}

/** One-line excerpt: collapse whitespace, cut on a word boundary, ellipsize. */
export function noteExcerpt(body: string | null | undefined, max = 110): string {
  const flat = (body ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Newest meeting first; rows with no timestamp sort last. */
export function sortRecentNotes<T extends NoteLike>(notes: T[], limit = 3): T[] {
  return [...notes]
    .sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""))
    .slice(0, limit);
}
