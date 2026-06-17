// cloudflare.ts — platform adapter: read infra bindings from wrangler config.
// Supports both wrangler.jsonc and wrangler.toml. All Cloudflare-specific knowledge
// lives here. Swap/omit for other platforms.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlatformAdapter, Bindings } from "../types.ts";

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
  for (const d of cfg.d1_databases ?? []) stores.push({ binding: d.binding, label: d.binding, sub: "D1 · " + (d.database_name ?? "") });
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

async function bindings(root: string): Promise<Bindings | null> {
  const jsonc = await readFile(join(root, "wrangler.jsonc"), "utf8").catch(() => "");
  if (jsonc) { try { return fromConfig(parseJsonc(jsonc)); } catch { /* fall through */ } }
  const toml = await readFile(join(root, "wrangler.toml"), "utf8").catch(() => "");
  if (toml) { try { return fromConfig(parseWranglerToml(toml)); } catch { /* none */ } }
  return null;
}

export const cloudflare: PlatformAdapter = { bindings };
