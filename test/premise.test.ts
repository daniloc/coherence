// premise.test.ts — decision caches get structural expiry signals, not semantic theatre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendDecision, newSessionId, type DecisionRecord } from "../src/decisions.ts";
import {
  auditPremiseLeases, classifyPremiseReferent, extractPremiseReferents, normalizePremisePath,
  premise, premiseStructure, renderPremiseAudit,
} from "../src/premise.ts";
import { cleanup, cfg, fileNode, graph, runCaptured, sym, tmpProject } from "./_helpers.ts";

const decision = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: "d-a", session: "s-a", at: "2026-07-31T00:00:00.000Z", kind: "decision",
  agent: "test", job: "test", branch: "main", commit: "abc", dirty: false,
  chose: "keep the boundary", over: [], because: "it centralizes the check", ...over,
});

test("extraction — explicit files are strong leases and suppress heuristic prose mining", () => {
  const refs = extractPremiseReferents(decision({
    files: ["src/live.ts", "src/live.ts"],
    chose: "keep `OldThing` from src/old.ts:12",
    because: "README.md also describes it",
  }));
  assert.deepEqual(refs, [{ kind: "file", value: "src/live.ts", source: "files", strength: "strong" }]);
});

test("extraction — fallback paths and code-shaped backticks are conservative", () => {
  const refs = extractPremiseReferents(decision({
    chose: "call `buildGraph` from src/derive.ts:44; do not lease `ordinary` or `--fast`",
    because: "`Graph.nodes` is described in README.md, while producer/consumer is prose",
  }));
  assert.deepEqual(refs, [
    { kind: "file", value: "README.md", source: "because-path", strength: "inferred" },
    { kind: "file", value: "src/derive.ts", source: "chose-path", strength: "inferred" },
    { kind: "symbol", value: "buildGraph", source: "chose-symbol", strength: "inferred" },
    { kind: "symbol", value: "Graph.nodes", source: "because-symbol", strength: "inferred" },
  ]);
});

test("path normalization — locations collapse and paths outside the project are refused", () => {
  assert.equal(normalizePremisePath("./src/x.ts:12:4"), "src/x.ts");
  assert.equal(normalizePremisePath("src/x.ts#L12"), "src/x.ts");
  assert.equal(normalizePremisePath("../outside.ts"), null);
  assert.equal(normalizePremisePath("/elsewhere/x.ts", "/project"), null);
  assert.equal(normalizePremisePath("/project/src/x.ts", "/project"), "src/x.ts");
});

test("classification — files distinguish live, missing, and a conservative move candidate", () => {
  const structure = premiseStructure(graph([
    fileNode("src/live.ts", "."), fileNode("src/new/renamed.ts", "."),
  ]));
  const ref = (value: string) => ({ kind: "file", value, source: "files", strength: "strong" } as const);
  assert.equal(classifyPremiseReferent(ref("src/live.ts"), structure).status, "valid");
  assert.equal(classifyPremiseReferent(ref("src/gone.ts"), structure).status, "missing");
  assert.deepEqual(classifyPremiseReferent(ref("src/old/renamed.ts"), structure), {
    ...ref("src/old/renamed.ts"), status: "moved-or-ambiguous", matches: ["src/new/renamed.ts"],
  });
});

test("classification — symbols are valid only when unique and otherwise say ambiguous", () => {
  const structure = premiseStructure(graph([
    sym("buildGraph", "src/a.ts"), sym("run()", "src/a.ts"), sym("run()", "src/b.ts"),
  ]));
  const ref = (value: string) => ({ kind: "symbol", value, source: "chose-symbol", strength: "inferred" } as const);
  assert.equal(classifyPremiseReferent(ref("buildGraph"), structure).status, "valid");
  assert.deepEqual(classifyPremiseReferent(ref("Runner.run()"), structure).matches, ["src/a.ts#run()", "src/b.ts#run()"]);
  assert.equal(classifyPremiseReferent(ref("Runner.run()"), structure).status, "moved-or-ambiguous");
  assert.equal(classifyPremiseReferent(ref("RemovedThing"), structure).status, "missing");
});

test("audit — retracted decisions disappear and only broken strong leases fail a check", () => {
  const old = decision({ id: "d-old", files: ["src/old.ts"] });
  const retract = decision({ id: "d-r", kind: "retraction", supersedes: "d-old", chose: "withdraw old" });
  const strong = decision({ id: "d-strong", files: ["src/gone.ts"] });
  const inferred = decision({ id: "d-inferred", chose: "retain `GoneThing`", files: undefined });
  const audits = auditPremiseLeases([old, retract, strong, inferred], graph([]));
  assert.deepEqual(audits.map((a) => [a.decisionId, a.status, a.checkFailure]), [
    ["d-inferred", "missing", false],
    ["d-strong", "missing", true],
  ]);
});

test("audit — a strong lease on a path the SAME decision records deleting is satisfied-by-deletion, never a gate failure", () => {
  // The eviction decision's lease can never resolve again — the act it records is what
  // emptied the address. Absence IS this premise holding (d-f241c582 named the hole).
  const evicted = decision({ id: "d-evicted", chose: "evicted the scene command wholesale: scene.ts + render-scene.ts", files: ["src/scene.ts", "src/render-scene.ts"] });
  const lost = decision({ id: "d-lost", chose: "anchor the walker here", files: ["src/gone.ts"] });
  const audits = auditPremiseLeases([evicted, lost], graph([]));
  const byId = new Map(audits.map((a) => [a.decisionId, a]));
  assert.deepEqual(byId.get("d-evicted")!.leases.map((l) => l.status), ["satisfied-by-deletion", "satisfied-by-deletion"]);
  assert.equal(byId.get("d-evicted")!.status, "valid");
  assert.equal(byId.get("d-evicted")!.checkFailure, false);
  assert.equal(byId.get("d-lost")!.checkFailure, true, "a missing strong lease with NO recorded deletion still fails — the cue must not loosen the gate");
});

test("render — findings are keyed and actionable; unleased decisions stay a coverage count", () => {
  const audits = auditPremiseLeases([
    decision({ id: "d-missing", files: ["src/gone.ts"] }),
    decision({ id: "d-unleased" }),
  ], graph([]));
  const text = renderPremiseAudit(audits);
  assert.match(text, /semantic premises checked: NO/);
  assert.match(text, /d-missing  missing  \[CHECK\]/);
  assert.match(text, /coherence retract d-missing/);
  assert.match(text, /1 unleased/);
  assert.doesNotMatch(text, /d-unleased/, "no structural address means there is no actionable stale-address row");
});

test("command — report advises, while check fails only a missing explicit file lease", async () => {
  const root = await tmpProject({ "src/live.ts": "export const live = true;\n" });
  const project = cfg(root);
  const session = newSessionId();
  appendDecision(project, {
    kind: "decision", chose: "live", because: "exists", files: ["src/live.ts"], session, now: "2026-07-31T00:00:00.000Z",
  });
  appendDecision(project, {
    kind: "decision", chose: "gone", because: "used to exist", files: ["src/gone.ts"], session, now: "2026-07-31T00:01:00.000Z",
  });
  appendDecision(project, {
    kind: "decision", chose: "`MissingSymbol`", because: "prose inference", session, now: "2026-07-31T00:02:00.000Z",
  });
  const g = graph([fileNode("src/live.ts", ".")]);
  g.absRoot = root;

  const report = await runCaptured(() => premise(project, g, "report"));
  const check = await runCaptured(() => premise(project, g, "check"));
  assert.equal(report.code, 0);
  assert.equal(check.code, 1);
  assert.match(check.out, /premise --check FAILED/);
  assert.match(check.out, /semantic premises checked: NO/);
  assert.doesNotMatch(check.out, /src\/live\.ts: missing/, "the command must consult the current filesystem");
  await cleanup(root);
});
