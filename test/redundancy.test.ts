// redundancy.test.ts — the UNDECLARED-parity detector. The failure it exists to catch is
// the one no claim covers: two spellings of one enumerated domain, nothing tying them
// together, and a divergence that only surfaces when a human notices a number looks wrong.
//
// The load-bearing test in this file is the NEGATIVE CONTROL: a detector that fires on
// everything has found nothing, so the same union is checked twice — once against an
// untyped hand-list (must fire) and once against a `Record<TheUnion, …>` table the compiler
// already checks (must NOT fire) — plus a genuinely unrelated pair (must not fire).
import test from "node:test";
import assert from "node:assert/strict";
import {
  sitesOfSource, sitesOfMarkdown, alternationsIn, pairSites, collectSites,
  declaredParitySymbols, renderRedundancy, redundancy, REDUNDANCY_DEFAULTS,
  type DomainSite,
} from "../src/redundancy.ts";
import { tmpProject, cleanup, cfg, graph, comp, runCaptured } from "./_helpers.ts";

const site = (over: Partial<DomainSite> & { keys: string[] }): DomainSite =>
  ({ name: "S", kind: "list", file: "a.ts", line: 1, typeLink: null, ...over });
const pairsOf = (sites: DomainSite[], declared = new Set<string>()) => pairSites(sites, declared).pairs;
const named = (sites: DomainSite[], n: string) => sites.find((s) => s.name === n);

// ── site extraction: every way a codebase spells a domain out loud ───────────────────

test("sitesOfSource — a string-literal union is a domain; a non-literal union is not", () => {
  const s = sitesOfSource(`export type Verdict = "live" | "literal" | "not-found";\nexport type U = A | B | C;`);
  assert.deepEqual(named(s, "Verdict")!.keys, ["literal", "live", "not-found"]);
  assert.equal(named(s, "U"), undefined);
});

test("sitesOfSource — a Record table records the TYPE it is keyed by (the suppression key)", () => {
  const s = sitesOfSource(`const G: Record<Verdict, string> = { live: "a", literal: "b", "not-found": "c" };`);
  const t = named(s, "G")!;
  assert.equal(t.kind, "table");
  assert.equal(t.typeLink, "Verdict"); // Record<K,V> → K, never the value type
  assert.deepEqual(t.keys, ["literal", "live", "not-found"]);
});

test("sitesOfSource — Omit/Pick unwrap to the type they narrow (an Omit<Config,…> IS checked)", () => {
  const s = sitesOfSource(`const D: Omit<Config, "root"> = { a: 1, b: 2, c: 3 };`);
  assert.equal(named(s, "D")!.typeLink, "Config");
});

test("sitesOfSource — interfaces, anonymous property type-literals, enums, switches and lists", () => {
  const s = sitesOfSource(
    `interface Opts { alpha: number; beta: number; gamma: number; nested?: { one: 1; two: 2; three: 3 } }\n` +
    `enum Mode { Fast, Slow, Idle }\n` +
    `const L = ["red", "green", "blue"];\n` +
    `function f(x: string) { switch (x) { case "up": break; case "down": break; case "flat": break; } }`,
  );
  assert.deepEqual(named(s, "Opts")!.keys, ["alpha", "beta", "gamma", "nested"]);
  assert.deepEqual(named(s, "Opts.nested")!.keys, ["one", "three", "two"]); // the anonymous knob block
  assert.deepEqual(named(s, "Mode")!.keys, ["Fast", "Idle", "Slow"]);
  assert.deepEqual(named(s, "L")!.keys, ["blue", "green", "red"]);
  assert.deepEqual(named(s, "x")!.keys, ["down", "flat", "up"]);
});

test("sitesOfSource — an `x === \"lit\"` chain is a domain spelled as control flow, scoped per function", () => {
  // Two unrelated `e.kind`s in two functions must NOT fuse into one 6-token domain: that
  // collision manufactured a divergence out of nothing on the first dogfood run.
  const s = sitesOfSource(
    `function a(e: E) { if (e.kind === "one") {} else if (e.kind === "two") {} else if (e.kind === "three") {} }\n` +
    `function b(e: F) { if (e.kind === "red") {} else if (e.kind === "green") {} else if (e.kind === "blue") {} }`,
  );
  const chains = s.filter((x) => x.kind === "compare").map((x) => x.keys.length);
  assert.deepEqual(chains, [3, 3]);
});

test("alternationsIn — a BRACKETED a|b|c is a domain; prose pipes and two-way choices are not", () => {
  assert.deepEqual(alternationsIn("usage: cmd <graph|verify|log>")[0], ["graph", "verify", "log"]);
  assert.deepEqual(alternationsIn("(root|this node|every node)")[0], ["root", "this node", "every node"]);
  assert.equal(alternationsIn("via (test|guard)").length, 0);        // only two alternatives
  assert.equal(alternationsIn("a | b happened, then c | d").length, 0); // unbracketed prose
});

test("sitesOfMarkdown — a table's first column is a domain; escaped pipes and fences are handled", () => {
  const s = sitesOfMarkdown(
    `## Config reference\n\n| Field | Purpose |\n| --- | --- |\n| \`alpha\` | a |\n| \`beta\` | b |\n` +
    `| \`gamma\` | matches (root\\|this node\\|every node) |\n\n\`\`\`\n| fake | table |\n| --- | --- |\n| x | y |\n\`\`\`\n`,
  );
  const t = s.find((x) => x.kind === "md-table")!;
  assert.equal(t.name, "Config reference");
  assert.deepEqual(t.keys, ["alpha", "beta", "gamma"]); // backticks stripped, fenced block ignored
});

// ── THE NEGATIVE CONTROL ─────────────────────────────────────────────────────────────
// One union, three partners. It must fire on the hand-list, stay silent on the table the
// compiler checks, and stay silent on an unrelated set of the same size.

const VERDICT = site({ name: "Verdict", kind: "union", file: "types.ts", keys: ["live", "literal", "no-iteration", "not-found"] });
const HAND_LIST = site({ name: "ALL_VERDICTS", kind: "list", file: "report.ts", keys: ["live", "literal", "no-iteration", "not-found"] });
const CHECKED_TABLE = site({ name: "LABEL", kind: "table", file: "render.ts", typeLink: "Verdict", keys: ["live", "literal", "no-iteration", "not-found"] });
const UNRELATED = site({ name: "GRADES", kind: "list", file: "grade.ts", keys: ["alpha", "beta", "gamma", "delta"] });

test("NEGATIVE CONTROL (a) — the known redundant pair IS found, above the reporting floor", () => {
  const found = pairsOf([VERDICT, HAND_LIST]);
  assert.equal(found.length, 1);
  assert.equal(found[0].shared.length, 4);
  assert.ok(found[0].score >= REDUNDANCY_DEFAULTS.minScore, `score ${found[0].score} must clear the floor`);
});

test("NEGATIVE CONTROL (b) — the SAME domain typed by the compiler is NOT reported", () => {
  const { pairs, suppressed } = pairSites([VERDICT, CHECKED_TABLE], new Set());
  assert.equal(pairs.length, 0);
  assert.equal(suppressed.typeLinked, 1); // tsc is the oracle; there is nothing to declare
});

test("NEGATIVE CONTROL (c) — an unrelated pair of the same size does NOT fire", () => {
  assert.equal(pairsOf([VERDICT, UNRELATED]).length, 0);
  assert.equal(pairsOf([HAND_LIST, UNRELATED]).length, 0);
});

test("NEGATIVE CONTROL (d) — all four together yield exactly the one true pair", () => {
  const found = pairsOf([VERDICT, HAND_LIST, CHECKED_TABLE, UNRELATED]);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].a.name, found[0].b.name].sort(), ["ALL_VERDICTS", "Verdict"]);
});

// ── the filters that keep the report from becoming a wall ────────────────────────────

test("a pair already carrying a parity claim is suppressed — the point is what nobody declared", () => {
  const { pairs, suppressed } = pairSites([VERDICT, HAND_LIST], new Set(["ALL_VERDICTS"]));
  assert.equal(pairs.length, 0);
  assert.equal(suppressed.declared, 1);
});

test("declaredParitySymbols reads domain + both projections off the graph's parity claims", () => {
  const g = graph([comp("src", { claims: ['parity "x" over TOOL_NAMES between toolActivity and messageProvenance via test "t"'] })]);
  assert.deepEqual([...declaredParitySymbols(g)].sort(), ["TOOL_NAMES", "messageProvenance", "toolActivity"]);
});

test("a token at many sites is project idiom, not a domain — maxDf drops it", () => {
  // "pass"/"fail"/"skip" everywhere: two more sites sharing only those must not pair.
  const spread = Array.from({ length: 8 }, (_, i) => site({ name: `S${i}`, file: `f${i}.ts`, keys: ["pass", "fail", "skip"] }));
  assert.equal(pairsOf(spread).length, 0);
});

test("containment — a big set that merely CONTAINS a small one is not a candidate", () => {
  const small = site({ name: "Few", file: "a.ts", keys: ["q", "r", "s"] });
  const big = site({ name: "Many", file: "b.ts", keys: ["q", "r", "s", "t", "u", "v", "w", "x", "y", "z"] });
  assert.equal(pairsOf([small, big]).length, 1);            // small is fully contained → candidate
  const partial = site({ name: "Half", file: "c.ts", keys: ["q", "r", "s", "m", "n", "o", "p"] });
  const found = pairsOf([partial, big]);
  assert.equal(found.length, 0);                            // only 3 of 7 overlap → below containment
});

test("a comparison chain reading PART of a domain earns no divergence bonus; extras do", () => {
  const dom = site({ name: "Kind", kind: "union", file: "t.ts", keys: ["a", "b", "c", "d"] });
  const subsetChain = site({ name: "v.kind", kind: "compare", file: "u.ts", keys: ["a", "b", "c"] });
  const strayChain = site({ name: "v.kind", kind: "compare", file: "w.ts", keys: ["a", "b", "c", "zzz"] });
  const clean = pairsOf([dom, subsetChain])[0];
  const stray = pairsOf([dom, strayChain])[0];
  assert.ok(stray.score > clean.score, "a chain holding a token the domain lacks is the drift direction");
  assert.deepEqual(stray.onlyB, ["zzz"]);
});

test("two interfaces sharing field names rank below a shape against an untyped defaults table", () => {
  const opts = site({ name: "Opts", kind: "shape", file: "a.ts", keys: ["one", "two", "three"] });
  const other = site({ name: "Other", kind: "shape", file: "b.ts", keys: ["one", "two", "three"] });
  const defaults = site({ name: "DEFAULTS", kind: "table", file: "c.ts", keys: ["one", "two", "three"] });
  const shapeShape = pairSites([opts, other], new Set()).pairs[0];
  const shapeTable = pairSites([opts, defaults], new Set()).pairs[0];
  assert.ok(shapeTable.score > shapeShape.score);
});

// ── the walk, the render, and the command ────────────────────────────────────────────

test("collectSites — walks code and markdown, skips tests and generated output", async () => {
  const root = await tmpProject({
    "src/kinds.ts": `export type Kind = "aa" | "bb" | "cc";`,
    "src/table.ts": `const T = ["aa", "bb", "cc"];`,
    "src/kinds.test.ts": `const COPY = ["aa", "bb", "cc"];`,     // evidence, not surface
    "AGENTS.md": `| K |\n| --- |\n| aa |\n| bb |\n| cc |\n`,      // generated
    "README.md": `| Field | X |\n| --- | --- |\n| aa | 1 |\n| bb | 2 |\n| cc | 3 |\n`,
    "public/graph.json": `{}`,
  });
  try {
    const sites = await collectSites(cfg(root, { outputDir: "public" }));
    const files = [...new Set(sites.map((s) => s.file))].sort();
    assert.deepEqual(files, ["README.md", "src/kinds.ts", "src/table.ts"]);
  } finally { await cleanup(root); }
});

test("renderRedundancy — names both sites, the divergence, and every suppression", () => {
  const { pairs, suppressed } = pairSites([VERDICT, HAND_LIST, CHECKED_TABLE], new Set());
  const text = renderRedundancy(pairs, suppressed, 3);
  assert.match(text, /types\.ts:1\s+union `Verdict`/);
  assert.match(text, /report\.ts:1\s+list `ALL_VERDICTS`/);
  assert.match(text, /1 compiler-enforced/);
  assert.match(text, /parity "<what must agree>"/); // the report ends in the fix, not a scold
});

test("renderRedundancy — silence is a legitimate report, not an empty one", () => {
  const text = renderRedundancy([], { typeLinked: 0, declared: 0, belowScore: 0 }, 12);
  assert.match(text, /no undeclared duplicated domain above the floor/);
});

test("redundancy — advisory end to end: finds the planted pair and still exits 0", async () => {
  const root = await tmpProject({
    "src/kinds.ts": `export type Verdict = "live" | "literal" | "no-iteration" | "not-found";`,
    "src/report.ts": `const ALL = ["live", "literal", "no-iteration", "not-found"];`,
  });
  try {
    const { code, out } = await runCaptured(() => redundancy(cfg(root), graph([]), {}));
    assert.equal(code, 0, "advisory: it gates nothing");
    assert.match(out, /Verdict/);
    assert.match(out, /ALL/);
  } finally { await cleanup(root); }
});

test("redundancy — a project whose domains are all compiler-tied reports nothing, loudly", async () => {
  const root = await tmpProject({
    "src/kinds.ts": `export type Verdict = "live" | "literal" | "no-iteration" | "not-found";`,
    "src/report.ts": `const LABEL: Record<Verdict, string> = { live: "a", literal: "b", "no-iteration": "c", "not-found": "d" };`,
  });
  try {
    const { code, out } = await runCaptured(() => redundancy(cfg(root), graph([]), {}));
    assert.equal(code, 0);
    assert.match(out, /no undeclared duplicated domain above the floor/);
    assert.match(out, /1 compiler-enforced/);
  } finally { await cleanup(root); }
});
