// tree.ts — the FILE TREE as evidence: the shared utilities every consumer of "what is
// actually on disk, at HEAD or at a base ref" reads from ONE home. Four seams live here
// because they answer the same question at different layers, and because their previous
// home (scene.ts) was a command, not a library — a command's utilities must outlive the
// command, so they live where no verb owns them:
//
//   · fileStats — per-file content STATS read from disk (line count + content hash). The
//     line count is the honest-mass driver (mass, economy, the contract's per-component
//     lines); the hash is the body-edit signal a structural diff would otherwise miss.
//     ONE implementation, so a file's measured size can never disagree across commands.
//   · claimedFilePaths — the ONE definition of which of a component's FILES a claim
//     blesses, matched by PATH, blessing at MOST ONE file per claim token. Every counter
//     of "claimed vs unclaimed" reads this set, so coverage is never over-reported and
//     two commands can never disagree on what a claim names.
//   · withBaseWorktree — base-tree acquisition: materialize a ref in a THROWAWAY detached
//     git worktree, load ITS config + build ITS graph, and ALWAYS tear it down. Extracted
//     so the layers that diff against a base cannot re-derive (and drift on) worktree
//     teardown or the subdirectory-root alignment rule.
//   · outsideTally / deriveOutside — the changed files a graph does NOT own, tallied from
//     `git diff --name-status`. A diff surface must never silently truncate: scripts, CI
//     and docs the graph never modeled are counted so the consumer can say so.
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, basename, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Config, Graph, GraphNode } from "./types.ts";
import { parseBoundary } from "./boundary.ts";
import { loadConfig } from "./config.ts";
import { buildGraph } from "./derive.ts";

/** Per-file content STATS keyed by repo-relative path: the LINE count (honest mass) and a
 *  content HASH (the body-edit signal for any diff). Unreadable or binary (a NUL byte) →
 *  0 lines; the hash is still taken from the raw bytes so a body edit to a binary would
 *  register. `lines` counts NEWLINES (join(cfg.root, path)). */
export interface FileStat { lines: number; hash: string }
export async function fileStats(cfg: Config, files: GraphNode[]): Promise<Map<string, FileStat>> {
  const out = new Map<string, FileStat>();
  await Promise.all(files.map(async (f) => {
    const path = f.path ?? f.label;
    try {
      const buf = await readFile(join(cfg.root, path));
      const hash = createHash("sha1").update(buf).digest("hex");
      const binary = buf.includes(0);
      let lines = 0;
      if (!binary) for (const b of buf) if (b === 0x0a) lines++;   // count '\n'
      out.set(path, { lines, hash });
    } catch { out.set(path, { lines: 0, hash: "" }); }
  }));
  return out;
}

/** A path-qualified claim token matches when its `/`-segments equal the file path's
 *  TRAILING segments: `documents/hooks.ts` matches `…/features/documents/hooks.ts` but
 *  NOT `…/pages/hooks.ts`. So a claim that names a specific sub-path blesses exactly the
 *  file it means, never every same-named sibling. */
const suffixMatch = (path: string, token: string): boolean => {
  const ps = path.split("/"), ts = token.split("/");
  if (ps.length < ts.length) return false;
  return ps.slice(ps.length - ts.length).every((s, i) => s === ts[i]);
};

/** The ONE definition of which of a component's FILES a claim blesses — matched by PATH,
 *  blessing at MOST ONE file per claim token, NEVER over-reporting coverage. A file is
 *  named via `<file> exists at …` or `<file> imports …`; a boundary claim names a
 *  chokepoint SYMBOL (skipped here), and typechecks/passes test/responds/conforms name
 *  neither. The file token is resolved against the component's REAL paths:
 *    · a token WITH a `/` → PATH-SUFFIX match (segments == the path's trailing segments);
 *    · a BARE basename    → matches only if EXACTLY ONE file carries that basename.
 *  Either way, if a token has several candidates it blesses NONE — a component with four
 *  `hooks.ts` never reads 4/4 claimed off a single same-named claim. Every consumer reads
 *  this ONE set, so per-file flags and aggregate counts stay exactly consistent. */
export function claimedFilePaths(claims: string[], files: GraphNode[]): Set<string> {
  const paths = files.map((f) => f.path ?? f.label);
  const blessed = new Set<string>();
  for (const claim of claims) {
    if (parseBoundary(claim)) continue;
    const m = /^(\S+)\s+(?:exists at|imports)\b/.exec(claim);
    if (!m) continue;
    const token = m[1];
    const cands = token.includes("/")
      ? paths.filter((p) => suffixMatch(p, token))
      : paths.filter((p) => basename(p) === token);
    if (cands.length === 1) blessed.add(cands[0]);   // ambiguous (0 or >1) → bless nothing
  }
  return blessed;
}

/** The SHARED base-tree acquisition every against-a-ref diff rides on: resolve `ref`,
 *  materialize it in a THROWAWAY detached git worktree, load ITS config + build ITS
 *  graph, hand them to `fn`, and ALWAYS tear the worktree down. The ref is resolved FIRST —
 *  the clean gate for "not a repo / unknown ref" before any worktree machinery — and its
 *  short sha is passed to `fn` (the base ref a diff records). Every write `fn` triggers
 *  lands in the discarded tmpdir, never the live tree. Extracting this keeps consumers
 *  from re-deriving (and drifting on) worktree teardown. */
export async function withBaseWorktree<T>(
  cfg: Config,
  ref: string,
  fn: (baseCfg: Config, baseGraph: Graph, shortRef: string) => Promise<T>,
): Promise<T> {
  const rp = spawnSync("git", ["rev-parse", "--short", ref], { cwd: cfg.root, encoding: "utf8" });
  if (rp.status !== 0) throw new Error(`cannot resolve '${ref}' (not a git repo, or unknown ref)`);
  const short = rp.stdout.trim();

  const tmp = await mkdtemp(join(tmpdir(), "coh-base-"));
  try {
    const add = spawnSync("git", ["worktree", "add", "--detach", tmp, ref], { cwd: cfg.root, encoding: "utf8" });
    if (add.status !== 0) throw new Error(`git worktree add failed: ${(add.stderr || "").trim()}`);
    // The coherence root may be a SUBDIRECTORY of the git repo (a sub-package with its own
    // coherence.config.json). The worktree materializes the WHOLE repo, so the base config
    // must be loaded from the SAME subdirectory inside it — loading from the worktree top
    // would fall back to defaults rooted at the repo top-level, prefix every base component
    // dir with the subdir, and make every diff a total razed/arrived storm. realpath both
    // ends because `git rev-parse --show-toplevel` returns the canonical path (e.g. macOS
    // /tmp → /private/tmp) while cfg.root may be the symlinked spelling.
    const tl = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: cfg.root, encoding: "utf8" });
    const rel = tl.status === 0 ? relative(realpathSync(tl.stdout.trim()), realpathSync(resolve(cfg.root))) : "";
    const baseCfg = await loadConfig(rel && !rel.startsWith("..") ? join(tmp, rel) : tmp);
    const baseGraph = await buildGraph(baseCfg);
    return await fn(baseCfg, baseGraph, short);
  } finally {
    // Tear down unconditionally: --force removes even a dirty worktree; prune cleans the
    // administrative ref if remove ever half-fails; rm sweeps the dir itself.
    spawnSync("git", ["worktree", "remove", "--force", tmp], { cwd: cfg.root, encoding: "utf8" });
    spawnSync("git", ["worktree", "prune"], { cwd: cfg.root, encoding: "utf8" });
    await rm(tmp, { recursive: true, force: true });
  }
}

/** The changed-files tally OUTSIDE a graph: added / removed / changed counts of the files
 *  the graph does not model. */
export interface OutsideTally { added: number; removed: number; changed: number }

/** PURE: tally the changed files OUTSIDE the graph from `git diff --name-status` output.
 *  A → added, D → removed, everything else (M, and R/C renames/copies) → changed. An entry
 *  whose path (either the old or the new for a rename) is graph-owned is DROPPED — those
 *  are already modeled. What's left is scripts/CI/docs the graph never saw — counted so
 *  the consumer can badge "N changes outside the map" instead of silently truncating. */
export function outsideTally(nameStatus: string, owned: Set<string>): OutsideTally {
  let added = 0, removed = 0, changed = 0;
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (paths.some((p) => owned.has(p))) continue;   // the graph models this one already
    const code = status[0];
    if (code === "A") added++;
    else if (code === "D") removed++;
    else changed++;                                   // M, R…, C…, T → a change
  }
  return { added, removed, changed };
}

/** IO shell over outsideTally: run `git diff --name-status <base> HEAD` and tally what the
 *  graph does NOT own. A non-repo / failed diff yields an all-zero tally (nothing to badge). */
export function deriveOutside(cfg: Config, baseRef: string, owned: Set<string>): OutsideTally {
  const r = spawnSync("git", ["diff", "--name-status", baseRef, "HEAD"], { cwd: cfg.root, encoding: "utf8" });
  if (r.status !== 0) return { added: 0, removed: 0, changed: 0 };
  return outsideTally(r.stdout, owned);
}
