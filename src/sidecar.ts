// sidecar.ts — shared plumbing for the ratchet subcommands (lint-sinks, conventions,
// atlas): source-file scanning scoped to the project's real source, and baseline
// read/write under the harness output dir (so `--update-baseline` is a harness concern,
// not reimplemented per consuming repo). These used to be three repo-local scripts that
// each re-walked the tree and hand-managed a baseline file.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { codeFiles } from "./walk.ts";
import type { Config } from "./types.ts";

export interface SrcFile { rel: string; text: string }

// Only the truly-never-walk dirs. Deliberately NOT cfg.ignore — that's tuned for the
// spec GRAPH (it excludes __tests__, docs, generated trees), but the conventions lint
// NEEDS the test files (to find totality oracles), and the `sources` scoping below
// already keeps docs/generated trees out. So scan source + tests, scoped by `sources`.
const ALWAYS_IGNORE = new Set(["node_modules", ".git", "dist", "build", ".turbo", ".wrangler", ".coherence"]);

/** Code files, scoped to `cfg.sources` (default: the whole tree under `entryDir`),
 *  split into source vs test by `cfg.testDir`. */
export async function scanSources(cfg: Config): Promise<{ src: SrcFile[]; test: SrcFile[] }> {
  const extRe = new RegExp(`\\.(${cfg.codeExt.join("|")})$`);
  const all = await codeFiles(cfg.root, ALWAYS_IGNORE, extRe, (n) => n.endsWith(".d.ts"));
  const sources = (cfg.sources?.length ? cfg.sources : [cfg.entryDir]).map((s) => s.replace(/\/+$/, ""));
  const inSources = (p: string) => sources.some((s) => s === "." || p === s || p.startsWith(s + "/"));
  const testDir = cfg.testDir ?? "__tests__";
  const src: SrcFile[] = [], test: SrcFile[] = [];
  for (const rel of all) {
    if (!inSources(rel)) continue;
    const text = await readFile(join(cfg.root, rel), "utf8").catch(() => "");
    (rel.includes(testDir) ? test : src).push({ rel, text });
  }
  return { src, test };
}

const baselinePath = (cfg: Config, name: string) => join(cfg.root, cfg.outputDir, name);

export async function readBaseline<T>(cfg: Config, name: string): Promise<T | null> {
  try { return JSON.parse(await readFile(baselinePath(cfg, name), "utf8")) as T; } catch { return null; }
}

export async function writeBaseline(cfg: Config, name: string, data: unknown): Promise<string> {
  await mkdir(join(cfg.root, cfg.outputDir), { recursive: true });
  const p = baselinePath(cfg, name);
  await writeFile(p, JSON.stringify(data, null, 2) + "\n");
  return join(cfg.outputDir, name);
}
