// oracle.test.ts — the META-ORACLE ("false oracles can't ship"). This is the harness's
// most load-bearing and least-obvious logic: it reads an oracle test's OWN source and
// decides whether its assertion loop ranges over a LIVE domain (a real totality check)
// or a hand-list / source-grep (a sampling oracle wearing the totality label). It was
// shipped validated against n=1 real project; these fixtures pin each classification path.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { analyzeOracle } from "../src/oracle-domain.ts";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";

// One fixture file holding a describe() block per case. The meta-oracle parses this with
// the TS compiler API; the imported modules need not exist (only the source is read).
const FIXTURE = `
import { REGISTRY } from "./reg.ts";
import { POLICY } from "./pol.ts";

describe("imported registry", () => {
  for (const p of REGISTRY) { expect(p).toBeDefined(); }
});

describe("object keys over import", () => {
  Object.keys(POLICY).forEach((k) => { expect(k).toBeTruthy(); });
});

describe("bare call result", () => {
  for (const row of liveTables()) { expect(row).toBeDefined(); }
});

describe("chain peels to imported receiver", () => {
  REGISTRY.map((x) => x.name).filter(Boolean).forEach((n) => { expect(n).toBeTruthy(); });
});

describe("unknown identifier is conservatively live", () => {
  for (const c of cols) { expect(c).toBeDefined(); }
});

describe("same-file const array", () => {
  const PATTERNS = ["a", "b", "c"];
  PATTERNS.forEach((p) => { expect(p).toBeTruthy(); });
});

describe("inline array literal", () => {
  ["x", "y"].forEach((v) => { expect(v).toBeTruthy(); });
});

describe("new Set over a literal", () => {
  for (const v of new Set([1, 2, 3])) { expect(v).toBeGreaterThan(0); }
});

describe("source-grep no iteration", () => {
  const src = "function foo() {}";
  expect(/eval\\(/.test(src)).toBe(false);
});

describe("empty body no iteration", () => {});

describe("live via it.each over an import", () => {
  it.each(REGISTRY)("case %s", (p) => { expect(p).toBeDefined(); });
});

describe("literal via it.each over an inline array", () => {
  it.each(["a", "b"])("case %s", (v) => { expect(v).toBeTruthy(); });
});

describe("live with a domain floor", () => {
  expect(REGISTRY.length).toBeGreaterThanOrEqual(3);
  for (const p of REGISTRY) { expect(p).toBeDefined(); }
});
`;

let root: string;
before(async () => { root = await tmpProject({ "oracles.test.ts": FIXTURE }); });
after(async () => { await cleanup(root); });

const verdict = async (name: string) => (await analyzeOracle(cfg(root), name)).verdict;

test("LIVE — for-of over an imported registry (SSOT)", async () => {
  assert.equal(await verdict("imported registry"), "live");
});

test("LIVE — Object.keys(importedMap).forEach peels to the live import", async () => {
  assert.equal(await verdict("object keys over import"), "live");
});

test("LIVE — a bare call result is the live domain", async () => {
  assert.equal(await verdict("bare call result"), "live");
});

test("LIVE — a .map().filter().forEach chain resolves to its imported receiver", async () => {
  assert.equal(await verdict("chain peels to imported receiver"), "live");
});

test("LIVE — an unknown identifier (param/anchor) is treated as live, never a false fail", async () => {
  assert.equal(await verdict("unknown identifier is conservatively live"), "live");
});

test("LITERAL — a same-file const array is a sampling oracle", async () => {
  assert.equal(await verdict("same-file const array"), "literal");
});

test("LITERAL — an inline array literal domain", async () => {
  assert.equal(await verdict("inline array literal"), "literal");
});

test("LITERAL — new Set([...]) over a literal is still a hand-list", async () => {
  assert.equal(await verdict("new Set over a literal"), "literal");
});

test("NO-ITERATION — a pure source-grep asserts a property, not domain coverage", async () => {
  assert.equal(await verdict("source-grep no iteration"), "no-iteration");
});

test("NO-ITERATION — an empty describe body iterates nothing", async () => {
  assert.equal(await verdict("empty body no iteration"), "no-iteration");
});

test("NOT-FOUND — an oracle name with no describe anywhere", async () => {
  const a = await analyzeOracle(cfg(root), "this oracle does not exist");
  assert.equal(a.verdict, "not-found");
});

test("the analysis reports which file the oracle was found in", async () => {
  const a = await analyzeOracle(cfg(root), "imported registry");
  assert.equal(a.file, "oracles.test.ts");
});

test("LIVE + FLOOR — a domain-size floor is detected", async () => {
  const a = await analyzeOracle(cfg(root), "live with a domain floor");
  assert.equal(a.verdict, "live");
  assert.equal(a.hasFloor, true);
});

test("LIVE + NO FLOOR — a live loop without a size floor is vacuous-able", async () => {
  const a = await analyzeOracle(cfg(root), "imported registry");
  assert.equal(a.verdict, "live");
  assert.equal(a.hasFloor, false);
  assert.match(a.detail, /no domain floor/);
});

test("a value assertion (toBeGreaterThan on a scalar) is NOT a domain floor", async () => {
  // `new Set over a literal` asserts `expect(v).toBeGreaterThan(0)` on each value —
  // that is not a lower bound on the domain size, so it must not read as a floor.
  const a = await analyzeOracle(cfg(root), "new Set over a literal");
  assert.notEqual(a.hasFloor, true);
});

test("LIVE — it.each over an imported registry is domain iteration", async () => {
  assert.equal(await verdict("live via it.each over an import"), "live");
});

test("LITERAL — it.each over an inline array is still a hand-list", async () => {
  assert.equal(await verdict("literal via it.each over an inline array"), "literal");
});
