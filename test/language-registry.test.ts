// language-registry.test.ts — a project's registered pack reaches every instrument the
// built-ins reach, through the loader, as data; anything else refuses by name. The
// fixture language reads `.rbx` files, an extension no built-in row claims, so every
// finding below exists only because the registered rows were consulted.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpProject, cleanup, cfg } from "./_helpers.ts";
import { resolveLanguageAdapter } from "../src/derive.ts";
import { analyzeOracle } from "../src/oracle-domain.ts";
import { registerLanguagePack, registeredPack } from "../src/language-registry.ts";
import { Unrunnable } from "../src/floor.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "src", "cli.ts");
const RUBY_WASM = join(REPO, "grammars", "tree-sitter-ruby.wasm");
const exec = promisify(execFile);

/** A toy language over the vendored ruby grammar, one row per instrument. The grammar
 *  path is relative to the module, as a project would vendor it beside its adapter. */
const packModule = (name: string, grammar: string) => `export const languagePack = {
  name: ${JSON.stringify(name)},
  grammar: ${JSON.stringify(grammar)},
  graph: {
    exts: ["rbx"],
    symbolQuery: "(method name: (identifier) @method) (assignment left: (constant) @const)",
    importQuery: '(call method: (identifier) @_r arguments: (argument_list (string (string_content) @spec)) (#match? @_r "^require_relative$"))',
    lineComment: "#",
  },
  surface: { ext: /\\.rbx$/, grammar: ${JSON.stringify(name)}, testPath: /_check\\.rbx$/,
    query: "(program (method name: (identifier) @export))" },
  sites: { ext: /\\.rbx$/, grammar: ${JSON.stringify(name)}, strings: "raw", compare: "operand",
    query: "(assignment left: (constant) @var.name right: (_) @var.init) @var.decl (array) @list.body (array (string) @list.item) @list.of (array (_) @list.alt) @list.of (comment) @skip" },
  sinks: { ext: ".rbx", grammar: ${JSON.stringify(name)}, sql: "text-shape", query: "(string (interpolation) @expr) @str" },
  oracle: {
    grade: "indent-regex",
    testFilePattern: /_check\\.rbx$/,
    anchorPatterns: ["^(\\\\s*)def\\\\s+{name}\\\\b"],
    domainPatterns: [/([A-Z]\\w*)\\.each\\b/],
    importPatterns: { fromImport: /^require_relative\\s+(\\S+)$/, plainImport: /^require\\s+(\\S+)$/ },
    literalDomainPatterns: [/^\\[/],
    floorPattern: /\\.size\\s*>=?\\s*\\d/,
    unwrapCalls: [],
    detailTemplates: {
      "inline-literal": "inline {expr40}", "call": "each over {expr}", "imported": "each over {expr}",
      "live-local": "each over {expr}", "const-array": "inline {expr40}", "call-root": "each over {expr}",
      "opaque-root": "each over {expr}", "unresolved": "each over {expr}",
    },
    noIterationDetail: "no each over a domain",
  },
};
`;

const fixture = (name: string, module = packModule(name, RUBY_WASM)) => ({
  "coherence.config.json": JSON.stringify({ language: "./.coherence/adapters/rbx.mjs", codeExt: ["rbx"], sources: ["lib"] }),
  "app.spec.md": "# app\n\nFixture.\n\n## why\n\nA fixture needs a reason too.\n",
  ".coherence/adapters/rbx.mjs": module,
  "lib/colors.rbx": "# the palette\nCOLORS = [\"crimson\", \"teal\", \"amber\", \"ochre\"]\ndef paint(table)\n  \"SELECT * FROM #{table} WHERE shade = 1\"\nend\n",
  "lib/theme.rbx": "PALETTE = [\"crimson\", \"teal\", \"amber\", \"ochre\"]\n",
  "lib/colors_check.rbx": "def every_color\n  COLORS.each { |c| paint(c) }\nend\n",
});

async function run(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return exec(process.execPath, [CLI, ...args], { cwd: root })
    .then((r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }))
    .catch((e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
}

test("language registry — a registered pack reaches sinks, sites, surface and oracle; a function field or a built-in name refuses", async (t) => {
  await t.test("lint-sinks, redundancy and signal subprocesses each read the project pack's rows", async () => {
    // The committed module's surface row reads nothing (the fixture has no classes); the
    // patch replaces it. Only a run that registers the CURRENT module first sees exports.
    // The grammar is untracked, like one under node_modules: the before-side worktree
    // lacks it, so its graph must derive from the held pack, not the historic copy.
    const current = packModule("rbx-reg", "../../vendor/grammar.wasm");
    const historic = current.replace("(program (method name: (identifier) @export))", "(program (class name: (constant) @export))");
    const root = await tmpProject({ ...fixture("rbx-reg", historic), ".gitignore": "vendor/\n" });
    try {
      spawnSync("mkdir", ["-p", join(root, "vendor")]);
      spawnSync("cp", [RUBY_WASM, join(root, "vendor", "grammar.wasm")]);
      const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
      git("init", "-q");
      git("add", "-A");
      git("-c", "user.email=guard@example.com", "-c", "user.name=guard", "commit", "-qm", "base");
      await writeFile(join(root, ".coherence/adapters/rbx.mjs"), current);

      const sinks = await run(root, ["lint-sinks"]);
      assert.equal(sinks.code, 0, sinks.stderr);
      assert.match(sinks.stdout, /SQL identifier \("\$\{expr\}"\): 1\b/, `the registered sinks row found the SQL interpolation\n${sinks.stdout}`);

      const sites = await run(root, ["redundancy"]);
      assert.equal(sites.code, 0, sites.stderr);
      assert.match(sites.stdout, /lib\/colors\.rbx:2 {2}list `COLORS`/, `the registered sites row spelled the domain\n${sites.stdout}`);
      assert.match(sites.stdout, /lib\/theme\.rbx:1 {2}list `PALETTE`/);
      assert.doesNotMatch(sites.stdout, /colors_check/, "the pack's testPath keeps its tests out of the site walk");

      // signal's before side imports the historic module from a worktree. The current tree
      // registers first and wins, so both sides read today's rows and the export count
      // moves by exactly the one method the patch adds — historic-first would read +0.
      await appendFile(join(root, "lib/theme.rbx"), "def launch\nend\n");
      const signal = await run(root, ["signal"]);
      assert.equal(signal.code, 0, signal.stderr);
      assert.match(signal.stdout, /surface \+1 exports/, `the registered surface row read both sides\n${signal.stdout}`);
    } finally { await cleanup(root); }
  });

  await t.test("the loader registers in-process: graph, oracle and a module-relative grammar", async () => {
    const root = await tmpProject(fixture("rbx-oracle", packModule("rbx-oracle", "../../grammar.wasm")));
    try {
      spawnSync("cp", [RUBY_WASM, join(root, "grammar.wasm")]);
      const config = cfg(root, { language: "./.coherence/adapters/rbx.mjs", codeExt: ["rbx"] });
      const adapter = await resolveLanguageAdapter(config);
      assert.deepEqual(adapter.exts, ["rbx"], "the pack's graph spec built the adapter");
      assert.equal(registeredPack("rbx-oracle")?.grammar, join(root, "grammar.wasm"), "a relative grammar resolves against the module");
      const oracle = await analyzeOracle(config, "every_color");
      assert.equal(oracle.verdict, "live", `the registered oracle row discovered and read the test file: ${JSON.stringify(oracle)}`);
      assert.equal(oracle.file, "lib/colors_check.rbx");
    } finally { await cleanup(root); }
  });

  await t.test("a function field refuses by path, through the loader and directly", async () => {
    const impure = packModule("rbx-impure", RUBY_WASM).replace(`sql: "text-shape",`, `sql: "text-shape", accept: () => true,`);
    const root = await tmpProject(fixture("rbx-impure", impure));
    try {
      await assert.rejects(
        () => resolveLanguageAdapter(cfg(root, { language: "./.coherence/adapters/rbx.mjs", codeExt: ["rbx"] })),
        (e: unknown) => e instanceof Unrunnable && e.report.some((l) => l.includes("pack.sinks.accept is a function")),
        "a pack carrying code refuses before any instrument trusts it");
      assert.equal(registeredPack("rbx-impure"), undefined, "nothing was registered");
    } finally { await cleanup(root); }
  });

  await t.test("a built-in name refuses; a second registration of a name is ignored", () => {
    assert.throws(() => registerLanguagePack({ name: "typescript", grammar: RUBY_WASM }), /built-in language/);
    const first = { name: "rbx-first-wins", grammar: RUBY_WASM, sinks: { ext: ".rbx", grammar: "rbx-first-wins", sql: "text-shape" as const, query: "(string) @str" } };
    assert.equal(registerLanguagePack(first), true);
    assert.equal(registerLanguagePack({ ...first, sinks: { ...first.sinks, query: "(comment) @str" } }), false);
    assert.equal(registeredPack("rbx-first-wins"), first, "the first registration holds the slot");
  });
});
