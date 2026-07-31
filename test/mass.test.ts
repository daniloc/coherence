// mass.test.ts — the MASS RATCHET (src/mass.ts). What is actually at risk here is not the
// arithmetic (summing line counts is not where a bug hides) but the three places the
// ratchet could quietly LIE:
//   · ABSENCE READ AS ZERO — no lockfile reported as "0 transitive deps" would turn a
//     deleted file into a triumphant shrink. The dimension must be OMITTED.
//   · AN UNMEASURABLE PROBE READ AS ZERO — a bundle-size command that exits 1 must FAIL
//     the check, not report a heroic reduction.
//   · A GATE THAT SAYS NOTHING ACTIONABLE — growth must instruct `coherence decide`, not
//     print a diff the reader already had.
// Each of those has a test below that fails if the behaviour is reversed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { mass, excursions, lastNumber, massFindings, structuralDims, reconcileMass, type MassDim } from "../src/mass.ts";
import { buildGraph } from "../src/derive.ts";
import type { StatusRecord } from "../src/status.ts";
import { tmpProject, cleanup, cfg, comp, fileNode, sym, graph, runCaptured } from "./_helpers.ts";
import type { Config } from "../src/types.ts";

const SRC = { "A/a.ts": "one\ntwo\nthree\n", "B/b.ts": "only\n" }; // 3 + 1 lines
const G = graph([
  comp("A"), comp("B"),
  fileNode("A/a.ts", "A"), fileNode("B/b.ts", "B"),
  sym("alpha", "A/a.ts"), sym("beta", "B/b.ts"),
]);

const project = (extra: Record<string, string> = {}) => tmpProject({ ...SRC, ...extra });

// ── the pure pieces ──────────────────────────────────────────────────────────────────────

test("lastNumber — the LAST numeric token wins (a probe prints its number last)", () => {
  assert.equal(lastNumber("bundle: 41.2 kB\n"), 41.2);
  assert.equal(lastNumber("1284\n"), 1284);
  assert.equal(lastNumber("v2 report: 7 files, 913 symbols"), 913);
  assert.equal(lastNumber("no digits at all"), null);
  assert.equal(lastNumber(""), null);
});

test("excursions — NEW keys and growth past tolerance regress; shrinkage NEVER does", () => {
  const base: MassDim[] = [{ key: "lines|total", value: 100 }, { key: "files|total", value: 4 }];
  const dims: MassDim[] = [
    { key: "lines|total", value: 130 },   // grew 30
    { key: "files|total", value: 2 },     // shrank — never a failure
    { key: "deps|direct", value: 9 },     // NEW
  ];
  const strict = excursions(dims, base, {});
  assert.deepEqual(strict.map((e) => e.key).sort(), ["deps|direct", "lines|total"]);
  assert.deepEqual(strict.find((e) => e.key === "deps|direct")!.baseline, null, "a NEW key has no baseline, not a zero one");
  const tolerant = excursions(dims, base, { "lines|total": 50 });
  assert.deepEqual(tolerant.map((e) => e.key), ["deps|direct"], "growth inside tolerance is not an excursion");
});

test("massFindings — the subject is the ADDRESSABLE KEY and carries no magnitude", () => {
  const [f] = massFindings([{ key: "lines|total", value: 900, baseline: 100, tolerance: 0 }]);
  assert.equal(f.advisory, "mass");
  assert.equal(f.subject, "lines|total");
  assert.doesNotMatch(f.subject, /\d/, "a number in the subject re-keys the question every run");
  assert.match(f.observation, /100 → 900/);
  assert.ok(f.discriminatedBy.includes("coherence decide"), "a finding must name the check that settles it");
});

// ── rename reconciliation (the pure layer) ───────────────────────────────────────────────
//
// A dimension key embeds a NAME someone chose (a spec H1, a measure's config key), so a
// rename re-addresses the pin — and before reconcileMass, a one-line H1 edit failed the
// ratchet with "gained parts nobody named" while the total sat unchanged two lines above.
// The reconciler is lint-sinks's, translated: matched disappearance, count-conserving,
// with the move-invariant address being family + unit + EXACT value.

const dim = (key: string, value: number, unit = "lines"): MassDim => ({ key, value, unit });

test("reconcileMass — a renamed dimension with conserved mass inherits its pin, and nothing fails", () => {
  const base = [dim("lines|ids", 35), dim("lines|total", 100)];
  const dims = [dim("lines|identifiers", 35), dim("lines|total", 100)];
  const { renamed, base: eff } = reconcileMass(dims, base);
  assert.deepEqual(renamed, [{ from: "lines|ids", to: "lines|identifiers", value: 35, unit: "lines" }]);
  assert.deepEqual(excursions(dims, eff, {}), [], "nothing was gained, so nothing may fail");
});

test("reconcileMass — a rename that ALSO changed value absorbs nothing; the growth still fails", () => {
  const { renamed, base: eff } = reconcileMass([dim("lines|identifiers", 40)], [dim("lines|ids", 35)]);
  assert.deepEqual(renamed, [], "only a value-conserving rename inherits a pin");
  const exc = excursions([dim("lines|identifiers", 40)], eff, {});
  assert.equal(exc.length, 1);
  assert.equal(exc[0].baseline, null, "renamed-and-grown is indistinguishable from new, and fails as such");
});

test("reconcileMass is count-conserving — two vanished pins absorb two renames, the third is new", () => {
  const base = [dim("lines|a", 3), dim("lines|b", 3)];
  const dims = [dim("lines|x", 3), dim("lines|y", 3), dim("lines|z", 3)];
  const { renamed, base: eff } = reconcileMass(dims, base);
  assert.equal(renamed.length, 2);
  assert.deepEqual(excursions(dims, eff, {}).map((e) => e.key), ["lines|z"], "the surface gained one dimension and the ratchet must say so");
});

test("reconcileMass — family and unit are part of the address; a value coincidence across them never pairs", () => {
  const base = [dim("lines|ids", 12, "lines"), dim("measure|bundle", 12, "kB")];
  const dims = [dim("files|extra", 12, "files"), dim("measure|tables", 12, "tables")];
  assert.deepEqual(reconcileMass(dims, base).renamed, [], "12 lines is not 12 files and kB are not tables");
});

test("reconcileMass — an unchanged, still-pinned dimension is untouched, and no baseline passes through as-is", () => {
  const base = [dim("lines|a", 3)];
  assert.deepEqual(reconcileMass([dim("lines|a", 3)], base), { renamed: [], base });
});

// ── report ───────────────────────────────────────────────────────────────────────────────

test("report — prints the structural dimensions: lines total + per component, files, symbols", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const { code, out } = await runCaptured(() => mass(cfg(root), G, "report"));
  assert.equal(code, 0);
  assert.match(out, /lines\|total\s+4/);
  assert.match(out, /lines\|A\s+3/);
  assert.match(out, /lines\|B\s+1/);
  assert.match(out, /files\|total\s+2/);
  assert.match(out, /symbols\|total\s+2/);
});

test("a file whose parent has no component node keys on the DIR, never on the raw graph id", async (t) => {
  // A baseline key is an address people type and quote at each other for years. `lines|c:.`
  // (what the id fallback produced on the harness's own repo, which declares no components)
  // is an internal identifier escaping into that surface.
  const root = await project();
  t.after(() => cleanup(root));
  const orphan = graph([fileNode("A/a.ts", "."), sym("alpha", "A/a.ts")]); // parent c:. with no comp node
  const { out } = await runCaptured(() => mass(cfg(root), orphan, "report"));
  assert.match(out, /lines\|\.\s+3/);
  assert.doesNotMatch(out, /lines\|c:/);
});

test("deps — direct/dev come from package.json, transitive from the lockfile's `packages` minus root", async (t) => {
  const root = await project({
    "package.json": JSON.stringify({ dependencies: { a: "1", b: "2" }, devDependencies: { t: "3" } }),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/a": {}, "node_modules/b": {}, "node_modules/t": {} } }),
  });
  t.after(() => cleanup(root));
  const { out } = await runCaptured(() => mass(cfg(root), G, "report"));
  assert.match(out, /deps\|direct\s+2/);
  assert.match(out, /deps\|dev\s+1/);
  assert.match(out, /deps\|transitive\s+3/);
});

test("ABSENCE IS NOT EMPTINESS — no lockfile OMITS deps|transitive rather than reporting 0", async (t) => {
  const root = await project({ "package.json": JSON.stringify({ dependencies: { a: "1" } }) });
  t.after(() => cleanup(root));
  const { out } = await runCaptured(() => mass(cfg(root), G, "report"));
  assert.match(out, /deps\|direct\s+1/);
  assert.doesNotMatch(out, /deps\|transitive/, "an absent lockfile must not manufacture a zero");
});

test("no package.json at all — every deps dimension is omitted, and `mass.deps: false` omits them too", async (t) => {
  const root = await project({
    "package.json": JSON.stringify({ dependencies: { a: "1" } }),
    "package-lock.json": JSON.stringify({ packages: { "": {}, "node_modules/a": {} } }),
  });
  const bare = await project();
  t.after(() => Promise.all([cleanup(root), cleanup(bare)]));

  const off = await runCaptured(() => mass(cfg(root, { mass: { deps: false } } as Partial<Config>), G, "report"));
  assert.doesNotMatch(off.out, /deps\|/, "`mass.deps: false` disables the dimension group");
  const none = await runCaptured(() => mass(cfg(bare), G, "report"));
  assert.doesNotMatch(none.out, /deps\|/);
});

test("measure — the project's own probe becomes a `measure|<key>` dimension", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root, { mass: { measures: [{ key: "widgets", cmd: ["node", "-e", "console.log(123)"], unit: "widgets" }] } } as Partial<Config>);
  const { out } = await runCaptured(() => mass(c, G, "report"));
  assert.match(out, /measure\|widgets\s+123/);
});

test("AN ERRORING PROBE IS NOT ZERO — a failing measure is reported loudly and FAILS --check", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root, { mass: { measures: [{ key: "bundle", cmd: ["node", "-e", "process.exit(1)"] }] } } as Partial<Config>);

  await runCaptured(() => mass(c, G, "update"));            // pin what IS measurable
  const { code, out, err } = await runCaptured(() => mass(c, G, "check"));
  assert.equal(code, 1, "an unmeasurable probe must fail the check, not read as a shrink");
  assert.match(err, /UNMEASURABLE bundle/);
  assert.match(err, /exited 1/);
  assert.doesNotMatch(out, /measure\|bundle\s+0/, "it must never appear as a zero-valued dimension");
});

test("a probe that exits 0 printing nothing numeric is unmeasurable too (silence is not a measurement)", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root, { mass: { measures: [{ key: "quiet", cmd: ["node", "-e", "console.log('done')"] }] } } as Partial<Config>);
  const { err } = await runCaptured(() => mass(c, G, "report"));
  assert.match(err, /UNMEASURABLE quiet — exited 0 but printed no number/);
});

// ── the ratchet triple ───────────────────────────────────────────────────────────────────

test("--check with NO baseline exits 2 and says how to make one", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const { code, err } = await runCaptured(() => mass(cfg(root), G, "check"));
  assert.equal(code, 2);
  assert.match(err, /no baseline\. Run with --update-baseline first/);
});

test("--update-baseline writes a SORTED {key,value} baseline; --check then HOLDS at exit 0", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root);

  const up = await runCaptured(() => mass(c, G, "update"));
  assert.equal(up.code, 0);
  assert.match(up.out, /Pinned \d+ mass dimension\(s\) to public\/mass-baseline\.json/);

  const base = JSON.parse(await readFile(join(root, "public", "mass-baseline.json"), "utf8")) as MassDim[];
  assert.deepEqual([...base].map((b) => b.key), [...base].map((b) => b.key).sort(), "the baseline is key-sorted (a stable diff)");
  assert.ok(base.some((b) => b.key === "lines|total" && b.value === 4));

  const held = await runCaptured(() => mass(c, G, "check"));
  assert.equal(held.code, 0);
  assert.match(held.out, /mass ratchet held/);
});

test("GROWTH fails --check with the watchmaker line, and INSTRUCTS `coherence decide`", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root);
  await runCaptured(() => mass(c, G, "update"));

  // Same tree, a bigger graph: a new file with a new symbol under a component that had
  // no baseline key of its own — one GROWN key (lines|total, files|total) and one NEW one.
  const grown = graph([
    ...G.nodes,
    comp("C"), fileNode("C/c.ts", "C"), sym("gamma", "C/c.ts"),
  ]);
  await mkdir(join(root, "C"), { recursive: true });
  await writeFile(join(root, "C/c.ts"), "a\nb\nc\nd\ne\n");

  const { code, err } = await runCaptured(() => mass(c, grown, "check"));
  assert.equal(code, 1);
  assert.match(err, /mass ratchet FAILED — the movement gained parts nobody named/);
  assert.match(err, /NEW dimension: lines\|C = 5/);
  assert.match(err, /lines\|total grew 4→9/);
  assert.match(err, /coherence decide "<what the new mass buys>"/);
  assert.match(err, /coherence mass --update-baseline/);
});

test("a per-key tolerance absorbs growth up to its size, and not one line past it", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  await runCaptured(() => mass(cfg(root), G, "update"));
  await writeFile(join(root, "A/a.ts"), "one\ntwo\nthree\nfour\n"); // 3 → 4

  const tolerant = cfg(root, { mass: { tolerance: { "lines|total": 1, "lines|A": 1 } } } as Partial<Config>);
  assert.equal((await runCaptured(() => mass(tolerant, G, "check"))).code, 0);
  const strict = cfg(root, { mass: { tolerance: { "lines|A": 1 } } } as Partial<Config>);
  assert.equal((await runCaptured(() => mass(strict, G, "check"))).code, 1, "lines|total still grew past ITS tolerance of 0");
});

test("a baselined key that vanished prints as droppable and never fails (the conventions pattern)", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root);
  await runCaptured(() => mass(c, G, "update"));

  const shrunk = graph([comp("A"), fileNode("A/a.ts", "A"), sym("alpha", "A/a.ts")]); // B is gone
  const { code, out } = await runCaptured(() => mass(c, shrunk, "check"));
  assert.equal(code, 0, "shrinking must never fail the ratchet");
  assert.match(out, /lines\|B \(1\) — gone from the project; drop from baseline/);
});

// ── rename reconciliation (the glue layer, over a real tree) ─────────────────────────────

test("mass — a renamed component keeps its pin; growth and novelty are never absorbed", async (t) => {
  // The measured scenario, end to end: component labels come from the spec's H1, so a
  // one-line H1 edit re-addresses `lines|<component>` while not one line of code moves.
  const root = await tmpProject({
    "ids/ids.spec.md": "# ids\n\nIdentifier utilities.\n",
    "ids/util.ts": "export const a = 1;\nconst b = 2;\nconst c = 3;\n",
    "other/other.spec.md": "# other\n\nOther stuff.\n",
    "other/o.ts": "export const d = 4;\n",
  });
  t.after(() => cleanup(root));
  const c = cfg(root);
  await runCaptured(async () => mass(c, await buildGraph(c), "update"));

  // 1. THE RENAME. Same files, same 3 lines, new H1 — the ratchet must hold and say so.
  await writeFile(join(root, "ids/ids.spec.md"), "# identifiers\n\nIdentifier utilities.\n");
  const renamedRun = await runCaptured(async () => mass(c, await buildGraph(c), "check"));
  assert.equal(renamedRun.code, 0, "a rename is not growth and must not fail a ratchet");
  assert.match(renamedRun.out, /1 dimension\(s\) RENAMED — the same pinned mass under a new name, not growth/);
  assert.match(renamedRun.out, /lines\|ids → lines\|identifiers\s+\(3 lines conserved\)/);
  assert.doesNotMatch(renamedRun.err, /gained parts nobody named/, "the exact lie this reconciler exists to retire");

  // 2. RENAMED AND GROWN. The vanished pin held 3; the new name holds 5. The rename must
  //    not launder the growth — it fails, and the report names the vanished candidate.
  await writeFile(join(root, "ids/util.ts"), "export const a = 1;\nconst b = 2;\nconst c = 3;\nconst d2 = 4;\nconst e = 5;\n");
  const grownRun = await runCaptured(async () => mass(c, await buildGraph(c), "check"));
  assert.equal(grownRun.code, 1, "a rename that also grew must fail on the growth");
  assert.match(grownRun.err, /NEW dimension: lines\|identifiers = 5/);
  assert.match(grownRun.err, /lines\|ids \(3\) vanished this run/);
  assert.match(grownRun.err, /its mass ALSO changed 3 → 5/);

  // 3. A GENUINELY NEW COMPONENT, beside the (restored, value-conserving) rename. The
  //    rename reconciles; the new dimension has no vanished pin at its value and fails.
  await writeFile(join(root, "ids/util.ts"), "export const a = 1;\nconst b = 2;\nconst c = 3;\n");
  await mkdir(join(root, "fresh"), { recursive: true });
  await writeFile(join(root, "fresh/fresh.spec.md"), "# fresh\n\nBrand new.\n");
  await writeFile(join(root, "fresh/f.ts"), "const z1 = 1;\nconst z2 = 2;\nconst z3 = 3;\nconst z4 = 4;\nconst z5 = 5;\n");
  const novelRun = await runCaptured(async () => mass(c, await buildGraph(c), "check"));
  assert.equal(novelRun.code, 1, "the ratchet must still catch a new dimension");
  assert.match(novelRun.err, /NEW dimension: lines\|fresh = 5/);
  assert.match(novelRun.out, /lines\|ids → lines\|identifiers/, "the rename beside it still reconciles");
  assert.doesNotMatch(novelRun.err, /NEW dimension: lines\|identifiers/, "the renamed component is not counted as new");
});

test("mass — two components renamed at once conserve (2 vanished absorb 2) and a third new one fails", async (t) => {
  const root = await project(); // A: 3 lines, B: 1 line
  t.after(() => cleanup(root));
  const c = cfg(root);
  await runCaptured(() => mass(c, G, "update"));

  // Both labels change (spec H1 edits); the files and their masses stay put. C is new.
  await mkdir(join(root, "C"), { recursive: true });
  await writeFile(join(root, "C/c.ts"), "a\nb\nc\nd\ne\n");
  const g2 = graph([
    comp("A", { label: "alpha" }), comp("B", { label: "beta" }), comp("C"),
    fileNode("A/a.ts", "A"), fileNode("B/b.ts", "B"), fileNode("C/c.ts", "C"),
    sym("alpha", "A/a.ts"), sym("beta", "B/b.ts"),
  ]);
  const { code, out, err } = await runCaptured(() => mass(c, g2, "check"));
  assert.equal(code, 1, "the genuinely new component must still fail");
  assert.match(out, /2 dimension\(s\) RENAMED/);
  assert.match(out, /lines\|A → lines\|alpha\s+\(3 lines conserved\)/);
  assert.match(out, /lines\|B → lines\|beta\s+\(1 lines conserved\)/);
  assert.match(err, /NEW dimension: lines\|C = 5/);
  assert.doesNotMatch(err, /NEW dimension: lines\|alpha/);
  assert.doesNotMatch(err, /NEW dimension: lines\|beta/);
});

// ── the record ───────────────────────────────────────────────────────────────────────────

test("recordMass — the run lands in .coherence/status.json with its dims, units and provenance", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  await runCaptured(() => mass(cfg(root), G, "report"));

  const rec = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8")) as StatusRecord;
  assert.ok(rec.mass, "status.json gained a mass section");
  assert.equal(typeof rec.mass!.at, "string");
  assert.equal(rec.mass!.dirty, false);          // not a git repo → no dirt to report
  const lines = rec.mass!.dims.find((d) => d.key === "lines|total")!;
  assert.equal(lines.value, 4);
  assert.equal(lines.unit, "lines");
  assert.equal(lines.baseline, undefined, "nothing was pinned, so nothing may claim a baseline");
});

test("recordMass — after a pin, each recorded dim carries the baseline it was measured against", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root);
  await runCaptured(() => mass(c, G, "update"));
  await runCaptured(() => mass(c, G, "check"));

  const rec = JSON.parse(await readFile(join(root, ".coherence", "status.json"), "utf8")) as StatusRecord;
  assert.equal(rec.mass!.dims.find((d) => d.key === "lines|total")!.baseline, 4);
});

// ── raising ──────────────────────────────────────────────────────────────────────────────

test("--raise opens ONE question per excursion, keyed on the dimension (never on its value)", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root);
  await runCaptured(() => mass(c, G, "update"));
  await writeFile(join(root, "A/a.ts"), "1\n2\n3\n4\n5\n6\n");

  const { out } = await runCaptured(() => mass(c, G, "check", { raise: true, session: "s-abcabcabcabc" }));
  assert.match(out, /RAISE — \d+ question\(s\) opened/);
  assert.match(out, /mass:lines\|total/);

  // Re-running after MORE growth must not mint a second question about the same key.
  await writeFile(join(root, "A/a.ts"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n");
  const again = await runCaptured(() => mass(c, G, "check", { raise: true, session: "s-abcabcabcabc" }));
  assert.match(again.out, /already open/);
});

test("without --raise nothing is written: the journal dir stays absent, and the hint still prints", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root);
  await runCaptured(() => mass(c, G, "update"));
  await writeFile(join(root, "A/a.ts"), "1\n2\n3\n4\n5\n6\n");

  const { out } = await runCaptured(() => mass(c, G, "check"));
  assert.match(out, /RAISE — .* never been asked about/);
  await assert.rejects(() => readFile(join(root, ".coherence", "decisions", "s-abcabcabcabc.jsonl"), "utf8"));
});

// ── undocumented|symbols — the UNDECLARED SURFACE dimension ──────────────────────────────
//
// `symbols|total` counts how much surface there is; this counts how much of it a reader has
// to derive by reading the body. The risk is not the count — it is the PREDICATE drifting
// from verify's, so that a symbol the coverage advisory calls undocumented is not the one
// the ratchet pins. Both now read `derive.ts`'s single `isDocumented`; the whitespace case
// below is the one where two hand-written spellings would plausibly disagree.

const documented = (name: string, path: string, prose?: string) =>
  ({ id: `s:${path}#${name}`, label: name, kind: "symbol" as const, path, line: 1, prose });

test("undocumented|symbols — counts exactly what fails isDocumented, whitespace-only prose included", async (t) => {
  const root = await project();
  t.after(() => cleanup(root));
  const g = graph([
    comp("A"), fileNode("A/a.ts", "A"),
    documented("hasDoc", "A/a.ts", "it does the thing"),
    documented("blankDoc", "A/a.ts", "   \n\t "),   // present but empty — undocumented
    documented("noDoc", "A/a.ts"),
  ]);
  const dims = await structuralDims(cfg(root), g);
  assert.equal(dims.find((d) => d.key === "symbols|total")!.value, 3);
  assert.equal(dims.find((d) => d.key === "undocumented|symbols")!.value, 2, "whitespace-only prose is not documentation");
  assert.equal(dims.find((d) => d.key === "undocumented|symbols")!.unit, "symbols");
});

test("undocumented|symbols — a repo pinned before v0.20.0 reds on the NEW key, with the re-pin instruction", async (t) => {
  // The designed adoption path: `excursions` already fails a key that is new, and the
  // failure message is the one that asks what the surface BUYS rather than printing a diff.
  const root = await project();
  t.after(() => cleanup(root));
  const c = cfg(root);
  const stale: MassDim[] = [
    { key: "lines|total", value: 4 }, { key: "lines|A", value: 3 }, { key: "lines|B", value: 1 },
    { key: "files|total", value: 2 }, { key: "symbols|total", value: 2 },
    { key: "deps|direct", value: 0 }, { key: "deps|dev", value: 0 },
  ];
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(join(root, "public", "mass-baseline.json"), JSON.stringify(stale, null, 2));

  const { code, err } = await runCaptured(() => mass(c, G, "check"));
  assert.equal(code, 1);
  assert.match(err, /NEW dimension: undocumented\|symbols = 2/);
  assert.match(err, /coherence mass --update-baseline/);
});
