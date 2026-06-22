// verify.test.ts — the claim engine end-to-end, driven through runVerify against a
// hand-built graph + a throwaway project. Covers the deterministic claim verifiers, the
// boundary ratchet (chokepoint must exist; invariant must be anchored), the meta-oracle
// integration, and the testMatch evidence rule — the regression that "a renamed test
// silently stays green" specifically broke and that this rule exists to catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runVerify } from "../src/verify.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, sym, graph } from "./_helpers.ts";

const withProject = async (
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
) => {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
};

test("structural — `exists at root` passes when the file is present, fails when absent", async () => {
  await withProject({ "present.txt": "" }, async (root) => {
    const okG = graph([comp(".", { claims: ["present.txt exists at root"], why: "r" })]);
    const ok = await runCaptured(() => runVerify(cfg(root), okG, {}));
    assert.equal(ok.code, 0);
    assert.match(ok.out, /1 green/);

    const badG = graph([comp(".", { claims: ["missing.txt exists at root"], why: "r" })]);
    const bad = await runCaptured(() => runVerify(cfg(root), badG, {}));
    assert.equal(bad.code, 1);
    assert.match(bad.out, /coherence failure/);
  });
});

test("structural — `imports` checks the source actually imports the module", async () => {
  await withProject({ "a.ts": 'import x from "./b";\n', "yes.txt": "" }, async (root) => {
    const okG = graph([comp(".", { claims: ["a.ts imports ./b", "yes.txt exists at root"], why: "r" })]);
    assert.equal((await runCaptured(() => runVerify(cfg(root), okG, {}))).code, 0);
  });
  await withProject({ "a.ts": "const x = 1;\n" }, async (root) => {
    const badG = graph([comp(".", { claims: ["a.ts imports ./b"], why: "r" })]);
    assert.equal((await runCaptured(() => runVerify(cfg(root), badG, {}))).code, 1);
  });
});

test("boundary — a chokepoint symbol absent from the graph fails the claim", async () => {
  await withProject({}, async (root) => {
    const g = graph([comp(".", { claims: ['boundary "x" at MissingSym via guard "g"'], invariants: ["x"], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /chokepoint symbol "MissingSym" not found/);
  });
});

test("RATCHET — a declared invariant with no anchoring boundary fails coverage", async () => {
  await withProject({}, async (root) => {
    // "guarded" is anchored by the boundary claim; "orphan" is declared but nothing anchors it.
    const g = graph([
      comp(".", { claims: ['boundary "guarded" at Choke via guard "g"'], invariants: ["guarded", "orphan"], why: "r" }),
      sym("Choke"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /invariant "orphan".*not anchored/);
  });
});

test("RATCHET — a fully anchored invariant set is coherent (the green baseline)", async () => {
  await withProject({}, async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "guarded" at Choke via guard "g"'], invariants: ["guarded"], why: "r" }),
      sym("Choke"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 0);
    assert.match(r.out, /✓ coherent/);
  });
});

test("META-ORACLE — a `via test` boundary whose oracle loops a LITERAL fails", async () => {
  await withProject({ "o.test.ts": 'describe("lit oracle", () => { ["a"].forEach((x) => {}); });\n' }, async (root) => {
    const g = graph([
      comp(".", { claims: ['boundary "y" at ChokeY via test "lit oracle"'], invariants: ["y"], why: "r" }),
      sym("ChokeY"),
    ]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /iterates a LITERAL domain/);
  });
});

test("META-ORACLE — a `via test` boundary whose oracle loops a LIVE domain passes the meta-check", async () => {
  await withProject(
    { "o.test.ts": 'import { REG } from "./r.ts";\ndescribe("live oracle", () => { for (const x of REG) { expect(x).toBeDefined(); } });\n' },
    async (root) => {
      const g = graph([
        comp(".", { claims: ['boundary "z" at ChokeZ via test "live oracle"'], invariants: ["z"], why: "r" }),
        sym("ChokeZ"),
      ]);
      // --fast skips the actual runner; the meta-oracle (live-domain check) still runs and must pass.
      const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
      assert.equal(r.code, 0);
      assert.doesNotMatch(r.out, /LITERAL|NO domain/);
    },
  );
});

test("testMatch — a runner exiting 0 with no matching output FAILS (the renamed-test trap)", async () => {
  await withProject({}, async (root) => {
    const c = cfg(root, { test: ["node", "-e", "process.exit(0)"], testMatch: "RAN" });
    const g = graph([comp(".", { claims: ['passes test "ghost"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(c, g, {}));
    assert.equal(r.code, 1);
    assert.match(r.out, /matched no run/);
  });
});

test("testMatch — a runner that emits the expected token passes", async () => {
  await withProject({}, async (root) => {
    const c = cfg(root, { test: ["node", "-e", "console.log('RAN ok')"], testMatch: "RAN" });
    const g = graph([comp(".", { claims: ['passes test "real"'], why: "r" })]);
    const r = await runCaptured(() => runVerify(c, g, {}));
    assert.equal(r.code, 0);
  });
});

test("coverage — a component with no claims, or no why, fails loudly", async () => {
  await withProject({ "present.txt": "" }, async (root) => {
    const noClaims = graph([comp(".", { claims: [], why: "r" })]);
    const a = await runCaptured(() => runVerify(cfg(root), noClaims, {}));
    assert.equal(a.code, 1);
    assert.match(a.out, /has no claims/);

    // claim passes (present.txt exists) so the failure is isolated to the missing why
    const noWhy = graph([comp(".", { claims: ["present.txt exists at root"] })]);
    const b = await runCaptured(() => runVerify(cfg(root), noWhy, {}));
    assert.equal(b.code, 1);
    assert.match(b.out, /states no rationale/);
  });
});
