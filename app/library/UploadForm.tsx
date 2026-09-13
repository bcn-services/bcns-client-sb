"use client";

/**
 * UploadForm — the one place /library needs client JavaScript.
 *
 * Creatives are tens of megabytes, so the bytes must not cross a Next server
 * action body. The browser PUTs each object straight to Supabase Storage on the
 * same cookie session the server pages use (@supabase/ssr `createBrowserClient`),
 * at the exact `<client_id>/orig/<uuid>.<ext>` path the platform validates, and
 * then posts only that path to the `registerUpload` action, which calls the
 * named `register_upload` RPC.
 *
 * Why not `client.media.upload()`, which does both halves: it decodes the JWT
 * with `Buffer.from(token, "base64url")`, and Next's client bundle aliases
 * `Buffer` to next/dist/compiled/buffer, which throws "Unknown encoding:
 * base64url". The two halves here are byte-for-byte the same calls that
 * @bcn-services/data-client would make.
 *
 * The URL and anon key arrive as props from the server component, which reads
 * them through lib/env.ts at request time — no NEXT_PUBLIC_* inlining, so the
 * app still builds with no environment set.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { registerUpload } from "./actions";
import { MAX_UPLOAD_BYTES, formatBytes, parseTags, storagePath, uploadStatus } from "@/lib/library";

export function UploadForm({
  supabaseUrl,
  anonKey,
  clientId,
}: {
  supabaseUrl: string;
  anonKey: string;
  clientId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = data.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) {
      setStatus({ text: "Choose at least one file.", bad: true });
      return;
    }

    const title = String(data.get("title") ?? "").trim();
    const { tags, invalid } = parseTags(String(data.get("tags") ?? ""));
    if (invalid.length) {
      setStatus({ text: `Not a valid tag: ${invalid[0]}`, bad: true });
      return;
    }

    const oversize = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversize) {
      setStatus({ text: `${oversize.name} is ${formatBytes(oversize.size)} — the limit is 100 MB.`, bad: true });
      return;
    }

    setBusy(true);
    const supabase = createBrowserClient(supabaseUrl, anonKey);
    let done = 0;
    // A batch that stops part-way must report the failure, so the final status
    // is written once, from here, rather than left to whichever branch ran last.
    let lastError: string | null = null;
    try {
      for (const file of files) {
        setStatus({ text: `Uploading ${file.name} (${done + 1} of ${files.length})…`, bad: false });
        const path = storagePath(clientId, crypto.randomUUID(), file.name, file.type);
        const { error } = await supabase.storage.from("media").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (error) {
          lastError = `${file.name}: ${error.message}`;
          break;
        }
        // Only the path crosses the action body — never the file.
        const result = await registerUpload({
          path,
          bytes: file.size,
          ...(files.length === 1 && title ? { title } : {}),
          ...(tags.length ? { tags } : {}),
        });
        if (!result.ok) {
          lastError = `${file.name}: ${result.error}`;
          // The object is already stored but nothing references it, and
          // purge_after only reaps `data.media` rows — so drop it here rather
          // than bill the client for an invisible file on every retry.
          await supabase.storage.from("media").remove([path]).catch(() => undefined);
          break;
        }
        done += 1;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Upload failed.";
    } finally {
      setBusy(false);
      if (done || lastError) setStatus(uploadStatus(done, files.length, lastError));
      if (done) {
        form.reset();
        router.refresh();
      }
    }
  }

  return (
    <form className="lib-form" onSubmit={onSubmit}>
      <label className="lib-field">
        <span>Files</span>
        <input type="file" name="files" multiple required disabled={busy} />
      </label>
      <label className="lib-field">
        <span>Title (single file)</span>
        <input type="text" name="title" maxLength={200} disabled={busy} />
      </label>
      <label className="lib-field">
        <span>Tags (comma separated)</span>
        <input type="text" name="tags" placeholder="summer, hero, ugc" disabled={busy} />
      </label>
      <button className="btn-accent btn-accent--sm" type="submit" disabled={busy}>
        {busy ? "Uploading…" : "Upload"}
      </button>
      {status ? (
        <p className={status.bad ? "lib-note lib-note--bad" : "lib-note"} role={status.bad ? "alert" : "status"}>
          {status.text}
        </p>
      ) : null}
    </form>
  );
}
