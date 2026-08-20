// cloudflare.ts — platform adapter: derive infra bindings from Cloudflare's two
// architectural declarations: wrangler configuration and direct Env property types.
// Optional deployment bindings may be commented out in wrangler while the committed
// code still supports them; the union keeps that capability in the graph without
// making one developer's provisioned resources an input to committed artifacts.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Query, type Node } from "web-tree-sitter";
import { grammarHandle, withTree } from "./tree-sitter.ts";
import type { PlatformAdapter, Bindings } from "../types.ts";

type Store = Bindings["stores"][number];
type StoreKind = "D1" | "KV" | "Vectorize" | "R2" | "Workers AI";

const STORE_TYPE_KIND: Record<string, StoreKind> = {
  D1Database: "D1",
  KVNamespace: "KV",
  VectorizeIndex: "Vectorize",
  R2Bucket: "R2",
  Ai: "Workers AI",
};

// Direct declarations only. Aliases and computed binding registries remain outside this
// grade; broad text matching would turn comments, examples, and generated declarations
// into architecture. The interface name predicate also reaches namespace Cloudflare {
// interface Env { … } }, Mnemion's committed optional-binding augmentation.
const ENV_BINDING_QUERY = `
  (interface_declaration
    name: (type_identifier) @env.name
    body: (interface_body
      (property_signature
        name: (property_identifier) @binding.name
        type: (type_annotation (_) @binding.type)))
    (#eq? @env.name "Env")) @env.interface
`;

let envHandle: Promise<{ parser: import("web-tree-sitter").Parser; query: Query }> | null = null;
function directEnvHandle(): Promise<{ parser: import("web-tree-sitter").Parser; query: Query }> {
  if (!envHandle) envHandle = grammarHandle("typescript")
    .then(({ language, parser }) => ({ parser, query: new Query(language, ENV_BINDING_QUERY) }));
  return envHandle;
}

/** Optionality is normally carried by `?`, outside the captured type. Also accept the
 *  equivalent direct `T | undefined | null` spelling without resolving aliases or
 *  wrappers — this remains a direct-declaration grade. */
function kindOfDirectType(type: string): StoreKind | null {
  const live = type.split("|").map((part) => part.trim())
    .filter((part) => part !== "undefined" && part !== "null");
  return live.length === 1 ? STORE_TYPE_KIND[live[0]] ?? null : null;
}

function kindOfStore(store: Store): StoreKind | null {
  if (store.sub === "D1" || store.sub.startsWith("D1 · ")) return "D1";
  return (["KV", "Vectorize", "R2", "Workers AI"] as const).find((kind) => store.sub === kind) ?? null;
}

const TOP_LEVEL_WRAPPERS = new Set(["ambient_declaration", "export_statement"]);
const MODULE_WRAPPERS = new Set(["ambient_declaration", "export_statement", "expression_statement"]);

function reachesProgram(node: Node, wrappers: ReadonlySet<string>): boolean {
  let current = node;
  while (current.parent && wrappers.has(current.parent.type)) current = current.parent;
  return current.parent?.type === "program";
}

/** An Env name is authoritative only at one of the two Cloudflare declaration homes:
 *  the module itself (`interface Env`, optionally export/declare wrapped), or the body
 *  of `namespace Cloudflare`. The namespace may itself be module-top-level or inside
 *  the standard `declare global { namespace Cloudflare { … } }` augmentation. An Env
 *  nested in a function/block or a foreign namespace is a local type, not infrastructure. */
function authoritativeEnv(iface: Node): boolean {
  if (reachesProgram(iface, TOP_LEVEL_WRAPPERS)) return true;

  const namespaceBody = iface.parent;
  const namespace = namespaceBody?.type === "statement_block" ? namespaceBody.parent : null;
  if (namespace?.type !== "internal_module" || namespace.childForFieldName("name")?.text !== "Cloudflare") return false;
  if (reachesProgram(namespace, MODULE_WRAPPERS)) return true;

  let wrappedNamespace: Node = namespace;
  while (wrappedNamespace.parent?.type === "expression_statement") wrappedNamespace = wrappedNamespace.parent;
  const globalBody = wrappedNamespace.parent;
  const globalDeclaration = globalBody?.type === "statement_block" ? globalBody.parent : null;
  return globalDeclaration?.type === "ambient_declaration"
    && /^declare\s+global\b/.test(globalDeclaration.text)
    && reachesProgram(globalDeclaration, TOP_LEVEL_WRAPPERS);
}

function addStore(
  stores: Map<string, Store>,
  incoming: Store,
  incomingFrom: "wrangler" | "Env",
): void {
  const incomingKind = kindOfStore(incoming);
  const canonical = incomingKind ? { ...incoming, sub: incomingKind } : incoming;
  const existing = stores.get(incoming.binding);
  if (!existing) { stores.set(incoming.binding, canonical); return; }
  const existingKind = kindOfStore(existing);
  if (existingKind !== incomingKind) {
    throw new Error(
      `Cloudflare binding ${JSON.stringify(incoming.binding)} has conflicting kinds: ${existingKind ?? existing.sub} and ${incomingKind ?? incoming.sub} (encountered in ${incomingFrom})`,
    );
  }
  // Equal declarations collapse to one canonical row, independent of which file or
  // deployment surface supplied it first.
}

async function storesFromDirectEnv(root: string, files: readonly string[]): Promise<Store[]> {
  const tsFiles = files.filter((file) => /\.(?:[cm]?ts|tsx)$/.test(file)).slice().sort();
  if (tsFiles.length === 0) return [];
  const { parser, query } = await directEnvHandle();
  const stores = new Map<string, Store>();
  for (const file of tsFiles) {
    const source = await readFile(join(root, file), "utf8");
    withTree(parser, source, null, (tree) => {
      for (const match of query.matches(tree.rootNode)) {
        let binding = "", type = "", iface: Node | null = null;
        for (const capture of match.captures) {
          if (capture.name === "binding.name") binding = capture.node.text;
          else if (capture.name === "binding.type") type = capture.node.text;
          else if (capture.name === "env.interface") iface = capture.node;
        }
        const kind = kindOfDirectType(type);
        if (!binding || !kind || !iface || !authoritativeEnv(iface)) continue;
        addStore(stores, { binding, label: binding, sub: kind }, "Env");
      }
      return null;
    });
  }
  return [...stores.values()];
}

function parseJsonc(text: string): any {
  let out = "", inStr = false, q = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (c === "\\") { out += text[++i]; continue; } if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; out += c; continue; }
    if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function fromConfig(cfg: any): Bindings {
  const stores: Bindings["stores"] = [];
  for (const d of cfg.d1_databases ?? []) stores.push({ binding: d.binding, label: d.binding, sub: "D1" });
  for (const k of cfg.kv_namespaces ?? []) stores.push({ binding: k.binding, label: k.binding, sub: "KV" });
  for (const v of cfg.vectorize ?? []) stores.push({ binding: v.binding, label: v.binding, sub: "Vectorize" });
  for (const r of cfg.r2_buckets ?? []) stores.push({ binding: r.binding, label: r.binding, sub: "R2" });
  if (cfg.ai?.binding) stores.push({ binding: cfg.ai.binding, label: cfg.ai.binding, sub: "Workers AI" });
  return {
    entities: (cfg.durable_objects?.bindings ?? []).map((b: any) => ({ name: b.name, className: b.class_name })),
    stores,
    vars: cfg.vars ?? {},
    meta: { entry: cfg.main ?? "", compat: cfg.compatibility_date ?? "" },
  };
}

// Minimal TOML reader for the wrangler subset we need: top-level keys, [tables],
// and [[array.of.tables]]. Enough for bindings; not a general TOML parser.
function parseWranglerToml(text: string): any {
  const root: any = {};
  let cur: any = root;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^\[\[(.+)\]\]$/.exec(line))) {
      const path = m[1].split(".");
      let node = root;
      for (let i = 0; i < path.length - 1; i++) node = (node[path[i]] ??= {});
      const key = path[path.length - 1];
      (node[key] ??= []).push((cur = {}));
    } else if ((m = /^\[(.+)\]$/.exec(line))) {
      const path = m[1].split(".");
      let node = root;
      for (const p of path) node = (node[p] ??= {});
      cur = node;
    } else if ((m = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line))) {
      let v: any = m[2].trim();
      if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
      else if (v === "true" || v === "false") v = v === "true";
      else if (/^-?\d+$/.test(v)) v = Number(v);
      cur[m[1]] = v;
    }
  }
  return root;
}

async function bindingsFromWrangler(root: string): Promise<Bindings | null> {
  const jsonc = await readFile(join(root, "wrangler.jsonc"), "utf8").catch(() => "");
  if (jsonc) { try { return fromConfig(parseJsonc(jsonc)); } catch { /* fall through */ } }
  const toml = await readFile(join(root, "wrangler.toml"), "utf8").catch(() => "");
  if (toml) { try { return fromConfig(parseWranglerToml(toml)); } catch { /* none */ } }
  return null;
}

/** The Cloudflare adapter chokepoint. Wrangler states what this checkout deploys; direct
 *  Env properties state what the committed program can use. Their union is sorted so
 *  toggling an already-declared optional binding cannot perturb graph byte order. */
export async function cloudflareBindings(root: string, files: readonly string[] = []): Promise<Bindings | null> {
  const [wrangler, sourceStores] = await Promise.all([
    bindingsFromWrangler(root),
    storesFromDirectEnv(root, files),
  ]);
  if (!wrangler && sourceStores.length === 0) return null;

  const stores = new Map<string, Store>();
  for (const store of wrangler?.stores ?? []) addStore(stores, store, "wrangler");
  for (const store of sourceStores) addStore(stores, store, "Env");
  const orderedStores = [...stores.values()].sort((a, b) =>
    a.binding < b.binding ? -1 : a.binding > b.binding ? 1 : 0);

  return {
    entities: wrangler?.entities ?? [],
    stores: orderedStores,
    vars: wrangler?.vars ?? {},
    meta: wrangler?.meta ?? { entry: "", compat: "" },
  };
}

export const cloudflare: PlatformAdapter = { bindings: cloudflareBindings };
