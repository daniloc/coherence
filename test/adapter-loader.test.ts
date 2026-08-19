// adapter-loader.test.ts — the language seam is declared, project-extensible, and
// refuses rather than falls back. The `?? typescript` fallback this guards against
// meant a typo'd language name walked the wrong grammar with full confidence.
import test from "node:test";
import assert from "node:assert/strict";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";
import { buildGraph, resolveLanguageAdapter } from "../src/derive.ts";
import { Unrunnable } from "../src/floor.ts";

const TOY_ADAPTER = `// toy.mjs — a minimal LanguageAdapter for .toy files.
export default {
  exts: ["toy"],
  symbols(src) {
    return src.split("\\n").flatMap((l, i) =>
      l.startsWith("thing ") ? [{ name: l.slice(6).trim(), kind: "thing", line: i + 1 }] : []);
  },
  imports(src) {
    return src.split("\\n").flatMap((l) => l.startsWith("uses ") ? [l.slice(5).trim()] : []);
  },
  docAbove() { return ""; },
  fileDoc(lines) { return lines[0]?.startsWith(";") ? lines[0].slice(1).trim() : ""; },
};
`;

test("language adapter — a project path loads and shapes the graph; unknown names refuse, never fall back", async (t) => {
  await t.test("an unknown bare name refuses, naming the built-ins", async () => {
    const root = await tmpProject({
      "app.spec.md": "# app\n\nFixture.\n",
    });
    try {
      await assert.rejects(
        () => buildGraph(cfg(root, { language: "go" })),
        (e: unknown) => e instanceof Unrunnable
          && e.report.some((l) => l.includes("typescript") && l.includes("python"))
          && e.report.some((l) => l.includes(".coherence/adapters")),
        "a typo'd language must refuse with the live built-in list, not silently walk the TS grammar");
    } finally { await cleanup(root); }
  });

  await t.test("a project .coherence adapter loads and its symbols shape the graph", async () => {
    const root = await tmpProject({
      "app.spec.md": "# app\n\nFixture.\n",
      "widget.toy": "; the widget module\nthing Widget\nuses gadget\n",
      ".coherence/adapters/toy.mjs": TOY_ADAPTER,
    });
    try {
      const config = cfg(root, { language: "./.coherence/adapters/toy.mjs", codeExt: ["toy"] });
      const adapter = await resolveLanguageAdapter(config);
      assert.deepEqual(adapter.exts, ["toy"]);
      const graph = await buildGraph(config);
      const sym = graph.nodes.find((n) => n.kind === "symbol" && n.label.includes("Widget"));
      assert.ok(sym, `the custom adapter's symbols reach the graph: ${JSON.stringify(graph.nodes.filter((n) => n.kind === "symbol").map((n) => n.label))}`);
      const file = graph.nodes.find((n) => n.kind === "file" && (n.path ?? "").endsWith("widget.toy"));
      assert.ok(file, "the .toy file is walked under the custom extension");
    } finally { await cleanup(root); }
  });

  await t.test("a wrong-shaped adapter refuses naming the broken field", async () => {
    const root = await tmpProject({
      "app.spec.md": "# app\n\nFixture.\n",
      ".coherence/adapters/broken.mjs":
        'export default { exts: ["toy"], symbols() { return []; }, imports() { return []; }, docAbove() { return ""; } };\n',
    });
    try {
      await assert.rejects(
        () => resolveLanguageAdapter(cfg(root, { language: "./.coherence/adapters/broken.mjs" })),
        (e: unknown) => e instanceof Unrunnable && e.report.some((l) => l.includes("fileDoc")),
        "the refusal names the missing field, not just 'invalid adapter'");
    } finally { await cleanup(root); }
  });

  await t.test("a missing adapter file refuses with the resolved path", async () => {
    const root = await tmpProject({ "app.spec.md": "# app\n\nFixture.\n" });
    try {
      await assert.rejects(
        () => resolveLanguageAdapter(cfg(root, { language: "./.coherence/adapters/ghost.mjs" })),
        (e: unknown) => e instanceof Unrunnable && e.report.some((l) => l.includes("could not be imported")));
    } finally { await cleanup(root); }
  });

  await t.test("built-in names resolve through the memoized grammar registry", async () => {
    const root = await tmpProject();
    try {
      // Underscore avoids the unused-variable lint while proving both names resolve.
      const _ts = await resolveLanguageAdapter(cfg(root, { language: "typescript" }));
      const py = await resolveLanguageAdapter(cfg(root, { language: "python" }));
      assert.deepEqual(py.exts, ["py"]);
      assert.deepEqual(_ts.exts, ["ts"]);
    } finally { await cleanup(root); }
  });
});
