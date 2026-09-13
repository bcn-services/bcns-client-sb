/**
 * qa-library.test.mjs — independent QA coverage of lib/library.ts against
 * DESIGN.md's "/library" spec (Content Library + Creative Folder) and the
 * item C plan, plus the exact empty/no-match copy DESIGN.md requires.
 *
 * Written independently of the engineer's tests/library.test.mjs — same
 * module, adversarial cases the engineer's own suite may not hit.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_BULK_IDS,
  MAX_TAGS,
  egressLine,
  fileCountLabel,
  formatBytes,
  filterMedia,
  groupSetItems,
  matchesQuery,
  parseIdList,
  parseIds,
  parseTags,
  setCoverPath,
  storagePath,
} from "../lib/library.ts";

// ---- tag parsing rules ----------------------------------------------------

test("parseTags: valid tags normalise to lower-case, trimmed, deduped", () => {
  const { tags, invalid } = parseTags(" Hero , hero, Summer Shot ");
  assert.deepEqual(tags, ["hero", "summer shot"]);
  assert.deepEqual(invalid, []);
});

test("parseTags: empty and whitespace-only entries are silently dropped, not counted invalid", () => {
  const { tags, invalid } = parseTags(" , , ,,   ,");
  assert.deepEqual(tags, []);
  assert.deepEqual(invalid, []);
});

test("parseTags: duplicate tags (case/space-insensitive) collapse to one", () => {
  const { tags } = parseTags("Hero,hero,HERO,  hero  ");
  assert.deepEqual(tags, ["hero"]);
});

test("parseTags: a tag over 40 chars is rejected as invalid, not silently truncated", () => {
  const long65 = "a".repeat(65);
  const { tags, invalid } = parseTags(`ok,${long65}`);
  assert.deepEqual(tags, ["ok"]);
  assert.deepEqual(invalid, [long65]);
});

test("parseTags: illegal characters (emoji, punctuation outside _- ) are rejected", () => {
  const { tags, invalid } = parseTags("hero!,summer/shot,ok_tag,ok-tag,😀");
  assert.deepEqual(tags, ["ok_tag", "ok-tag"]);
  assert.deepEqual(invalid.sort(), ["hero!", "summer/shot", "😀"].sort());
});

test("parseTags: over MAX_TAGS unique tags truncates the list and flags the overflow", () => {
  const many = Array.from({ length: MAX_TAGS + 5 }, (_, i) => `tag${i}`).join(",");
  const { tags, invalid } = parseTags(many);
  assert.equal(tags.length, MAX_TAGS);
  assert.ok(invalid.some((m) => m.includes(`max ${MAX_TAGS}`)));
});

test("parseTags: null/undefined input is empty, not a throw", () => {
  assert.deepEqual(parseTags(null), { tags: [], invalid: [] });
  assert.deepEqual(parseTags(undefined), { tags: [], invalid: [] });
});

// ---- search + tag filter semantics ----------------------------------------

test("matchesQuery: matches title, filename, or any tag, case-insensitively", () => {
  const row = { title: "Summer Hero", filename: "IMG_01.png", tags: ["ugc", "launch"] };
  assert.equal(matchesQuery(row, "summer"), true);
  assert.equal(matchesQuery(row, "IMG_01"), true);
  assert.equal(matchesQuery(row, "LAUNCH"), true);
  assert.equal(matchesQuery(row, "nope"), false);
});

test("matchesQuery: empty/whitespace query matches everything", () => {
  const row = { title: "x" };
  assert.equal(matchesQuery(row, ""), true);
  assert.equal(matchesQuery(row, "   "), true);
});

test("filterMedia: search and tag filter combine with AND, not OR", () => {
  const rows = [
    { id: "1", title: "Summer Hero", tags: ["ugc"] },
    { id: "2", title: "Summer Ad", tags: ["launch"] },
    { id: "3", title: "Winter Ad", tags: ["ugc"] },
  ];
  const out = filterMedia(rows, { q: "summer", tag: "ugc" });
  assert.deepEqual(out.map((r) => r.id), ["1"]);
});

test("filterMedia: no-match query returns an empty array (drives the no-match copy)", () => {
  const rows = [{ id: "1", title: "Summer Hero", tags: [] }];
  assert.deepEqual(filterMedia(rows, { q: "zzz-nonexistent" }), []);
});

test("filterMedia: with neither q nor tag, every row passes through", () => {
  const rows = [{ id: "1" }, { id: "2" }];
  assert.deepEqual(filterMedia(rows), rows);
});

// ---- byte formatting --------------------------------------------------------

test("formatBytes: adversarial inputs never print negative or NaN", () => {
  assert.equal(formatBytes(-1), "0 B");
  assert.equal(formatBytes(NaN), "0 B");
  assert.equal(formatBytes(Infinity), "0 B");
  assert.equal(formatBytes(undefined), "0 B");
});

test("formatBytes: unit boundaries", () => {
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024 - 1), "1024 KB");
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
});

// ---- bulk-id validation: UUID only, cap ------------------------------------

test("parseIds: rejects non-UUID strings outright", () => {
  const out = parseIds(["not-a-uuid", "12345", "", null, undefined, "0000000a-1111-4222-8333-444444444444"]);
  assert.deepEqual(out, ["0000000a-1111-4222-8333-444444444444"]);
});

test("parseIds: deduplicates repeated ids", () => {
  const id = "0000000a-1111-4222-8333-444444444444";
  assert.deepEqual(parseIds([id, id, id]), [id]);
});

test("parseIds: caps at MAX_BULK_IDS (501 ids -> 500 kept)", () => {
  const ids = Array.from({ length: 501 }, (_, i) => {
    const hex = i.toString(16).padStart(8, "0");
    return `${hex}-1111-4222-8333-444444444444`;
  });
  const out = parseIds(ids);
  assert.equal(out.length, MAX_BULK_IDS);
  assert.equal(ids.length, 501);
});

test("parseIdList: parses the ?dl= comma-separated tray, dropping malformed entries", () => {
  const id = "0000000a-1111-4222-8333-444444444444";
  assert.deepEqual(parseIdList(`${id},garbage,${id}`), [id]);
  assert.deepEqual(parseIdList(null), []);
  assert.deepEqual(parseIdList(""), []);
});

// ---- egress gate: exceeded -> disabled, unreadable -> fail-open ------------

test("egressLine: exceeded flag disables downloads regardless of numbers", () => {
  const { exceeded } = egressLine({ bytes_used: 0, quota_bytes: 1000, exceeded: true });
  assert.equal(exceeded, true);
});

test("egressLine: used >= quota also counts as exceeded even if the flag is false/missing", () => {
  const { exceeded } = egressLine({ bytes_used: 1000, quota_bytes: 1000, exceeded: false });
  assert.equal(exceeded, true);
});

test("egressLine: unreadable row (null) fails open -- no label, not exceeded", () => {
  assert.deepEqual(egressLine(null), { label: null, exceeded: false });
  assert.deepEqual(egressLine(undefined), { label: null, exceeded: false });
});

test("egressLine: label renders as byte sizes ('X of Y'), matching the platform's byte-metered egress", () => {
  const { label } = egressLine({ bytes_used: 364, quota_bytes: 20 * 1024 ** 3 });
  assert.equal(label, "Downloads this period: 364 B of 20 GB");
});

// ---- storage path shape -----------------------------------------------------

test("storagePath: matches <client_id>/orig/<uuid>.<ext> exactly", () => {
  const clientId = "c-123";
  const uuid = "0000000a-1111-4222-8333-444444444444";
  const path = storagePath(clientId, uuid, "photo.PNG", "image/png");
  assert.equal(path, `${clientId}/orig/${uuid}.png`);
  assert.match(path, /^[^/]+\/orig\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/);
});

test("storagePath: falls back to mime subtype, then 'bin', when the filename has no usable extension", () => {
  const clientId = "c-1";
  const uuid = "0000000a-1111-4222-8333-444444444444";
  assert.equal(storagePath(clientId, uuid, "noext", "image/jpeg"), `${clientId}/orig/${uuid}.jpeg`);
  assert.equal(storagePath(clientId, uuid, null, null), `${clientId}/orig/${uuid}.bin`);
});

// ---- set grouping / cover ---------------------------------------------------

test("groupSetItems: groups by set_id, newest added_at first, drops rows missing ids", () => {
  const items = [
    { set_id: "s1", media_id: "m1", added_at: "2026-01-01" },
    { set_id: "s1", media_id: "m2", added_at: "2026-02-01" },
    { set_id: "s2", media_id: "m3", added_at: "2026-01-01" },
    { set_id: null, media_id: "m4", added_at: "2026-01-01" },
    { set_id: "s1", media_id: null, added_at: "2026-01-01" },
  ];
  const grouped = groupSetItems(items);
  assert.deepEqual(grouped.get("s1"), ["m2", "m1"]);
  assert.deepEqual(grouped.get("s2"), ["m3"]);
  assert.equal(grouped.has("s3"), false);
});

test("setCoverPath: prefers the view's own cover_thumb_path", () => {
  const byId = new Map([["m1", { id: "m1", thumb_path: "t1.jpg" }]]);
  const cover = setCoverPath({ cover_thumb_path: "cover.jpg" }, ["m1"], byId);
  assert.equal(cover, "cover.jpg");
});

test("setCoverPath: falls back to the newest member with a thumbnail, else null", () => {
  const byId = new Map([
    ["m1", { id: "m1", thumb_path: null }],
    ["m2", { id: "m2", thumb_path: "t2.jpg" }],
  ]);
  assert.equal(setCoverPath({}, ["m1", "m2"], byId), "t2.jpg");
  assert.equal(setCoverPath({}, ["m1"], byId), null);
  assert.equal(setCoverPath({}, [], byId), null);
});

test("fileCountLabel: singular/plural", () => {
  assert.equal(fileCountLabel(0), "0 Files");
  assert.equal(fileCountLabel(1), "1 File");
  assert.equal(fileCountLabel(2), "2 Files");
  assert.equal(fileCountLabel(null), "0 Files");
});

// ---- empty-state and no-match copy (DESIGN.md exact strings) --------------

test("page copy: /library empty state matches DESIGN.md exactly", () => {
  const src = readFileSync(new URL("../app/library/page.tsx", import.meta.url), "utf8");
  assert.match(src, /No files yet\. Upload your first creative\./);
});

test("page copy: home Content Library panel uses the same empty-state copy", () => {
  const src = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(src, /No files yet\. Upload your first creative\./);
});

test("page copy: /library no-match state has its own distinct copy", () => {
  const src = readFileSync(new URL("../app/library/page.tsx", import.meta.url), "utf8");
  assert.match(src, /No files match this search\./);
});
