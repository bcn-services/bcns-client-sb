/**
 * /library — Content Library + Creative Folder, per DESIGN.md.
 *
 * Toolbar (search / tag filter / Upload / New set) → media grid with checkbox
 * selection and a bulk bar → item view → the Creative Folder sidebar of sets.
 * Everything except the upload is server-rendered: the grid is one <form> of
 * checkboxes whose submit buttons are the bulk operations, so selection needs
 * no client JavaScript (the bar reveals itself with CSS `:has()`).
 *
 * The library is dashboard-sourced, so this page has no not-connected state —
 * only "empty" and "data".
 */

import Link from "next/link";
import { getDataClient } from "@/lib/data";
import { getConfig } from "@/lib/env";
import { getSignedInEmail, loadShellData } from "@/lib/header";
import { parseRange, todayInTimezone } from "@/lib/overview";
import {
  collectTags,
  egressLine,
  fileCountLabel,
  filterMedia,
  firstParam,
  formatBytes,
  groupSetItems,
  lookupMessage,
  mediaLabel,
  mediaThumbPath,
  parseIdList,
  parseIds,
  setCoverPath,
  type MediaLike,
  type MediaSetLike,
} from "@/lib/library";
import { AppHeader, parsePopup } from "@/app/_components/AppHeader";
import { Panel, PanelHead, Unconfigured } from "@/app/_components/Panel";
import { LibraryIcon } from "@/app/_components/icons";
import { bulkAction, downloadMedia, saveMedia, setAction, type LibraryError } from "./actions";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

// ponytail: the grid reads at most this many rows and filters in memory, so
// search and tag filtering cost no extra round trip. Upgrade to server-side
// `ilike`/`contains` filters plus paging once SB's library passes ~500 files.
const MEDIA_LIMIT = 500;
const SET_LIMIT = 200;
const SET_ITEM_LIMIT = 5000;

const ERRORS: Record<LibraryError, string> = {
  unconfigured: "Not connected to the data platform.",
  no_selection: "Select at least one file first.",
  bad_tags: "Tags may only use letters, numbers, spaces, hyphens and underscores (max 40 characters each).",
  bad_name: "A set name must be 1–80 characters.",
  name_taken: "A set with that name already exists.",
  no_set: "Choose a set first.",
  egress: "This period's download allowance is used up.",
  too_large: "That file is larger than the 100 MB limit.",
  failed: "That didn't work. Please try again.",
};

type Settled<T> = { data: T | null; error: unknown };

function unwrap<T>(r: PromiseSettledResult<{ data: T | null; error: unknown }>, name: string): Settled<T> {
  if (r.status === "rejected") {
    console.error(`library: ${name} read failed`, r.reason);
    return { data: null, error: r.reason };
  }
  if (r.value.error) console.error(`library: ${name} read failed`, r.value.error);
  return r.value;
}

// Next hands these over as `string | string[]` whenever a parameter repeats
// (`?tag=a&tag=b`), so every value goes through firstParam() before use.
type Param = string | string[] | undefined;

interface LibrarySearchParams {
  from?: Param;
  to?: Param;
  popup?: Param;
  q?: Param;
  tag?: Param;
  set?: Param;
  item?: Param;
  dl?: Param;
  error?: Param;
}

export default async function LibraryPage({ searchParams }: { searchParams: LibrarySearchParams }) {
  const client = await getDataClient();
  if (!client) return <Unconfigured />;

  const [shell, email] = await Promise.all([loadShellData(client), getSignedInEmail()]);
  const today = todayInTimezone(shell.timezone);
  const range = parseRange({ from: firstParam(searchParams.from, 10), to: firstParam(searchParams.to, 10) }, today);

  const q = firstParam(searchParams.q, 120);
  const tag = firstParam(searchParams.tag, 40).toLowerCase();
  const openSetId = parseIds([firstParam(searchParams.set, 36)])[0] ?? null;
  const openItemId = parseIds([firstParam(searchParams.item, 36)])[0] ?? null;
  const trayIds = parseIdList(firstParam(searchParams.dl, 40 * 500));
  // Never index ERRORS with a raw parameter: `?error=__proto__` would otherwise
  // hand React an object and 500 the page.
  const errorMessage = lookupMessage(ERRORS, firstParam(searchParams.error, 40));

  const [mediaR, setsR, itemsR, egressR] = await Promise.allSettled([
    client.views
      .media_v1("id,client_id,title,filename,tags,bytes,kind,mime,storage_path,thumb_path,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MEDIA_LIMIT),
    client.views.media_sets_v1("id,name,description,file_count,cover_thumb_path,created_at").order("created_at", { ascending: false }).limit(SET_LIMIT),
    client.views.media_set_items_v1("set_id,media_id,added_at").limit(SET_ITEM_LIMIT),
    client.views.egress_status_v1("client_id,bytes_used,quota_bytes,exceeded").single(),
  ]);

  const allMedia = (unwrap(mediaR, "media_v1").data ?? []) as MediaLike[];
  const sets = (unwrap(setsR, "media_sets_v1").data ?? []) as MediaSetLike[];
  const setItems = (unwrap(itemsR, "media_set_items_v1").data ?? []) as { set_id?: string | null; media_id?: string | null; added_at?: string | null }[];
  const egressRow = unwrap(egressR, "egress_status_v1").data as { client_id?: string | null; bytes_used?: number | null; quota_bytes?: number | null; exceeded?: boolean | null } | null;

  const egress = egressLine(egressRow);
  const byId = new Map<string, MediaLike>(allMedia.filter((m) => m.id).map((m) => [m.id as string, m]));
  const setMembers = groupSetItems(setItems);
  const openSet = openSetId ? (sets.find((s) => s.id === openSetId) ?? null) : null;

  // The grid shows the open set's members, or the whole library, then the
  // toolbar's search and tag filter on top.
  const scope = openSet
    ? ((setMembers.get(openSet.id as string) ?? []).map((id) => byId.get(id)).filter((m): m is MediaLike => Boolean(m)))
    : allMedia;
  const rows = filterMedia(scope, { q, tag });
  const tagOptions = collectTags(allMedia);
  const openItem = openItemId ? (byId.get(openItemId) ?? null) : null;
  const trayRows = trayIds.map((id) => byId.get(id)).filter((m): m is MediaLike => Boolean(m));

  // One signing round trip for every thumbnail on the page.
  const thumbPaths = [
    ...rows.map(mediaThumbPath),
    ...sets.map((s) => setCoverPath(s, setMembers.get(s.id ?? ""), byId)),
    openItem ? mediaThumbPath(openItem) : null,
  ].filter((p): p is string => Boolean(p));
  let thumbUrls: Record<string, string | null> = {};
  if (thumbPaths.length) {
    try {
      thumbUrls = await client.media.thumbUrls([...new Set(thumbPaths)]);
    } catch (err) {
      console.error("library: thumbUrls failed", err instanceof Error ? err.message : err);
    }
  }

  /** The query string every form returns to, and every link keeps. */
  const view = new URLSearchParams({ from: range.from, to: range.to });
  if (q) view.set("q", q);
  if (tag) view.set("tag", tag);
  if (openSetId) view.set("set", openSetId);
  if (openItemId) view.set("item", openItemId);
  const back = `?${view.toString()}`;

  const linkTo = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(view);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `/library?${next.toString()}`;
  };

  const { supabaseUrl, supabaseAnonKey } = getConfig();
  const clientId = egressRow?.client_id ?? (allMedia[0] as { client_id?: string | null } | undefined)?.client_id ?? null;
  const canUpload = Boolean(supabaseUrl && supabaseAnonKey && clientId);

  return (
    <>
      <AppHeader
        active="library"
        range={range}
        today={today}
        clientName={shell.clientName}
        timezone={shell.timezone}
        email={email}
        health={shell.health}
        healthError={shell.healthError}
        openPopup={parsePopup(firstParam(searchParams.popup, 20))}
      />

      <div className="page-title-row">
        <h1 className="page-title">Content Library</h1>
        {egress.label ? <span className="page-title__sub">{egress.label}</span> : null}
      </div>

      {errorMessage ? (
        <p className="lib-alert" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="lib-toolbar">
        <form className="lib-search" method="get" action="/library">
          <input type="hidden" name="from" value={range.from} />
          <input type="hidden" name="to" value={range.to} />
          {openSetId ? <input type="hidden" name="set" value={openSetId} /> : null}
          <input className="lib-input" type="search" name="q" defaultValue={q} placeholder="Search title, filename, tags" aria-label="Search the library" />
          <select className="lib-input lib-input--select" name="tag" defaultValue={tag} aria-label="Filter by tag">
            <option value="">All tags</option>
            {tagOptions.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.tag} ({t.count})
              </option>
            ))}
          </select>
          <button className="btn-plain btn-plain--inline" type="submit">
            Filter
          </button>
          {q || tag ? (
            <Link className="lib-clear" href={linkTo({ q: null, tag: null })}>
              Clear
            </Link>
          ) : null}
        </form>

        <details className="popup lib-menu">
          <summary className="page-btn">Upload</summary>
          <div className="popup-panel popup-panel--wide">
            <div className="popup-panel__title">Upload creatives</div>
            {canUpload ? (
              <UploadForm supabaseUrl={supabaseUrl as string} anonKey={supabaseAnonKey as string} clientId={clientId as string} />
            ) : (
              <p className="state-note">Uploads are unavailable until the workspace finishes connecting.</p>
            )}
          </div>
        </details>

        <details className="popup lib-menu">
          <summary className="page-btn">New set</summary>
          <div className="popup-panel">
            <div className="popup-panel__title">New set</div>
            <form className="lib-form" action={setAction}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="op" value="create" />
              <label className="lib-field">
                <span>Name</span>
                <input type="text" name="name" maxLength={80} required />
              </label>
              <label className="lib-field">
                <span>Description</span>
                <input type="text" name="description" maxLength={200} />
              </label>
              <button className="btn-accent btn-accent--sm" type="submit">
                Create set
              </button>
            </form>
          </div>
        </details>
      </div>

      <div className="lib-layout">
        <div className="lib-main">
          {openItem ? (
            <ItemView
              item={openItem}
              thumbUrl={thumbUrls[mediaThumbPath(openItem) ?? ""] ?? null}
              back={back}
              closeHref={linkTo({ item: null })}
              exceeded={egress.exceeded}
              sets={sets.filter((s) => (setMembers.get(s.id ?? "") ?? []).includes(openItem.id as string))}
            />
          ) : null}

          {trayRows.length ? (
            <Panel className="lib-tray">
              <PanelHead
                tile={<LibraryIcon />}
                title={`Downloads ready (${trayRows.length})`}
                small
                right={
                  <Link className="view-all" href={linkTo({})}>
                    Close
                  </Link>
                }
              />
              <p className="state-note">Each file is minted full-quality when you click it, so nothing is charged until you do.</p>
              <div className="rows">
                {trayRows.map((row) => (
                  <div className="row" key={row.id}>
                    <span className="row__label">{mediaLabel(row)}</span>
                    <span className="row__value">{formatBytes(row.bytes)}</span>
                    <form action={downloadMedia}>
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="media_id" value={row.id ?? ""} />
                      <button className="btn-plain btn-plain--inline" type="submit" disabled={egress.exceeded}>
                        Download
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel className="panel--column">
            <PanelHead
              tile={<LibraryIcon />}
              title={openSet ? (openSet.name ?? "Set") : "All files"}
              small
              right={<span className="lib-count">{rows.length === scope.length ? fileCountLabel(rows.length) : `${rows.length} of ${fileCountLabel(scope.length)}`}</span>}
            />

            {allMedia.length === 0 ? (
              <p className="state-note">No files yet. Upload your first creative.</p>
            ) : rows.length === 0 ? (
              <p className="state-note">No files match this search.</p>
            ) : (
              <form className="media-form" action={bulkAction}>
                <input type="hidden" name="back" value={back} />
                {openSetId ? <input type="hidden" name="open_set" value={openSetId} /> : null}

                <div className="media-grid">
                  {rows.map((row) => {
                    const path = mediaThumbPath(row);
                    const url = path ? thumbUrls[path] : null;
                    return (
                      <div className="media-tile" key={row.id}>
                        <label className="media-tile__pick">
                          <input className="media-check" type="checkbox" name="ids" value={row.id ?? ""} />
                          <span className="media-tile__box" aria-hidden="true" />
                          <span className="sr-only">Select {mediaLabel(row)}</span>
                        </label>
                        <Link className="media-tile__thumb" href={linkTo({ item: row.id ?? "" })}>
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URLs; next/image would proxy every one
                            <img className="media-tile__img" src={url} alt="" />
                          ) : (
                            <span className="media-tile__img media-tile__img--placeholder" aria-hidden="true" />
                          )}
                        </Link>
                        <Link className="media-tile__name" href={linkTo({ item: row.id ?? "" })}>
                          {mediaLabel(row)}
                        </Link>
                        <div className="media-tile__meta">{formatBytes(row.bytes)}</div>
                        {row.tags?.length ? (
                          <div className="tag-row">
                            {row.tags.slice(0, 4).map((t) => (
                              <span className="tag" key={t}>
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="bulk-bar">
                  <span className="bulk-bar__label">With selected</span>
                  <input className="lib-input lib-input--sm" type="text" name="tags" placeholder="tag, tag" aria-label="Tags to add" />
                  <button className="btn-plain btn-plain--inline" type="submit" name="op" value="tag">
                    Add tags
                  </button>
                  <select className="lib-input lib-input--select lib-input--sm" name="set_id" aria-label="Set to add to" defaultValue="">
                    <option value="">Choose set…</option>
                    {sets.map((s) => (
                      <option key={s.id} value={s.id ?? ""}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn-plain btn-plain--inline" type="submit" name="op" value="add-set">
                    Add to set
                  </button>
                  {openSetId ? (
                    <button className="btn-plain btn-plain--inline" type="submit" name="op" value="remove-set">
                      Remove from set
                    </button>
                  ) : null}
                  <button className="btn-plain btn-plain--inline" type="submit" name="op" value="download" disabled={egress.exceeded}>
                    Download
                  </button>
                  <button className="btn-plain btn-plain--inline btn-plain--danger" type="submit" name="op" value="delete">
                    Delete
                  </button>
                </div>
              </form>
            )}
          </Panel>
        </div>

        <aside className="lib-side">
          <Panel className="panel--column">
            <PanelHead
              tile={<LibraryIcon />}
              title="Creative Folder"
              small
              right={openSetId ? <Link className="view-all" href={linkTo({ set: null, item: null })}>{"All files  →"}</Link> : null}
            />
            {sets.length === 0 ? (
              <p className="state-note">No sets yet. Use New set to group creatives.</p>
            ) : (
              <div className="set-list">
                {sets.map((s) => {
                  const cover = setCoverPath(s, setMembers.get(s.id ?? ""), byId);
                  const url = cover ? thumbUrls[cover] : null;
                  return (
                    <Link
                      className={s.id === openSetId ? "set-row is-active" : "set-row"}
                      key={s.id}
                      href={linkTo({ set: s.id ?? "", item: null })}
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
                        <img className="set-row__cover" src={url} alt="" />
                      ) : (
                        <span className="set-row__cover set-row__cover--placeholder" aria-hidden="true" />
                      )}
                      <span className="set-row__body">
                        <span className="set-row__name">{s.name}</span>
                        {s.description ? <span className="set-row__desc">{s.description}</span> : null}
                        <span className="set-row__count">{fileCountLabel(s.file_count)}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}

            {openSet ? (
              <div className="set-edit">
                <form className="lib-form" action={setAction}>
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="op" value="rename" />
                  <input type="hidden" name="set_id" value={openSet.id ?? ""} />
                  <label className="lib-field">
                    <span>Set name</span>
                    <input type="text" name="name" defaultValue={openSet.name ?? ""} maxLength={80} required />
                  </label>
                  <label className="lib-field">
                    <span>Description</span>
                    <input type="text" name="description" defaultValue={openSet.description ?? ""} maxLength={200} />
                  </label>
                  <button className="btn-plain btn-plain--inline" type="submit">
                    Rename set
                  </button>
                </form>
                <form action={setAction}>
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="op" value="delete" />
                  <input type="hidden" name="set_id" value={openSet.id ?? ""} />
                  <button className="btn-plain btn-plain--inline btn-plain--danger" type="submit">
                    Delete set
                  </button>
                </form>
              </div>
            ) : null}
          </Panel>
        </aside>
      </div>
    </>
  );
}

function ItemView({
  item,
  thumbUrl,
  back,
  closeHref,
  exceeded,
  sets,
}: {
  item: MediaLike;
  thumbUrl: string | null;
  back: string;
  closeHref: string;
  exceeded: boolean;
  sets: MediaSetLike[];
}) {
  return (
    <Panel className="lib-item">
      <PanelHead
        tile={<LibraryIcon />}
        title={mediaLabel(item)}
        small
        right={
          <Link className="view-all" href={closeHref}>
            Close
          </Link>
        }
      />
      <div className="lib-item__body">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
          <img className="lib-item__img" src={thumbUrl} alt={mediaLabel(item)} />
        ) : (
          <span className="lib-item__img lib-item__img--placeholder" aria-hidden="true" />
        )}
        <div className="lib-item__detail">
          <dl className="settings-list">
            <dt>Filename</dt>
            <dd>{item.filename ?? "—"}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(item.bytes)}</dd>
            <dt>Type</dt>
            <dd>{item.mime ?? item.kind ?? "—"}</dd>
            {sets.length ? (
              <>
                <dt>In sets</dt>
                <dd>{sets.map((s) => s.name).join(", ")}</dd>
              </>
            ) : null}
          </dl>

          <form className="lib-form" action={saveMedia}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="media_id" value={item.id ?? ""} />
            <label className="lib-field">
              <span>Title</span>
              <input type="text" name="title" defaultValue={item.title ?? ""} maxLength={200} />
            </label>
            <label className="lib-field">
              <span>Tags (comma separated)</span>
              <input type="text" name="tags" defaultValue={(item.tags ?? []).join(", ")} />
            </label>
            <button className="btn-accent btn-accent--sm" type="submit">
              Save changes
            </button>
          </form>

          <div className="lib-item__actions">
            <form action={downloadMedia}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="media_id" value={item.id ?? ""} />
              <button className="btn-plain btn-plain--inline" type="submit" disabled={exceeded}>
                Download full quality
              </button>
            </form>
            <form action={bulkAction}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="op" value="delete" />
              <input type="hidden" name="ids" value={item.id ?? ""} />
              <button className="btn-plain btn-plain--inline btn-plain--danger" type="submit">
                Delete file
              </button>
            </form>
          </div>
        </div>
      </div>
    </Panel>
  );
}
