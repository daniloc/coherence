// derive.ts — build the coherence Graph from a project, using the walker plus the
// config-selected language and platform adapters. This is the ONE source every
// renderer and verify consumes (no second walk anywhere).
import { readFile } from "node:fs/promises";
import { join, basename, dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Config, Graph, GraphNode, GraphEdge, LanguageAdapter, PlatformAdapter } from "./types.ts";
import { parseSpec, splitWhy, findSpec, nodeDirs, codeFiles, ownerOf } from "./walk.ts";
import { Unrunnable, requireDeclaredRoot } from "./floor.ts";
import { BUILTIN_LANGUAGES, makeTreeSitterAdapter } from "./adapters/tree-sitter.ts";
import { registerLanguagePack, registeredPack, type LanguagePack } from "./language-registry.ts";
import { cloudflare } from "./adapters/cloudflare.ts";

const PLATFORMS: Record<string, PlatformAdapter> = { cloudflare };

/** Which field of a would-be adapter is wrong, or null when the shape is complete.
 *  Named fields in the refusal, because "invalid adapter" sends the author back to the
 *  docs while "`fileDoc` must be a function" sends them to the line that needs one. */
function adapterShapeProblem(a: unknown): string | null {
  if (!a || typeof a !== "object") return "the module exports no adapter (a default export or a named `adapter` export is expected)";
  const o = a as Record<string, unknown>;
  if (!Array.isArray(o.exts) || o.exts.length === 0 || !o.exts.every((e) => typeof e === "string")) {
    return "`exts` must be a non-empty array of extension strings";
  }
  for (const fn of ["symbols", "imports", "docAbove", "fileDoc"] as const) {
    if (typeof o[fn] !== "function") return `\`${fn}\` must be a function`;
  }
  return null;
}

const projectAdapters = new Map<string, Promise<LanguageAdapter>>();

/**
 * Resolve `cfg.language` to an adapter: a built-in name, or a `./`-relative project
 * module (conventionally `.coherence/adapters/<lang>.mjs`) exporting a LanguageAdapter,
 * a `languagePack`, or both.
 *
 * AN UNKNOWN BARE NAME REFUSES. The `?? typescript` fallback this replaces meant
 * `"language": "go"` silently walked Go files with the TypeScript grammar and reported
 * on the garbage with full confidence — the same walking-a-DIFFERENT-tree failure
 * loadConfig refuses for when the config itself is unreadable. Importing a project
 * module executes project code, which is the trust the atlas already declares at the
 * loadConfig crossing: running the harness in a tree executes that tree's config.
 *
 * THE ONE PROJECT PATH INTO THE INSTRUMENTS. A module's `languagePack` export is DATA the
 * loader registers (purity-checked; a relative `grammar` resolves against the module), so
 * its rows reach surface, sites, sinks, and oracle as the built-ins' do — and its `graph`
 * spec builds the adapter when the module exports none. The loader registers rather than
 * the module calling the registry itself: the package exports no entry a project could
 * import, and a module bound to a different install's registry would register into a
 * copy no instrument reads. Memoized per module path, so every command that needs the
 * rows registered can call this first at no cost.
 */
export async function resolveLanguageAdapter(cfg: Config): Promise<LanguageAdapter> {
  const name = cfg.language;
  // Built-ins are grammar-backed (memoized wasm load; grammars/ ships with the package).
  // The regex adapters they replaced were corpus-diffed to parity first and live in git
  // history — one spelling of "how coherence reads a language", not two.
  const builtin = BUILTIN_LANGUAGES[name];
  if (builtin) return builtin();
  if (name.startsWith("./") || name.startsWith("../")) {
    const path = resolve(cfg.root, name);
    let cached = projectAdapters.get(path);
    if (!cached) { cached = loadProjectLanguage(name, path); projectAdapters.set(path, cached); }
    return cached;
  }
  throw new Unrunnable([
    `✗ [config] "language": ${JSON.stringify(name)} is not a language coherence knows`,
    `  built-ins: ${Object.keys(BUILTIN_LANGUAGES).join(" · ")}`,
    `  or a project adapter: "./.coherence/adapters/<lang>.mjs" — a module exporting a LanguageAdapter or a languagePack`,
    `  Refusing rather than falling back: walking ${JSON.stringify(name)} files with the`,
    "  typescript grammar would grade a DIFFERENT tree than you configured, with full confidence.",
  ]);
}

/** Import one project language module: register its pack, then return its adapter —
 *  the module's own, else one built from the pack's `graph` spec. */
async function loadProjectLanguage(name: string, path: string): Promise<LanguageAdapter> {
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(path).href) as Record<string, unknown>;
  } catch (error) {
    throw new Unrunnable([
      `✗ [config] "language": ${JSON.stringify(name)} could not be imported`,
      `  ${path}`,
      `  ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const pack = mod.languagePack as LanguagePack | undefined;
  if (pack !== undefined) {
    const located = pack && typeof pack === "object" && typeof pack.grammar === "string"
      ? { ...pack, grammar: resolve(dirname(path), pack.grammar) } : pack;
    let held: LanguagePack;
    try {
      held = registerLanguagePack(located) ? located : registeredPack(located.name)!;
    } catch (error) {
      throw new Unrunnable([
        `✗ [config] "language": ${JSON.stringify(name)} exports a languagePack coherence cannot register`,
        ...(error instanceof Error ? error.message : String(error)).split("\n").map((l) => `  ${l.trim()}`),
      ]);
    }
    // The graph reads the HELD pack too: a historic worktree copy derives with today's
    // spec and grammar, which also exists where the worktree's untracked files do not.
    if (mod.default === undefined && mod.adapter === undefined && held.graph) {
      return makeTreeSitterAdapter(held.graph, held.grammar);
    }
  }
  const candidate = mod.default ?? mod.adapter;
  const problem = adapterShapeProblem(candidate);
  if (problem) {
    throw new Unrunnable([
      `✗ [config] "language": ${JSON.stringify(name)} does not export a LanguageAdapter`,
      `  ${problem}`,
      `  required shape: { exts: string[], symbols(src), imports(src), docAbove(lines, line), fileDoc(lines) }`,
      `  or a \`languagePack\` export whose \`graph\` spec builds one`,
    ]);
  }
  return candidate as LanguageAdapter;
}

/** THE documented-symbol predicate — one spelling, homed with the code that SETS `prose`
 *  (the `add({ …, prose: what || undefined })` call below). verify's coverage line
 *  ("symbols N/M documented"), its `[doc]` jobs, and mass's `undocumented|symbols`
 *  dimension all read this, so a symbol the coverage advisory calls undocumented is
 *  exactly one the ratchet counts. It was spelled twice inside verify.ts alone before this
 *  — the harness's own `redundancy` finding, fixed the way that advisory prescribes:
 *  derive one spelling from the other, here by deleting the others. */
export const isDocumented = (n: GraphNode): boolean => !!(n.prose && String(n.prose).trim());

export async function buildGraph(cfg: Config): Promise<Graph> {
  requireDeclaredRoot(cfg); // the walk floor: an undeclared tree is refused, never wandered
  const root = cfg.root;
  const lang = await resolveLanguageAdapter(cfg);
  const platform = cfg.platform ? PLATFORMS[cfg.platform] ?? null : null;

  const ignore = new Set(cfg.ignore);
  const extRe = new RegExp(`\\.(${cfg.codeExt.join("|")})$`);
  const skip = (n: string) =>
    n.startsWith(".") || n === "dev.log" || n === "package-lock.json" ||
    n === "AGENTS.md" || n.endsWith(".spec.md") || /^_.*\.html$/.test(n) || n === "graph.json";

  const dirs = await nodeDirs(root, ignore);
  const files = await codeFiles(root, ignore, extRe, skip);
  // The platform adapter receives THIS walk's exact file population rather than
  // walking independently. That keeps ignored generated files (notably Cloudflare's
  // worker-configuration.d.ts) from becoming machine-local graph inputs.
  const bindings = platform ? await platform.bindings(root, files) : null;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (n: GraphNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
  const link = (source: string, target: string, kind: string) => {
    const id = `${source}->${target}:${kind}`;
    if (source !== target && !edges.some((e) => e.id === id)) edges.push({ id, source, target, kind });
  };
  const compId = (d: string) => `c:${d}`;
  const langExt = new RegExp(`\\.(${lang.exts.join("|")})$`);

  // components (spec nodes)
  const classToDir: Record<string, string> = {};
  for (const d of dirs) {
    const spec = parseSpec(await readFile((await findSpec(join(root, d === "." ? "" : d)))!, "utf8"));
    add({ id: compId(d), label: spec.name || basename(d), kind: "component", sub: spec.intent, claimed: spec.claims.length > 0, claims: spec.claims, prose: spec.prose || undefined, why: spec.why || undefined, invariants: spec.invariants.length ? spec.invariants : undefined, refutations: spec.refutations.length ? spec.refutations : undefined, claimKinds: Object.keys(spec.claimKinds).length ? spec.claimKinds : undefined });
    classToDir[spec.name || basename(d)] = d;
  }

  // platform bindings → infra nodes + binding→target map (generic wiring over adapter data)
  const targets: Record<string, string> = {};
  if (bindings) {
    for (const e of bindings.entities) { const dir = classToDir[e.className]; if (dir) targets[e.name] = compId(dir); }
    for (const s of bindings.stores) { const id = `i:${s.binding}`; add({ id, label: s.label, kind: "infra", sub: s.sub }); targets[s.binding] = id; }
  }

  // files, symbols (language adapter), edges
  const fileIds = new Map(files.map((f) => [f, `f:${f}`]));
  for (const f of files) {
    const owner = ownerOf(f, dirs);
    const isCode = langExt.test(f);
    const src = isCode ? await readFile(join(root, f), "utf8") : "";
    const lines = src.split("\n");
    let fwhat: string | undefined, fwhy: string | undefined;
    if (isCode) { const r = splitWhy(lang.fileDoc(lines)); fwhat = r.what || undefined; fwhy = r.why || undefined; }
    // An UNOWNED file (no *.spec.md above it — a root config, a build script, a module in
    // a tree still being decomposed) gets NO parent, rather than a parent pointing at a
    // `c:.` node that may not exist. mass.ts has always had the "(unowned)" branch for
    // this; until `ownerOf` could say null, that branch was unreachable and the dangling
    // parent was silent instead.
    add({ id: fileIds.get(f)!, parent: owner === null ? undefined : compId(owner), label: basename(f), kind: "file", sub: f, path: f, prose: fwhat, why: fwhy });
    if (!isCode) continue;

    for (const s of lang.symbols(src)) {
      const { what, why } = splitWhy(lang.docAbove(lines, s.line));
      add({ id: `s:${f}#${s.name}`, parent: fileIds.get(f), label: s.name, kind: "symbol", sub: s.kind, path: f, line: s.line, prose: what || undefined, why: why || undefined });
    }
    for (const spec of lang.imports(src)) {
      if (spec.startsWith(".")) {
        const target = relative(root, resolve(join(root, dirname(f)), spec));
        // A specifier may name the file exactly (`./data.ts`, Node-style), omit the
        // extension (`./data`, bundler-style), or name a directory (`./data` →
        // data/index.ts). Try all three shapes — extensionless projects otherwise
        // derive ZERO internal import edges, silently starving every consumer of
        // the structure graph (decompose hubs, the contract's reliances).
        const candidates = [target, ...lang.exts.map((e) => `${target}.${e}`), ...lang.exts.map((e) => join(target, `index.${e}`))];
        const hit = candidates.find((t) => fileIds.has(t));
        if (hit) link(fileIds.get(f)!, fileIds.get(hit)!, "imports");
      } else { const id = `x:${spec}`; add({ id, label: spec, kind: "external", sub: "module" }); link(fileIds.get(f)!, id, "imports"); }
    }
    for (const [bind, target] of Object.entries(targets)) if (new RegExp(`env\\.${bind}\\b`).test(src)) link(fileIds.get(f)!, target, "binds");
    for (const m of src.matchAll(/fetch\(\s*["']https?:\/\/([^"'/]+)/g)) { const id = `x:host:${m[1]}`; add({ id, label: m[1], kind: "external", sub: "service" }); link(fileIds.get(f)!, id, "calls"); }
  }

  // `root` is the project's NAME as every artifact renders it. Declared wins; the
  // directory basename is the fallback, and it is the only value here that is not a
  // function of the tracked tree (see Config.name — an undeclared name makes
  // `docs --check` report byte-correct artifacts stale in any checkout whose directory
  // is named differently). `absRoot` is deliberately still the absolute path: it is
  // normalized away by the staleness comparison rather than committed as truth.
  return { generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + "Z", root: cfg.name?.trim() || basename(resolve(root)), absRoot: resolve(root), nodes, edges, bindings };
}
