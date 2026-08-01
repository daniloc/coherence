// tree.ts — the FILE TREE as evidence: the shared utilities every consumer of "what is
// actually on disk" reads from ONE home. Two seams live here because they answer the same
// question at different layers, and because their previous home (scene.ts) was a command,
// not a library — a command's utilities must outlive the command, so they live where no
// verb owns them:
//
//   · fileStats — per-file content STATS read from disk (line count + content hash). The
//     line count is the honest-mass driver (mass, economy, the contract's per-component
//     lines); the hash is the body-edit signal a structural diff would otherwise miss.
//     ONE implementation, so a file's measured size can never disagree across commands.
//   · claimedFilePaths — the ONE definition of which of a component's FILES a claim
//     blesses, matched by PATH, blessing at MOST ONE file per claim token. Every counter
//     of "claimed vs unclaimed" reads this set, so coverage is never over-reported and
//     two commands can never disagree on what a claim names.
//
// A THIRD SEAM USED TO LIVE HERE AND NO LONGER DOES. `withBaseWorktree` (base-tree
// acquisition in a throwaway detached worktree) and `outsideTally`/`deriveOutside` (the
// changed files a graph does not own) arrived in this file with the others, extracted from
// scene.ts ahead of its eviction. Their only two callers were `scene`'s deriveBaseModel and
// `review`'s derivePromiseBase, and both commands were evicted the same day — leaving the
// three functions with zero callers AND zero tests, in a package that exports only a `bin`,
// so nothing outside this repo could reach them either. They were removed rather than kept
// against a future diff-against-a-base command: an eviction release that ships dead code
// teaches the opposite of what it is for, and git still has them. What they knew is in the
// release notes so the next base-diff can be written knowingly rather than rediscovered.
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import type { Config, GraphNode } from "./types.ts";
import { parseBoundary } from "./boundary.ts";

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

