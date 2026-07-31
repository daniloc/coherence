// promise.test.ts — the DERIVATION half of the PROMISE GRAPH (`coherence contract`/`review`).
// Locks the load-bearing, rot-prone logic: the GRAMMAR (the optional `crossing` clause, the
// `## zones` section, `lives in` residence), the GRADE doctrine (A/B/C/D/U as a total function
// of one record), the reliance DOUBLE-ENTRY (covered/naked/same-zone/undeclared + the reliants
// posting), the review DIFF (one test per event kind, blast + severity), and the ledger TEXT.
// The pure cores are exercised directly with hand-built graphs/models (no git, no status file);
// the IO readers (zones off a spec) run against a temp project.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseBoundary, normalizeBoundaryClaim, claimKey } from "../src/boundary.ts";
import { parseZones } from "../src/walk.ts";
import { CLAIM_FORMS } from "../src/phrasebook.ts";
import {
  assemblePromiseModel, deriveGates, residenceOf, readZones, promiseDiff, buildReview, formatLedger,
  derivePromiseBase, buildPromiseModel,
} from "../src/promise.ts";
import { buildGraph } from "../src/derive.ts";
import type { PromiseModel, PromiseComponent, PromiseGate, Reliance, Zone } from "../src/promise-model.ts";
import type { ClaimRecord, StatusRecord } from "../src/status.ts";
import type { FileStat } from "../src/tree.ts";
import { comp, fileNode, imp, graph, cfg, tmpProject, cleanup } from "./_helpers.ts";

const EMPTY: StatusRecord = { version: 1 };
const rec = (node: string, claim: string, kind: ClaimRecord["kind"], o: Partial<ClaimRecord> = {}): ClaimRecord =>
  ({ node, claim, kind, at: "2026-07-10T11:58:00.000Z", commit: "head111", tier: "fast", ...o });
const stats = (m: Record<string, number>): Map<string, FileStat> =>
  new Map(Object.entries(m).map(([k, lines]) => [k, { lines, hash: "" }]));

// ── hand-built model factories for the PURE diff (no graph, no status) ────────────────
const gate = (inv: string, o: Partial<PromiseGate> = {}): PromiseGate =>
  ({ inv, chokepoint: `${inv}CP`, verb: "test", oracle: "o", crossing: null, grade: "A", verdict: "pass", reliants: [], ...o });
const pcomp = (dir: string, o: Partial<PromiseComponent> = {}): PromiseComponent =>
  ({ label: dir, dir, intent: "", zone: null, gates: [], relies: [], mass: { files: 0, lines: 0 }, accounted: { files: 0, lines: 0 }, ...o });
const pmodel = (components: PromiseComponent[], o: Partial<PromiseModel> = {}): PromiseModel =>
  ({ root: "test", intent: "", generatedAt: "", head: "head111", dirty: false, zones: [], components, review: null, ...o });
const reliance = (to: string, o: Partial<Reliance> = {}): Reliance => ({ to, crossing: null, via: null, ...o });
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

// ── REVIEW: one test per event kind, blast, severity ──────────────────────────────────

test("diff — covered / withdrawn (blast = the gate's reliants at head / at base)", () => {
  const base = pmodel([pcomp("core", { gates: [gate("gone", { reliants: ["api"] })] })]);
  const head = pmodel([pcomp("core", { gates: [gate("fresh", { crossing: { from: "a", to: "b" }, reliants: ["ui"] })] })]);
  const evs = promiseDiff(head, base);
  const covered = evs.find((e) => e.kind === "covered")!;
  assert.equal(covered.inv, "fresh");
  assert.deepEqual(covered.blast, ["ui"], "covered blast = the new gate's head reliants");
  const withdrawn = evs.find((e) => e.kind === "withdrawn")!;
  assert.equal(withdrawn.inv, "gone");
  assert.deepEqual(withdrawn.blast, ["api"], "withdrawn blast = the vanished gate's BASE reliants (who lost the promise)");
});

test("diff — promoted / demoted follow the ordinal (A>B>C>D>U); demoted carries the reason + the blast", () => {
  const base = pmodel([pcomp("core", { gates: [gate("up", { grade: "D", verdict: "unknown" }), gate("down", { grade: "A", reliants: ["api", "ingress"] })] })]);
  const head = pmodel([pcomp("core", { gates: [gate("up", { grade: "A" }), gate("down", { grade: "D", verdict: "fail", reliants: ["api", "ingress"] })] })]);
  const evs = promiseDiff(head, base);
  const up = evs.find((e) => e.kind === "promoted")!;
  assert.deepEqual([up.from, up.to], ["D", "A"]);
  const down = evs.find((e) => e.kind === "demoted")!;
  assert.deepEqual([down.from, down.to], ["A", "D"]);
  assert.match(down.detail, /oracle now fails/, "the demotion reason rides in the detail");
  assert.deepEqual(down.blast, ["api", "ingress"], "demoted blast = the weakened gate's reliants");
});

test("diff — naked / sealed track a reliance crossing the uncovered↔covered boundary", () => {
  const nakedR = reliance("b", { crossing: { from: "za", to: "zb" }, via: null });
  const coveredR = reliance("b", { crossing: { from: "za", to: "zb" }, via: "wall" });
  const unassessableR = reliance("b");   // crossing null — undeclared residence
  // was covered, now naked → naked.
  const nakedEvs = promiseDiff(pmodel([pcomp("a", { relies: [nakedR] })]), pmodel([pcomp("a", { relies: [coveredR] })]));
  const naked = nakedEvs.find((e) => e.kind === "naked")!;
  assert.match(naked.detail, /reliance on b crosses za→zb/);
  assert.deepEqual([naked.from, naked.to], ["za", "zb"], "the wall rides in from/to");
  // was naked, now covered → sealed, naming the prior state.
  const fromNaked = promiseDiff(pmodel([pcomp("a", { relies: [coveredR] })]), pmodel([pcomp("a", { relies: [nakedR] })]));
  const s1 = fromNaked.find((e) => e.kind === "sealed")!;
  assert.match(s1.detail, /previously naked/, "the prior state is named");
  assert.match(s1.detail, /covered by "wall"/);
  // BROADENED: was UNASSESSABLE (undeclared residence, crossing null), now covered → sealed
  // too. A topology-establishing diff must not read as silent on exactly its coverage gains.
  const fromUnassessable = promiseDiff(pmodel([pcomp("a", { relies: [coveredR] })]), pmodel([pcomp("a", { relies: [unassessableR] })]));
  const s2 = fromUnassessable.find((e) => e.kind === "sealed")!;
  assert.match(s2.detail, /previously unassessable \(undeclared residence\)/);
  assert.match(s2.detail, /covered by "wall"/);
  // A reliance that ARRIVES covered (no base counterpart) stays quiet — nothing improved.
  const arrivedCovered = promiseDiff(pmodel([pcomp("a", { relies: [coveredR] })]), pmodel([pcomp("a")]));
  assert.equal(arrivedCovered.filter((e) => e.kind === "sealed").length, 0);
});

test("diff — placed: an existing gate's crossing goes null → declared; blast = the reliants the placement newly covers", () => {
  const base = pmodel([pcomp("core", { gates: [gate("wall", { crossing: null })] })]);
  const head = pmodel([pcomp("core", { gates: [gate("wall", { crossing: { from: "za", to: "zb" }, reliants: ["api"] })] })]);
  const evs = promiseDiff(head, base);
  const placed = evs.find((e) => e.kind === "placed")!;
  assert.ok(placed, "unplaced → placed emits a `placed` event");
  assert.equal(placed.inv, "wall");
  assert.match(placed.detail, /guards the za→zb crossing/, "the detail names the declared wall");
  assert.deepEqual(placed.blast, ["api"], "blast = reliants newly covered (the gate covered nothing while unplaced)");
  assert.equal(evs.filter((e) => e.kind === "covered").length, 0, "placement is NOT a new gate — no covered event");
  // Placement is independent of grade movement: same-grade gates emit placed alone.
  assert.equal(evs.filter((e) => e.kind === "promoted" || e.kind === "demoted").length, 0);
});

test("diff — arrived / razed / rezoned; a razed component's gates each report withdrawn too", () => {
  const base = pmodel([
    pcomp("core", { zone: "za" }),
    pcomp("legacy", { gates: [gate("g1", { reliants: ["core"] }), gate("g2")] }),   // vanishes
  ]);
  const head = pmodel([
    pcomp("core", { zone: "zb" }),   // rezoned
    pcomp("fresh"),                  // arrives
  ]);
  const evs = promiseDiff(head, base);
  assert.equal(evs.find((e) => e.kind === "arrived")!.comp, "fresh");
  const rezoned = evs.find((e) => e.kind === "rezoned")!;
  assert.deepEqual([rezoned.from, rezoned.to], ["za", "zb"]);
  assert.equal(evs.find((e) => e.kind === "razed")!.comp, "legacy");
  const withdrawns = evs.filter((e) => e.kind === "withdrawn").map((e) => e.inv).sort();
  assert.deepEqual(withdrawns, ["g1", "g2"], "each gate of the razed component reports withdrawn individually");
});

test("diff — severity puts the alarm cases first (demoted/naked/withdrawn/razed before promoted/…/arrived)", () => {
  const base = pmodel([pcomp("core", { gates: [gate("d", { grade: "A", reliants: ["x"] })] })]);
  const head = pmodel([
    pcomp("core", { gates: [gate("d", { grade: "D", verdict: "fail", reliants: ["x"] })] }),
    pcomp("new"),   // arrived — a mild, trailing event
  ]);
  const evs = promiseDiff(head, base);
  assert.equal(evs[0].kind, "demoted", "the alarm leads");
  assert.ok(evs.findIndex((e) => e.kind === "demoted") < evs.findIndex((e) => e.kind === "arrived"), "demoted sorts before arrived");

  // placed/sealed sit with the good-news family: after the alarms, before covered/arrived.
  const base2 = pmodel([pcomp("core", {
    gates: [gate("g1", { grade: "A", reliants: ["x"] }), gate("g2", { crossing: null })],
    relies: [reliance("lib", { crossing: { from: "za", to: "zb" }, via: null })],
  }), pcomp("lib")]);
  const head2 = pmodel([pcomp("core", {
    gates: [gate("g1", { grade: "D", verdict: "fail", reliants: ["x"] }), gate("g2", { crossing: { from: "za", to: "zb" } })],
    relies: [reliance("lib", { crossing: { from: "za", to: "zb" }, via: "g2" })],
  }), pcomp("lib"), pcomp("new")]);
  const evs2 = promiseDiff(head2, base2).map((e) => e.kind);
  assert.deepEqual(evs2, ["demoted", "placed", "sealed", "arrived"], "demoted first; placed/sealed good-news; arrived trails");
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

test("diff — a pure crossing BACKFILL yields placed (and possibly sealed/rezoned), never promoted/demoted", () => {
  // Same verify record at both ends; the only change is annotation. With normalized record
  // identity the grade is identical at base and head → NO grade events, only topology ones.
  const bare = 'boundary "w" at S via test "o"';
  const crossed = 'boundary "w" at S crossing za -> zb via test "o"';
  const status: StatusRecord = { version: 1, verify: {
    at: "", commit: "head111", dirty: false, tier: "fast", scope: null,
    claims: [rec("A", bare, "pass", { commit: "head111" })],
    coverage: { components: 0, claimed: 0, withWhy: 0, symbols: 0, documented: 0 },
    invariants: { total: 0, anchored: 0, gaps: [] }, narrative: null, jobs: 0, failures: 0,
  } };
  const mk = (claims: string[]) => assemblePromiseModel(
    graph([comp(".", {}), comp("a", { label: "A", claims })]),
    status, new Map(), ZONES, { commit: "head111", dirty: false });
  const evs = promiseDiff(mk([crossed, "lives in za"]), mk([bare]));
  assert.equal(evs.filter((e) => e.kind === "promoted" || e.kind === "demoted").length, 0,
    "no spurious grade events from pure annotation");
  assert.equal(evs.filter((e) => e.kind === "placed").length, 1, "the backfill reads as placement");
  assert.equal(evs.filter((e) => e.kind === "rezoned").length, 1, "…and the new residence as rezoning");
});

test("promote reason — U→D is honest: the claim parses again, but carries no verdict yet", () => {
  const base = pmodel([pcomp("core", { gates: [gate("g", { grade: "U", verdict: "unknown" })] })]);
  const head = pmodel([pcomp("core", { gates: [gate("g", { grade: "D", verdict: "unknown" })] })]);
  const up = promiseDiff(head, base).find((e) => e.kind === "promoted")!;
  assert.match(up.detail, /parses again — no verdict yet/, "a floor-exit does not claim evidence it lacks");
});

// ── the base worktree when the coherence root is a git SUBDIRECTORY ───────────────────

test("worktree (IO) — a coherence root that is a SUBDIRECTORY of the git repo derives base dirs aligned with head", async () => {
  // The repo top-level holds no config; the coherence root is repo/app. The base worktree
  // materializes the WHOLE repo, so the base config must load from <worktree>/app — loading
  // from the top would prefix every base dir with "app/" and turn EVERY review into a total
  // razed/arrived storm (the mnemion defect).
  const root = await tmpProject({
    "app/coherence.config.json": JSON.stringify({ outputDir: "public", codeExt: ["ts"] }),
    "app/root.spec.md": "# Root\n\nthe entry\n\n## works when\n\n- a.ts exists at this node\n",
    "app/a.ts": "export const A = 1;\n",
    "app/sub/sub.spec.md": "# Sub\n\na sub\n\n## works when\n\n- s.ts exists at this node\n",
    "app/sub/s.ts": "export const S = 1;\n",
  });
  try {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: root, stdio: "pipe" });
    git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
    git("add", "-A"); git("commit", "-qm", "base");

    const c = cfg(join(root, "app"));
    const headGraph = await buildGraph(c);
    const headModel = await buildPromiseModel(c, headGraph, EMPTY);
    assert.deepEqual(headModel.components.map((x) => x.dir), [".", "sub"], "head dirs are subdir-relative");

    // PROMISE base: dirs must align with head (no "app/" prefix) → a same-ref diff is steady.
    const pbase = await derivePromiseBase(c, "HEAD", EMPTY);
    assert.deepEqual(pbase.model.components.map((x) => x.dir), [".", "sub"], "base dirs align with head");
    assert.deepEqual(promiseDiff(headModel, pbase.model), [], "a no-change review is steady state, not a razed/arrived storm");
  } finally { await cleanup(root); }
});

// ── buildReview + formatLedger ────────────────────────────────────────────────────────

test("buildReview — head annotated with change (added/removed) and a populated review", () => {
  const base = pmodel([pcomp("core"), pcomp("legacy")]);
  const head = pmodel([pcomp("core"), pcomp("fresh")]);
  const m = buildReview(head, base, "base123", { added: 0, removed: 0, changed: 0 });
  assert.equal(m.review!.base, "base123");
  assert.equal(m.components.find((c) => c.dir === "fresh")!.change, "added", "a head-only district is added");
  const legacy = m.components.find((c) => c.dir === "legacy")!;
  assert.equal(legacy.change, "removed", "a base-only district is injected as removed");
  assert.equal(m.components.find((c) => c.dir === "core")!.change, undefined, "an unchanged district carries no flag");
});

test("formatLedger — deterministic masthead + one block per event, with the blast line when reliants are hit", () => {
  const base = pmodel([pcomp("core", { gates: [gate("write policy", { grade: "A", reliants: ["api"] })] })]);
  const head = pmodel([pcomp("core", { gates: [gate("write policy", { grade: "D", verdict: "fail", reliants: ["api"] })] })]);
  const m = buildReview(head, base, "base123", { added: 0, removed: 1, changed: 2 });
  const text = formatLedger(m);
  assert.match(text, /^contract test — head head111 vs base base123 · 1 event · outside \+0 −1 ~2/m, "the masthead carries head/base/count/outside");
  assert.match(text, /^DEMOTED   core: write policy/m, "KIND is padded; the comp: inv header");
  assert.match(text, /weakened from A to D — its oracle now fails\./, "the detail sentence");
  assert.match(text, /→ 1 reliant holds a degraded asset: api/, "the blast line when reliants hold a degraded asset");

  // A good-news event's blast reads as a GAIN, not a degradation.
  const placedBase = pmodel([pcomp("core", { gates: [gate("wall", { crossing: null })] })]);
  const placedHead = pmodel([pcomp("core", { gates: [gate("wall", { crossing: { from: "za", to: "zb" }, reliants: ["api"] })] })]);
  const placedText = formatLedger(buildReview(placedHead, placedBase, "b1", { added: 0, removed: 0, changed: 0 }));
  assert.match(placedText, /^PLACED    core: wall  za→zb/m);
  assert.match(placedText, /→ 1 reliant holds a strengthened asset: api/, "placed blast is a coverage gain");

  // A steady-state review prints almost nothing.
  const quiet = formatLedger(buildReview(pmodel([pcomp("core")]), pmodel([pcomp("core")]), "b0", { added: 0, removed: 0, changed: 0 }));
  assert.match(quiet, /0 events/);
  assert.match(quiet, /steady state/);
});
