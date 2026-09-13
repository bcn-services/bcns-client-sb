/**
 * library.ts — the pure logic behind /library (DESIGN.md "Content Library +
 * Creative Folder"): search and tag filtering, tag parsing/normalising, byte
 * formatting, selection/id validation, egress gating and the storage path an
 * upload lands at.
 *
 * Everything here is a pure function over plain rows so tests/library.test.mjs
 * stays unit-only; the page and the server actions hold all the I/O.
 *
 * The tag and set-name rules mirror the platform's own validation
 * (`data.clean_tags`, `api.create_media_set`) so a bad value is rejected with a
 * readable message instead of a BCNS3 error from Postgres.
 */

/** `data.clean_tags`: lower-cased, trimmed, `[a-z0-9 _-]`, 1-40 chars. */
export const TAG_PATTERN = /^[a-z0-9 _-]{1,40}$/;
/** `data.clean_tags` raises above 50 tags. */
export const MAX_TAGS = 50;
/** `data.register_media` rejects anything larger. */
export const MAX_UPLOAD_BYTES = 104_857_600;
/** `api.create_media_set` / `api.update_media_set` bound. */
export const SET_NAME_MAX = 80;
/** `api.bulk_tag`, `api.delete_media` and `api.set_media_set_items` all cap at 500 ids. */
export const MAX_BULK_IDS = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MediaLike {
  id?: string | null;
  title?: string | null;
  filename?: string | null;
  tags?: string[] | null;
  bytes?: number | null;
  kind?: string | null;
  mime?: string | null;
  storage_path?: string | null;
  thumb_path?: string | null;
  created_at?: string | null;
}

export interface MediaSetLike {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  file_count?: number | null;
  cover_thumb_path?: string | null;
  created_at?: string | null;
}

export interface SetItemLike {
  set_id?: string | null;
  media_id?: string | null;
  added_at?: string | null;
}

/** What the grid prints under a tile: the title the user gave, else the filename. */
export function mediaLabel(row: MediaLike): string {
  const title = row.title?.trim();
  if (title) return title;
  const filename = row.filename?.trim();
  if (filename) return filename;
  return "Untitled";
}

/**
 * The storage path to sign for a thumbnail — `thumb_path` and nothing else.
 *
 * The original under `<client>/orig/` is deliberately NOT a fallback: the
 * storage policy `media_read_orig` only signs an original while a download
 * ticket for it exists (`data.has_download_ticket`), so an orig path signs for
 * the few minutes after a download and fails silently the rest of the time —
 * an inconsistent, flickering grid. Every row without a thumbnail renders the
 * placeholder tile DESIGN.md asks for. See the report: the platform never
 * populates `thumb_path` today, so that is every dashboard upload.
 */
export function mediaThumbPath(row: MediaLike): string | null {
  return row.thumb_path ?? null;
}

/** Human byte size: "812 B", "9.4 KB", "24 MB", "1.5 GB". */
export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Split a comma-separated tag box into platform-legal tags. Normalises case,
 * whitespace and duplicates; anything the platform would reject comes back in
 * `invalid` so the caller can say which one rather than swallowing it.
 */
export function parseTags(input: string | null | undefined): { tags: string[]; invalid: string[] } {
  const tags: string[] = [];
  const invalid: string[] = [];
  for (const raw of String(input ?? "").split(",")) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag) continue;
    if (!TAG_PATTERN.test(tag)) {
      if (!invalid.includes(tag)) invalid.push(tag);
      continue;
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_TAGS) invalid.push(`${tags.length} tags (max ${MAX_TAGS})`);
  return { tags: tags.slice(0, MAX_TAGS), invalid };
}

/** Every tag in the library with its usage count, most used first then A–Z. */
export function collectTags(rows: MediaLike[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags ?? []) {
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** DESIGN.md: search covers title, filename and tags. Case-insensitive substring. */
export function matchesQuery(row: MediaLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [row.title ?? "", row.filename ?? "", ...(row.tags ?? [])].join(" ").toLowerCase();
  return haystack.includes(q);
}

/** The grid's rows after the toolbar's search box and tag filter. */
export function filterMedia<T extends MediaLike>(rows: T[], opts: { q?: string; tag?: string } = {}): T[] {
  const tag = opts.tag?.trim().toLowerCase();
  return rows.filter((row) => {
    if (tag && !(row.tags ?? []).includes(tag)) return false;
    return matchesQuery(row, opts.q ?? "");
  });
}

/** Trimmed set name, or null when the platform would reject it. */
export function validateSetName(name: string | null | undefined): string | null {
  const trimmed = String(name ?? "").trim();
  if (trimmed.length < 1 || trimmed.length > SET_NAME_MAX) return null;
  return trimmed;
}

/** Keep only well-formed, unique media ids, capped at the RPCs' own limit. */
export function parseIds(values: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const id = String(value ?? "").trim();
    if (UUID.test(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(0, MAX_BULK_IDS);
}

/** The `?dl=` download tray carries its ids comma-separated. */
export function parseIdList(value: string | null | undefined): string[] {
  return parseIds(String(value ?? "").split(","));
}

export interface EgressLike {
  bytes_used?: number | null;
  quota_bytes?: number | null;
  exceeded?: boolean | null;
}

/**
 * DESIGN.md's "Downloads this period: X of Y". `egress_status_v1` meters bytes,
 * not download counts, so X and Y are byte sizes — see the report's Conflicts.
 *
 * Fails open: with no readable row the label is null and downloads stay
 * enabled, because `api.download_url` refuses on its own once the ledger is
 * spent (BCNS1 budget_reached).
 */
export function egressLine(row: EgressLike | null | undefined): { label: string | null; exceeded: boolean } {
  if (!row) return { label: null, exceeded: false };
  const used = Number(row.bytes_used ?? 0);
  const quota = Number(row.quota_bytes ?? 0);
  const exceeded = row.exceeded === true || (quota > 0 && used >= quota);
  return { label: `Downloads this period: ${formatBytes(used)} of ${formatBytes(quota)}`, exceeded };
}

/**
 * The extension `data.register_media`'s path check allows: lower-case
 * alphanumerics, at most 8, falling back to the mime subtype then "bin".
 * Mirrors @bcn-services/data-client's own `extFromFile`.
 */
export function fileExtension(filename: string | null | undefined, mime: string | null | undefined): string {
  const name = String(filename ?? "");
  const dot = name.lastIndexOf(".");
  const raw = dot > -1 ? name.slice(dot + 1) : (String(mime ?? "").split("/")[1] ?? "");
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
}

/**
 * `<client_id>/orig/<uuid>.<ext>` — the exact shape `data.register_media`
 * validates with `^<client>/orig/[0-9a-f-]{36}\.[a-z0-9]{1,8}$`, and the same
 * one @bcn-services/data-client's `media.upload` builds.
 */
export function storagePath(clientId: string, uuid: string, filename: string | null | undefined, mime: string | null | undefined): string {
  return `${clientId}/orig/${uuid}.${fileExtension(filename, mime)}`;
}

/** set_id → its media ids, newest addition first (the view has no ordering column). */
export function groupSetItems(items: SetItemLike[]): Map<string, string[]> {
  const bySet = new Map<string, SetItemLike[]>();
  for (const item of items) {
    if (!item.set_id || !item.media_id) continue;
    const list = bySet.get(item.set_id) ?? [];
    list.push(item);
    bySet.set(item.set_id, list);
  }
  const out = new Map<string, string[]>();
  for (const [setId, list] of bySet) {
    list.sort((a, b) => String(b.added_at ?? "").localeCompare(String(a.added_at ?? "")));
    out.set(setId, list.map((i) => i.media_id as string));
  }
  return out;
}

/**
 * A set's cover: the view's own `cover_thumb_path`, else the newest member that
 * has a thumbnail. Both are null for dashboard uploads today (see
 * mediaThumbPath), so the set list renders the placeholder cover.
 */
export function setCoverPath(
  set: MediaSetLike,
  memberIds: readonly string[] | undefined,
  byId: Map<string, MediaLike>,
): string | null {
  if (set.cover_thumb_path) return set.cover_thumb_path;
  for (const id of memberIds ?? []) {
    const row = byId.get(id);
    const path = row ? mediaThumbPath(row) : null;
    if (path) return path;
  }
  return null;
}

/** "3 Files" / "1 File" — the count DESIGN.md shows on a set. */
export function fileCountLabel(count: number | null | undefined): string {
  const n = Number(count ?? 0);
  return `${n} ${n === 1 ? "File" : "Files"}`;
}

/**
 * App-Router `searchParams` values are `string | string[]` at runtime whatever
 * the page's interface declares (`?tag=a&tag=b` yields an array), so every
 * parameter is normalized here before anything calls a string method on it.
 * A repeated parameter keeps its first value; everything else becomes "".
 */
export function firstParam(value: string | string[] | null | undefined, max = 200): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.slice(0, max) : "";
}

/**
 * Look a message up in a literal map without letting a caller-supplied key
 * reach `Object.prototype` — `map["__proto__"]` otherwise returns an object
 * that React refuses to render, so `?error=__proto__` would 500 the page.
 */
export function lookupMessage(map: Record<string, string>, code: string): string | null {
  return Object.prototype.hasOwnProperty.call(map, code) ? (map[code] ?? null) : null;
}

/**
 * The line shown after an upload batch. A batch that failed part-way must name
 * the failure — reporting "Uploaded 1 file." when files 2-3 were skipped is
 * worse than reporting nothing.
 */
export function uploadStatus(done: number, total: number, lastError: string | null): { text: string; bad: boolean } {
  if (lastError) return { text: `Uploaded ${done} of ${total} — ${lastError}`, bad: true };
  return { text: `Uploaded ${done} file${done === 1 ? "" : "s"}.`, bad: false };
}
