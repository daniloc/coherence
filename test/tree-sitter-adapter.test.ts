// tree-sitter-adapter.test.ts — the grammar-backed adapter serves the SAME seam the
// regex adapters do: a real ruby parse becomes graph symbols, import edges, and prose,
// reached through a project-local adapter module with top-level await.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";
import { buildGraph } from "../src/derive.ts";
import { makeTreeSitterAdapter, ruby } from "../src/adapters/tree-sitter.ts";

const HARNESS = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUBY_WASM = join(HARNESS, "node_modules", "tree-sitter-ruby", "tree-sitter-ruby.wasm");

const RUBY_SRC = `# frozen_string_literal: true
# Renders order status badges.
require "json"
require_relative "domain"

STATUS_BADGE = { "paid" => "green" }.freeze

# The one renderer every surface calls.
class BadgeRenderer
  def render(status)
    STATUS_BADGE.fetch(status)
  end

  def self.default
    new
  end
end

module Formatting
  def self.wrap(text)
    "[#{text}]"
  end
end
`;

test("tree-sitter — a grammar-backed adapter derives ruby symbols, imports, and prose through the same seam", async (t) => {
  await t.test("the factory's adapter reads symbols, imports, and docs from a real parse", async () => {
    const adapter = await makeTreeSitterAdapter(ruby, RUBY_WASM);
    assert.deepEqual(adapter.exts, ["rb"]);
    const symbols = adapter.symbols(RUBY_SRC);
    const byName = new Map(symbols.map((s) => [s.name, s.kind]));
    assert.equal(byName.get("BadgeRenderer"), "class");
    assert.equal(byName.get("Formatting"), "module");
    assert.equal(byName.get("STATUS_BADGE"), "const");
    assert.equal(byName.get("render()"), "method", "methods carry the () spelling both regex adapters use");
    assert.equal(byName.get("default()"), "method", "singleton methods count");
    assert.deepEqual(adapter.imports(RUBY_SRC), ["json", "domain"]);
    const lines = RUBY_SRC.split("\n");
    const renderer = symbols.find((s) => s.name === "BadgeRenderer")!;
    assert.equal(adapter.docAbove(lines, renderer.line), "The one renderer every surface calls.");
    assert.match(adapter.fileDoc(lines), /Renders order status badges/);
  });

  await t.test("a project-local adapter module with top-level await drives buildGraph", async () => {
    const root = await tmpProject({
      "app.spec.md": "# app\n\nRuby fixture.\n\n## works when\n\n- badge.rb exists at this node\n",
      "badge.rb": RUBY_SRC,
    });
    try {
      await mkdir(join(root, ".coherence", "adapters"), { recursive: true });
      await writeFile(join(root, ".coherence", "adapters", "ruby.mjs"), [
        `import { makeTreeSitterAdapter, ruby } from ${JSON.stringify(join(HARNESS, "src", "adapters", "tree-sitter.ts"))};`,
        `export default await makeTreeSitterAdapter(ruby, ${JSON.stringify(RUBY_WASM)});`,
        "",
      ].join("\n"));
      const graph = await buildGraph(cfg(root, {
        language: "./.coherence/adapters/ruby.mjs",
        codeExt: ["rb"],
      }));
      const symbolLabels = graph.nodes.filter((n) => n.kind === "symbol").map((n) => n.label);
      assert.ok(symbolLabels.some((l) => l.includes("BadgeRenderer")),
        `ruby symbols reach the graph through the seam: ${JSON.stringify(symbolLabels)}`);
      assert.ok(symbolLabels.some((l) => l.includes("render()")));
      const file = graph.nodes.find((n) => n.kind === "file" && (n.path ?? "").endsWith("badge.rb"));
      assert.ok(file, "the .rb file is walked");
      assert.match(file!.prose ?? "", /Renders order status badges/,
        "fileDoc prose survives into the graph node");
    } finally { await cleanup(root); }
  });
});
