// qa-shell-home.test.mjs — Item A "done when" gaps the engineer's own suites
// don't cover: layout has no nav/Ask surface, popup query values are
// whitelisted, and outbound service links are real https targets with the
// external-link safety props. Behavioral (browser-driven) checks cover the
// rest of Item A; see .claude/dev-team/qa-report.md.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePopup } from "../app/_components/AppHeader.tsx";
import { SERVICE_LINKS, EXTERNAL_LINK_PROPS } from "../lib/links.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("app/layout.tsx has no sidebar/nav and no Ask/agent strip", () => {
  const src = readFileSync(join(root, "app/layout.tsx"), "utf8");
  assert.equal(/app-nav/.test(src), false);
  assert.equal(/Ask the/i.test(src), false);
  assert.equal(/agent-strip|quick-action/i.test(src), false);
});

test("app/integrations/page.tsx is gone (route deleted, popup replaces it)", () => {
  assert.throws(() => readFileSync(join(root, "app/integrations/page.tsx"), "utf8"));
});

test("parsePopup: only 'integrations' and 'settings' open a popup on arrival", () => {
  assert.equal(parsePopup("integrations"), "integrations");
  assert.equal(parsePopup("settings"), "settings");
  assert.equal(parsePopup("bogus"), undefined);
  assert.equal(parsePopup(undefined), undefined);
});

test("SERVICE_LINKS: every outbound target is a real https URL, not a placeholder", () => {
  for (const [key, url] of Object.entries(SERVICE_LINKS)) {
    assert.match(url, /^https:\/\/\S+$/, `${key} should be a real https URL`);
    assert.equal(url.includes("localhost"), false);
  }
});

test("EXTERNAL_LINK_PROPS: carries target=_blank and rel=noopener noreferrer", () => {
  assert.equal(EXTERNAL_LINK_PROPS.target, "_blank");
  assert.equal(EXTERNAL_LINK_PROPS.rel, "noopener noreferrer");
});
