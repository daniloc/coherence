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


/** Markdown formatters (markdownlint/prettier --fix) escape `_` and `*` in prose —
 *  including inside claim lines (`at \_load` → unresolvable symbol). Claims are a
 *  grammar, not prose: strip those escapes so a formatted spec still parses. */
export const unescapeMd = (s: string) => s.replace(/\\([_*])/g, "$1");

export function parseSpec(text: string): ParsedSpec {
  const lines = text.split("\n");
  let name = "", intent = "", i = 0, intentLine = -1;
  for (; i < lines.length; i++) { const m = /^#\s+(.+?)\s*$/.exec(lines[i]); if (m) { name = m[1]; i++; break; } }
  // The intent is the first PARAGRAPH, not the first line. Specs are hard-wrapped at 80
  // columns, so reading one line chopped every intent mid-clause — and that text is what
  // the generated CLAUDE.md, the outline and the panel all show. `intentLine`
  // is the LAST line consumed, because the prose scan below starts after it.
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith("#")) break;
    const para: string[] = [];
    for (; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t || t.startsWith("#")) { i--; break; }
      para.push(t); intentLine = i;
    }
    intent = para.join(" ");
    break;
  }
  const claims: string[] = [];
  // A claim may carry a trailing KIND — `... via test "t" [structural]`. It is stripped
  // HERE, at the single parse site, so every downstream consumer (parseBoundary, the
  // coverage ratchet, panel/structural/promise, the status record's identity)
  // sees the exact string it saw before kinds existed. The precedent is the `crossing`
  // clause in src/boundary.ts: a purely declarative annotation must not leak into claim
  // identity, or annotating an existing claim orphans its history. Stripping it inside
  // evalClaim instead — which is what the first cut did — silently dropped every kinded
  // boundary out of the CLAUDE.md invariant table and the promise graph.
  const claimKinds: Record<string, string> = {};
  const ws = lines.findIndex((l) => /^##\s+works when\s*$/i.test(l));
  let we = -1;
  if (ws >= 0) { we = lines.length; for (let j = ws + 1; j < lines.length; j++) { if (/^##\s+/.test(lines[j])) { we = j; break; } const c = /^-\s+(.+?)\s*$/.exec(lines[j]); if (c) { const raw = unescapeMd(c[1]); const km = /\s*\[([A-Za-z][\w-]*)\]$/.exec(raw); const bare = km ? raw.slice(0, km.index) : raw; if (km) claimKinds[bare] = km[1]; claims.push(bare); } } }
  const wy = lines.findIndex((l) => /^##\s+why\s*$/i.test(l));
  let wye = -1, why = "";
  if (wy >= 0) { wye = lines.length; for (let j = wy + 1; j < lines.length; j++) if (/^##\s+/.test(lines[j])) { wye = j; break; } why = lines.slice(wy + 1, wye).join("\n").trim(); }
  // ## invariants — named properties this component upholds; each MUST be anchored by
  // a `boundary "<name>" ...` claim. Coverage fails an unanchored invariant (the ratchet).
  const invariants: string[] = [];
  const iv = lines.findIndex((l) => /^##\s+invariants\s*$/i.test(l));
  let ive = -1;
  if (iv >= 0) { ive = lines.length; for (let j = iv + 1; j < lines.length; j++) { if (/^##\s+/.test(lines[j])) { ive = j; break; } const c = /^-\s+(.+?)\s*$/.exec(lines[j]); if (c) invariants.push(c[1]); } }
  // ## refutations — the OBSERVED negative control for an invariant: what was broken,
  // and what was seen when it broke. Same bullet shape as ## invariants, keyed by the
  // invariant name. A claim nobody has watched fail is not evidence, so this is where
  // the evidence lives; verify reports coverage over it.
  const refutations: string[] = [];
  const rf = lines.findIndex((l) => /^##\s+refutations\s*$/i.test(l));
  let rfe = -1;
  if (rf >= 0) { rfe = lines.length; for (let j = rf + 1; j < lines.length; j++) { if (/^##\s+/.test(lines[j])) { rfe = j; break; } const c = /^-\s+(.+?)\s*$/.exec(lines[j]); if (c) refutations.push(c[1]); } }
  const prose: string[] = [];
  for (let k = (intentLine >= 0 ? intentLine + 1 : i); k < lines.length; k++) {
    if (ws >= 0 && k >= ws && k < we) continue;
    if (wy >= 0 && k >= wy && k < wye) continue;
    if (iv >= 0 && k >= iv && k < ive) continue;
    if (rf >= 0 && k >= rf && k < rfe) continue;
    prose.push(lines[k]);
  }
  return { name, intent, claims, claimKinds, prose: prose.join("\n").trim(), why, invariants, refutations };
}

/** One declared trust zone from a `## zones` section (PROMISE GRAPH topology). Parsed here
 *  because walk.ts is the single home of spec-section parsing; the promise layer is the only
 *  consumer, so zones ride as their own standalone parse rather than through ParsedSpec/the
 *  graph (nothing else needs them, and the graph stays untouched). */
export interface ParsedZone { name: string; intent: string; inside: string | null }

/** Parse a `## zones` section — same shape as `## invariants`: a bullet list, and the
 *  DECLARED ORDER is the canonical trust order (most-trusted first). Each line is either
 *  `- <name>: <intent>` or `- <name> inside <parent>: <intent>` (the `: <intent>` is
 *  optional — a bare `- <name>` or `- <name> inside <parent>` is a zone with "" intent).
 *  Single-home doctrine: only the ENTRY component's zones are authoritative, so this is run
 *  against the entry spec alone — a `## zones` in a non-entry spec is simply never read
 *  (ignored, not an error). Returns [] when the spec has no zones section. */
export function parseZones(text: string): ParsedZone[] {
  const lines = text.split("\n");
  const zs = lines.findIndex((l) => /^##\s+zones\s*$/i.test(l));
  if (zs < 0) return [];
  const zones: ParsedZone[] = [];
  for (let j = zs + 1; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break;
    const c = /^-\s+(.+?)\s*$/.exec(lines[j]);
    if (!c) continue;
    // Split the optional `: <intent>` tail off the `<name> [inside <parent>]` head.
    const colon = c[1].indexOf(":");
    const head = (colon >= 0 ? c[1].slice(0, colon) : c[1]).trim();
    const intent = colon >= 0 ? c[1].slice(colon + 1).trim() : "";
    const im = /^(\S+)\s+inside\s+(\S+)$/.exec(head);
    if (im) zones.push({ name: im[1], intent, inside: im[2] });
    else zones.push({ name: head.split(/\s+/)[0], intent, inside: null });
  }
  return zones;
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

/**
 * The deepest node dir that is a prefix of the file's dir — or NULL when no node dir owns
 * it at all.
 *
 * THE NULL IS THE POINT. This used to return `"."` unconditionally on a miss, which is
 * the same value it returns when a root `*.spec.md` genuinely owns the file, so no caller
 * could tell "the root component owns this" from "nothing owns this". On a project with
 * no root component that fabricated a component out of a miss, and
 * `affectedComponents` fed it straight into verify's scope set: measured 2026-07-31 on a
 * healthy two-component tree whose only change was an unowned root-level file, `verify
 * --staged` printed `scoped to 1 changed component(s): .`, graded `claims: 0 · 0 green`,
 * and pronounced `✓ coherent` — a LIVE vacuous green needing no mutation to reach.
 *
 * An unowned file is ordinary, not an error: a root config, a build script, a stray
 * module in a tree that is still being decomposed. So the miss is REPRESENTED rather than
 * refused, and each of the three callers says what it does with one (derive: an unparented
 * file node; verify and structural: out of every component's scope).
 */
export function ownerOf(fileRel: string, dirs: string[]): string | null {
  const d = dirname(fileRel) === "." ? "" : dirname(fileRel);
  let best: string | null = null;
  for (const nd of dirs) {
    const ndp = nd === "." ? "" : nd;
    if (ndp === "" || d === ndp || d.startsWith(ndp + "/")) if (ndp.length >= (best === null || best === "." ? 0 : best.length)) best = nd;
  }
  return best;
}
