// walk.ts — THE single spec-tree walker (consolidates the two that used to exist).
// Language/platform-agnostic: spec parsing + node/file enumeration. Used by derive,
// which is in turn used by every renderer and by verify.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import type { ParsedSpec } from "./types.ts";

/** Split a docblock/section into its derivable description (what) and its protected rationale (@why). */
export function splitWhy(text: string): { what: string; why: string } {
  if (!text) return { what: "", why: "" };
  const idx = text.search(/(^|\n)\s*@why\b/);
  if (idx < 0) return { what: text.trim(), why: "" };
  return { what: text.slice(0, idx).trim(), why: text.slice(idx).replace(/^\s*\n?\s*@why\b[ :]*/, "").trim() };
}

export function parseSpec(text: string): ParsedSpec {
  const lines = text.split("\n");
  let name = "", intent = "", i = 0, intentLine = -1;
  for (; i < lines.length; i++) { const m = /^#\s+(.+?)\s*$/.exec(lines[i]); if (m) { name = m[1]; i++; break; } }
  for (; i < lines.length; i++) { const l = lines[i].trim(); if (!l) continue; if (l.startsWith("#")) break; intent = l; intentLine = i; break; }
  const claims: string[] = [];
  const ws = lines.findIndex((l) => /^##\s+works when\s*$/i.test(l));
  let we = -1;
  if (ws >= 0) { we = lines.length; for (let j = ws + 1; j < lines.length; j++) { if (/^##\s+/.test(lines[j])) { we = j; break; } const c = /^-\s+(.+?)\s*$/.exec(lines[j]); if (c) claims.push(c[1]); } }
  const wy = lines.findIndex((l) => /^##\s+why\s*$/i.test(l));
  let wye = -1, why = "";
  if (wy >= 0) { wye = lines.length; for (let j = wy + 1; j < lines.length; j++) if (/^##\s+/.test(lines[j])) { wye = j; break; } why = lines.slice(wy + 1, wye).join("\n").trim(); }
  const prose: string[] = [];
  for (let k = (intentLine >= 0 ? intentLine + 1 : i); k < lines.length; k++) {
    if (ws >= 0 && k >= ws && k < we) continue;
    if (wy >= 0 && k >= wy && k < wye) continue;
    prose.push(lines[k]);
  }
  return { name, intent, claims, prose: prose.join("\n").trim(), why };
}

export async function findSpec(dir: string): Promise<string | null> {
  const e = await readdir(dir).catch(() => []);
  const s = e.find((f) => f.endsWith(".spec.md"));
  return s ? join(dir, s) : null;
}

/** Folders that contain a *.spec.md, relative to root (root = "."). */
export async function nodeDirs(root: string, ignore: Set<string>): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    if (await findSpec(dir)) out.push(relative(root, dir) || ".");
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory() && !ignore.has(e.name) && !e.name.startsWith(".")) await visit(join(dir, e.name));
    }
  }
  await visit(root);
  return out;
}

export async function codeFiles(root: string, ignore: Set<string>, extRe: RegExp, skip: (n: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || ignore.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await visit(p);
      else if (!skip(e.name) && extRe.test(e.name)) out.push(relative(root, p));
    }
  }
  await visit(root);
  return out;
}

/** the deepest node dir that is a prefix of file's dir */
export function ownerOf(fileRel: string, dirs: string[]): string {
  const d = dirname(fileRel) === "." ? "" : dirname(fileRel);
  let best = ".";
  for (const nd of dirs) {
    const ndp = nd === "." ? "" : nd;
    if (ndp === "" || d === ndp || d.startsWith(ndp + "/")) if (ndp.length >= (best === "." ? 0 : best.length)) best = nd;
  }
  return best;
}
