// parity.test.ts — the parity claim: two functions declared PROJECTIONS OF ONE
// ENUMERATED DOMAIN that must AGREE over it. The boundary totality pattern generalized
// from coverage to agreement. These pin: the grammar (single home, parity.ts), the
// parity META-ORACLE's verdicts (an oracle must enumerate the DECLARED domain and drive
// BOTH projections — the motivating false oracle compared two runs of the SAME
// projector), and the claim form end-to-end through runVerify (anchoring included).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { parseParity, PARITY_RE } from "../src/parity.ts";
import { analyzeParityOracle } from "../src/oracle-domain.ts";
import { runVerify } from "../src/verify.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, sym, graph } from "./_helpers.ts";

const withProject = async (files: Record<string, string>, fn: (root: string) => Promise<void>) => {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
};

const CLAIM = 'parity "disclosure faithfulness" over TOOL_NAMES between toolActivity and messageProvenance via test "live equals settled"';

// ── the grammar ───────────────────────────────────────────────────────────────────────

test("parseParity — captures invariant, domain, both projections, and the oracle", () => {
  const p = parseParity(CLAIM)!;
  assert.deepEqual(p, {
    inv: "disclosure faithfulness", domain: "TOOL_NAMES",
    f: "toolActivity", g: "messageProvenance", oracle: "live equals settled",
  });
});

test("parseParity — the via test clause is REQUIRED (agreement without an oracle is an empty attestation)", () => {
  assert.equal(parseParity('parity "x" over D between f and g'), null);
  assert.equal(PARITY_RE.test('parity "x" over D between f and g via guard "g"'), false);
});

// ── the parity meta-oracle ────────────────────────────────────────────────────────────

const FIXTURE = (body: string) =>
  `import { TOOL_NAMES } from "./registry.ts";\n` +
  `import { toolActivity, messageProvenance, history } from "./patient.ts";\n` +
  `describe("live equals settled", () => {\n${body}\n});\n`;

const analyze = (root: string) =>
  analyzeParityOracle(cfg(root), "live equals settled", "TOOL_NAMES", "toolActivity", "messageProvenance");

test("meta-oracle — enumerates the domain and drives both projections: OK", async () => {
  await withProject({
    "x.test.ts": FIXTURE(`for (const name of TOOL_NAMES) { it(name, () => { expect(toolActivity(name)).toEqual(messageProvenance(name)); }); }`),
  }, async (root) => {
    const a = await analyze(root);
    assert.equal(a.verdict, "ok", a.detail);
  });
});

test("meta-oracle — ONE-SIDED: the motivating false oracle (two runs of the same projector) is refused", async () => {
  // Enumerates the domain, but exercises only messageProvenance (settled vs history
  // reload) — the live projection is never driven, so live/settled divergence sails.
  await withProject({
    "x.test.ts": FIXTURE(`for (const name of TOOL_NAMES) { it(name, () => { expect(messageProvenance(name)).toEqual(history(name)); }); }`),
  }, async (root) => {
    const a = await analyze(root);
    assert.equal(a.verdict, "one-sided");
    assert.match(a.detail, /toolActivity/);
  });
});

test("meta-oracle — NO-ENUMERATION: a hand-copied sample list is not a parity totality", async () => {
  await withProject({
    "x.test.ts": FIXTURE(`for (const name of ["set_field", "web_search"]) { it(name, () => { expect(toolActivity(name)).toEqual(messageProvenance(name)); }); }`),
  }, async (root) => {
    const a = await analyze(root);
    assert.equal(a.verdict, "no-enumeration");
    assert.match(a.detail, /never the declared domain/);
  });
});

test("meta-oracle — NO-ENUMERATION: hand-enumerated it() cases with no loop at all", async () => {
  await withProject({
    "x.test.ts": FIXTURE(`it("one case", () => { expect(toolActivity("set_field")).toEqual(messageProvenance("set_field")); });`),
  }, async (root) => {
    assert.equal((await analyze(root)).verdict, "no-enumeration");
  });
});

test("meta-oracle — helper unwraps count as enumeration (Object.keys over the registry)", async () => {
  await withProject({
    "x.test.ts":
      `import { TOOL_NAMES } from "./registry.ts";\nimport { toolActivity, messageProvenance } from "./p.ts";\n` +
      `describe("live equals settled", () => { Object.keys(TOOL_NAMES).forEach((n) => { expect(toolActivity(n)).toEqual(messageProvenance(n)); }); });`,
  }, async (root) => {
    assert.equal((await analyze(root)).verdict, "ok");
  });
});

test("meta-oracle — NOT-FOUND when no describe carries the exact title", async () => {
  await withProject({ "x.test.ts": `describe("something else", () => {});` }, async (root) => {
    assert.equal((await analyze(root)).verdict, "not-found");
  });
});

// ── the claim form, end-to-end through runVerify ─────────────────────────────────────

const GOOD_ORACLE = FIXTURE(
  `for (const name of TOOL_NAMES) { it(name, () => { expect(toolActivity(name)).toEqual(messageProvenance(name)); }); }`,
);
const SYMS = [sym("TOOL_NAMES", "registry.ts"), sym("toolActivity", "p.ts"), sym("messageProvenance", "p.ts")];

test("parity claim — anchors its invariant (satisfies the coverage ratchet) and passes with a well-shaped oracle", async () => {
  await withProject({ "x.test.ts": GOOD_ORACLE }, async (root) => {
    const g = graph([comp(".", { claims: [CLAIM], invariants: ["disclosure faithfulness"], why: "r" }), ...SYMS]);
    // --fast: the meta-oracle still runs (source analysis); the runner is skipped.
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /invariants: 1\/1 anchored/);
    assert.match(r.out, /parity oracle \(--fast\)/);
  });
});

test("parity claim — a missing projection symbol fails (the graph must hold all three)", async () => {
  await withProject({ "x.test.ts": GOOD_ORACLE }, async (root) => {
    const g = graph([comp(".", { claims: [CLAIM], invariants: ["disclosure faithfulness"], why: "r" }),
      sym("TOOL_NAMES", "registry.ts"), sym("toolActivity", "p.ts")]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /symbol "messageProvenance" not found/);
  });
});

test("parity claim — a one-sided oracle fails EVEN under --fast (the meta-oracle is not skippable)", async () => {
  await withProject({
    "x.test.ts": FIXTURE(`for (const name of TOOL_NAMES) { it(name, () => { expect(messageProvenance(name)).toBeTruthy(); }); }`),
  }, async (root) => {
    const g = graph([comp(".", { claims: [CLAIM], invariants: ["disclosure faithfulness"], why: "r" }), ...SYMS]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /\[parity\].*never exercises `toolActivity`/);
  });
});

test("parity claim — the oracle actually RUNS (a failing runner fails the claim)", async () => {
  // Fake runner: exit 1 always — the claim must go red on the executable arm.
  await withProject({ "x.test.ts": GOOD_ORACLE, "runner.js": "process.exit(1);" }, async (root) => {
    const g = graph([comp(".", { claims: [CLAIM], invariants: ["disclosure faithfulness"], why: "r" }), ...SYMS]);
    const r = await runCaptured(() =>
      runVerify(cfg(root, { test: ["node", join(root, "runner.js")] }), g, { fast: false, serial: true }));
    assert.equal(r.code, 1);
  });

  // And green when the runner passes — name-sensitively: the serial canary refuses a
  // runner that cannot fail, so the fake must red a name it does not know.
  await withProject({ "x.test.ts": GOOD_ORACLE, "runner.js": "process.exit(process.argv[2] === 'live equals settled' ? 0 : 1);" }, async (root) => {
    const g = graph([comp(".", { claims: [CLAIM], invariants: ["disclosure faithfulness"], why: "r" }), ...SYMS]);
    const r = await runCaptured(() =>
      runVerify(cfg(root, { test: ["node", join(root, "runner.js")] }), g, { fast: false, serial: true }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 green/); // pass details are not printed — green count is the evidence
  });
});
