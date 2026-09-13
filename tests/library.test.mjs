/**
 * library.test.mjs — the pure logic behind /library (lib/library.ts).
 *
 * Covers the parts a wrong answer would quietly corrupt: tag normalising and
 * rejection (the platform raises otherwise), search/tag filtering, the egress
 * gate that disables every download control, id validation on the bulk RPC
 * boundary, and the storage path `data.register_media` regex-checks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstParam,
  lookupMessage,
  uploadStatus,
  MAX_BULK_IDS,
  collectTags,
  egressLine,
  fileCountLabel,
  fileExtension,
  filterMedia,
  formatBytes,
  groupSetItems,
  matchesQuery,
  mediaLabel,
  mediaThumbPath,
  parseIdList,
  parseIds,
  parseTags,
  setCoverPath,
  storagePath,
  validateSetName,
} from "../lib/library.ts";

const uuid = (n) => `0000000${n}-1111-4222-8333-444444444444`.slice(-36);

test("mediaLabel prefers the title, falls back to filename then Untitled", () => {
  assert.equal(mediaLabel({ title: " Hero ", filename: "a.png" }), "Hero");
  assert.equal(mediaLabel({ title: "  ", filename: "a.png" }), "a.png");
  assert.equal(mediaLabel({}), "Untitled");
});

test("mediaThumbPath signs the thumbnail only, never the original", () => {
  // `<client>/orig/` is only signable while a download ticket exists, so a row
  // without a thumb_path must render the placeholder instead.
  assert.equal(mediaThumbPath({ thumb_path: "t.jpg", storage_path: "o.jpg" }), "t.jpg");
  assert.equal(mediaThumbPath({ kind: "image", storage_path: "c/orig/u.jpg" }), null);
  assert.equal(mediaThumbPath({ mime: "image/png", storage_path: "c/orig/u.png" }), null);
  assert.equal(mediaThumbPath({}), null);
});

test("formatBytes scales and never prints a negative or NaN", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(null), "0 B");
  assert.equal(formatBytes(-5), "0 B");
  assert.equal(formatBytes(812), "812 B");
  assert.equal(formatBytes(9625), "9.4 KB");
  assert.equal(formatBytes(25 * 1024 * 1024), "25 MB");
  assert.equal(formatBytes(1.5 * 1024 ** 3), "1.5 GB");
});

test("parseTags normalises case, spacing and duplicates", () => {
  const { tags, invalid } = parseTags(" Summer , summer,  HERO   SHOT ,, ugc ");
  assert.deepEqual(tags, ["summer", "hero shot", "ugc"]);
  assert.deepEqual(invalid, []);
});

test("parseTags rejects what the platform would reject", () => {
  const { tags, invalid } = parseTags("ok, bad!tag, " + "x".repeat(41));
  assert.deepEqual(tags, ["ok"]);
  assert.equal(invalid.length, 2);
  assert.ok(invalid.includes("bad!tag"));
});

test("parseTags caps at 50 tags and reports the overflow", () => {
  const many = Array.from({ length: 55 }, (_, i) => `t${i}`).join(",");
  const { tags, invalid } = parseTags(many);
  assert.equal(tags.length, 50);
  assert.equal(invalid.length, 1);
});

test("collectTags counts and orders by usage then name", () => {
  const rows = [{ tags: ["a", "b"] }, { tags: ["b"] }, { tags: ["c", "b"] }, { tags: null }];
  assert.deepEqual(collectTags(rows), [
    { tag: "b", count: 3 },
    { tag: "a", count: 1 },
    { tag: "c", count: 1 },
  ]);
});

test("search covers title, filename and tags, case-insensitively", () => {
  const row = { title: "Sauna Hero", filename: "IMG_0042.png", tags: ["ugc"] };
  assert.ok(matchesQuery(row, "hero"));
  assert.ok(matchesQuery(row, "img_00"));
  assert.ok(matchesQuery(row, "UGC"));
  assert.ok(matchesQuery(row, ""));
  assert.ok(!matchesQuery(row, "winter"));
});

test("filterMedia applies search and tag together", () => {
  const rows = [
    { id: "1", title: "Hero", tags: ["summer"] },
    { id: "2", title: "Hero two", tags: ["winter"] },
    { id: "3", title: "Other", tags: ["summer"] },
  ];
  assert.deepEqual(filterMedia(rows, { q: "hero", tag: "summer" }).map((r) => r.id), ["1"]);
  assert.deepEqual(filterMedia(rows, { tag: "summer" }).map((r) => r.id), ["1", "3"]);
  assert.equal(filterMedia(rows).length, 3);
});

test("validateSetName trims and bounds", () => {
  assert.equal(validateSetName("  Spring  "), "Spring");
  assert.equal(validateSetName("   "), null);
  assert.equal(validateSetName("x".repeat(81)), null);
});

test("parseIds keeps only well-formed unique uuids and caps at the RPC limit", () => {
  const a = uuid(1);
  const b = uuid(2);
  assert.deepEqual(parseIds([a, a, b, "nope", "", null]), [a, b]);
  assert.equal(parseIds(Array.from({ length: 600 }, () => a).map((v, i) => v.slice(0, -1) + (i % 10))).length <= MAX_BULK_IDS, true);
  assert.deepEqual(parseIdList(`${a},${b},junk`), [a, b]);
  assert.deepEqual(parseIdList(null), []);
});

test("egressLine renders the label and gates downloads", () => {
  assert.deepEqual(egressLine(null), { label: null, exceeded: false });
  const ok = egressLine({ bytes_used: 1024, quota_bytes: 10 * 1024 ** 3, exceeded: false });
  assert.equal(ok.label, "Downloads this period: 1.0 KB of 10 GB");
  assert.equal(ok.exceeded, false);
  assert.equal(egressLine({ bytes_used: 5, quota_bytes: 5, exceeded: false }).exceeded, true);
  assert.equal(egressLine({ bytes_used: 0, quota_bytes: 0, exceeded: true }).exceeded, true);
});

test("fileExtension mirrors the platform's path check", () => {
  assert.equal(fileExtension("a.PNG", "image/png"), "png");
  assert.equal(fileExtension("noext", "image/jpeg"), "jpeg");
  assert.equal(fileExtension("", ""), "bin");
  assert.equal(fileExtension("a.verylongextension", null), "verylong");
});

test("storagePath matches <client>/orig/<uuid>.<ext>", () => {
  const path = storagePath("c1", "0f8fad5b-d9cb-469f-a165-70867728950e", "shot.JPG", "image/jpeg");
  assert.equal(path, "c1/orig/0f8fad5b-d9cb-469f-a165-70867728950e.jpg");
  assert.match(path, /^c1\/orig\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/);
});

test("groupSetItems buckets by set, newest addition first", () => {
  const grouped = groupSetItems([
    { set_id: "s1", media_id: "m1", added_at: "2026-01-01T00:00:00Z" },
    { set_id: "s1", media_id: "m2", added_at: "2026-02-01T00:00:00Z" },
    { set_id: "s2", media_id: "m3", added_at: "2026-01-01T00:00:00Z" },
    { set_id: null, media_id: "m4" },
  ]);
  assert.deepEqual(grouped.get("s1"), ["m2", "m1"]);
  assert.deepEqual(grouped.get("s2"), ["m3"]);
  assert.equal(grouped.size, 2);
});

test("setCoverPath uses the view's cover, else the newest member with a thumb", () => {
  const byId = new Map([
    ["m1", { kind: "video", storage_path: "v.mp4" }],
    ["m2", { kind: "image", storage_path: "i.png", thumb_path: "i-thumb.png" }],
  ]);
  assert.equal(setCoverPath({ cover_thumb_path: "c.jpg" }, ["m1"], byId), "c.jpg");
  assert.equal(setCoverPath({}, ["m1", "m2"], byId), "i-thumb.png");
  assert.equal(setCoverPath({}, ["m1"], byId), null);
  assert.equal(setCoverPath({}, undefined, byId), null);
});

test("fileCountLabel singularises", () => {
  assert.equal(fileCountLabel(1), "1 File");
  assert.equal(fileCountLabel(0), "0 Files");
  assert.equal(fileCountLabel(null), "0 Files");
});

test("firstParam survives a repeated search parameter", () => {
  // Next hands ?tag=a&tag=b over as an array; .toLowerCase() on it would 500.
  assert.equal(firstParam(["summer", "hero"]), "summer");
  assert.equal(firstParam("summer"), "summer");
  assert.equal(firstParam(undefined), "");
  assert.equal(firstParam(null), "");
  assert.equal(firstParam([]), "");
  assert.equal(firstParam([undefined]), "");
  assert.equal(firstParam("abcdef", 3), "abc");
  assert.equal(firstParam(["abcdef", "x"], 2), "ab");
});

test("lookupMessage never reaches Object.prototype", () => {
  const map = { failed: "That didn't work." };
  assert.equal(lookupMessage(map, "failed"), "That didn't work.");
  assert.equal(lookupMessage(map, "nope"), null);
  assert.equal(lookupMessage(map, "__proto__"), null);
  assert.equal(lookupMessage(map, "constructor"), null);
  assert.equal(lookupMessage(map, "toString"), null);
  assert.equal(lookupMessage(map, "hasOwnProperty"), null);
});

test("uploadStatus names the failure on a partial batch", () => {
  assert.deepEqual(uploadStatus(3, 3, null), { text: "Uploaded 3 files.", bad: false });
  assert.deepEqual(uploadStatus(1, 1, null), { text: "Uploaded 1 file.", bad: false });
  assert.deepEqual(uploadStatus(1, 3, "b.png: denied"), {
    text: "Uploaded 1 of 3 — b.png: denied",
    bad: true,
  });
  // Nothing uploaded at all still reports the error, never a success line.
  assert.equal(uploadStatus(0, 2, "a.png: denied").bad, true);
});
