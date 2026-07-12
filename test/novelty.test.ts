// novelty.test.ts — the novelty-vs-anchor advisory. The failure it exists to catch: a
// large feature lands, `log` says "no structural change", verify stays green — because
// nothing DECLARED changed while a pile of load-bearing surface (exports, enumerated
// domains, keyed lookup tables) appeared unanchored. The scan is pure AST; the verdict
// is a pure function; the churn proviso self-qualifies refactor-shaped ranges.
import test from "node:test";
import assert from "node:assert/strict";
import {
  surfaceOfSource, surfaceSignals, noveltyVerdict, isTestPath, scanSurface,
  type FileSurface,
} from "../src/novelty.ts";
import { tmpProject, cleanup } from "./_helpers.ts";

const fs = (exports: string[] = [], domains: Array<[string, string[]]> = []): FileSurface => ({
  exports: new Set(exports),
  domains: new Map(domains.map(([k, v]) => [k, new Set(v)])),
});

// ── surfaceOfSource — the AST proxies ────────────────────────────────────────────────

test("surfaceOfSource — exported string-literal union is an enumerated domain", () => {
  const s = surfaceOfSource(`export type ToolName = "set_field" | "read_record" | "web_search";`);
  assert.deepEqual([...s.domains.get("ToolName")!].sort(), ["read_record", "set_field", "web_search"]);
  assert.ok(s.exports.has("ToolName"));
});

test("surfaceOfSource — a NON-exported Record table still counts (the motivating bug class)", () => {
  // The consumer's TOOL_KIND/READ_SUMMARY tables were module-local consts in a .tsx
  // component — behavioral surface no export-based proxy can see.
  const s = surfaceOfSource(
    `const TOOL_KIND: Record<string, Kind> = { web_search: "evidence", set_field: "edit" };\n` +
    `export const VISIBLE: Record<string, string> = { a: "x" };`,
    "Thread.tsx",
  );
  assert.deepEqual([...s.domains.get("TOOL_KIND")!].sort(), ["set_field", "web_search"]);
  assert.deepEqual([...s.domains.get("VISIBLE")!], ["a"]);
  assert.ok(!s.exports.has("TOOL_KIND"));
  assert.ok(s.exports.has("VISIBLE"));
});

test("surfaceOfSource — satisfies Record<…> and enums count; plain object literals do not", () => {
  const s = surfaceOfSource(
    `export const T = { a: 1, b: 2 } satisfies Record<K, number>;\n` +
    `export enum Mode { Fast, Slow }\n` +
    `const notATable = { x: 1 };`,
  );
  assert.deepEqual([...s.domains.get("T")!].sort(), ["a", "b"]);
  assert.deepEqual([...s.domains.get("Mode")!].sort(), ["Fast", "Slow"]);
  assert.equal(s.domains.get("notATable"), undefined);
});

test("surfaceOfSource — exported functions/classes/interfaces/consts are exports; non-literal unions are not domains", () => {
  const s = surfaceOfSource(
    `export function f() {}\nexport class C {}\nexport interface I { x: number }\n` +
    `export const k = 1;\nfunction hidden() {}\nexport type U = A | B;`,
  );
  for (const name of ["f", "C", "I", "k"]) assert.ok(s.exports.has(name), name);
  assert.ok(!s.exports.has("hidden"));
  assert.equal(s.domains.get("U"), undefined); // A | B — not an enumerated string domain
});

test("isTestPath — test files are evidence, not surface", () => {
  assert.ok(isTestPath("entities/Patient/patient.test.ts"));
  assert.ok(isTestPath("src/__tests__/x.ts"));
  assert.ok(!isTestPath("shared/tools/registry.ts"));
});

test("scanSurface — merges changed files, skips tests and missing files", async () => {
  const root = await tmpProject({
    "a.ts": `export type K = "x" | "y";`,
    "b.tsx": `const T: Record<string, string> = { x: "1" };`,
    "a.test.ts": `export const TEST_ONLY = 1;`,
  });
  try {
    const s = await scanSurface(root, ["a.ts", "b.tsx", "a.test.ts", "gone.ts"]);
    assert.deepEqual([...s.domains.keys()].sort(), ["K", "T"]);
    assert.ok(!s.exports.has("TEST_ONLY"));
  } finally { await cleanup(root); }
});

// ── surfaceSignals — the diff ────────────────────────────────────────────────────────

test("surfaceSignals — net-new exports, new-domain members, and grown domains", () => {
  const before = fs(["kept"], [["ToolName", ["a", "b"]]]);
  const after = fs(["kept", "brandNew"], [["ToolName", ["a", "b", "c"]], ["TOOL_KIND", ["a", "b", "c"]]]);
  const sig = surfaceSignals(before, after, { added: 100, deleted: 10 }, { anchorsAdded: 0, componentsAdded: 0 });
  assert.deepEqual(sig.newExports, ["brandNew"]);
  assert.equal(sig.newVariants, 4); // ToolName +1, TOOL_KIND +3 (new)
  assert.deepEqual(sig.newDomains, ["TOOL_KIND (+3, new)", "ToolName (+1)"]);
});

test("surfaceSignals — a file move (same names, different files) is churn, not novelty", () => {
  const before = fs(["f", "g"], [["T", ["a"]]]);
  const after = fs(["f", "g"], [["T", ["a"]]]); // scanSurface keys by NAME across files
  const sig = surfaceSignals(before, after, { added: 300, deleted: 290 }, { anchorsAdded: 0, componentsAdded: 0 });
  assert.equal(sig.newExports.length, 0);
  assert.equal(sig.newVariants, 0);
});

// ── noveltyVerdict — the advisory decision + the churn proviso ───────────────────────

const sig = (over: Partial<Parameters<typeof noveltyVerdict>[0]>) => ({
  newExports: [] as string[], removedExports: 0, newVariants: 0, newDomains: [] as string[],
  locAdded: 0, locDeleted: 0, anchorsAdded: 0, componentsAdded: 0, ...over,
});

test("noveltyVerdict — big surface with zero anchors ALARMS, feature-shaped carries no proviso", () => {
  const v = noveltyVerdict(sig({ newExports: Array(20).fill("x").map((_, i) => `e${i}`), newVariants: 30, locAdded: 1500, locDeleted: 200 }));
  assert.equal(v.level, "alarm");
  assert.equal(v.proviso, false); // deletions ≪ additions and surface is net-new: a feature
});

test("noveltyVerdict — LOC-only alarm self-qualifies (churn proviso)", () => {
  // High line-churn, almost no net-new exports/variants: refactor-shaped.
  const v = noveltyVerdict(sig({ newExports: ["one"], locAdded: 900, locDeleted: 850 }));
  assert.equal(v.level, "alarm"); // still worth saying — but…
  assert.equal(v.proviso, true);  // …"disregard if recent work was mostly refactor"
});

test("noveltyVerdict — deletions tracking additions triggers the proviso even with surface", () => {
  const v = noveltyVerdict(sig({ newExports: Array(12).fill(0).map((_, i) => `e${i}`), locAdded: 1000, locDeleted: 600 }));
  assert.equal(v.level, "alarm");
  assert.equal(v.proviso, true);
});

test("noveltyVerdict — anchors keeping pace stays quiet; outpacing is the softer advisory", () => {
  const paced = noveltyVerdict(sig({ newExports: ["a", "b", "c"], newVariants: 5, anchorsAdded: 2, locAdded: 300 }));
  assert.equal(paced.level, "quiet");
  const outpaced = noveltyVerdict(sig({ newExports: Array(30).fill(0).map((_, i) => `e${i}`), newVariants: 30, anchorsAdded: 2, locAdded: 300, locDeleted: 20 }));
  assert.equal(outpaced.level, "outpacing");
});

test("noveltyVerdict — small quiet change raises nothing", () => {
  const v = noveltyVerdict(sig({ newExports: ["a", "b"], locAdded: 120, locDeleted: 40 }));
  assert.equal(v.level, "quiet");
});

test("noveltyVerdict — thresholds are configurable", () => {
  const s = sig({ newExports: ["a", "b", "c"], locAdded: 50 });
  assert.equal(noveltyVerdict(s).level, "quiet");
  assert.equal(noveltyVerdict(s, { minSurface: 3 }).level, "alarm");
});
