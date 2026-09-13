"use server";

/**
 * /library server actions — every write in DESIGN.md's "Content Library +
 * Creative Folder" section, each one a named RPC through lib/data.ts as the
 * signed-in user. No direct table writes and no service-role key.
 *
 * Uploaded bytes never reach here: the browser PUTs the object straight to
 * Supabase Storage on its own cookie session and posts only the resulting path
 * to `registerUpload` below, which calls `register_upload`. See the engineer
 * report for why `client.media.upload()` can't run in the browser bundle.
 *
 * Actions don't return errors (a server component can't read one); they
 * redirect back with `?error=<code>`, which page.tsx renders as an alert.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDataClient } from "@/lib/data";
import { MAX_UPLOAD_BYTES, parseIds, parseTags, validateSetName } from "@/lib/library";

/** Ids the ?dl= tray carries; more would push the redirect past Node's 16 KB header limit. */
const DL_TRAY_MAX = 50;

/** Error codes page.tsx knows how to phrase. */
export type LibraryError =
  | "unconfigured"
  | "no_selection"
  | "bad_tags"
  | "bad_name"
  | "name_taken"
  | "no_set"
  | "egress"
  | "too_large"
  | "failed";

/**
 * The query string a form came from, so the redirect lands back on the same
 * view. Anything that isn't a plain query string is dropped rather than
 * followed — `back` is client-supplied.
 */
function safeBack(value: FormDataEntryValue | null): string {
  const raw = String(value ?? "");
  return /^\?[A-Za-z0-9=&%,.:_+*-]*$/.test(raw) ? raw : "";
}

/** Drop one parameter from a `?a=1&b=2` string, keeping it well-formed. */
function withoutParam(back: string, name: string): string {
  const stripped = back.replace(new RegExp(`[?&]${name}=[^&]*`, "g"), "");
  if (!stripped || stripped === "?") return "";
  return stripped.startsWith("&") ? `?${stripped.slice(1)}` : stripped;
}

function backTo(back: string, error?: LibraryError): never {
  revalidatePath("/library");
  const sep = back ? "&" : "?";
  redirect(`/library${back}${error ? `${sep}error=${error}` : ""}`);
}

/** Map a platform error onto one of our codes; anything unexpected is "failed". */
function codeFor(err: unknown): LibraryError {
  const detail = String((err as { details?: string })?.details ?? "");
  const message = String((err as { message?: string })?.message ?? err ?? "");
  if (detail === "name_taken") return "name_taken";
  if (detail === "name") return "bad_name";
  if (detail === "tags") return "bad_tags";
  if (message === "budget_reached") return "egress";
  if (message === "too_large") return "too_large";
  console.error("library: rpc failed", message, detail);
  return "failed";
}

/**
 * One action behind the grid's bulk bar. The grid is a single <form> of
 * checkboxes with one submit button per operation (`op`), so selection needs no
 * client JavaScript.
 */
export async function bulkAction(form: FormData): Promise<void> {
  const back = safeBack(form.get("back"));
  const op = String(form.get("op") ?? "");
  const ids = parseIds(form.getAll("ids").map(String));
  if (!ids.length) backTo(back, "no_selection");

  const client = await getDataClient();
  if (!client) backTo(back, "unconfigured");

  let error: LibraryError | undefined;
  let target: string | null = null;

  try {
    if (op === "tag") {
      const { tags, invalid } = parseTags(String(form.get("tags") ?? ""));
      if (invalid.length || !tags.length) error = "bad_tags";
      else await client.rpc.bulk_tag({ media_ids: ids, add: tags });
    } else if (op === "add-set" || op === "remove-set") {
      // Remove acts on the set being viewed (the hidden `open_set`), not on
      // whatever the "Add to set" dropdown happens to be showing.
      const setId =
        op === "remove-set"
          ? (parseIds([String(form.get("open_set") ?? "")])[0] ?? parseIds([String(form.get("set_id") ?? "")])[0])
          : parseIds([String(form.get("set_id") ?? "")])[0];
      if (!setId) error = "no_set";
      else await client.rpc.set_media_set_items({ set_id: setId, media_ids: ids, action: op === "add-set" ? "add" : "remove" });
    } else if (op === "delete") {
      await client.rpc.delete_media({ media_ids: ids });
    } else if (op === "download") {
      // No egress is spent here: the tray renders one mint-on-click button per
      // file, so a selection the user never downloads costs nothing.
      const clean = withoutParam(back, "dl");
      target = `/library${clean}${clean ? "&" : "?"}dl=${ids.slice(0, DL_TRAY_MAX).join(",")}`;
    } else {
      error = "failed";
    }
  } catch (err) {
    error = codeFor(err);
  }

  if (target && !error) {
    revalidatePath("/library");
    redirect(target);
  }
  backTo(back, error);
}

/** Item view: title + tags edit (`update_media`). */
export async function saveMedia(form: FormData): Promise<void> {
  const back = safeBack(form.get("back"));
  const mediaId = parseIds([String(form.get("media_id") ?? "")])[0];
  if (!mediaId) backTo(back, "no_selection");

  const client = await getDataClient();
  if (!client) backTo(back, "unconfigured");

  const { tags, invalid } = parseTags(String(form.get("tags") ?? ""));
  if (invalid.length) backTo(back, "bad_tags");

  let error: LibraryError | undefined;
  try {
    await client.rpc.update_media({ media_id: mediaId, title: String(form.get("title") ?? "").trim(), tags });
  } catch (err) {
    error = codeFor(err);
  }
  backTo(back, error);
}

/**
 * Mint a full-quality URL for one file and send the browser to it. Minting is
 * what charges egress, so it happens on a POST — never on a page render, where
 * a refresh would charge again.
 */
export async function downloadMedia(form: FormData): Promise<void> {
  const back = safeBack(form.get("back"));
  const mediaId = parseIds([String(form.get("media_id") ?? "")])[0];
  if (!mediaId) backTo(back, "no_selection");

  const client = await getDataClient();
  if (!client) backTo(back, "unconfigured");

  // The server refuses before spending anything; api.download_url raises
  // budget_reached on its own too, so the disabled button is only the hint.
  const status = await client.views.egress_status_v1("bytes_used,quota_bytes,exceeded").single();
  if (!status.error && status.data?.exceeded) backTo(back, "egress");

  let url: string | null = null;
  let error: LibraryError | undefined;
  try {
    url = await client.media.downloadUrl(mediaId);
  } catch (err) {
    error = codeFor(err);
  }
  if (url && !error) redirect(url);
  backTo(back, error);
}

/** Creative Folder: create / rename / delete a set. */
export async function setAction(form: FormData): Promise<void> {
  const back = safeBack(form.get("back"));
  const op = String(form.get("op") ?? "");

  const client = await getDataClient();
  if (!client) backTo(back, "unconfigured");

  const setId = parseIds([String(form.get("set_id") ?? "")])[0];
  const rawDescription = String(form.get("description") ?? "").trim();
  let error: LibraryError | undefined;
  let target: string | null = null;

  try {
    if (op === "create") {
      const name = validateSetName(form.get("name") as string);
      if (!name) error = "bad_name";
      else {
        const id = await client.rpc.create_media_set({ name, ...(rawDescription ? { description: rawDescription } : {}) });
        const clean = withoutParam(back, "set");
        target = `/library${clean}${clean ? "&" : "?"}set=${id}`;
      }
    } else if (op === "rename") {
      const name = validateSetName(form.get("name") as string);
      if (!setId) error = "no_set";
      else if (!name) error = "bad_name";
      else await client.rpc.update_media_set({ set_id: setId, name, description: rawDescription });
    } else if (op === "delete") {
      if (!setId) error = "no_set";
      else {
        await client.rpc.delete_media_set({ set_id: setId });
        // The open set is gone; drop ?set= so the view falls back to all files.
        target = `/library${withoutParam(back, "set")}`;
      }
    } else {
      error = "failed";
    }
  } catch (err) {
    error = codeFor(err);
  }

  if (target && !error) {
    revalidatePath("/library");
    redirect(target);
  }
  backTo(back, error);
}

/**
 * Second half of an upload: the browser has already PUT the object, this
 * registers it. Called imperatively from UploadForm, so unlike the form actions
 * above it returns a result instead of redirecting — the client refreshes once,
 * after the last file.
 */
export async function registerUpload(input: { path: string; title?: string; tags?: string[]; bytes?: number }): Promise<{ ok: boolean; error?: string }> {
  const client = await getDataClient();
  if (!client) return { ok: false, error: "Not connected to the data platform." };
  if (typeof input?.path !== "string" || !input.path) return { ok: false, error: "Missing upload path." };
  if (Number(input.bytes ?? 0) > MAX_UPLOAD_BYTES) return { ok: false, error: "File is larger than 100 MB." };

  const { tags, invalid } = parseTags((input.tags ?? []).join(","));
  if (invalid.length) return { ok: false, error: `Not a valid tag: ${invalid[0]}` };

  try {
    await client.rpc.register_upload({
      path: input.path,
      ...(input.title ? { title: input.title.slice(0, 200) } : {}),
      ...(tags.length ? { tags } : {}),
    });
  } catch (err) {
    const message = String((err as { message?: string })?.message ?? err);
    console.error("library: register_upload failed", message);
    return { ok: false, error: message === "too_large" ? "File is larger than 100 MB." : "Upload could not be registered." };
  }
  revalidatePath("/library");
  return { ok: true };
}
