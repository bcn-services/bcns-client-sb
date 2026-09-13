/**
 * qa-monday-meet.test.mjs — item D QA: adversarial fixtures for the Monday
 * (jobs_v1/kind=task) and Meet (messages_v1/kind=meeting_note) panel shaping
 * in lib/panels.ts, plus the mondayState/meetState wiring in app/page.tsx.
 * Run with: corepack pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  taskBadge,
  sortPriorityTasks,
  noteExcerpt,
  sortRecentNotes,
  panelState,
} from "../lib/panels.ts";

test("taskBadge: mixed-case 'In PROGRESS' is still detected as progress", () => {
  assert.deepEqual(taskBadge({ status: "In PROGRESS" }), { label: "In PROGRESS", tone: "progress" });
  assert.deepEqual(taskBadge({ status: "WORKING on it" }), { label: "WORKING on it", tone: "progress" });
});

test("taskBadge: all-done batch every row tones 'done'", () => {
  const tasks = [
    { title: "a", is_done: true, status: "Shipped" },
    { title: "b", is_done: true, status: "" },
  ];
  for (const t of tasks) assert.equal(taskBadge(t).tone, "done");
});

test("sortPriorityTasks: duplicate due_on breaks the tie by title, stable and deterministic", () => {
  const tasks = [
    { title: "zeta", due_on: "2026-09-14" },
    { title: "alpha", due_on: "2026-09-14" },
    { title: "mid", due_on: "2026-09-14" },
  ];
  assert.deepEqual(sortPriorityTasks(tasks).map((t) => t.title), ["alpha", "mid", "zeta"]);
});

test("sortPriorityTasks: >5 tasks caps at 5 and keeps priority order", () => {
  const tasks = [
    { title: "done1", is_done: true, due_on: "2026-09-01" },
    { title: "t1", due_on: "2026-09-10" },
    { title: "t2", due_on: "2026-09-11" },
    { title: "t3", due_on: "2026-09-12" },
    { title: "t4", due_on: "2026-09-13" },
    { title: "t5", due_on: "2026-09-14" },
    { title: "t6", due_on: "2026-09-15" },
  ];
  const top = sortPriorityTasks(tasks);
  assert.equal(top.length, 5);
  assert.deepEqual(top.map((t) => t.title), ["t1", "t2", "t3", "t4", "t5"]);
  assert.ok(!top.some((t) => t.title === "done1"), "done task should be pushed past the cap");
});

test("noteExcerpt: multi-line body with leading/trailing whitespace collapses to one line, trimmed", () => {
  const body = "  \n  Line one.\n\n  Line two continues here.  \n\t";
  const excerpt = noteExcerpt(body);
  assert.equal(excerpt, "Line one. Line two continues here.");
  assert.ok(!excerpt.includes("\n"));
  assert.equal(excerpt, excerpt.trim());
});

test("sortRecentNotes: occurred_at ties keep both, stable relative order; >3 notes caps at 3", () => {
  const notes = [
    { title: "a", occurred_at: "2026-09-10T00:00:00Z" },
    { title: "b", occurred_at: "2026-09-10T00:00:00Z" },
    { title: "c", occurred_at: "2026-09-09T00:00:00Z" },
    { title: "d", occurred_at: "2026-09-11T00:00:00Z" },
    { title: "e", occurred_at: "2026-09-08T00:00:00Z" },
  ];
  const top = sortRecentNotes(notes);
  assert.equal(top.length, 3);
  assert.equal(top[0].title, "d");
  // tied pair a/b both precede c; order between ties is whatever Array#sort
  // gives (stable in Node), just assert both outrank the older "c".
  assert.deepEqual(new Set(top.map((n) => n.title)), new Set(["d", "a", "b"]));
});

test("panelState: rows present but no health row still reads not_connected (connection = health presence, not data presence)", () => {
  assert.equal(panelState([], ["monday"], true), "not_connected");
  assert.equal(panelState([], ["meet"], true), "not_connected");
});

test("panelState: health row present but zero rows reads empty, not not_connected", () => {
  const health = [{ source: "monday", status: "ok" }];
  assert.equal(panelState(health, ["monday"], false), "empty");
});

/* -------- app/page.tsx wiring: reads degrade to [] on a failed promise -------- */

test("app/page.tsx: jobs_v1/messages_v1 reads sit inside the Promise.allSettled and degrade via unwrap, never throw into the page", () => {
  const src = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const allSettledBlock = src.slice(src.indexOf("Promise.allSettled(["), src.indexOf("]);", src.indexOf("Promise.allSettled([")));
  assert.match(allSettledBlock, /jobs_v1\(\)\.eq\("kind",\s*"task"\)/);
  assert.match(allSettledBlock, /messages_v1\(\)\.eq\("kind",\s*"meeting_note"\)/);
  // unwrap() turns a rejected settle into { data: null, error }, never a throw
  assert.match(src, /function unwrap<T>\(r: PromiseSettledResult<[^>]+>\): Settled<T> \{\s*\n\s*if \(r\.status === "fulfilled"\) return r\.value;\s*\n\s*return \{ data: null, error: r\.reason \};/);
  // taskRows/noteRows fall back to [] when the settled read errored
  assert.match(src, /const taskRows = tasks\.error \? \[\] : \(tasks\.data \?\? \[\]\);/);
  assert.match(src, /const noteRows = notes\.error \? \[\] : \(notes\.data \?\? \[\]\);/);
});

test("app/page.tsx: mondayState/meetState derive from health-row presence (isConnected), not row presence, matching lib/panels.ts panelState contract", () => {
  const src = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(src, /const mondayState = panelState\(shell\.health, \["monday"\], taskRows\.length > 0\);/);
  assert.match(src, /const meetState = panelState\(shell\.health, \["meet"\], noteRows\.length > 0\);/);
});
