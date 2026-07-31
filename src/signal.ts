// signal.ts — make the future cost of an unanchored change present in THIS change.
//
// `novelty` already observes behavioral surface outrunning anchors, but an advisory that
// scrolls past cannot change the acceptance function. SIGNAL is the deliberately narrow
// pressure layer over that instrument:
//
//   significant surface + zero new anchors + no patch-specific attestation => RED in --check
//
// The escape hatch is a DECISION, not a boolean config switch. `--attest-no-invariant`
// records why this patch adds no new invariant under a finding key carrying a fingerprint
// of the actual patch. Change one byte and the fingerprint changes, so yesterday's reason
// cannot silently waive today's patch. Adding any anchor is still the cheaper path: no
// attestation is needed at all.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import type { Config, Graph } from "./types.ts";
import { buildGraph } from "./derive.ts";
import { loadConfig } from "./config.ts";
import {
  changedBetween, diffGraphs, locDelta, withTreeAt, type StructuralDiff,
} from "./structural.ts";
import {
  scanSurface, surfaceSignals, noveltyVerdict,
  type NoveltySignals, type NoveltyVerdict,
} from "./novelty.ts";
import {
  appendDecision, readJournal, resolve as resolveJournal, type DecisionRecord,
} from "./decisions.ts";
import { parseBoundary } from "./boundary.ts";
import { parseParity } from "./parity.ts";

export interface ChangeSignal {
  ref: string;
  changed: string[];
  fingerprint: string;
  signals: NoveltySignals;
  novelty: NoveltyVerdict;
  structural: StructuralDiff;
  attestation?: DecisionRecord;
}

export interface SignalOptions {
  since?: string;
  check?: boolean;
  attestBecause?: string;
  session?: string;
  agent?: string;
}

export type SignalState = "quiet" | "anchored" | "attested" | "needs-decision";

/** Stable address for the one permissible waiver. It is intentionally readable up to the
 * fingerprint: `grep signal:no-new-invariant` lists every place the escape hatch was used. */
export const attestationFinding = (fingerprint: string): string =>
  `signal:no-new-invariant:${fingerprint}`;

/** Only a standing, structured finding can waive a patch. Arbitrary prose containing the
 * right words does not: that would turn spelling into authority and make false positives
 * indistinguishable from deliberate attestations. */
export function findAttestation(records: DecisionRecord[], fingerprint: string): DecisionRecord | undefined {
  const key = attestationFinding(fingerprint);
  return resolveJournal(records).standing.find((r) => r.kind === "decision" && r.finding === key);
}

export function signalState(v: NoveltyVerdict, anchorsAdded: number, attested: boolean): SignalState {
  if (v.level !== "alarm") return v.level === "quiet" ? "quiet" : "anchored";
  if (anchorsAdded > 0) return "anchored"; // defensive: novelty's alarm currently implies zero
  return attested ? "attested" : "needs-decision";
}

/** `diffGraphs` intentionally summarizes a brand-new component as one component event
 * instead of exploding its whole ledger. Signal still needs to know whether that new
 * surface arrived with invariants and anchors, so recover those counts from the after
 * graph while retaining the temporal ledger's compact rendering contract. */
export function anchorsAddedByChange(structural: StructuralDiff, after: Graph): number {
  let n = structural.invAdded.length + structural.boundaryAdded.length + structural.parityAdded.length;
  const added = new Set(structural.componentsAdded);
  for (const node of after.nodes) {
    if (node.kind !== "component" || !added.has(node.label)) continue;
    n += node.invariants?.length ?? 0;
    for (const claim of node.claims ?? []) if (parseBoundary(claim) || parseParity(claim)) n++;
  }
  return n;
}

const git = (cfg: Config, args: string[]): string => {
  const r = spawnSync("git", args, { cwd: cfg.root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.trim() : "";
};

/** Hash the base commit plus every assessable changed path's CURRENT bytes. Reading
 * current bytes rather than `git diff` also covers untracked files; a missing marker covers deletions.
 * Path delimiters are NUL because NUL cannot occur in a git path or file text. */
export async function patchFingerprint(cfg: Config, ref: string, changed: Iterable<string>): Promise<string> {
  const h = createHash("sha256");
  h.update(git(cfg, ["rev-parse", ref]) || ref).update("\0");
  for (const path of [...changed].sort()) {
    h.update(path).update("\0");
    const body = await readFile(`${cfg.root}/${path}`).catch(() => null);
    if (body === null) h.update("<deleted>"); else h.update(body);
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

/** `locDelta` cannot see untracked files because git numstat cannot. Count their current
 * lines here so a brand-new 800-line feature is not reported as zero LOC until staged. */
async function locIncludingUntracked(cfg: Config, ref: string, changed: Set<string>): Promise<{ added: number; deleted: number }> {
  const loc = locDelta(cfg, ref, null);
  const untracked = new Set(git(cfg, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean));
  const ext = new RegExp(`\\.(${cfg.codeExt.join("|")})$`);
  for (const path of changed) {
    if (!untracked.has(path) || !ext.test(path)) continue;
    const src = await readFile(`${cfg.root}/${path}`, "utf8").catch(() => "");
    loc.added += src ? src.split(/\r?\n/).length : 0;
  }
  return loc;
}

/** Derive the current patch signal. The before graph and surface come from ONE detached
 * worktree; the after side is the caller's working tree. No writes. */
export async function analyzeChange(cfg: Config, graph?: Graph, ref = "HEAD"): Promise<ChangeSignal> {
  // Harness records are consequences of assessing the patch, not part of the patch being
  // assessed. Including the attestation journal line would make its own fingerprint
  // self-invalidating; calibration/status writes would do the same at Stop.
  const changedSet = new Set([...changedBetween(cfg, ref, null)].filter((p) => !p.startsWith(".coherence/")));
  const changed = [...changedSet].sort();
  const fingerprint = await patchFingerprint(cfg, ref, changed);
  const before = await withTreeAt(cfg, ref, async (root) => {
    const atCfg = await loadConfig(root);
    return { graph: await buildGraph(atCfg), surface: await scanSurface(root, changedSet) };
  });
  const afterGraph = graph ?? await buildGraph(cfg);
  const afterSurface = await scanSurface(cfg.root, changedSet);
  const structural = diffGraphs(before.graph, afterGraph);
  const anchorsAdded = anchorsAddedByChange(structural, afterGraph);
  const signals = surfaceSignals(
    before.surface,
    afterSurface,
    await locIncludingUntracked(cfg, ref, changedSet),
    {
      anchorsAdded,
      componentsAdded: structural.componentsAdded.length,
    },
  );
  const novelty = noveltyVerdict(signals, cfg.novelty);
  const attestation = findAttestation(readJournal(cfg).records, fingerprint);
  return { ref, changed, fingerprint, signals, novelty, structural, ...(attestation ? { attestation } : {}) };
}

export function formatSignal(s: ChangeSignal): string[] {
  if (!s.changed.length) return ["CHANGE SIGNAL — clean working tree; nothing to assess."];
  const state = signalState(s.novelty, s.signals.anchorsAdded, !!s.attestation);
  const lines = [
    `CHANGE SIGNAL — ${s.ref} → working tree · ${s.changed.length} changed file(s) · patch ${s.fingerprint}`,
    `  surface +${s.signals.newExports.length} exports / +${s.signals.newVariants} variants / +${s.signals.locAdded} LOC`,
    `  anchors +${s.signals.anchorsAdded} · components +${s.signals.componentsAdded}`,
  ];
  if (state === "quiet") lines.push("  ✓ no significant unanchored behavioral growth detected.");
  else if (state === "anchored") lines.push("  ✓ behavioral growth carries a new invariant/boundary/parity anchor.");
  else if (state === "attested") lines.push(`  ✓ no-new-invariant decision recorded as ${s.attestation!.id}.`);
  else {
    lines.push("  ✗ significant behavioral surface has no new anchor and no patch-specific decision.");
    lines.push("    Add an invariant/boundary/parity claim, or record why this change creates none:");
    lines.push("    coherence signal --attest-no-invariant --because \"<why the existing contract is sufficient>\"");
  }
  return lines;
}

/** Command-shaped entrypoint. Attestation is an explicit write; ordinary report/check
 * paths are read-only. */
export async function signal(cfg: Config, graph: Graph | undefined, opts: SignalOptions = {}): Promise<number> {
  let analysis = await analyzeChange(cfg, graph, opts.since ?? "HEAD");
  if (opts.attestBecause !== undefined) {
    if (!analysis.changed.length) {
      console.error("cannot attest a clean working tree — there is no patch to bind the decision to");
      return 2;
    }
    if (!opts.attestBecause.trim()) {
      console.error("--attest-no-invariant requires --because \"<why the existing contract is sufficient>\"");
      return 2;
    }
    const rec = appendDecision(cfg, {
      kind: "decision",
      chose: `no new invariant for patch ${analysis.fingerprint}`,
      over: ["add an invariant or boundary claim that the change does not require"],
      because: opts.attestBecause,
      finding: attestationFinding(analysis.fingerprint),
      files: analysis.changed,
      session: opts.session,
      agent: opts.agent,
    });
    analysis = { ...analysis, attestation: rec };
    console.log(`${rec.id}  attests no new invariant for patch ${analysis.fingerprint}\n`);
  }
  for (const line of formatSignal(analysis)) console.log(line);
  return opts.check && signalState(analysis.novelty, analysis.signals.anchorsAdded, !!analysis.attestation) === "needs-decision" ? 1 : 0;
}
