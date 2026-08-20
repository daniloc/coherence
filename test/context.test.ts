// context.test.ts — task-addressed context must make omissions visible, not merely return
// a plausible packet. The pure layer is driven by a hand-built graph and journal so tests
// pin ownership, one-hop directionality, anchor extraction, test relevance, journal status,
// deterministic rendering, and unresolved selectors without touching Git.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  contextFor, contextFromProject, gitContextPaths, looksLikeTestPath, normalizeContextPath,
  renderContext, renderContextProjection, repositoryContextPaths,
} from "../src/context.ts";
import type { DecisionRecord } from "../src/decisions.ts";
import { cfg, cleanup, comp, fileNode, graph, imp, sym, tmpProject } from "./_helpers.ts";

const BOUNDARY = 'boundary "validated writes" at seal crossing input -> store via test "seal rejects every invalid kind"';
const PARITY = 'parity "wire agreement" over KINDS between encode and decode via test "wire roundtrip"';

const G = graph([
  comp("core", {
    label: "Core", intent: "Own validated writes", why: "One choke point keeps callers honest.",
    invariants: ["validated writes", "wire agreement"], claims: [BOUNDARY, PARITY, "typechecks"],
  }),
  comp("ui", { label: "UI", intent: "Present writes", why: "Rendering stays outside the core.", claims: ["typechecks"] }),
  fileNode("src/core.ts", "core"),
  { ...sym("seal", "src/core.ts"), line: 10, sub: "function" },
  { ...sym("encode", "src/core.ts"), line: 20, sub: "function" },
  { ...sym("decode", "src/core.ts"), line: 30, sub: "function" },
  { ...sym("KINDS", "src/core.ts"), line: 2, sub: "const" },
  fileNode("src/dep.ts", "core"),
  fileNode("src/user.ts", "ui"),
  fileNode("test/core.test.ts", "core"),
  fileNode("test/unrelated.test.ts", "ui"),
  { id: "x:node:fs", label: "node:fs", kind: "external", sub: "module" },
], [
  imp("src/core.ts", "src/dep.ts"),
  imp("src/user.ts", "src/core.ts"),
  imp("test/core.test.ts", "src/core.ts"),
  { id: "ext", source: "f:src/core.ts", target: "x:node:fs", kind: "imports" },
]);

const rec = (o: Partial<DecisionRecord> & Pick<DecisionRecord, "id" | "kind" | "chose">): DecisionRecord => ({
  session: "s-test", at: "2026-07-31T10:00:00.000Z", agent: "agent", job: "context",
  branch: "main", commit: "abc", dirty: false, over: [], because: "evidence", ...o,
});

const records: DecisionRecord[] = [
  rec({ id: "d-file", kind: "decision", chose: "keep core narrow", files: ["src/core.ts"], because: "measured import fan-in" }),
  rec({ id: "d-symbol", kind: "decision", chose: "seal is the only write choke point", because: "callers route through seal" }),
  rec({ id: "d-noise", kind: "decision", chose: "change the website color", files: ["src/user.ts"] }),
  rec({ id: "b-core", kind: "blocked", chose: "cannot migrate seal callers", files: ["src/core.ts"], because: "one caller has no write authority" }),
  rec({ id: "q-open", kind: "conjecture", chose: "wire roundtrip may miss a member", because: "compare KINDS against the oracle", couldBe: ["the test is stale"] }),
  rec({ id: "q-closed", kind: "conjecture", chose: "seal may accept blank input", because: "probe seal", couldBe: ["guard bug"] }),
  rec({ id: "r-closed", kind: "resolution", chose: "guard is total", supersedes: "q-closed", because: "the probe rejected every blank" }),
  rec({ id: "d-old", kind: "decision", chose: "put seal in the UI", because: "old plan" }),
  rec({ id: "r-old", kind: "retraction", chose: "keep seal in core", supersedes: "d-old", because: "UI has no storage authority" }),
];

test("contextFor — file selection returns ownership, intent/why, invariants and parsed anchors", () => {
  const result = contextFor(G, { files: ["./src/core.ts"] }, records);
  assert.deepEqual(result.selection.files, ["src/core.ts"]);
  assert.deepEqual(result.components, [{
    name: "Core", dir: "core", intent: "Own validated writes", why: "One choke point keeps callers honest.",
    invariants: ["validated writes", "wire agreement"],
  }]);
  assert.deepEqual(result.obligations.map((o) => [o.kind, o.invariant, o.chokepoints, o.oracles]), [
    ["boundary", "validated writes", ["seal"], ["seal rejects every invalid kind"]],
    ["claim", undefined, [], []],
    ["parity", "wire agreement", ["encode", "decode"], ["wire roundtrip"]],
  ]);
});

test("contextFor — imports are one-hop, directional, internal + external, and deterministic", () => {
  const result = contextFor(G, { files: ["src/core.ts"] });
  assert.deepEqual(result.imports, [
    { from: "src/core.ts", to: "node:fs", external: true },
    { from: "src/core.ts", to: "src/dep.ts", external: false },
  ]);
  assert.deepEqual(result.importers, [
    { from: "src/user.ts", to: "src/core.ts", external: false },
    { from: "test/core.test.ts", to: "src/core.ts", external: false },
  ]);
  assert.ok(!result.imports.some((e) => e.to === "src/user.ts"), "an importer must not be relabelled as a dependency");
});

test("contextFor — symbol selection resolves all definitions and pulls their owning files", () => {
  const duplicate = graph([...G.nodes, { ...sym("seal", "src/other.ts"), line: 4 }, fileNode("src/other.ts", "ui")], G.edges);
  const result = contextFor(duplicate, { symbols: ["seal", "missing"] });
  assert.deepEqual(result.selection.files, ["src/core.ts", "src/other.ts"]);
  assert.deepEqual(result.selection.requestedSymbols.map((s) => `${s.path}:${s.line}`), ["src/core.ts:10", "src/other.ts:4"]);
  assert.deepEqual(result.selection.unresolvedSymbols, ["missing"]);
  assert.match(result.limitations.at(-1)!, /1 selector/);
});

test("contextFor — changed paths compose with explicit files and unknown paths stay loud", () => {
  const result = contextFor(G, { files: ["src/dep.ts"], changedFiles: ["src/core.ts", "README.md", "src/core.ts"] });
  assert.deepEqual(result.selection.files, ["src/core.ts", "src/dep.ts"]);
  assert.deepEqual(result.selection.unresolvedFiles, ["README.md"]);
  assert.match(renderContext(result), /Unresolved files: `README\.md`/);
});

test("contextFor — test relevance prefers structural reasons and includes same-owner tests", () => {
  const result = contextFor(G, { files: ["src/core.ts"] });
  assert.deepEqual(result.tests, [{ path: "test/core.test.ts", reason: "direct importer" }]);
  assert.equal(looksLikeTestPath("component.spec.md"), false, "a coherence spec is not a test");
  assert.equal(looksLikeTestPath("src/widget.spec.ts"), true);
});

test("contextFor — journal shows matching standing decisions + OPEN conjectures only", () => {
  const result = contextFor(G, { files: ["src/core.ts"] }, records);
  assert.deepEqual(result.journal.decisions.map((d) => d.id), ["d-file", "d-symbol"]);
  assert.deepEqual(result.journal.openConjectures.map((d) => d.id), ["q-open"]);
  assert.deepEqual(result.journal.blocked.map((d) => d.id), ["b-core"]);
  assert.ok(!JSON.stringify(result.journal).includes("q-closed"), "resolved questions are not open context");
  assert.ok(!JSON.stringify(result.journal).includes("d-old"), "retracted choices are not standing context");
  assert.ok(!JSON.stringify(result.journal).includes("d-noise"), "a neighboring file alone is not a journal intersection");
  assert.deepEqual(result.journal.decisions[0].matchedBy, ["file:src/core.ts", "text:Core"]);
  assert.ok(result.journal.decisions[1].matchedBy.includes("text:seal"));
});

test("contextFor — injected non-graph paths resolve as repository surfaces without invented ownership", () => {
  const paths = [
    "README.md", "package.json", "coherence.config.json", ".github/workflows/ci.yml",
    "scripts/release.sh", ".codex/hooks.json", "generated/report.json",
  ];
  const result = contextFor(G, { files: [...paths, "absent.txt"] }, records, { repositoryFiles: paths });
  assert.deepEqual(result.selection.files, [...paths].sort());
  assert.deepEqual(result.selection.unresolvedFiles, ["absent.txt"]);
  assert.ok(result.selection.surfaces.every((surface) =>
    surface.source === "repository" && surface.graphOwner === null));
  assert.deepEqual(result.components, [], "directory proximity must not manufacture graph ownership");
  assert.match(renderContext(result), /README\.md — outside source graph; graph ownership unavailable/);
  assert.match(result.limitations.join("\n"), /7 selected repository surface\(s\)/);
});

test("renderContext — byte-stable for the same inputs and names every approximation", () => {
  // Same content-id retried later in another session: resolve keeps one. Input order must
  // not decide whether the early or late copy supplies the rendered timestamp.
  const duplicate = { ...records[0], session: "s-later", at: "2026-07-31T11:00:00.000Z" };
  const withDuplicate = [...records, duplicate];
  const a = renderContext(contextFor(G, { files: ["src/core.ts"] }, withDuplicate));
  const b = renderContext(contextFor(G, { files: ["src/core.ts"] }, [...withDuplicate].reverse()));
  assert.equal(a, b, "journal input order must not perturb an agent-facing packet");
  assert.match(a, /One choke point keeps callers honest/);
  assert.match(a, /Imports\/importers are static graph edges one hop/);
  assert.match(a, /Journal file matches are exact and prose matches are lexical/);
});

test("normalizeContextPath — absolute editor paths under graph root become graph-relative", () => {
  const rooted = { ...G, absRoot: "/work/project" };
  assert.equal(normalizeContextPath(rooted, "/work/project/src/core.ts"), "src/core.ts");
  assert.equal(normalizeContextPath(rooted, "src\\core.ts"), "src/core.ts");
});

test("contextFromProject — existing ignored artifacts and tracked deletions resolve at the repository edge", async (t) => {
  const root = await tmpProject({
    "README.md": "read me\n",
    "dist/generated.json": "{}\n",
    ".github/workflows/ci.yml": "name: ci\n",
  });
  t.after(() => cleanup(root));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  git("add", "README.md", ".github/workflows/ci.yml");
  assert.equal(git("commit", "-q", "-m", "base").status, 0);
  await unlink(join(root, "README.md"));

  const rooted = { ...G, absRoot: root };
  const projectCfg = cfg(root);
  const known = repositoryContextPaths(projectCfg, rooted, ["dist/generated.json"]);
  assert.ok(known.includes("README.md"), "Git keeps a deleted tracked surface addressable");
  assert.ok(known.includes("dist/generated.json"), "an explicitly requested ignored artifact resolves by existence");

  const result = contextFromProject(projectCfg, rooted, {
    files: ["README.md", "dist/generated.json", ".github/workflows/ci.yml", "missing.md", "/etc/passwd"],
  });
  assert.deepEqual(result.selection.files, [".github/workflows/ci.yml", "README.md", "dist/generated.json"]);
  assert.deepEqual(result.selection.unresolvedFiles, ["/etc/passwd", "missing.md"]);
  assert.ok(result.selection.surfaces.every((surface) => surface.source === "repository"));
});

test("renderContext — bounded projection is route-first, byte-stable, and accounts for every omission", () => {
  const why = `WHY_HEAD ${"rationale ".repeat(900)} WHY_SENTINEL_END`;
  const extraTests = Array.from({ length: 9 }, (_, i) => fileNode(`test/same-${i}.test.ts`, "core"));
  const budgetGraph = graph(G.nodes.map((node) => node.id === "c:core" ? { ...node, why } : node).concat(extraTests), G.edges);
  const longDecision = rec({
    id: "d-long", kind: "decision", files: ["src/core.ts"],
    chose: `DECISION_HEAD ${"choice ".repeat(120)} DECISION_SENTINEL_END`,
    because: `BECAUSE_HEAD ${"evidence ".repeat(120)} BECAUSE_SENTINEL_END`,
    at: "2026-07-31T12:00:00.000Z",
  });
  const aResult = contextFor(budgetGraph, { files: ["src/core.ts"] }, [...records, longDecision]);
  const bResult = contextFor(budgetGraph, { files: ["src/core.ts"] }, [longDecision, ...records].reverse());
  const a = renderContextProjection(aResult, { maxBytes: 3_500 });
  const b = renderContextProjection(bResult, { maxBytes: 3_500 });

  assert.equal(a.text, b.text);
  assert.equal(a.renderedBytes, Buffer.byteLength(a.text));
  assert.ok(a.renderedBytes <= 3_500);
  assert.equal(a.mode, "bounded");
  const sections = [
    "Selection / repository surfaces", "Owner / intent", "Governing obligations",
    "Standing decisions", "Blocked", "Open conjectures", "Direct dependencies", "Relevant tests",
  ];
  for (let i = 1; i < sections.length; i++)
    assert.ok(a.text.indexOf(sections[i - 1]) < a.text.indexOf(sections[i]), `${sections[i]} must follow ${sections[i - 1]}`);
  assert.ok(!a.text.includes("DECISION_SENTINEL_END"), "bounded journal summaries are excerpts");
  assert.ok(!a.text.includes("WHY_SENTINEL_END"), "bounded mode never dumps the whole component why");
  assert.ok(a.withholding.some((entry) => entry.reason === "same-component test cap" && entry.items === 5));
  assert.ok(a.withholding.some((entry) => entry.reason === "bounded entry excerpt"));
  assert.match(a.text, new RegExp(`Withheld: ${a.withheldItems} item\\(s\\), ${a.withheldBytes} byte\\(s\\)`));
  for (const entry of a.withholding)
    assert.match(a.text, new RegExp(`${entry.reason}: ${entry.items} item\\(s\\), ${entry.bytes} byte\\(s\\)`));

  const allBounded = renderContextProjection(aResult, { maxBytes: 100_000 });
  const cappedTestBytes = Array.from({ length: 5 }, (_, i) =>
    Buffer.byteLength(`  test/same-${i + 4}.test.ts — same owning component\n`))
    .reduce((sum, bytes) => sum + bytes, 0);
  const excerptBytes = [why, longDecision.chose, longDecision.because]
    .map((text) => Buffer.byteLength(text.replace(/\s+/g, " ").trim()) - 317)
    .reduce((sum, bytes) => sum + bytes, 0);
  assert.deepEqual(allBounded.withholding, [
    { reason: "same-component test cap", items: 5, bytes: cappedTestBytes },
    { reason: "bounded entry excerpt", items: 3, bytes: excerptBytes },
  ], "withholding is independently reproducible from the five capped tests and three 320-byte excerpts");
  assert.equal(allBounded.withheldItems, 8);
  assert.equal(allBounded.withheldBytes, cappedTestBytes + excerptBytes);

  const expanded = renderContext(aResult, { maxBytes: 3_500, expand: true });
  assert.equal(expanded, renderContext(aResult), "no budget remains the byte-compatible legacy expansion path");
  assert.match(expanded, /WHY_SENTINEL_END/);
  assert.match(expanded, /test\/same-8\.test\.ts/);
  let refused: unknown;
  try { renderContextProjection(aResult, { maxBytes: 100 }); } catch (error) { refused = error; }
  assert.ok(refused instanceof RangeError);
  const minimum = Number(refused.message.match(/minimum is (\d+)/)?.[1]);
  assert.ok(Number.isSafeInteger(minimum));
  assert.ok(renderContextProjection(aResult, { maxBytes: minimum }).renderedBytes <= minimum,
    "the reported minimum must be sufficient, including the decimal width of its own Limit field");
});

test("gitContextPaths — staged reads only the index; changed includes unstaged + untracked", async (t) => {
  const root = await tmpProject({ "a.ts": "a\n", "b.ts": "b\n" });
  t.after(() => cleanup(root));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  git("add", "a.ts", "b.ts");
  assert.equal(git("commit", "-q", "-m", "base").status, 0, "fixture must have a HEAD so staged and changed are distinct");
  await writeFile(join(root, "a.ts"), "staged\n");
  git("add", "a.ts");
  await writeFile(join(root, "b.ts"), "unstaged\n");
  await writeFile(join(root, "new.ts"), "untracked\n");

  assert.deepEqual(gitContextPaths(cfg(root), "staged"), ["a.ts"]);
  assert.deepEqual(gitContextPaths(cfg(root), "changed"), ["a.ts", "b.ts", "new.ts"]);
});
