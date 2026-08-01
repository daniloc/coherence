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
  INDEX_HTML, INDEX_JSON, type IndexModel,
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

test("JOURNAL — with NO frame, nothing is news: a first look has no news by definition", () => {
  const j = buildJournal([rec({ id: "b", kind: "blocked", at: "2026-06-02T00:00:00Z" })], 1, 0, null);
  assert.equal(j.news.blocked, 0);
  assert.equal(j.blocked.shown[0].news, false, "the alternative — flagging all of history as new — is the noise that kills a since-I-last-looked view");
});

test("JOURNAL — an unreadable journal line is COUNTED, never silently dropped", () => {
  const j = buildJournal([rec({ id: "d", kind: "decision", at: "2026-01-01T00:00:00Z" })], 1, 4, null);
  assert.equal(j.totals.unreadable, 4);
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
