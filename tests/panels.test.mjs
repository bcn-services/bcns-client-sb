/**
 * panels.test.mjs — pure-logic coverage for lib/panels.ts: the three panel
 * states, Integrations-popup rows, and the Monday/Meet row shaping item D
 * will feed with real rows. Run with:
 *   corepack pnpm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_SOURCES,
  healthFor,
  isConnected,
  panelState,
  integrationRow,
  integrationRows,
  taskBadge,
  sortPriorityTasks,
  noteExcerpt,
  sortRecentNotes,
} from "../lib/panels.ts";

const HEALTH = [
  { source: "shopify", status: "ok", last_success_at: "2026-09-11T06:00:00Z", last_error: null },
  { source: "meta", status: "auth_failed", last_success_at: null, last_error: "token expired" },
];

test("healthFor: finds a row, null for an absent source", () => {
  assert.equal(healthFor(HEALTH, "shopify")?.status, "ok");
  assert.equal(healthFor(HEALTH, "monday"), null);
});

test("isConnected: needs every source present, false on an empty source list", () => {
  assert.equal(isConnected(HEALTH, ["shopify"]), true);
  assert.equal(isConnected(HEALTH, ["shopify", "meta"]), true);
  assert.equal(isConnected(HEALTH, ["shopify", "monday"]), false);
  assert.equal(isConnected(HEALTH, []), false);
});

test("panelState: the three DESIGN.md states", () => {
  assert.equal(panelState([], ["shopify"], false), "not_connected");
  // Rows without a health row still read as not connected — health is the gate.
  assert.equal(panelState([], ["shopify"], true), "not_connected");
  assert.equal(panelState(HEALTH, ["shopify"], false), "empty");
  assert.equal(panelState(HEALTH, ["shopify"], true), "data");
});

test("integrationRow: not connected when no row exists", () => {
  const row = integrationRow(HEALTH, "monday", "Monday.com");
  assert.equal(row.connected, false);
  assert.equal(row.statusLabel, "Not connected");
  assert.equal(row.tone, "idle");
  assert.equal(row.lastSuccessAt, null);
});

test("integrationRow: maps status to label and tone, carries the error", () => {
  assert.deepEqual(
    { ...integrationRow(HEALTH, "shopify", "Shopify") },
    { source: "shopify", label: "Shopify", connected: true, statusLabel: "Connected", tone: "ok", lastSuccessAt: "2026-09-11T06:00:00Z", lastError: null },
  );
  const meta = integrationRow(HEALTH, "meta", "Meta Ads");
  assert.equal(meta.statusLabel, "Auth failed");
  assert.equal(meta.tone, "bad");
  assert.equal(meta.lastError, "token expired");
});

test("integrationRow: an unknown status falls through as its own label", () => {
  const row = integrationRow([{ source: "drive", status: "quarantined" }], "drive", "Google Drive");
  assert.equal(row.statusLabel, "quarantined");
  assert.equal(row.tone, "idle");
});

test("integrationRows: one row per expected source, in order, on empty health", () => {
  const rows = integrationRows([]);
  assert.equal(rows.length, EXPECTED_SOURCES.length);
  assert.deepEqual(rows.map((r) => r.source), EXPECTED_SOURCES.map((s) => s.source));
  assert.ok(rows.every((r) => r.statusLabel === "Not connected"));
});

test("taskBadge: done wins, in-progress is detected, blank falls back to To Do", () => {
  assert.deepEqual(taskBadge({ status: "Shipped", is_done: true }), { label: "Shipped", tone: "done" });
  assert.deepEqual(taskBadge({ status: "", is_done: true }), { label: "Done", tone: "done" });
  assert.deepEqual(taskBadge({ status: "In Progress" }), { label: "In Progress", tone: "progress" });
  assert.deepEqual(taskBadge({ status: "  " }), { label: "To Do", tone: "todo" });
});

test("sortPriorityTasks: open before done, then soonest due, undated last", () => {
  const tasks = [
    { title: "d", is_done: true, due_on: "2026-01-01" },
    { title: "c", due_on: null },
    { title: "b", due_on: "2026-09-20" },
    { title: "a", due_on: "2026-09-14" },
  ];
  assert.deepEqual(sortPriorityTasks(tasks).map((t) => t.title), ["a", "b", "c", "d"]);
  assert.equal(sortPriorityTasks(tasks, 2).length, 2);
  // input untouched
  assert.equal(tasks[0].title, "d");
});

test("sortPriorityTasks: default cap is 5, from a server-shaped batch of 50", () => {
  const tasks = Array.from({ length: 50 }, (_, i) => ({ title: `t${i}`, due_on: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` }));
  assert.equal(sortPriorityTasks(tasks).length, 5);
});

test("noteExcerpt: collapses whitespace, cuts on a word boundary", () => {
  assert.equal(noteExcerpt("  hello\n\n  world "), "hello world");
  assert.equal(noteExcerpt(null), "");
  const long = noteExcerpt("alpha bravo charlie delta", 14);
  assert.equal(long, "alpha bravo…");
  // no usable word boundary: hard cut
  assert.equal(noteExcerpt("abcdefghijklmnop", 8), "abcdefgh…");
});

test("sortRecentNotes: newest first, undated last, limited", () => {
  const notes = [
    { title: "old", occurred_at: "2026-09-01T00:00:00Z" },
    { title: "none", occurred_at: null },
    { title: "new", occurred_at: "2026-09-10T00:00:00Z" },
  ];
  assert.deepEqual(sortRecentNotes(notes).map((n) => n.title), ["new", "old", "none"]);
  assert.deepEqual(sortRecentNotes(notes, 1).map((n) => n.title), ["new"]);
});

test("sortRecentNotes: default cap is 3, from a server-shaped batch of 50", () => {
  const notes = Array.from({ length: 50 }, (_, i) => ({ title: `n${i}`, occurred_at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` }));
  assert.equal(sortRecentNotes(notes).length, 3);
});
