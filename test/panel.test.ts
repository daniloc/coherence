// panel.test.ts — the instrument panel's PURE core: light derivation (staleness
// degrades a pass, a fail stays the worst known truth, dialect gaps get their own
// mark), model assembly (worst-light-wins, unanchored invariants red), and the frame
// renderer (colors off → assertable plain text). The interactive loop is a thin
// shell over these; what can rot is here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, lightFor, humanAge, wrapText, renderFrame, initialUI } from "../src/panel.ts";
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
