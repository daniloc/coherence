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

test("atlas — a chokepoint with TWO boundary claims (one via test, one via guard) renders tier-1 REGARDLESS of claim order", async () => {
  // Two claims share the chokepoint `mintToken`: one `via test`, one `via guard`. Enshrinement
  // is guard-backed iff ANY claim there is `via guard`, so this must render tier-1 and pass
  // --check no matter which claim `allBoundaries` happens to keep first. Drive BOTH orders.
  const guardClaim = 'boundary "capability" at mintToken via guard "brand totality"';
  const testClaim = 'boundary "chat ownership" at mintToken via test "ownership check"';
  const run = async (claims: string[]) => {
    const { root, cfg: c } = await fixture(
      { mintToken: { from: "untrusted", to: "trusted", security: true, enshrined: true, translates: "raw → branded capability" } },
      ["mintToken"],
    );
    const g = graph([comp(".", { label: "Auth", claims, invariants: ["capability", "chat ownership"], why: "r" })]);
    const res = await runCaptured(() => atlas(c, g, "check"));
    await cleanup(root);
    return res;
  };
  // guard-first and test-first: `allBoundaries` keeps whichever is declared first, but the
  // tier grade must not depend on that pick.
  const guardFirst = await run([guardClaim, testClaim]);
  const testFirst = await run([testClaim, guardClaim]);
  for (const [name, r] of [["guard-first", guardFirst], ["test-first", testFirst]] as const) {
    assert.equal(r.code, 0, `${name}: two claims incl. a via-guard must pass --check`);
    assert.match(r.out, /tier-1 · ENSHRINED \(structural — 1 crossing\)/, `${name}: renders tier-1`);
    assert.match(r.out, /Tiers: 1 enshrined · 0 totality-checked · 0 convention/, `${name}`);
    assert.match(r.out, /no over-claim/, `${name}: not an over-claim`);
  }
  // Order-independence, stated directly: the outcome is identical either way.
  assert.equal(guardFirst.code, testFirst.code);
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

// ── HEAT — where the map is being worked ─────────────────────────────────────────────
//
// A tier says how well a crossing is DEFENDED; heat says whether anyone has been near it.
// Two layers, the split evolution.ts's header prescribes: the derivation is a pure function
// of injected commits (exhaustive, no git), and the glue — column, doc table, record, and
// the verdict heat must NOT touch — is driven through a real throwaway repo.
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { crossingHeat, heatCell } from "../src/atlas.ts";
import { _resetEvolutionMemo, type Commit } from "../src/evolution.ts";
import { sym } from "./_helpers.ts";
import type { StatusRecord } from "../src/status.ts";

const commit = (hash: string, files: string[]): Commit => ({ hash, subject: hash, files });

test("crossingHeat — a symbol defined in two files takes the MAX share, never the sum or the mean", () => {
  // hot.ts in 3 of 4 considered commits, cold.ts in 1. The chokepoint is defined in both.
  const g = graph([sym("mintToken", "hot.ts"), sym("mintToken", "cold.ts")]);
  const commits = [
    commit("c1", ["hot.ts", "x.ts"]),
    commit("c2", ["hot.ts", "y.ts"]),
    commit("c3", ["hot.ts", "cold.ts"]),
    commit("c4", ["y.ts", "z.ts"]),
  ];
  const h = crossingHeat(g, ["mintToken"], commits);
  assert.equal(h.get("mintToken"), 0.75, "max over defining files — a cold twin must not hide a hot definition");
  // and specifically not the alternatives: sum would be 1.0, mean 0.5
  assert.notEqual(h.get("mintToken"), 1.0);
  assert.notEqual(h.get("mintToken"), 0.5);
});

test("crossingHeat — the BULK band is respected, because fileChurn owns that filter", () => {
  // A 1-file commit carries no concern signal and a >BULK commit is a mechanical migration;
  // neither is `considered`, so neither can heat a chokepoint.
  const g = graph([sym("guard", "g.ts")]);
  const bulk = Array.from({ length: 60 }, (_, i) => `f${i}.ts`);
  const commits = [
    commit("solo", ["g.ts"]),                    // 1 file — no pairs, not considered
    commit("migration", ["g.ts", ...bulk]),      // > BULK — mechanical, not considered
    commit("real", ["g.ts", "other.ts"]),        // the only commit that counts
    commit("other", ["other.ts", "third.ts"]),
  ];
  assert.equal(crossingHeat(g, ["guard"], commits).get("guard"), 0.5, "1 of 2 considered commits");
});

test("crossingHeat — ABSENCE, not zero: no graph symbol and no history both yield no entry", () => {
  const g = graph([sym("known", "k.ts")]);
  const commits = [commit("c1", ["k.ts", "x.ts"])];
  const h = crossingHeat(g, ["known", "neverHeardOf"], commits);
  assert.equal(h.get("known"), 1);
  assert.ok(!h.has("neverHeardOf"), "a symbol with no graph node has no reading — it is not cold");
  // an empty history measures nothing about anything
  assert.equal(crossingHeat(g, ["known"], []).size, 0);
  // …and a history where nothing survived the concern filter is equally unmeasurable
  assert.equal(crossingHeat(g, ["known"], [commit("solo", ["k.ts"])]).size, 0);
});

test("crossingHeat — a symbol in the graph over a real history but never touched is a MEASURED zero", () => {
  const g = graph([sym("cold", "cold.ts")]);
  const h = crossingHeat(g, ["cold"], [commit("c1", ["a.ts", "b.ts"])]);
  assert.equal(h.get("cold"), 0, "found + measurable is a reading of 0, which is not the same as no reading");
});

test("heatCell — a reading renders bar + percent, no reading renders an em dash", () => {
  assert.equal(heatCell(undefined, 0.5), "—");
  assert.match(heatCell(0.5, 0.5), /^█ 50%$/);      // the hottest crossing tops the bar
  assert.match(heatCell(0.18, 0.9), /\s18%$/);
  assert.equal(heatCell(0, 0.5), "▁ 0%");
});

// ── the glue layer, over a real repo ─────────────────────────────────────────────────

const git = (args: string[], cwd: string) => spawnSync("git", args, { cwd, encoding: "utf8" });
async function heatRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coh-atlas-heat-"));
  git(["init", "-q"], root);
  git(["config", "user.email", "t@test"], root);
  git(["config", "user.name", "t"], root);
  git(["config", "commit.gpgsign", "false"], root);
  const write = async (p: string, c: string) => { await mkdir(dirname(join(root, p)), { recursive: true }); await writeFile(join(root, p), c); };
  // src/mod.ts (defining mintToken) is touched by both commits; src/other.ts by one.
  await write("src/mod.ts", "export function mintToken() {}\n");
  await write("src/other.ts", "export const x = 1;\n");
  git(["add", "-A"], root); git(["commit", "-q", "-m", "one"], root);
  await write("src/mod.ts", "export function mintToken() { return 1; }\n");
  await write("src/side.ts", "export const y = 2;\n");
  git(["add", "-A"], root); git(["commit", "-q", "-m", "two"], root);
  return root;
}

test("atlas — the crossing row, the doc table and the record all carry the heat reading", async (t) => {
  const root = await heatRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const c = cfg(root, {
    atlas: {
      charts: { untrusted: "raw", trusted: "safe" },
      transitions: { mintToken: { from: "untrusted", to: "trusted", security: true, translates: "raw → branded" } },
    },
  });
  const g = graph([
    comp(".", { label: "Auth", claims: ['boundary "capability" at mintToken via guard "brand totality"'], invariants: ["capability"], why: "r" }),
    sym("mintToken", "src/mod.ts"),
  ]);
  const { code, out } = await runCaptured(() => atlas(c, g, "check"));
  assert.equal(code, 0, out);
  // both commits touch src/mod.ts and both are inside the 2…BULK band → 100%
  assert.match(out, /mintToken\s+heat █ 100%/);
  const md = await readFile(join(root, "public", "atlas.md"), "utf8");
  assert.match(md, /\| heat \|/, "the doc table gains the column");
  assert.match(md, /\| █ 100% \|/);
  const rec: StatusRecord = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8"));
  assert.equal(rec.atlas!.crossings[0].heat, 1, "the record stores the RAW share, not the rendered bar");
});

test("atlas — a crossing with no measurable heat renders `—`, and `--check` is unaffected either way", async (t) => {
  // Same atlas, over a directory that is not a repo: nothing to measure, so nothing is
  // claimed. Heat is a temperature, not a correctness fact — the verdict must not move.
  const root = await tmpProject({ "src/mod.ts": "export function mintToken() {}\n" });
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const c = cfg(root, {
    atlas: {
      charts: { untrusted: "raw", trusted: "safe" },
      transitions: { mintToken: { from: "untrusted", to: "trusted", security: true, translates: "raw → branded" } },
    },
  });
  const g = graph([
    comp(".", { label: "Auth", claims: ['boundary "capability" at mintToken via guard "brand totality"'], invariants: ["capability"], why: "r" }),
    sym("mintToken", "src/mod.ts"),
  ]);
  const { code, out } = await runCaptured(() => atlas(c, g, "check"));
  assert.equal(code, 0, "an unmeasurable temperature is not a defect");
  assert.match(out, /mintToken\s+heat —/);
  assert.match(out, /atlas --check held/);
  const rec: StatusRecord = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8"));
  assert.equal(rec.atlas!.crossings[0].heat, undefined, "absence survives into the record as absence");
});

test("atlas — heat does not enter the `--check` verdict: a hot repo with real drift still FAILS", async (t) => {
  // The inverse of the case above: a measurable, maximal heat reading on a map that is out
  // of sync must still red, and for the drift reason — never softened by how warm it is.
  const root = await heatRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const c = cfg(root, {
    atlas: {
      charts: { untrusted: "raw", trusted: "safe" },
      transitions: { mintToken: { from: "untrusted", to: "trusted", security: true, translates: "raw → branded" } },
    },
  });
  const g = graph([
    comp(".", { label: "Auth", claims: [
      'boundary "capability" at mintToken via guard "brand totality"',
      'boundary "unmapped" at otherChoke via guard "g"',
    ], invariants: ["capability", "unmapped"], why: "r" }),
    sym("mintToken", "src/mod.ts"), sym("otherChoke", "src/other.ts"),
  ]);
  const { code, out, err } = await runCaptured(() => atlas(c, g, "check"));
  assert.equal(code, 1);
  assert.match(out + err, /ATLAS DRIFT/);
  assert.match(out, /heat █ 100%/, "the hot reading is still rendered — it just grades nothing");
});

// ── INFERENCE HAZARDS — a tier-3 crossing with change traffic through it ─────────────
//
// A tier grade says nobody wrote down what may cross here; heat says people keep needing to
// know. The JOIN is the only line on this map that reports a cost being paid REPEATEDLY,
// and it is advisory for the same reason heat is: a verdict that moved with the commit
// calendar is one nobody could act on. These tests pin both halves — that it fires on the
// join and only on the join, and that `--check` never notices it.

/** src/mod.ts (mintToken) is touched by all 11 commits; src/cold.ts (coldChoke) by 1 of 11
 *  — 9%, deliberately just UNDER the 10% floor, so the cold case is a MEASURED reading and
 *  not an absent one. */
async function hazardRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coh-atlas-hazard-"));
  git(["init", "-q"], root);
  git(["config", "user.email", "t@test"], root);
  git(["config", "user.name", "t"], root);
  git(["config", "commit.gpgsign", "false"], root);
  const write = async (p: string, c: string) => { await mkdir(dirname(join(root, p)), { recursive: true }); await writeFile(join(root, p), c); };
  await write("src/mod.ts", "export function mintToken() {}\n");
  await write("src/cold.ts", "export function coldChoke() {}\n");
  await write("src/other.ts", "export const x = 0;\n");
  git(["add", "-A"], root); git(["commit", "-q", "-m", "init"], root);
  for (let i = 0; i < 10; i++) {
    // Both files must actually CHANGE, or git records a one-file commit and the 2…BULK
    // concern band drops it — which would move `considered` and with it the cold reading.
    await write("src/mod.ts", `export function mintToken() { return ${i + 1}; }\n`);
    await write("src/other.ts", `export const x = ${i + 1};\n`);
    git(["add", "-A"], root); git(["commit", "-q", "-m", `edit ${i}`], root);
  }
  return root;
}

const HAZARD_TRANSITIONS = {
  mintToken: { from: "untrusted", to: "trusted", security: true, translates: "raw → branded" },
  coldChoke: { from: "untrusted", to: "trusted", security: true, translates: "raw → checked" },
};
const hazardCfg = (root: string) => cfg(root, {
  atlas: { charts: { untrusted: "raw", trusted: "safe" }, transitions: HAZARD_TRANSITIONS },
});
const hazardGraph = (claims: string[] = []) => graph([
  comp(".", { label: "Auth", claims, invariants: claims.length ? ["capability"] : undefined, why: "r" }),
  sym("mintToken", "src/mod.ts"), sym("coldChoke", "src/cold.ts"),
]);

test("atlas — a HOT tier-3 crossing is an inference hazard; a COLD one, measured, is not", async (t) => {
  const root = await hazardRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const { code, out } = await runCaptured(() => atlas(hazardCfg(root), hazardGraph(), "check"));
  assert.equal(code, 0, "a hazard is advisory — it must not move the verdict");
  assert.match(out, /INFERENCE HAZARD — 1 crossing\(s\)/);
  assert.match(out, /mintToken\s+untrusted → trusted — heat 100%/);
  assert.doesNotMatch(out, /coldChoke\s+untrusted → trusted — heat/, "9% is under the floor: measured, and not a hazard");
  assert.match(out, /never --check/, "the line says what it is not");

  const md = await readFile(join(root, "public", "atlas.md"), "utf8");
  assert.match(md, /### Inference hazards/);
  assert.match(md, /never affects `atlas --check`/);

  const rec: StatusRecord = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8"));
  assert.deepEqual(rec.atlas!.hazards, ["mintToken"], "the record carries the hazard set");
});

test("atlas — a HOT tier-2 crossing is NOT a hazard: the junction is declared, whatever the traffic", async (t) => {
  const root = await hazardRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const g = hazardGraph(['boundary "capability" at mintToken via guard "brand totality"']);
  const { code, out } = await runCaptured(() => atlas(hazardCfg(root), g, "check"));
  assert.equal(code, 0, out);
  assert.match(out, /heat █ 100%/, "still the hottest crossing on the map");
  assert.doesNotMatch(out, /INFERENCE HAZARD/, "a boundary claim answers the question once, for every reader");
  const rec: StatusRecord = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8"));
  assert.deepEqual(rec.atlas!.hazards, []);
});

test("atlas — an UNMEASURABLE tier-3 crossing is never a hazard (absence is not cold)", async (t) => {
  const root = await tmpProject({ "src/mod.ts": "export function mintToken() {}\nexport function coldChoke() {}\n" });
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const { code, out } = await runCaptured(() => atlas(hazardCfg(root), hazardGraph(), "check"));
  assert.equal(code, 0);
  assert.match(out, /heat —/);
  assert.doesNotMatch(out, /INFERENCE HAZARD/);
});

test("atlas --raise — a hazard opens ONE question keyed on the SYMBOL, and a second run opens none", async (t) => {
  const root = await hazardRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });
  _resetEvolutionMemo();
  const c = hazardCfg(root);
  const first = await runCaptured(() => atlas(c, hazardGraph(), "render", { raise: true, session: "s-abcabcabcabc" }));
  assert.match(first.out, /RAISE — 1 question\(s\) opened/);
  assert.match(first.out, /inference-hazard:mintToken/, "the key is the symbol — heat moves weekly and must not be in it");

  const again = await runCaptured(() => atlas(c, hazardGraph(), "render", { raise: true, session: "s-abcabcabcabc" }));
  assert.match(again.out, /already open/);
  assert.doesNotMatch(again.out, /RAISE — [1-9]\d* question\(s\) opened/);
});
