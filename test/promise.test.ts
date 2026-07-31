// promise.test.ts — the DERIVATION half of the PROMISE GRAPH (`coherence contract`).
// Locks the load-bearing, rot-prone logic: the GRAMMAR (the optional `crossing` clause, the
// `## zones` section, `lives in` residence), the GRADE doctrine (A/B/C/D/U as a total function
// of one record), and the reliance DOUBLE-ENTRY (covered/naked/same-zone/undeclared + the
// reliants posting). The pure cores are exercised directly with hand-built graphs (no git, no
// status file); the IO readers (zones off a spec) run against a temp project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBoundary, normalizeBoundaryClaim, claimKey } from "../src/boundary.ts";
import { parseZones } from "../src/walk.ts";
import { CLAIM_FORMS } from "../src/phrasebook.ts";
import { assemblePromiseModel, deriveGates, residenceOf, readZones } from "../src/promise.ts";
import type { Zone } from "../src/promise-model.ts";
import type { ClaimRecord, StatusRecord } from "../src/status.ts";
import type { FileStat } from "../src/tree.ts";
import { comp, fileNode, imp, graph, cfg, tmpProject, cleanup } from "./_helpers.ts";

const EMPTY: StatusRecord = { version: 1 };
const rec = (node: string, claim: string, kind: ClaimRecord["kind"], o: Partial<ClaimRecord> = {}): ClaimRecord =>
  ({ node, claim, kind, at: "2026-07-10T11:58:00.000Z", commit: "head111", tier: "fast", ...o });
const stats = (m: Record<string, number>): Map<string, FileStat> =>
  new Map(Object.entries(m).map(([k, lines]) => [k, { lines, hash: "" }]));

const ZONES: Zone[] = [{ name: "za", intent: "", inside: null }, { name: "zb", intent: "", inside: null }];

// ── GRAMMAR: the crossing clause, zones, residence ────────────────────────────────────

test("grammar — the boundary crossing clause parses (with and without), and OLD via-only lines are unchanged", () => {
  // Old form — no crossing: crossing is null, verb/oracle land in the right (now shifted) groups.
  const old = parseBoundary('boundary "kernel write" at writeClass via guard "totality"');
  assert.deepEqual(old, { inv: "kernel write", chokepoint: "writeClass", verb: "guard", oracle: "totality", crossing: null });

  // Crossing + via: the wall is captured, verb/oracle still resolve.
  const both = parseBoundary('boundary "raise trust" at query crossing served-untrusted -> owner-trusted via test "trust totality"');
  assert.deepEqual(both, {
    inv: "raise trust", chokepoint: "query", verb: "test", oracle: "trust totality",
    crossing: { from: "served-untrusted", to: "owner-trusted" },
  });

  // Crossing, NO via: a wall declared with no oracle (grade D later, but placed).
  const noVia = parseBoundary('boundary "wall" at S crossing a -> b');
  assert.deepEqual(noVia!.crossing, { from: "a", to: "b" });
  assert.equal(noVia!.verb, "");

  // Bare form still parses to no wall, no oracle.
  const bare = parseBoundary('boundary "x" at Choke');
  assert.deepEqual(bare, { inv: "x", chokepoint: "Choke", verb: "", oracle: "", crossing: null });
});

test("grammar — `## zones` parses in declared (trust) order, honoring `inside` and optional intents", () => {
  const spec = [
    "# Entry", "the intent line", "",
    "## zones",
    "- owner-trusted: full kernel access",
    "- served-untrusted inside owner-trusted: public reads + ingress",
    "- storage",                                   // bare — no intent, no parent
    "",
    "## works when", "- typechecks",
  ].join("\n");
  const zones = parseZones(spec);
  assert.deepEqual(zones.map((z) => z.name), ["owner-trusted", "served-untrusted", "storage"], "declared order IS trust order");
  assert.equal(zones[0].intent, "full kernel access");
  assert.equal(zones[1].inside, "owner-trusted", "`inside` nests");
  assert.deepEqual([zones[2].intent, zones[2].inside], ["", null], "a bare zone has empty intent and no parent");
  assert.deepEqual(parseZones("# X\nno zones section here"), [], "no section → no zones");
});

test("grammar — `lives in <zone>` is residence, and is a registered PASS form (never a U dialect gap)", async () => {
  assert.equal(residenceOf(["typechecks", "lives in owner-trusted"]), "owner-trusted");
  assert.equal(residenceOf(["x.ts exists at this node"]), null, "no residence claim → undeclared");
  // Registered in the phrasebook so verify grades it a PASS, not a skip (which would read as U).
  const form = CLAIM_FORMS.find((f) => f.name === "lives in");
  assert.ok(form, "a `lives in` claim form is registered");
  const m = form!.match("lives in owner-trusted");
  assert.ok(m, "it matches a residence line");
  const r = await form!.evaluate({} as never, m!);
  assert.equal(r.kind, "pass", "residence verifies as a pass, so it never grades as U");
});

test("grammar — readZones reads ONLY the entry spec's zones (single home)", async () => {
  const root = await tmpProject({
    "entry.spec.md": "# Entry\n\nintent\n\n## zones\n- top\n- low inside top\n",
    "sub/sub.spec.md": "# Sub\n\nintent\n\n## zones\n- ignored\n",   // a non-entry `## zones` is never read
  });
  try {
    const zones = await readZones(cfg(root, { entryDir: "." }));
    assert.deepEqual(zones.map((z) => z.name), ["top", "low"], "only the entry spec's zones, in order");
    assert.equal(zones[1].inside, "top");
  } finally { await cleanup(root); }
});

// ── GRADE doctrine (a total function of one record) ───────────────────────────────────

test("grade — A/B/C/D/U from constructed records; UNPLACED when a gate declares no crossing", () => {
  const claims = [
    'boundary "a" at CA via test "oa"',    // fresh machine pass → A
    'boundary "b" at CB via test "ob"',    // stale machine pass → B
    'boundary "c" at CC via guard "oc"',   // any guard pass → C
    'boundary "d" at CD via test "od"',    // a fail → D (verdict carries the fail)
    'boundary "u" at CU via guard "ou"',   // a skip → U (the unassessed floor)
    'boundary "n" at CN',                  // no oracle → D (declared, no evidence)
  ];
  const recBy = new Map<string, ClaimRecord>([
    [`N ${claims[0]}`, rec("N", claims[0], "pass", { commit: "head111" })],
    [`N ${claims[1]}`, rec("N", claims[1], "pass", { commit: "old000" })],
    [`N ${claims[2]}`, rec("N", claims[2], "pass", { commit: "head111" })],
    [`N ${claims[3]}`, rec("N", claims[3], "fail")],
    [`N ${claims[4]}`, rec("N", claims[4], "skip")],
    // claims[5] has no record at all
  ]);
  const g = deriveGates(claims, "N", recBy, "head111");
  assert.deepEqual(g.map((x) => x.grade), ["A", "B", "C", "D", "U", "D"]);
  assert.deepEqual([g[0].verdict, g[1].verdict, g[3].verdict, g[4].verdict], ["pass", "stale", "fail", "unknown"]);
  assert.equal(g[0].freshest, "2026-07-10T11:58:00.000Z", "a pass carries its stamp");
  assert.equal(g[1].freshest, "2026-07-10T11:58:00.000Z", "a stale pass is still a stamped pass");
  assert.equal(g[3].freshest, undefined, "a fail carries no freshest");
  assert.equal(g[0].crossing, null, "a gate with no crossing clause is UNPLACED (crossing null)");
});

// ── DERIVATION: components, mass/accounted, the reliance double-entry ──────────────────

test("assemble — components in spec-tree order (entry '.' first, then dir sort); mass + accounted from files/lines", () => {
  const g = graph([
    comp("b", { label: "B" }),
    comp(".", { label: "Entry", intent: "the root" }),
    comp("a", { label: "A", claims: ["x.ts exists at this node"] }),
    fileNode("a/x.ts", "a"), fileNode("a/y.ts", "a"),
  ]);
  const m = assemblePromiseModel(g, EMPTY, stats({ "a/x.ts": 10, "a/y.ts": 5 }), [], { commit: "h", dirty: false });
  assert.deepEqual(m.components.map((c) => c.dir), [".", "a", "b"], "entry first, then lexicographic");
  assert.equal(m.intent, "the root", "model intent is the entry component's");
  const a = m.components.find((c) => c.dir === "a")!;
  assert.deepEqual(a.mass, { files: 2, lines: 15 }, "mass = all files + their lines");
  assert.deepEqual(a.accounted, { files: 1, lines: 10 }, "accounted = only the claim-named file (x.ts) + its lines");
});

test("reliance — COVERED by a gate on the wall; the covering gate posts the reliant back (double-entry)", () => {
  const g = graph([
    comp(".", {}),
    comp("a", { label: "A", claims: ["lives in za"] }),
    comp("b", { label: "B", claims: ["lives in zb", 'boundary "wall" at S crossing za -> zb via guard "g"'] }),
    fileNode("a/x.ts", "a"), fileNode("b/y.ts", "b"),
  ], [imp("a/x.ts", "b/y.ts")]);
  const m = assemblePromiseModel(g, EMPTY, new Map(), ZONES, { commit: "h", dirty: false });
  const a = m.components.find((c) => c.dir === "a")!;
  assert.equal(a.zone, "za", "residence from `lives in`");
  assert.deepEqual(a.relies, [{ to: "b", crossing: { from: "za", to: "zb" }, via: "wall" }], "the za→zb reliance is covered by the wall gate");
  const wall = m.components.find((c) => c.dir === "b")!.gates[0];
  assert.deepEqual(wall.crossing, { from: "za", to: "zb" });
  assert.deepEqual(wall.reliants, ["a"], "the gate lists its reliant back — one fact, two postings");
});

test("reliance — NAKED (cross-zone, no gate), SAME-ZONE (never naked), UNDECLARED residence (crossing null)", () => {
  const mk = (aClaims: string[], bClaims: string[]) => {
    const g = graph([
      comp(".", {}),
      comp("a", { label: "A", claims: aClaims }),
      comp("b", { label: "B", claims: bClaims }),
      fileNode("a/x.ts", "a"), fileNode("b/y.ts", "b"),
    ], [imp("a/x.ts", "b/y.ts")]);
    return assemblePromiseModel(g, EMPTY, new Map(), ZONES, { commit: "h", dirty: false }).components.find((c) => c.dir === "a")!;
  };
  // Cross-zone, no gate anywhere on the wall → NAKED.
  assert.deepEqual(mk(["lives in za"], ["lives in zb"]).relies, [{ to: "b", crossing: { from: "za", to: "zb" }, via: null }]);
  // Same zone → a crossing to itself, via null, but NOT naked (from === to).
  assert.deepEqual(mk(["lives in za"], ["lives in za"]).relies, [{ to: "b", crossing: { from: "za", to: "za" }, via: null }]);
  // Undeclared residence at either end → crossing null (neither covered nor naked — a different exposure).
  assert.deepEqual(mk([], ["lives in zb"]).relies, [{ to: "b", crossing: null, via: null }]);
});

// ── record identity: the crossing clause never orphans a verdict ──────────────────────

test("normalization — the crossing clause is stripped from record identity; annotation never orphans a verdict (both directions, both layers)", () => {
  const bare = 'boundary "kernel write" at writeClass via test "totality"';
  const crossed = 'boundary "kernel write" at writeClass crossing agent -> storage via test "totality"';
  assert.equal(normalizeBoundaryClaim(crossed), bare, "stripping reconstructs the canonical claim");
  assert.equal(normalizeBoundaryClaim(bare), bare, "a crossing-less boundary is verbatim");
  assert.equal(normalizeBoundaryClaim("typechecks"), "typechecks", "a non-boundary claim passes through");
  const noVia = normalizeBoundaryClaim('boundary "w" at S crossing a -> b');
  assert.equal(noVia, 'boundary "w" at S', "crossing with no via strips to the bare form");

  // A record stored WITHOUT the crossing (pre-annotation verify run) is found by the
  // post-annotation claim — the gate keeps its earned A instead of dropping to D.
  const recBy = new Map<string, ClaimRecord>([[claimKey("N", bare), rec("N", bare, "pass", { commit: "head111" })]]);
  const g1 = deriveGates([crossed], "N", recBy, "head111");
  assert.equal(g1[0].grade, "A", "pre-crossing record matches the post-crossing claim");
  assert.equal(g1[0].verdict, "pass");
  // And the REVERSE: a record stored with the crossing is found by the bare claim.
  const recBy2 = new Map<string, ClaimRecord>([[claimKey("N", crossed), rec("N", crossed, "pass", { commit: "head111" })]]);
  const g2 = deriveGates([bare], "N", recBy2, "head111");
  assert.equal(g2[0].grade, "A", "post-crossing record matches the pre-crossing claim");
});
