// index.test.ts — THE INDEX: the returning human's page.
//
// Two layers, following the pattern decompose.test.ts's header sets out:
//   · the PURE derivations (the cap idiom, the four darknesses, the journal's novelty
//     gate, the gate collapse) driven from hand-built graphs and records — deterministic,
//     no git, no filesystem.
//   · the GLUE (frame resolution, the cursor round-trip, the refusal on a corrupt cursor)
//     driven through a REAL throwaway git repo and the real CLI, because every one of
//     those is a statement about git and about files, and an injected fake would be
//     asserting my own mock.
//
// WHAT IS ACTUALLY AT RISK HERE, which is what these test. The Index shows nothing it
// derived itself, so the classic bugs are not arithmetic — they are HONESTY bugs:
//   · a source that could not be read rendering as an empty section (green-by-absence);
//   · a list silently truncated so the page looks complete;
//   · a denominator of 0 rendering identically to a denominator of 500;
//   · a frame that quietly resolves to nothing, so "no change" means "no comparison";
//   · a corrupt cursor read as an absent one, so the page calls itself a FIRST LOOK for a
//     project that has an index — and re-reports every old impasse as news.
// Each of those is a test below, and each of them has a matching prohibition in
// src/index-model.ts's header.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  capList, CAPS, resolveFrame, darknesses, buildJournal, buildMap, structuralView,
  INDEX_HTML, INDEX_JSON, crossingOwners, type IndexModel, type IndexCrossing,
} from "../src/index-model.ts";
import { renderIndex, formatIndexSummary } from "../src/render-index.ts";
import { assemblePromiseModel } from "../src/promise.ts";
import { diffGraphs } from "../src/structural.ts";
import { _resetEvolutionMemo } from "../src/evolution.ts";
import type { DecisionRecord } from "../src/decisions.ts";
import type { StatusRecord, ClaimRecord } from "../src/status.ts";
import { cfg, comp, graph, sym, fileNode, tmpProject, cleanup } from "./_helpers.ts";

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = promisify(execFile);
const git = (args: string[], cwd: string) => spawnSync("git", args, { cwd, encoding: "utf8" });

// ── the cap idiom (raise.ts's, applied to a render) ───────────────────────────────────

test("capList — the withheld tail is a NUMBER the caller cannot forget, not an absence", () => {
  const xs = ["a", "b", "c", "d", "e"];
  const c = capList(xs, 2);
  assert.deepEqual(c.shown, ["a", "b"]);
  assert.equal(c.withheld, 3, "3 were held back and the report has to be able to say so");
  assert.equal(c.total, 5, "the denominator survives the truncation — that is the whole point");
  // Under the cap, nothing is withheld and `total` still states the population.
  const all = capList(xs, 9);
  assert.equal(all.withheld, 0);
  assert.equal(all.total, 5);
  // A cap of 0 is "count only" — a section that collapses BY DESIGN still reports its size.
  const none = capList(xs, 0);
  assert.deepEqual(none.shown, []);
  assert.equal(none.withheld, 5);
  assert.equal(none.total, 5);
});

// ── the frame ─────────────────────────────────────────────────────────────────────────

async function frameRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coh-index-frame-"));
  git(["init", "-q"], root);
  git(["config", "user.email", "t@test"], root);
  git(["config", "user.name", "t"], root);
  git(["config", "commit.gpgsign", "false"], root);
  const write = async (p: string, c: string) => {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), c);
  };
  for (const i of [1, 2, 3]) {
    await write(`src/f${i}.ts`, `export const x${i} = ${i};\n`);
    git(["add", "-A"], root);
    git(["commit", "-q", "-m", `c${i}`], root);
  }
  return root;
}

test("FRAME — no git repository is a FIRST LOOK that says why, never a silent empty delta", async (t) => {
  const root = await tmpProject({});
  t.after(() => cleanup(root));
  const f = resolveFrame(cfg(root), {});
  assert.equal(f.kind, "first");
  assert.equal(f.commit, null);
  assert.match(f.why, /no git repository/i, "the page must NAME the missing source; 'nothing changed' over an unread history is green-by-absence");
});

test("FRAME — the ORDER is --since > cursor > tag, and a tag that IS HEAD is not a frame", async (t) => {
  const root = await frameRepo();
  t.after(() => cleanup(root));
  const c = cfg(root);
  const head = git(["rev-parse", "HEAD"], root).stdout.trim();
  const first = git(["rev-parse", "HEAD~2"], root).stdout.trim();

  // 1. explicit --since wins over everything.
  const explicit = resolveFrame(c, { since: first, cursor: head });
  assert.equal(explicit.kind, "since");
  assert.equal(explicit.commits, 2, "two commits sit between HEAD~2 and HEAD");

  // 2. the CURSOR is the default — literally "since you last looked".
  const cursor = resolveFrame(c, { cursor: first });
  assert.equal(cursor.kind, "cursor");
  assert.equal(cursor.commits, 2);
  assert.ok(cursor.at, "the frame carries the cut the journal's novelty gate joins on");

  // 3. with no cursor, a tag standing BEFORE head is the fallback.
  git(["tag", "v1"], root); // on HEAD
  assert.equal(resolveFrame(c, {}).kind, "first",
    "a tag that IS HEAD frames nothing — this was the briefed default and it degenerates exactly here");
  git(["tag", "-d", "v1"], root);
  git(["tag", "v0", first], root);
  const tagged = resolveFrame(c, {});
  assert.equal(tagged.kind, "tag");
  assert.equal(tagged.ref, "v0");
  assert.equal(tagged.commits, 2);
});

test("FRAME — a ref that does not resolve REFUSES to be a frame, and says so by name", async (t) => {
  const root = await frameRepo();
  t.after(() => cleanup(root));
  // THE FAILURE THIS CATCHES: a cursor from a rebased or squashed history names a commit
  // git no longer has. Framing against it would produce an empty diff that reads as
  // "nothing changed" — a comparison that never happened, reported as a result.
  const stale = resolveFrame(cfg(root), { cursor: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" });
  assert.equal(stale.kind, "first");
  assert.match(stale.why, /no longer has/i);

  const bogus = resolveFrame(cfg(root), { since: "no-such-ref" });
  assert.equal(bogus.kind, "first");
  assert.match(bogus.why, /does not resolve/);
  assert.match(bogus.why, /no-such-ref/, "the refusal names the ref the operator typed");
});

// ── the four darknesses ───────────────────────────────────────────────────────────────

const darkGraph = () => graph([
  comp("src", {
    label: "Core",
    claims: ['a.ts exists at this node', 'boundary "guarded" at gate via guard "g"'],
    invariants: ["guarded", "unwatched"],
    refutations: ["guarded: broke the gate -> claim went red by name"],
  }),
  fileNode("src/a.ts", "src"),
  fileNode("src/b.ts", "src"),
  { ...sym("documented", "src/a.ts"), parent: "f:src/a.ts", prose: "what it does" },
  { ...sym("bare", "src/a.ts"), parent: "f:src/a.ts" },
]);

test("TRUST — the four darknesses are named separately and each carries its own denominator", () => {
  const ds = darknesses(cfg("/x"), darkGraph(), { paths: ["src/a.ts", "README.md", "scripts/x.sh"], considered: 9 });
  assert.deepEqual(ds.map((d) => d.key), ["unwitnessed", "unclaimed", "undocumented", "unvisited"],
    "unwitnessed LEADS: it is the only reading here that separates a green claim from an unfalsifiable one");

  const by = new Map(ds.map((d) => [d.key, d]));
  // unwitnessed: 2 declared invariants, 1 carries a `## refutations` entry.
  assert.deepEqual([by.get("unwitnessed")!.dark, by.get("unwitnessed")!.total], [1, 2]);
  assert.ok(by.get("unwitnessed")!.worst.shown.some((w) => w.includes("unwatched")));
  // unclaimed: 2 files, only a.ts is named by a claim.
  assert.deepEqual([by.get("unclaimed")!.dark, by.get("unclaimed")!.total], [1, 2]);
  assert.deepEqual(by.get("unclaimed")!.worst.shown, ["src/b.ts"]);
  // undocumented: 2 symbols, one has prose (derive.ts's isDocumented, the shared predicate).
  assert.deepEqual([by.get("undocumented")!.dark, by.get("undocumented")!.total], [1, 2]);
  // unvisited: 3 churned paths, 1 of them the graph owns.
  assert.deepEqual([by.get("unvisited")!.dark, by.get("unvisited")!.total], [2, 3]);

  // AND THEY ARE NEVER MERGED. A single "dark region" figure would average four problems
  // with four different repairs into one number that prescribes nothing.
  assert.equal(new Set(ds.map((d) => d.what)).size, 4, "each darkness states what dark MEANS for it");
});

test("TRUST — an unread history makes `unvisited` UNMEASURED, never zero", () => {
  const [unvisited] = darknesses(cfg("/x"), darkGraph(), null).filter((d) => d.key === "unvisited");
  assert.equal(unvisited.total, null, "0 of 0 and 0 of 500 must not render alike — floor.ts, in the harness's own words");
  assert.equal(unvisited.dark, 0);
  assert.match(unvisited.unmeasurable ?? "", /not zero/i, "the reading has to say it is UNMEASURED rather than clean");
});

// ── the journal's novelty gate ────────────────────────────────────────────────────────

const rec = (o: Partial<DecisionRecord> & { id: string; kind: DecisionRecord["kind"]; at: string }): DecisionRecord => ({
  session: "s-1", agent: "a", job: "j", branch: "main", commit: "abc", dirty: false,
  chose: `chose ${o.id}`, over: [], because: "why", ...o,
});

test("JOURNAL — novelty GATES the order, severity only sorts what survived, and settled collapses to counts", () => {
  const records = [
    rec({ id: "old-block", kind: "blocked", at: "2026-01-01T00:00:00Z" }),
    rec({ id: "new-block", kind: "blocked", at: "2026-06-02T00:00:00Z" }),
    rec({ id: "open-q", kind: "conjecture", at: "2026-06-03T00:00:00Z", discriminatedBy: "the test" }),
    rec({ id: "answered", kind: "conjecture", at: "2026-01-04T00:00:00Z", discriminatedBy: "t" }),
    rec({ id: "r1", kind: "resolution", at: "2026-06-05T00:00:00Z", supersedes: "answered" }),
    rec({ id: "dec", kind: "decision", at: "2026-01-06T00:00:00Z" }),
  ];
  const j = buildJournal(records, 2, 0, "2026-06-01T00:00:00Z");

  // A three-day-old impasse the reader has already seen is not NEWS however severe — but it
  // is still standing, so it sinks rather than disappearing.
  assert.deepEqual(j.blocked.shown.map((e) => e.id), ["new-block", "old-block"]);
  assert.deepEqual(j.blocked.shown.map((e) => e.news), [true, false]);
  assert.equal(j.news.blocked, 1);
  assert.equal(j.totals.blocked, 2, "the count is of everything standing, not of the news");

  assert.deepEqual(j.open.shown.map((e) => e.id), ["open-q"], "a resolved conjecture is not open");
  assert.deepEqual(j.settled, { resolved: 1, dismissed: 0, retracted: 0, inFrame: 1 },
    "settled work is a COUNT — that is what settled means");
  assert.equal(j.decisions.total, 1);
});

test("JOURNAL — novelty compares INSTANTS, not ISO text: a `-04:00` frame against `Z` records", () => {
  // THE DEFECT THIS CATCHES, and it had shipped. The frame's stamp comes from git (`%cI`,
  // which carries a numeric offset) and a journal record's comes from the journal (`Z`).
  // Compared as strings, the lexicographic walk reaches the SECONDS field before it ever
  // reaches the offset — so `02:54:53Z` sorted after `02:49:18-04:00` (= 06:49:18Z) and
  // four hours of standing history was reported as news. Measured on the consuming project:
  // 26 of 182 standing records were flagged NEW, including BOTH of its impasses.
  const cut = "2026-07-31T02:49:18-04:00"; // 06:49:18Z
  const before = rec({ id: "before", kind: "decision", at: "2026-07-31T02:54:53.044Z" });
  const after = rec({ id: "after", kind: "decision", at: "2026-07-31T07:01:00.000Z" });
  assert.ok(before.at >= cut, "the fixture must actually reproduce the string-compare trap or this test checks nothing");

  const j = buildJournal([before, after], 1, 0, cut);
  const news = new Map(j.decisions.shown.map((e) => [e.id, e.news]));
  assert.equal(news.get("before"), false, "written four hours BEFORE the frame opened — standing, not news");
  assert.equal(news.get("after"), true);
  assert.equal(j.news.decisions, 1);
});

test("JOURNAL — with NO frame, nothing is news: a first look has no news by definition", () => {
  const j = buildJournal([rec({ id: "b", kind: "blocked", at: "2026-06-02T00:00:00Z" })], 1, 0, null);
  assert.equal(j.news.blocked, 0);
  assert.equal(j.blocked.shown[0].news, false, "the alternative — flagging all of history as new — is the noise that kills a since-I-last-looked view");
});

test("JOURNAL — an unreadable journal line is COUNTED, never silently dropped", () => {
  const j = buildJournal([rec({ id: "d", kind: "decision", at: "2026-01-01T00:00:00Z" })], 1, 4, null);
  assert.equal(j.totals.unreadable, 4);
});

test("JOURNAL — every standing record gets a MARK, and `shown` never over-promises", () => {
  // THE TIMELINE IS DRAWN FROM `marks`, and a timeline drawn from the capped lists would be
  // a picture of the cap: measured on the consuming project, the lists carry 28 of 182
  // standing records. So time and novelty are complete here and only TEXT is capped —
  // `shown` is read off the same cap the lists use, so a mark can never advertise a reveal
  // the page cannot perform.
  const many = Array.from({ length: CAPS.decisions + 6 }, (_, i) =>
    rec({ id: `d${i}`, kind: "decision", at: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
  const j = buildJournal([...many, rec({ id: "b", kind: "blocked", at: "2026-02-01T00:00:00Z" })], 1, 0, null);

  assert.equal(j.marks.length, j.totals.decisions + j.totals.blocked + j.totals.open,
    "every standing record is plotted — the axis must not describe a subset it does not name");
  assert.equal(j.marks.filter((m) => m.shown).length, CAPS.decisions + 1,
    "exactly the records whose text the page carries are openable");
  assert.deepEqual(new Set(j.marks.filter((m) => m.shown).map((m) => m.id)),
    new Set([...j.decisions.shown, ...j.blocked.shown].map((e) => e.id)),
    "`shown` is the cap's own answer, not a second spelling of it");
  const ordered = j.marks.map((m) => m.at);
  assert.deepEqual(ordered, [...ordered].sort(), "marks are oldest-first so the render never has to sort");
});

test("JOURNAL — every list is capped and the tail is stated", () => {
  const many = Array.from({ length: CAPS.blocked + 5 }, (_, i) =>
    rec({ id: `b${i}`, kind: "blocked", at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
  const j = buildJournal(many, 1, 0, null);
  assert.equal(j.blocked.shown.length, CAPS.blocked);
  assert.equal(j.blocked.withheld, 5);
  assert.equal(j.blocked.total, CAPS.blocked + 5);
});

// ── the MAP ───────────────────────────────────────────────────────────────────────────

/** A graph with three boundary claims, and a status record that grades them apart. */
function mapFixture(verdicts: Array<ClaimRecord["kind"]>, commit: string | null) {
  const claims = [
    'boundary "fresh" at f via test "t-fresh"',
    'boundary "aging" at a via test "t-aging"',
    'boundary "broken" at b via test "t-broken"',
  ];
  const g = graph([comp("src", { label: "Core", claims, invariants: ["fresh", "aging", "broken"] })]);
  const status: StatusRecord = {
    version: 1,
    verify: {
      at: "2026-06-01T00:00:00Z", commit, dirty: false, tier: "full", scope: null,
      claims: claims.map((claim, i) => ({
        node: "Core", claim, kind: verdicts[i], at: "2026-06-01T00:00:00Z", commit, tier: "full" as const,
      })),
      coverage: { components: 1, claimed: 1, withWhy: 0, symbols: 0, documented: 0 },
      invariants: { total: 3, anchored: 3, gaps: [] },
      narrative: null, jobs: 0, failures: 0,
    },
  };
  return { g, status };
}

test("MAP — the greens collapse to a COUNT; a breach and an unassessed gate each earn a row", () => {
  // HEAD matches the record's commit, so a pass is grade A (fresh).
  const { g, status } = mapFixture(["pass", "pass", "fail"], "head1");
  const pm = assemblePromiseModel(g, status, new Map(), [], { commit: "head1", dirty: false });
  const m = buildMap(cfg("/x"), g, pm, status, "head1", null);

  assert.equal(m.gatesTotal, 3);
  assert.equal(m.gatesClean, 2, "two machine oracles ran and passed — collapsed");
  assert.deepEqual(m.gates.shown.map((x) => x.inv), ["broken"]);
  assert.equal(m.gates.shown[0].verdict, "fail");
});

test("MAP — a STALE record does not flood the page: an aging green (grade B) collapses too", () => {
  // THE MEASUREMENT THAT FORCED THIS. The record is filed at another commit — the ordinary
  // state of any tree with uncommitted work — so every passing verdict degrades to
  // stale/B at once. Listing them individually produced 47 rows carrying one bit between
  // them on the first real run (see index-model.ts's collapse comment).
  const { g, status } = mapFixture(["pass", "pass", "pass"], "old");
  const pm = assemblePromiseModel(g, status, new Map(), [], { commit: "head2", dirty: false });
  const m = buildMap(cfg("/x"), g, pm, status, "head2", null);

  assert.equal(m.grades.B, 3, "the fixture must actually produce aging greens or this test checks nothing");
  assert.equal(m.gatesClean, 3);
  assert.equal(m.gates.total, 0);
  // AND THE STALENESS IS NOT LOST — it is stated once, where it belongs, as a fact about
  // the RECORD rather than repeated as a fact about each gate.
  assert.equal(m.components[0].grades.B, 3);
});

test("MAP — a project with no atlas reading gets NULL, so the render can say nothing was read", () => {
  const { g, status } = mapFixture(["pass", "pass", "pass"], "h");
  const pm = assemblePromiseModel(g, status, new Map(), [], { commit: "h", dirty: false });
  const m = buildMap(cfg("/x"), g, pm, status, "h", null);
  assert.equal(m.atlas, null, "an ABSENT atlas section must not be indistinguishable from a graded one with zero flags");
  assert.equal(m.crossings.total, 0);
});

// ── the TRAJECTORY ────────────────────────────────────────────────────────────────────

test("TRAJECTORY — the ledger counts LOSSES separately, and every list states its tail", () => {
  const before = graph([comp("src", {
    label: "Core",
    claims: ['boundary "kept" at k via test "t"', 'boundary "dropped" at d via test "t2"'],
    invariants: ["kept", "dropped"],
  })]);
  const after = graph([comp("src", {
    label: "Core",
    claims: ['boundary "kept" at k2 via test "t"', 'boundary "gained" at g via test "t3"'],
    invariants: ["kept", "gained"],
  })]);
  const s = structuralView(diffGraphs(before, after));
  assert.equal(s.invRemoved.total, 1);
  assert.equal(s.invAdded.total, 1);
  assert.equal(s.boundaryRemoved.total, 1);
  assert.equal(s.boundaryRewired.total, 1, "the kept invariant moved chokepoint — a rewire, not a loss");
  assert.equal(s.losses, 2, "a removed invariant AND its removed anchor are two losses");
  assert.ok(s.changes > s.losses);
});

// ── the render ────────────────────────────────────────────────────────────────────────

/** The smallest model the renderer accepts, with one deliberately UNREAD source. */
const modelWith = (over: Partial<IndexModel> = {}): IndexModel => ({
  project: "p", intent: "an intent", generatedAt: "2026-06-01 00:00Z",
  head: { commit: "abc1234", dirty: false },
  frame: { kind: "first", ref: null, commit: null, at: null, commits: null, why: "no prior index and no tags in this repository." },
  sources: [
    { name: "graph", ok: true, detail: "1 component(s)" },
    { name: ".coherence/status.json — atlas", ok: false, detail: "no atlas reading recorded — nothing was read." },
  ],
  map: {
    components: [], zones: [], gates: capList([], CAPS.gates), gatesClean: 0, gatesTotal: 0,
    grades: { A: 0, B: 0, C: 0, D: 0, U: 0 }, crossings: capList([], CAPS.crossings), atlas: null,
    darknesses: darknesses(cfg("/x"), darkGraph(), null),
  },
  journal: {
    blocked: capList([], CAPS.blocked), open: capList([], CAPS.open), decisions: capList([], CAPS.decisions),
    marks: [],
    settled: { resolved: 0, dismissed: 0, retracted: 0, inFrame: 0 },
    totals: { blocked: 0, open: 0, decisions: 0, records: 0, sessions: 0, unreadable: 0 },
    news: { blocked: 0, open: 0, decisions: 0 },
  },
  trajectory: { structural: null, structuralWhy: "no frame", loc: null, mass: null, drift: null },
  empty: false,
  ...over,
});

test("RENDER — an UNREAD source and an UNMEASURED reading both say so on the page", () => {
  const html = renderIndex(modelWith());
  assert.match(html, /UNREAD/, "a source that could not be read must be visible; a blank section reads as health");
  assert.match(html, /UNMEASURED/, "an unmeasurable denominator renders as such, never as 0");
  assert.match(html, /nothing was read, not because there are no crossings/,
    "the empty crossings table must state WHY it is empty");
});

test("RENDER — the page is SELF-CONTAINED and carries no forbidden ornament", () => {
  const html = renderIndex(modelWith());
  // Self-contained: a strict offline artifact, like every other render this harness emits.
  assert.doesNotMatch(html, /<script/i, "no script: the page is a readout, not an application");
  assert.doesNotMatch(html, /src\s*=\s*["']https?:/i);
  assert.doesNotMatch(html, /<link\b/i, "no external stylesheet or font");
  // The form is a spec sheet, not a dashboard. These are the ornaments that were ruled out
  // by name, and a regression here is a regression in the brief rather than in the code.
  for (const banned of [/border-radius/, /box-shadow/, /linear-gradient/, /radial-gradient/, /@keyframes/, /transition\s*:/]) {
    assert.doesNotMatch(html, banned, `the Index must carry no ${banned.source}`);
  }
  assert.match(html, /ui-monospace/, "monospace throughout — everything on the page is tabular");
  assert.match(html, /prefers-color-scheme: dark/, "light and dark are both first-class");
});

test("RENDER — severity is encoded as TEXT first, so the page survives greyscale", () => {
  const { g, status } = mapFixture(["fail", "pass", "pass"], "h");
  const pm = assemblePromiseModel(g, status, new Map(), [], { commit: "h", dirty: false });
  const map = buildMap(cfg("/x"), g, pm, status, "h", null);
  const html = renderIndex(modelWith({ map }));
  // The MARK column is the encoding; colour only reinforces it. If the distinction
  // vanished without colour it was never encoded — which is the actual test of the rule.
  assert.match(html, /class="mk alarm">!!</, "an alarm row carries a text mark, not only a colour");
  assert.match(html, /FAIL/, "the verdict is spelled out beside its colour");
  assert.match(html, />U<|>D<|>C<|>B<|>A</, "the grade letter always prints — the colour is redundancy");
});

test("RENDER — the withheld tail appears in the page, never a silent truncation", () => {
  const many = Array.from({ length: CAPS.blocked + 3 }, (_, i) =>
    rec({ id: `b${i}`, kind: "blocked", at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
  const html = renderIndex(modelWith({ journal: buildJournal(many, 1, 0, null) }));
  assert.match(html, /3 more impasse\(s\) not shown/);
  assert.match(html, new RegExp(`${CAPS.blocked + 3} in total`));
});

// ── the MAP as a DIAGRAM ──────────────────────────────────────────────────────────────
//
// THE PAGE THIS REPLACED was a wall of tables, and the verdict on it was that it taught
// nothing. The reference now is the Prius energy monitor: three boxes and the arrows
// between them explain a drivetrain with no documentation at all. These assert that the
// picture actually CARRIES the four things it claims to encode — and that each of them
// survives greyscale, which is the only reason they are shape and weight rather than hue.

const xing = (o: Partial<IndexCrossing> & { sym: string; from: string; to: string }): IndexCrossing =>
  ({ tier: 2, security: false, present: true, heat: 0.1, owner: null, ...o });

const widths = (svg: string) =>
  [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));

test("DIAGRAM — regions are boxes, crossings are arrows, and the GUARD'S NAME labels each one", () => {
  const crossings = [
    xing({ sym: "requireAuth", from: "public-web", to: "authed-user", security: true, heat: 0.9 }),
    xing({ sym: "OwnedScope", from: "authed-user", to: "patient", tier: 1, security: true, heat: 0.2 }),
    xing({ sym: "runWithRetry", from: "patient", to: "model-provider", heat: 0.02 }),
  ];
  const html = renderIndex(modelWith({
    map: { ...modelWith().map, crossings: capList(crossings, CAPS.crossings) },
  }));
  const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
  assert.ok(svg.length > 500, "an empty <svg> would satisfy every assertion below");

  // Every region is a labelled box, and every crossing is a named arrow. The count is the
  // point: a diagram that silently drops an edge is worse than a table that lists it.
  for (const r of ["public-web", "authed-user", "patient", "model-provider"]) {
    assert.match(svg, new RegExp(`>${r}</text>`), `region ${r} must be drawn`);
  }
  for (const c of crossings) assert.match(svg, new RegExp(`>${c.sym}</text>`), `${c.sym} must label its arrow`);
  assert.equal((svg.match(/<rect /g) ?? []).length, 4 + 2 * crossings.length,
    "four region boxes, plus a background plate AND a (hidden) selection ring per edge label");

  // HEAT IS LINE WEIGHT. The hottest crossing draws the thickest line, and the order of the
  // widths is the order of the heats — that is the whole "current flowing" encoding.
  const w = widths(svg).slice(0, 3);
  assert.ok(w[0] > w[1] && w[1] > w[2], `heat must order the line weights, got ${w.join(",")}`);

  // TIER IS LINE TREATMENT, not colour: the stronger the guarantee, the more continuous the
  // line. tier-1 (enshrined) is solid, so it carries NO dash array at all.
  const lines = [...svg.matchAll(/<line [^>]*>/g)].map((m) => m[0]).slice(0, 3);
  assert.equal(lines.length, 3, "one line per crossing, in the model's own order");
  assert.doesNotMatch(lines[1], /stroke-dasharray/,
    "the ENSHRINED crossing draws solid — a distinction that vanishes in greyscale was never encoded");
  assert.match(lines[0], /stroke-dasharray="7 4"/, "a totality-checked crossing draws dashed");
  assert.match(lines[2], /stroke-dasharray="7 4"/);

  // SECURITY IS A DRAWN MARK. Two security crossings plus the legend's sample = three.
  assert.equal((svg.match(/l4\.5,-4\.5 l4\.5,4\.5 l-4\.5,4\.5 Z/g) ?? []).length, 3,
    "a security crossing carries a shape, so it survives a black-and-white printer");

  // AND THE LEGEND ONLY NAMES WHAT IS ON THE PAGE. `convention` has no subjects in this
  // fixture, so teaching the word here would be teaching a vocabulary the data does not use.
  assert.match(svg, />enshrined</);
  assert.match(svg, />totality-checked</);
  assert.doesNotMatch(svg, />convention</);
});

test("DIAGRAM — with no crossings the Map SAYS SO; it never draws an empty frame", () => {
  const html = renderIndex(modelWith());
  assert.doesNotMatch(html, /<svg/, "an empty diagram would read as a system with no boundaries");
  assert.match(html, /NO CROSSING DIAGRAM/);
  assert.match(html, /the shape is UNREAD, not absent/,
    "unread and absent are different facts and the tab must not merge them");
});

test("DIAGRAM — a CYCLE in the region graph terminates, and every crossing is still drawn", () => {
  // The layering is a longest-path relaxation, which does not converge on a cycle. It is
  // bounded by the region count instead of guarded by a DAG check, because a cyclic trust
  // graph is a REAL shape: the diagram must draw something honest for it, not refuse.
  const crossings = [
    xing({ sym: "aToB", from: "a", to: "b" }),
    xing({ sym: "bToC", from: "b", to: "c" }),
    xing({ sym: "cToA", from: "c", to: "a" }),
    xing({ sym: "selfA", from: "a", to: "a", tier: 3, present: false }),
  ];
  const html = renderIndex(modelWith({
    map: { ...modelWith().map, crossings: capList(crossings, CAPS.crossings) },
  }));
  for (const c of crossings) assert.match(html, new RegExp(`>${c.sym}`), `${c.sym} must survive the cycle`);
  assert.match(html, />selfA DANGLING</, "a chokepoint no longer in source says so on its own arrow");
  assert.match(html, /stroke-dasharray="1.5 3"/, "a convention-tier crossing draws dotted");
});

// ── the page: three tabs, one visible, and no dead reveals ────────────────────────────

// ── the ORGAN ROSTER: the join, and the order that teaches ────────────────────────────
//
// THE DIAGRAM SHOWED THE PLUMBING AND HID THE ORGANS. `authed-user`, `storage`,
// `public-egress` are region names — true, and they say nothing about what the system is
// for. These test the two things that changed: the JOIN that says which component owns each
// guarded crossing, and the ORDER (perimeter before interior) that makes the roster read as
// a statement rather than a list. Both are honesty tests again, not arithmetic ones: the
// failure modes are claiming an owner the data does not support, and reporting "owns none"
// for a project where nothing was ever measured.

/**
 * A project with a real perimeter: three components, four graded crossings, and one guard
 * (`ghostGuard`) whose symbol is in NO component — the shape that makes the join degenerate.
 */
function organFixture() {
  const g = graph([
    comp(".", { label: "entry", intent: "The door: every request lands here first.", claims: [], invariants: [] }),
    comp("shared/auth", { label: "auth", intent: "Sessions and passkeys, and the only place a token is minted.", claims: [], invariants: [] }),
    comp("shared/ids", { label: "ids", intent: "Compile-only brands. Never crosses a wire.", claims: [], invariants: [] }),
    fileNode("server.ts", "."),
    fileNode("shared/auth/auth.ts", "shared/auth"),
    fileNode("shared/ids/ids.ts", "shared/ids"),
    sym("requireAuth", "server.ts", "f:server.ts"),
    sym("serveJson", "server.ts", "f:server.ts"),
    sym("verifySession", "shared/auth/auth.ts", "f:shared/auth/auth.ts"),
    sym("UserId", "shared/ids/ids.ts", "f:shared/ids/ids.ts"),
  ]);
  const xs = ["requireAuth", "serveJson", "verifySession", "ghostGuard"];
  const status: StatusRecord = {
    version: 1,
    atlas: {
      at: "2026-06-01T00:00:00Z", commit: "h",
      tiers: { enshrined: 0, checked: 4, convention: 0 },
      crossings: xs.map((sym, i) => ({
        sym, from: "public-web", to: "authed-user", tier: 2, security: false,
        note: "", translates: "", present: sym !== "ghostGuard", pending: false, heat: 0.1 * (i + 1),
      })),
      drift: [], dangling: ["ghostGuard"], overclaimed: [], tier3Security: [],
    },
  };
  const pm = assemblePromiseModel(g, status, new Map(), [], { commit: "h", dirty: false });
  return buildMap(cfg("/x"), g, pm, status, "h", null);
}

test("ROSTER — every guard resolves to the ORGAN that owns it, and the intent prose comes with it", () => {
  const m = organFixture();
  const owner = new Map(m.crossings.shown.map((c) => [c.sym, c.owner]));
  // The join is the graph's OWN symbol → file → component parentage crossed with the atlas
  // record. Nothing here is a new source and nothing is a second spelling of ownership.
  assert.equal(owner.get("requireAuth"), "entry");
  assert.equal(owner.get("serveJson"), "entry");
  assert.equal(owner.get("verifySession"), "auth");

  const by = new Map(m.components.map((c) => [c.label, c]));
  assert.deepEqual(by.get("entry")!.guards, ["requireAuth", "serveJson"]);
  assert.deepEqual(by.get("auth")!.guards, ["verifySession"]);
  assert.deepEqual(by.get("ids")!.guards, [], "a component owning no crossing is INTERIOR, not broken");

  // AND THE SENTENCE TRAVELS WITH THE ROW. The intent line is the best human-written prose
  // in any of these projects and the Index used to bury it behind a drill-down.
  assert.equal(by.get("auth")!.intent, "Sessions and passkeys, and the only place a token is minted.");
});

test("ROSTER — the ORDER is derived: perimeter first, most-held first, interior last", () => {
  const m = organFixture();
  assert.deepEqual(m.components.map((c) => c.label), ["entry", "auth", "ids"],
    "entry holds 2 crossings, auth 1, ids none — and that is the reading order");
  const guards = m.components.map((c) => c.guards.length);
  assert.deepEqual([...guards].sort((a, b) => b - a), guards, "the counts must never rise as you read down");
  // ALPHABETICAL WOULD HAVE ORDERED BY AN ACCIDENT OF NAMING. If the sort ever degrades to
  // that, this fixture says so out loud: alphabetical here is auth, entry, ids.
  assert.notDeepEqual(m.components.map((c) => c.label), ["auth", "entry", "ids"]);
});

test("ROSTER — a guard no component owns says WHY, and is never given an arbitrary owner", () => {
  const m = organFixture();
  const ghost = m.crossings.shown.find((c) => c.sym === "ghostGuard")!;
  assert.equal(ghost.owner, null, "inventing an owner for an unresolvable guard is the one thing this must not do");
  assert.match(ghost.ownerWhy ?? "", /no component owns a symbol named/);
  assert.match(ghost.ownerWhy ?? "", /DANGLING/, "the atlas already grades this state and the roster says so in its words");
  // AND IT COUNTS TOWARD NOBODY'S PERIMETER — the alternative (silently attributing it to
  // the entry component) would inflate one organ's perimeter with a symbol that is not there.
  assert.equal(m.components.reduce((n, c) => n + c.guards.length, 0), 3,
    "three of the four crossings are owned; the fourth is owned by no one and stays that way");

  // THE OTHER DEGENERATION: one name, two components. Neither owns it more than the other,
  // so it is AMBIGUOUS and it says which two — picking one would be inventing a fact.
  const amb = crossingOwners(
    [{ sym: "handle", present: true }],
    new Map([["handle", new Set(["a", "b"])]]),
    new Map([["a", "Alpha"], ["b", "Beta"]]),
  ).get("handle")!;
  assert.equal(amb.owner, null);
  assert.match(amb.why ?? "", /AMBIGUOUS/);
  assert.match(amb.why ?? "", /Alpha, Beta/);
});

test("ROSTER — with NO atlas the perimeter is UNREAD, never `0 of N own a crossing`", () => {
  // THE GREEN-BY-ABSENCE TRAP, in its newest hiding place. This harness's own repo has four
  // components and no atlas config at all, so every `guards` array is empty — and reporting
  // that as "4 of 4 are interior" would be the page asserting a measurement nobody took.
  const { g, status } = mapFixture(["pass", "pass", "pass"], "h");
  const pm = assemblePromiseModel(g, status, new Map(), [], { commit: "h", dirty: false });
  const map = buildMap(cfg("/x"), g, pm, status, "h", null);
  assert.equal(map.atlas, null);
  assert.deepEqual(map.components[0].guards, []);

  const html = renderIndex(modelWith({ map }));
  assert.match(html, /The perimeter is UNREAD/);
  assert.doesNotMatch(html, /own no graded crossing/,
    "an unmeasured perimeter must not borrow the sentence a measured one earns");
  assert.doesNotMatch(html, /class="bhead"/, "and it must not draw bands it has no reading to fill");
});

test("ROSTER — the intent prose is at GLANCE level, not behind a drill-down", () => {
  const html = renderIndex(modelWith({ map: organFixture() }));
  const map = html.slice(html.indexOf('id="map"'), html.indexOf('id="journal"'));
  const roster = map.slice(map.indexOf('class="roster"'));
  const drill = map.indexOf('class="drill"');
  assert.ok(map.indexOf('class="roster"') < drill && drill !== -1,
    "the roster precedes the drill strip: the prose is on the first paint, not one click down");
  for (const line of ["The door: every request lands here first.",
    "Sessions and passkeys, and the only place a token is minted.",
    "Compile-only brands. Never crosses a wire."]) {
    assert.ok(roster.includes(line), `the roster must carry: ${line}`);
  }
  // ONE BLOCK, NOT N. Fourteen organs are fourteen rows and one object; the ≤7-objects rule
  // is about things a reader orients among, and the two bands live inside the single roster.
  assert.equal((map.match(/class="roster"/g) ?? []).length, 1);
  // The band labels are lower-case in the markup and upper-cased by `text-transform`, so
  // this asserts the STRING the page carries rather than the one a screenshot shows.
  assert.match(roster, /class="bhead">perimeter /);
  assert.match(roster, /class="bhead">interior /);
  assert.match(roster, /own no graded crossing/);
  assert.match(roster, /reading of the shape, not a gap to close/,
    "an interior component is a READING, and the page must not let it read as a defect");
});

test("ROSTER — selection works BOTH ways with no script, and no control points at nothing", () => {
  const html = renderIndex(modelWith({ map: organFixture() }));
  assert.doesNotMatch(html, /<script/i, "the whole interaction is :checked plus a sibling combinator");

  // ONE radio group: a selection is one thing at a time, which is what makes "dim the rest"
  // mean anything. Checkboxes would allow "auth and entry and ids" and no highlight at all.
  assert.doesNotMatch(html, /name="[a-z]*sel"[^>]*type="checkbox"/);
  const group = [...html.matchAll(/name="orgsel" id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(group.includes("sel-all"), "a reset, checked in the markup, so the reader can get the whole map back");

  // EVERY CONTROL HAS A RULE AND EVERY RULE HAS A CONTROL — the journal timeline's dead-click
  // prohibition, applied to the map. A label pointing at an id with no styling behind it
  // looks exactly like one that works.
  for (const id of group.filter((x) => x !== "sel-all")) {
    assert.ok(html.includes(`<label for="${id}"`), `#${id} has no control that selects it`);
    assert.ok(html.includes(`#${id}:checked`), `#${id} is selectable and changes nothing`);
  }
  for (const m of html.matchAll(/<label for="([og]-[^"]+)"/g)) {
    assert.ok(group.includes(m[1]), `a label points at #${m[1]}, which is in no selection group`);
  }

  // ORGAN → ITS GUARDS IN THE PICTURE. Selecting `entry` lights the two crossings it owns.
  assert.match(html, /#o-_:checked ~ \.figure \.cx-requireAuth,#o-_:checked ~ \.figure \.cx-serveJson\{opacity:1\}/);
  // GUARD → ITS ORGAN. Selecting `verifySession` marks auth's row AND reveals the sentence.
  assert.match(html, /#g-verifySession:checked ~ \.own-verifySession\{display:block\}/);
  assert.match(html, /#g-verifySession:checked ~ \.roster \.org-shared_auth\{/);
  assert.match(html, /<p class="own own-verifySession">.*<b>auth<\/b> <span class="dim">owns this crossing/);
  // …and a guard nobody owns says that instead, rather than marking an arbitrary row.
  assert.match(html, /<p class="own own-ghostGuard">.*no organ owns this crossing/);
  assert.doesNotMatch(html, /#g-ghostGuard:checked ~ \.roster \.org-/);

  // THE HIGHLIGHT IS NOT COLOUR. The rest fades (a tone, which greyscale keeps) and the
  // selected guard gains a drawn RING — either alone survives a black-and-white printer.
  assert.match(html, /#map:has\(\.msel:checked\) \.cx \{ opacity: \.13; \}/);
  assert.match(html, /class="ring"/);
  // AND PRINT REOPENS EVERYTHING: paper has no selection state.
  assert.match(html, /#map:has\(\.msel:checked\) \.cx \{ opacity: 1 !important; \}/);
});

test("RENDER — THREE TABS, one visible, each linkable by hash, and no script anywhere", () => {
  const html = renderIndex(modelWith());
  for (const id of ["map", "journal", "trajectory"]) {
    assert.match(html, new RegExp(`<section class="view" id="${id}">`), `${id} is a section, addressable as #${id}`);
    assert.match(html, new RegExp(`href="#${id}"`), `${id} has a tab that links to it`);
  }
  // The other two tabs must be genuinely hidden — not merely below a fold, which is the
  // failure the whole rewrite exists to undo.
  assert.match(html, /\.view \{ display: none;/);
  assert.match(html, /\.view:target \{ display: block; \}/);
  assert.match(html, /body:not\(:has\(\.view:target\)\) #map \{ display: block; \}/,
    "with no hash the Map is the default — the tab state has to exist before the first click");
  assert.doesNotMatch(html, /<script/i, "the switching is :target and checkboxes: this is a document, not an application");
});

test("RENDER — every openable mark has a rule, and every rule has a mark: no dead clicks", () => {
  // THE FAILURE THIS CATCHES. The reveal is one generated CSS rule per record, and the
  // marks are generated from `journal.marks`. If those two lists ever disagree, a reader
  // clicks a mark and nothing happens — a page that silently refuses to show what it
  // advertised, which is the same class of lie as a table that looks complete.
  const records = Array.from({ length: CAPS.decisions + 4 }, (_, i) =>
    rec({ id: `d-${i}`, kind: "decision", at: `2026-04-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
  const j = buildJournal([...records, rec({ id: "d-blk", kind: "blocked", at: "2026-04-20T00:00:00Z" })], 3, 0, null);
  const html = renderIndex(modelWith({ journal: j }));

  const rules = new Set([...html.matchAll(/#e-([\w-]+):checked ~ \.detail \.d-\1\{/g)].map((m) => m[1]));
  const labels = new Set([...html.matchAll(/<label for="e-([\w-]+)" class="mkr/g)].map((m) => m[1]));
  const openable = new Set(j.marks.filter((m) => m.shown).map((m) => m.id));
  assert.ok(openable.size > 0, "the fixture must produce openable marks or this test is vacuous");
  assert.deepEqual(labels, openable, "exactly the records whose text is carried are clickable");
  assert.deepEqual(rules, openable, "and each of those has the rule that reveals it");

  // A WITHHELD RECORD IS STILL PLOTTED — as a tick that cannot be clicked. The timeline
  // never hides that the cap ran, and never offers a reveal it cannot perform.
  const held = j.marks.filter((m) => !m.shown).length;
  assert.equal(held, 4);
  assert.equal((html.match(/class="mkr decision held"/g) ?? []).length, 4);
  assert.match(html, /4 more decision\(s\) not shown/);
});

test("RENDER — the Index grades NOTHING: no health glyph is reachable at the terminal", () => {
  // The vacuity oracle proves this for a degenerate project; this proves it for a RICH one,
  // which is the case that oracle cannot reach. A render command has no standing to
  // pronounce a project healthy, so the glyph must be absent by construction, not by luck.
  const { g, status } = mapFixture(["pass", "pass", "pass"], "h");
  const pm = assemblePromiseModel(g, status, new Map(), [], { commit: "h", dirty: false });
  const lines = formatIndexSummary(modelWith({ map: buildMap(cfg("/x"), g, pm, status, "h", null) }), "out/_index.html");
  assert.ok(lines.length > 3, "the summary must actually say something or this assertion is vacuous");
  assert.ok(!lines.join("\n").includes("✓"), "a ✓ here would assert a verdict this command never took");
});

// ── the glue: the CLI, the artifacts, and the cursor round-trip ───────────────────────

const PROJECT = {
  "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: ".", codeExt: ["ts"] }),
  "app.spec.md": "# App\n\nThe root.\n\n## invariants\n\n- guarded\n\n## works when\n\n- a.ts exists at this node\n- boundary \"guarded\" at gate via guard \"g\"\n",
  "a.ts": "export const gate = 1;\n",
};

async function cliRepo(): Promise<string> {
  const root = await tmpProject(PROJECT);
  git(["init", "-q"], root);
  git(["config", "user.email", "t@test"], root);
  git(["config", "user.name", "t"], root);
  git(["config", "commit.gpgsign", "false"], root);
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "one"], root);
  return root;
}

test("`coherence index` writes BOTH the page and the model, and the page is a function of it", async (t) => {
  const root = await cliRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });

  const r = await run(process.execPath, [CLI_PATH, "index"], { cwd: root });
  assert.match(r.stdout, /^index: /m);
  const json = JSON.parse(await readFile(join(root, "public", INDEX_JSON), "utf8")) as IndexModel;
  const html = await readFile(join(root, "public", INDEX_HTML), "utf8");
  assert.ok(html.length > 2000, "an index that rendered nothing would pass every other assertion here");
  // THE PURITY CLAIM, checked rather than asserted: re-render the committed model and it
  // must be byte-identical. Anything the page knows that the model does not is unverifiable.
  assert.equal(renderIndex(json), html, "the render must be a pure function of index.json");
});

test("`coherence index` frames the SECOND run against the FIRST run's head — the cursor round-trip", async (t) => {
  const root = await cliRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });

  const first = await run(process.execPath, [CLI_PATH, "index"], { cwd: root });
  assert.match(first.stdout, /FIRST LOOK/, "no prior index and no tags: there is nothing to frame against, and it says so");

  // A second commit, then a second run: the frame must now be the FIRST run's HEAD.
  const head1 = git(["rev-parse", "--short", "HEAD"], root).stdout.trim();
  await writeFile(join(root, "b.ts"), "export const y = 2;\n");
  git(["add", "-A"], root);
  git(["commit", "-q", "-m", "two"], root);

  const second = await run(process.execPath, [CLI_PATH, "index"], { cwd: root });
  assert.match(second.stdout, new RegExp(`frame since ${head1}`), "the cursor is the previous run's head — literally since you last looked");
  const json = JSON.parse(await readFile(join(root, "public", INDEX_JSON), "utf8")) as IndexModel;
  assert.equal(json.frame.kind, "cursor");
  assert.equal(json.frame.commits, 1);
});

test("`coherence index` REFUSES a corrupt cursor rather than calling the page a first look", async (t) => {
  // AN UNREADABLE MEMORY IS NOT AN EMPTY ONE (floor.ts). Defaulting past a truncated
  // index.json would retitle the page "FIRST LOOK — nothing to frame against" for a project
  // that HAS an index, and every standing impasse would be re-reported as news — the exact
  // noise that makes a since-I-last-looked view stop being read.
  const root = await cliRepo();
  t.after(() => { _resetEvolutionMemo(); return cleanup(root); });

  await run(process.execPath, [CLI_PATH, "index"], { cwd: root });
  await writeFile(join(root, "public", INDEX_JSON), '{"head": {"commit"');

  const r = await run(process.execPath, [CLI_PATH, "index"], { cwd: root })
    .then(() => ({ code: 0, stdout: "", stderr: "" }), (e: { code: number; stdout: string; stderr: string }) => e);
  assert.equal(r.code, 2, "an instrument that cannot read its own memory reports; it does not guess");
  assert.match(r.stderr, /\[floor\]/);
  assert.match(r.stderr, /DOES NOT PARSE AS JSON/);
  assert.equal(await readFile(join(root, "public", INDEX_JSON), "utf8"), '{"head": {"commit"',
    "the refusal must not write — a run that repaired the file would turn one broken run into every run after it");
});
