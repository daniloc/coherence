// derive.ts — build the coherence Graph from a project, using the walker plus the
// config-selected language and platform adapters. This is the ONE source every
// renderer and verify consumes (no second walk anywhere).
import { readFile } from "node:fs/promises";
import { join, basename, dirname, relative, resolve } from "node:path";
import type { Config, Graph, GraphNode, GraphEdge, LanguageAdapter, PlatformAdapter } from "./types.ts";
import { parseSpec, splitWhy, findSpec, nodeDirs, codeFiles, ownerOf } from "./walk.ts";
import { typescript } from "./adapters/typescript.ts";
import { cloudflare } from "./adapters/cloudflare.ts";

const LANGUAGES: Record<string, LanguageAdapter> = { typescript };
const PLATFORMS: Record<string, PlatformAdapter> = { cloudflare };

export async function buildGraph(cfg: Config): Promise<Graph> {
  const root = cfg.root;
  const lang = LANGUAGES[cfg.language] ?? typescript;
  const platform = cfg.platform ? PLATFORMS[cfg.platform] ?? null : null;

  const ignore = new Set(cfg.ignore);
  const extRe = new RegExp(`\\.(${cfg.codeExt.join("|")})$`);
  const skip = (n: string) =>
    n.startsWith(".") || n === "dev.log" || n === "package-lock.json" ||
    n === "AGENTS.md" || n.endsWith(".spec.md") || /^_.*\.html$/.test(n) || n === "graph.json";

  const dirs = await nodeDirs(root, ignore);
  const files = await codeFiles(root, ignore, extRe, skip);
  const bindings = platform ? await platform.bindings(root) : null;

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
    add({ id: compId(d), label: spec.name || basename(d), kind: "component", sub: spec.intent, claimed: spec.claims.length > 0, claims: spec.claims, prose: spec.prose || undefined, why: spec.why || undefined });
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
    add({ id: fileIds.get(f)!, parent: compId(owner), label: basename(f), kind: "file", sub: f, path: f, prose: fwhat, why: fwhy });
    if (!isCode) continue;

    for (const s of lang.symbols(src)) {
      const { what, why } = splitWhy(lang.docAbove(lines, s.line));
      add({ id: `s:${f}#${s.name}`, parent: fileIds.get(f), label: s.name, kind: "symbol", sub: s.kind, path: f, line: s.line, prose: what || undefined, why: why || undefined });
    }
    for (const spec of lang.imports(src)) {
      if (spec.startsWith(".")) {
        const target = relative(root, resolve(join(root, dirname(f)), spec));
        if (fileIds.has(target)) link(fileIds.get(f)!, fileIds.get(target)!, "imports");
      } else { const id = `x:${spec}`; add({ id, label: spec, kind: "external", sub: "module" }); link(fileIds.get(f)!, id, "imports"); }
    }
    for (const [bind, target] of Object.entries(targets)) if (new RegExp(`env\\.${bind}\\b`).test(src)) link(fileIds.get(f)!, target, "binds");
    for (const m of src.matchAll(/fetch\(\s*["']https?:\/\/([^"'/]+)/g)) { const id = `x:host:${m[1]}`; add({ id, label: m[1], kind: "external", sub: "service" }); link(fileIds.get(f)!, id, "calls"); }
  }

  return { generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + "Z", root: basename(resolve(root)), absRoot: resolve(root), nodes, edges, bindings };
}
