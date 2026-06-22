// structural.test.ts — the temporal ledger that powers `coherence log [--strict]`. Its
// whole job is to make a LOSS loud: a dropped invariant, a removed boundary anchor, or a
// silently-rewired chokepoint is exactly the diff a prose review misses. diffGraphs is the
// pure core; renderDiff returns the loss count that --strict turns into a nonzero exit.
import test from "node:test";
import assert from "node:assert/strict";
import { diffGraphs, renderDiff, allBoundaries } from "../src/structural.ts";
import { graph, comp } from "./_helpers.ts";
import { runCaptured } from "./_helpers.ts";

const losses = async (before: ReturnType<typeof graph>, after: ReturnType<typeof graph>) =>
  (await runCaptured(async () => renderDiff(diffGraphs(before, after), "A", "B"))).code;

test("diffGraphs — a removed boundary anchor is recorded as a loss", () => {
  const before = graph([comp(".", { label: "Hive", claims: ['boundary "egress" at seal via test "egress totality"'], invariants: ["egress"], why: "r" })]);
  const after = graph([comp(".", { label: "Hive", claims: [], invariants: ["egress"], why: "r" })]);
  const d = diffGraphs(before, after);
  assert.equal(d.boundaryRemoved.length, 1);
  assert.equal(d.boundaryRemoved[0].b.inv, "egress");
});

test("diffGraphs — a removed invariant is a loss", () => {
  const before = graph([comp(".", { label: "Hive", invariants: ["egress", "writes"], why: "r" })]);
  const after = graph([comp(".", { label: "Hive", invariants: ["writes"], why: "r" })]);
  const d = diffGraphs(before, after);
  assert.deepEqual(d.invRemoved, [{ comp: "Hive", inv: "egress" }]);
});

test("diffGraphs — a rewired chokepoint is flagged (not silently accepted)", () => {
  const before = graph([comp(".", { label: "Hive", claims: ['boundary "egress" at oldSeal via test "egress totality"'], invariants: ["egress"], why: "r" })]);
  const after = graph([comp(".", { label: "Hive", claims: ['boundary "egress" at newSeal via test "egress totality"'], invariants: ["egress"], why: "r" })]);
  const d = diffGraphs(before, after);
  assert.equal(d.boundaryRewired.length, 1);
  assert.equal(d.boundaryRewired[0].before.chokepoint, "oldSeal");
  assert.equal(d.boundaryRewired[0].after.chokepoint, "newSeal");
});

test("diffGraphs — additions are tracked but are not losses", () => {
  const before = graph([comp(".", { label: "Hive", invariants: ["egress"], why: "r" })]);
  const after = graph([
    comp(".", { label: "Hive", claims: ['boundary "egress" at seal via guard "g"'], invariants: ["egress", "writes"], why: "r" }),
    comp("new", { label: "New", why: "r" }),
  ]);
  const d = diffGraphs(before, after);
  assert.deepEqual(d.componentsAdded, ["New"]);
  assert.deepEqual(d.invAdded, [{ comp: "Hive", inv: "writes" }]);
  assert.equal(d.boundaryAdded.length, 1);
  assert.equal(d.invRemoved.length + d.boundaryRemoved.length + d.componentsRemoved.length, 0);
});

test("renderDiff — counts losses (the number --strict gates on)", async () => {
  const before = graph([comp(".", { label: "Hive", claims: ['boundary "egress" at seal via guard "g"'], invariants: ["egress"], why: "r" })]);
  const dropped = graph([comp(".", { label: "Hive", claims: [], invariants: [], why: "r" })]);
  assert.equal(await losses(before, dropped), 1 + 1); // invariant removed + boundary removed
  // a no-op diff has zero losses
  assert.equal(await losses(before, before), 0);
});

test("allBoundaries — keyed by chokepoint symbol, first declaration wins", () => {
  const g = graph([
    comp("a", { label: "A", claims: ['boundary "x" at seal via test "t1"'] }),
    comp("b", { label: "B", claims: ['boundary "y" at seal via test "t2"'] }), // same chokepoint, ignored
    comp("c", { label: "C", claims: ['boundary "z" at mint via guard "g"'] }),
  ]);
  const all = allBoundaries(g);
  assert.equal(all.size, 2);
  assert.equal(all.get("seal")!.inv, "x");
  assert.equal(all.get("seal")!.component, "A");
  assert.equal(all.get("mint")!.verb, "guard");
});
