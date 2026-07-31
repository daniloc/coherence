// panel.test.ts — the instrument panel's PURE core: light derivation (staleness
// degrades a pass, a fail stays the worst known truth, dialect gaps get their own
// mark), model assembly (worst-light-wins, unanchored invariants red), and the frame
// renderer (colors off → assertable plain text). The interactive loop is a thin
// shell over these; what can rot is here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, lightFor, humanAge, wrapText, renderFrame, initialUI, mastheadHeight } from "../src/panel.ts";
import type { StatusRecord, ClaimRecord } from "../src/status.ts";
import { comp, graph } from "./_helpers.ts";

const NOW = new Date("2026-07-10T12:00:00.000Z");
const rec = (node: string, claim: string, kind: ClaimRecord["kind"], o: Partial<ClaimRecord> = {}): ClaimRecord =>
  ({ node, claim, kind, at: "2026-07-10T11:58:00.000Z", commit: "aaaa111", tier: "fast", ...o });

const statusWith = (claims: ClaimRecord[], gaps: Array<{ comp: string; inv: string }> = []): StatusRecord => ({
  version: 1,
  verify: {
    at: "2026-07-10T11:58:00.000Z", commit: "aaaa111", dirty: false, tier: "fast", scope: null,
    lastFastAt: "2026-07-10T11:58:00.000Z",
    claims,
    coverage: { components: 1, claimed: 1, withWhy: 1, symbols: 0, documented: 0 },
    invariants: { total: gaps.length, anchored: 0, gaps },
    narrative: null, jobs: 0, failures: 0,
  },
});

test("humanAge — seconds, minutes, hours, days", () => {
  assert.equal(humanAge("2026-07-10T11:59:20.000Z", NOW), "40s");
  assert.equal(humanAge("2026-07-10T11:55:00.000Z", NOW), "5m");
  assert.equal(humanAge("2026-07-10T06:00:00.000Z", NOW), "6h");
  assert.equal(humanAge("2026-07-07T12:00:00.000Z", NOW), "3d");
});

test("lightFor — no record is 'none'; a pass at another commit degrades to STALE; a fail never does", () => {
  assert.equal(lightFor(undefined, "bbbb222", NOW).kind, "none");
  const pass = rec("A", "c", "pass");
  assert.equal(lightFor(pass, "aaaa111", NOW).kind, "pass", "same commit: still green");
  assert.equal(lightFor(pass, "bbbb222", NOW).kind, "stale", "other commit: degraded, not re-badged");
  const fail = rec("A", "c", "fail");
  assert.equal(lightFor(fail, "bbbb222", NOW).kind, "fail", "an old fail is still the worst known truth");
});

test("lightFor — a dialect-gap skip carries the gap mark", () => {
  const l = lightFor(rec("A", "gibberish", "skip", { detail: "no verifier (dialect gap)" }), "aaaa111", NOW);
  assert.equal(l.kind, "skip");
  assert.equal(l.gap, true);
});

test("buildModel — worst light wins: a fail reddens the component; unanchored invariants redden it too", () => {
  const g = graph([
    comp("a", { label: "A", intent: "does a", claims: ["x.ts exists at this node", 'boundary "inv-a" at chokeA via test "oracle a"'], invariants: ["inv-a"], why: "w" }),
    comp("b", { label: "B", intent: "does b", claims: ["y.ts exists at this node"], invariants: ["inv-b"], why: "w" }),
  ]);
  const status = statusWith(
    [rec("A", "x.ts exists at this node", "pass"), rec("A", 'boundary "inv-a" at chokeA via test "oracle a"', "fail", { detail: "chokepoint gone" }), rec("B", "y.ts exists at this node", "pass")],
    [{ comp: "B", inv: "inv-b" }],
  );
  const m = buildModel(g, status, { commit: "aaaa111", dirty: false }, NOW);
  const A = m.comps.find((c) => c.label === "A")!;
  const B = m.comps.find((c) => c.label === "B")!;
  assert.equal(A.light, "fail", "claim fail → red");
  assert.equal(A.boundaries.length, 1);
  assert.equal(A.boundaries[0].chokepoint, "chokeA");
  assert.equal(B.light, "fail", "unanchored invariant → red even with green claims");
  assert.deepEqual(B.unanchored, ["inv-b"]);
  assert.equal(m.totals.pass, 2);
  assert.equal(m.totals.fail, 1);
});

test("buildModel — a record from before a boundary gained its crossing clause still lights the annotated row", () => {
  // Same amnesia class as the merge: the panel's record lookup was raw-string keyed, so a
  // purely declarative `crossing` annotation turned a claim's earned light into "none".
  const bare = 'boundary "inv-a" at chokeA via guard "oracle a"';
  const crossed = 'boundary "inv-a" at chokeA crossing agent -> storage via guard "oracle a"';
  const g = graph([comp("a", { label: "A", intent: "does a", claims: [crossed], invariants: ["inv-a"], why: "w" })]);
  const m = buildModel(g, statusWith([rec("A", bare, "pass")]), { commit: "aaaa111", dirty: false }, NOW);
  const A = m.comps.find((c) => c.label === "A")!;
  assert.equal(A.boundaries[0].light.kind, "pass", "the pre-annotation verdict must still be found through claimKey");
});

test("buildModel — with no verify record, unanchored invariants fall back to a static parse", () => {
  const g = graph([comp("a", { label: "A", claims: ['boundary "anchored" at sym'], invariants: ["anchored", "orphan"], why: "w" })]);
  const m = buildModel(g, { version: 1 }, { commit: null, dirty: false }, NOW);
  assert.deepEqual(m.comps[0].unanchored, ["orphan"]);
  assert.equal(m.comps[0].light, "fail");
});

test("buildModel — all green at the current commit reads green; the same record at a new HEAD reads stale", () => {
  const g = graph([comp("a", { label: "A", claims: ["x.ts exists at this node"], why: "w" })]);
  const status = statusWith([rec("A", "x.ts exists at this node", "pass")]);
  assert.equal(buildModel(g, status, { commit: "aaaa111", dirty: false }, NOW).comps[0].light, "pass");
  assert.equal(buildModel(g, status, { commit: "bbbb222", dirty: false }, NOW).comps[0].light, "stale");
});

test("renderFrame — the list frame carries the masthead facts and one row per component, plain text", () => {
  const g = graph([
    comp("a", { label: "Hive", intent: "owns the data", claims: ['boundary "kw" at writeClass via test "wpt"'], invariants: ["kw"], why: "w" }),
    comp("b", { label: "Session", intent: "speaks MCP", claims: ["s.ts exists at this node"], why: "w" }),
  ]);
  const status = statusWith([rec("Hive", 'boundary "kw" at writeClass via test "wpt"', "pass"), rec("Session", "s.ts exists at this node", "pass")]);
  const lines = renderFrame(buildModel(g, status, { commit: "aaaa111", dirty: false }, NOW), initialUI(false), { cols: 100, rows: 30 }, false, NOW);
  const text = lines.join("\n");
  assert.match(text, /test/);                    // graph.root from the helper
  assert.match(text, /●2/);                      // two green claims in the masthead
  assert.match(text, /Hive/);
  assert.match(text, /Session/);
  assert.match(text, /atlas: not run/);          // honest about what hasn't run
  assert.match(text, /watch:off/);
});

test("renderFrame — the component view renders the invariant table with chokepoint, verb, and the guard's human-eye flag", () => {
  const g = graph([comp("a", {
    label: "Routing", intent: "dispatch",
    claims: ['boundary "inert" at inertHeaders via test "inertness totality"', 'boundary "gating" at denyUnless via guard "bearer totality"'],
    invariants: ["inert", "gating"], why: "the rationale text",
  })]);
  const status = statusWith([
    rec("Routing", 'boundary "inert" at inertHeaders via test "inertness totality"', "pass"),
    rec("Routing", 'boundary "gating" at denyUnless via guard "bearer totality"', "pass"),
  ]);
  const ui = { ...initialUI(false), view: "comp" as const, cursor: 0 };
  const text = renderFrame(buildModel(g, status, { commit: "aaaa111", dirty: false }, NOW), ui, { cols: 110, rows: 30 }, false, NOW).join("\n");
  assert.match(text, /"inert"/);
  assert.match(text, /inertHeaders/);
  assert.match(text, /via test/);
  assert.match(text, /human eye/, "a via-guard row must carry the needs-human-eye flag");
});

test("renderFrame — the why view is the wrapped rationale", () => {
  const why = "This boundary exists because a shipped bug let served markup run same-origin.";
  const g = graph([comp("a", { label: "A", claims: [], why })]);
  const ui = { ...initialUI(false), view: "why" as const, cursor: 0 };
  const text = renderFrame(buildModel(g, { version: 1 }, { commit: null, dirty: false }, NOW), ui, { cols: 80, rows: 24 }, false, NOW).join("\n");
  assert.match(text, /A — why/);
  assert.match(text, /shipped bug/);
});

test("wrapText — wraps at width and preserves paragraph breaks", () => {
  const out = wrapText("alpha beta gamma delta\n\nsecond para", 11);
  assert.ok(out.every((l) => l.length <= 11));
  assert.ok(out.includes(""), "paragraph break preserved");
  assert.equal(out[out.length - 1], "second para");
});

// ── THE ENERGY STRIP — the work ledger at masthead altitude ──────────────────────────
//
// The panel builds from the graph + the status record and re-runs NOTHING (module header):
// cost and heat are read out of the record other commands filed, never measured here. And
// the strip is absent when there is nothing to say — unlike atlas/drift, which nag with
// "not run" because they name a key the operator can press.

const withCost = (s: StatusRecord, cost: NonNullable<StatusRecord["verify"]>["cost"]): StatusRecord =>
  ({ ...s, verify: { ...s.verify!, cost } });

const atlasSection = (crossings: Array<{ sym: string; heat?: number }>): StatusRecord["atlas"] => ({
  at: "2026-07-10T11:58:00.000Z", commit: "aaaa111",
  tiers: { enshrined: 1, checked: 1, convention: 1 },
  crossings: crossings.map((c) => ({
    sym: c.sym, from: "a", to: "b", tier: 2, security: true, note: "n", translates: "t",
    present: true, pending: false, heat: c.heat,
  })),
  drift: [], dangling: [], overclaimed: [], tier3Security: [],
});

const oneComp = () => graph([comp("a", { label: "Root", claims: ["x.ts exists at this node"], why: "w" })]);

test("buildModel — the cost vector maps straight from the record, head first, nothing re-timed", () => {
  const status = withCost(statusWith([rec("Root", "x.ts exists at this node", "pass")]), {
    totalMs: 2840,
    claims: [
      { node: "Root", claim: 'passes test "alpha"', ms: 2500, source: "report" },
      { node: "Root", claim: 'passes test "beta"', ms: 300, source: "report" },
    ],
  });
  const m = buildModel(oneComp(), status, { commit: "aaaa111", dirty: false }, NOW);
  assert.equal(m.cost?.totalMs, 2840);
  assert.equal(m.cost?.top?.ms, 2500);
  assert.equal(m.cost?.top?.claim, 'passes test "alpha"');
  assert.equal(m.cost?.top?.node, "Root");
});

test("buildModel — heat maps hottest-first, and crossings with NO reading are dropped, not zeroed", () => {
  const status: StatusRecord = { ...statusWith([]), atlas: atlasSection([
    { sym: "warm", heat: 0.3 }, { sym: "unmeasured" }, { sym: "hottest", heat: 0.9 },
  ]) };
  const m = buildModel(oneComp(), status, { commit: "aaaa111", dirty: false }, NOW);
  assert.deepEqual(m.atlas?.heat?.map((h) => h.sym), ["hottest", "warm"]);
  assert.ok(!m.atlas?.heat?.some((h) => h.sym === "unmeasured"), "an unmeasurable crossing is not a cold one");
});

test("buildModel — a record with no cost and no heat yields neither, so the strip has nothing to draw", () => {
  const m = buildModel(oneComp(), statusWith([rec("Root", "x.ts exists at this node", "pass")]), { commit: "aaaa111", dirty: false }, NOW);
  assert.equal(m.cost, undefined);
  assert.equal(m.atlas, undefined);
  assert.equal(mastheadHeight(m), 3);
});

test("renderFrame — the masthead carries the energy strip when the record has cost and heat", () => {
  const status: StatusRecord = {
    ...withCost(statusWith([rec("Root", "x.ts exists at this node", "pass")]), {
      totalMs: 12400,
      claims: [{ node: "Hive", claim: 'passes test "big domain"', ms: 4100, source: "report" }],
    }),
    atlas: atlasSection([{ sym: "writeClass", heat: 0.42 }, { sym: "mintToken", heat: 0.1 }]),
  };
  const m = buildModel(oneComp(), status, { commit: "aaaa111", dirty: false }, NOW);
  assert.equal(mastheadHeight(m), 4, "the strip takes a row, and the scroll math must know it");
  const text = renderFrame(m, initialUI(false), { cols: 120, rows: 30 }, false, NOW).join("\n");
  assert.match(text, /energy/);
  assert.match(text, /cost 12\.4s/);
  assert.match(text, /top 4\.1s Hive/);
  assert.match(text, /heat [▁▂▃▄▅▆▇█]{2} writeClass 42%/);
});

test("renderFrame — no cost and no heat means NO strip: there is no `energy: not run` nag", () => {
  const m = buildModel(oneComp(), statusWith([rec("Root", "x.ts exists at this node", "pass")]), { commit: "aaaa111", dirty: false }, NOW);
  const text = renderFrame(m, initialUI(false), { cols: 100, rows: 30 }, false, NOW).join("\n");
  assert.doesNotMatch(text, /energy/);
  // atlas and drift DO nag, because pressing a/d is the fix — the strip has no such key
  assert.match(text, /atlas: not run/);
});

test("renderFrame — cost alone (no atlas yet) still draws the strip, with only what is known", () => {
  const status = withCost(statusWith([rec("Root", "x.ts exists at this node", "pass")]), {
    totalMs: 640, claims: [{ node: "Root", claim: "typechecks", ms: 600, source: "wall" }],
  });
  const text = renderFrame(buildModel(oneComp(), status, { commit: "aaaa111", dirty: false }, NOW), initialUI(false), { cols: 100, rows: 30 }, false, NOW).join("\n");
  assert.match(text, /energy\s+cost 640ms/);
  assert.doesNotMatch(text, /energy.*heat/);
});
