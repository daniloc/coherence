// atlas.test.ts — the trust-graded manifold's tier derivation. The load-bearing rule:
// tier-1 (enshrined) is NOT inferred from a claim's verb — a bare `via guard` is only
// source-totality evidence (tier-2). Tier-1 requires an EXPLICIT `enshrined: true` marker
// on the transition AND a backing `via guard` claim; a marker with no backing guard is an
// empty over-claim that fails-closed (`atlas --check` reds instead of rendering tier-1).
import test from "node:test";
import assert from "node:assert/strict";
import { atlas } from "../src/atlas.ts";
import { graph, comp, cfg, tmpProject, cleanup, runCaptured } from "./_helpers.ts";
import type { Config } from "../src/types.ts";

// A project whose source actually contains the chokepoint symbols (so symbolExists holds
// and `dangling` doesn't muddy the case we're testing), with the given atlas transitions.
type Transitions = NonNullable<Config["atlas"]>["transitions"];
async function fixture(transitions: Transitions, symbols: string[]) {
  const root = await tmpProject({ "src/mod.ts": symbols.map((s) => `export function ${s}() {}`).join("\n") + "\n" });
  const c = cfg(root, {
    atlas: {
      charts: { untrusted: "raw input", trusted: "validated" },
      transitions,
    },
  });
  return { root, cfg: c };
}

test("atlas — a `via guard` crossing with NO enshrined marker renders tier-2 (not tier-1)", async () => {
  const { root, cfg: c } = await fixture(
    { buildQuery: { from: "untrusted", to: "trusted", security: true, translates: "raw input → safe query" } },
    ["buildQuery"],
  );
  const g = graph([comp(".", { label: "Db", claims: ['boundary "sql safety" at buildQuery via guard "no raw sql"'], invariants: ["sql safety"], why: "r" })]);
  const { code, out } = await runCaptured(() => atlas(c, g, "check"));
  assert.equal(code, 0, "a bare via-guard crossing is fully mapped and must pass --check");
  assert.match(out, /tier-2 · TOTALITY-CHECKED/);
  assert.doesNotMatch(out, /tier-1 · ENSHRINED/);
  assert.match(out, /Tiers: 0 enshrined · 1 totality-checked · 0 convention/);
  await cleanup(root);
});

test("atlas — a crossing marked `enshrined` AND backed by a `via guard` claim renders tier-1", async () => {
  const { root, cfg: c } = await fixture(
    { mintToken: { from: "untrusted", to: "trusted", security: true, enshrined: true, translates: "raw → branded capability" } },
    ["mintToken"],
  );
  const g = graph([comp(".", { label: "Auth", claims: ['boundary "capability" at mintToken via guard "brand totality"'], invariants: ["capability"], why: "r" })]);
  const { code, out } = await runCaptured(() => atlas(c, g, "check"));
  assert.equal(code, 0);
  assert.match(out, /tier-1 · ENSHRINED \(structural — 1 crossing\)/);
  assert.match(out, /Tiers: 1 enshrined · 0 totality-checked · 0 convention/);
  assert.match(out, /no over-claim/);
  await cleanup(root);
});

test("atlas — `enshrined` with NO backing via-guard claim FAILS --check (fail-closed), not tier-1", async () => {
  const { root, cfg: c } = await fixture(
    { mintToken: { from: "untrusted", to: "trusted", security: true, enshrined: true, translates: "raw → branded capability" } },
    ["mintToken"],
  );
  const g = graph([comp(".", { label: "Auth", claims: ['boundary "capability" at mintToken via test "brand totality"'], invariants: ["capability"], why: "r" })]);
  const { code, out } = await runCaptured(() => atlas(c, g, "check"));
  assert.equal(code, 1, "an enshrined marker with no source-totality guard must red");
  assert.match(out, /OVER-CLAIM/);
  assert.doesNotMatch(out, /tier-1 · ENSHRINED/, "must NOT silently render tier-1");
  assert.match(out, /tier-2 · TOTALITY-CHECKED/, "renders at its real evidence tier instead");
  await cleanup(root);
});

test("atlas — `enshrined` with NO boundary claim at all also fails-closed (tier-3, over-claim)", async () => {
  const { root, cfg: c } = await fixture(
    { mintToken: { from: "untrusted", to: "trusted", security: true, enshrined: true, translates: "raw → branded capability" } },
    ["mintToken"],
  );
  const g = graph([comp(".", { label: "Auth", claims: [], invariants: [], why: "r" })]);
  const { code, out } = await runCaptured(() => atlas(c, g, "check"));
  assert.equal(code, 1);
  assert.match(out, /OVER-CLAIM/);
  assert.doesNotMatch(out, /tier-1 · ENSHRINED/);
  await cleanup(root);
});
