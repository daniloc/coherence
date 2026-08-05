// regulate.ts — turn declared observations into one deterministic next action.
//
// Observation and policy are separate on purpose.  Sensors say what they saw; the pure
// selector applies the versioned doctrine.  No sensor can emit `release`, no weak item can
// mask an unavailable prerequisite, and no array insertion order can choose the action.
import { createHash } from "node:crypto";
import type { Config, Graph } from "./types.ts";
import { commandFor } from "./commands.ts";
import {
  ANTI_ENTROPY_DOCTRINE,
  DOCTRINE_ID,
  type DoctrineCommand,
  type DoctrineRule,
  type RegulationAction,
} from "./doctrine.ts";
import { inspectLifecycleHook } from "./control.ts";
import { analyzeChange, signalState } from "./signal.ts";
import { Unrunnable } from "./floor.ts";

export type ObservationStatus = "satisfied" | "violated" | "unavailable";

export interface RegulationObservation {
  /** A doctrine rule id. Kept open so an unknown future/foreign reading fails closed. */
  rule: string;
  status: ObservationStatus;
  evidence: string;
  /** Current-patch identity when the sensor has one. */
  fingerprint?: string;
}

export interface RegulationReading {
  doctrine: string;
  scope: "shared-worktree";
  observations: RegulationObservation[];
  limitations: string[];
}

export interface SelectedRegulation {
  rule: string;
  evidence: string;
  remedy?: string;
  command?: DoctrineCommand;
}

export interface RegulationDecision {
  doctrine: typeof DOCTRINE_ID;
  id: string;
  action: RegulationAction;
  scope: "shared-worktree";
  selected?: SelectedRegulation;
  /** Counts after exact duplicates have been collapsed. */
  potential: {
    unavailable: number;
    requireDecision: number;
    redirect: number;
  };
  /** Other obligations are counted, never rendered as competing commands. */
  remaining: number;
  limitations: string[];
}

interface Candidate {
  action: Exclude<RegulationAction, "release">;
  rule: string;
  evidence: string;
  remedy?: string;
  command?: DoctrineCommand;
  key: string;
}

const byteCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const uniqSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(byteCompare);
const OBSERVATION_STATUSES = new Set<string>(["satisfied", "violated", "unavailable"]);

function observationKey(o: RegulationObservation): string {
  return JSON.stringify([o.rule, o.status, o.evidence, o.fingerprint ?? ""]);
}

function ruleIndex(rule: string): number {
  const i = ANTI_ENTROPY_DOCTRINE.rules.findIndex((candidate) => candidate.id === rule);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

function actionIndex(action: RegulationAction): number {
  return ANTI_ENTROPY_DOCTRINE.potential.indexOf(action);
}

function candidateCompare(a: Candidate, b: Candidate): number {
  return actionIndex(a.action) - actionIndex(b.action)
    || ruleIndex(a.rule) - ruleIndex(b.rule)
    || byteCompare(a.key, b.key);
}

function validCommand(rule: DoctrineRule): string | null {
  if (!rule.command) return null;
  const live = commandFor(rule.command.name);
  if (!live) return `doctrine rule ${rule.id} redirects to unknown command ${rule.command.name}`;
  if (live.name === "regulate") return `doctrine rule ${rule.id} redirects to regulate itself`;
  return null;
}

function refusal(rule: string, evidence: string, key: string): Candidate {
  return { action: "refuse", rule, evidence, key };
}

/**
 * The control law. Pure, total over arbitrary readings, and intentionally ignorant of
 * filesystems, Git, clocks, config, output, and exit codes.
 */
export function selectRegulation(reading: RegulationReading): RegulationDecision {
  const candidates: Candidate[] = [];
  const byRule = new Map<string, Map<string, RegulationObservation>>();
  for (const observation of reading.observations) {
    const variants = byRule.get(observation.rule) ?? new Map<string, RegulationObservation>();
    variants.set(observationKey(observation), observation);
    byRule.set(observation.rule, variants);
  }

  if (reading.doctrine !== DOCTRINE_ID) {
    candidates.push(refusal(
      "doctrine",
      `reading names ${reading.doctrine || "no doctrine"}; this selector implements ${DOCTRINE_ID}`,
      `doctrine:${reading.doctrine}`,
    ));
  }
  if (reading.scope !== "shared-worktree") {
    candidates.push(refusal(
      "scope",
      `reading names unsupported scope ${String(reading.scope)}`,
      `scope:${String(reading.scope)}`,
    ));
  }

  const known = new Set(ANTI_ENTROPY_DOCTRINE.rules.map((rule) => rule.id));
  for (const [id, variants] of [...byRule].sort(([a], [b]) => byteCompare(a, b))) {
    if (!known.has(id)) {
      candidates.push(refusal(id, `observation names a rule absent from ${DOCTRINE_ID}`, `unknown:${id}`));
      continue;
    }
    if (variants.size > 1) {
      candidates.push(refusal(id, `sensor returned ${variants.size} conflicting observations`, `conflict:${id}`));
    }
  }

  for (const rule of ANTI_ENTROPY_DOCTRINE.rules) {
    const variants = byRule.get(rule.id);
    if (!variants?.size) {
      candidates.push(refusal(rule.id, `required sensor ${rule.sensor} returned no observation`, `missing:${rule.id}`));
      continue;
    }
    if (variants.size > 1) continue;
    const observation = [...variants.values()][0];
    if (!OBSERVATION_STATUSES.has(String(observation.status))) {
      candidates.push(refusal(
        rule.id,
        `sensor ${rule.sensor} returned unknown status ${String(observation.status)}`,
        `invalid-status:${observationKey(observation)}`,
      ));
      continue;
    }
    if (observation.status === "unavailable") {
      candidates.push(refusal(rule.id, observation.evidence, `unavailable:${observationKey(observation)}`));
      continue;
    }
    if (observation.status === "satisfied") continue;

    const invalid = validCommand(rule);
    if (invalid) {
      candidates.push(refusal(rule.id, invalid, `invalid-command:${rule.id}`));
      continue;
    }
    candidates.push({
      action: rule.response,
      rule: rule.id,
      evidence: observation.evidence,
      remedy: rule.remedy,
      ...(rule.command ? { command: { name: rule.command.name, args: [...rule.command.args] } } : {}),
      key: `violation:${rule.id}:${observation.fingerprint ?? ""}:${observation.evidence}`,
    });
  }

  candidates.sort(candidateCompare);
  const selected = candidates[0];
  const action: RegulationAction = selected?.action ?? "release";
  const potential = {
    unavailable: candidates.filter((candidate) => candidate.action === "refuse").length,
    requireDecision: candidates.filter((candidate) => candidate.action === "require-decision").length,
    redirect: candidates.filter((candidate) => candidate.action === "redirect").length,
  };
  const limitations = uniqSorted([...ANTI_ENTROPY_DOCTRINE.limits, ...reading.limitations]);
  const identity = JSON.stringify({
    doctrine: DOCTRINE_ID,
    scope: "shared-worktree",
    action,
    candidates: candidates.map(({ action: kind, rule, evidence, key }) => ({ action: kind, rule, evidence, key })),
    limitations,
  });
  const id = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return {
    doctrine: DOCTRINE_ID,
    id,
    action,
    scope: "shared-worktree",
    ...(selected ? {
      selected: {
        rule: selected.rule,
        evidence: selected.evidence,
        ...(selected.remedy ? { remedy: selected.remedy } : {}),
        ...(selected.command ? { command: selected.command } : {}),
      },
    } : {}),
    potential,
    remaining: Math.max(0, candidates.length - 1),
    limitations,
  };
}

function shellWord(word: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(word)) return word;
  return `'${word.replaceAll("'", "'\"'\"'")}'`;
}

export function renderRegulationCommand(
  command: DoctrineCommand,
  cli: readonly string[] = ["npx", "coherence"],
): string {
  return [...cli, command.name, ...command.args].map(shellWord).join(" ");
}

export function formatRegulation(
  decision: RegulationDecision,
  options: { json?: boolean; cli?: readonly string[] } = {},
): string[] {
  if (options.json) return [JSON.stringify(decision, null, 2)];
  if (decision.action === "release") {
    return [
      `REGULATION release · ${decision.doctrine} · ${decision.id}`,
      "  No intervention under the rules v1 actually evaluated; this is not a proof of correctness.",
    ];
  }
  const selected = decision.selected!;
  const lines = [
    `REGULATION ${decision.action} · ${selected.rule} · ${decision.id}`,
    `  ${selected.evidence}`,
  ];
  if (selected.remedy) lines.push(`  ${selected.remedy}`);
  if (selected.command) lines.push(`  next: ${renderRegulationCommand(selected.command, options.cli)}`);
  if (decision.remaining) lines.push(`  ${decision.remaining} lower-priority obligation(s) withheld.`);
  return lines;
}

export interface RegulateOptions {
  since?: string;
  check?: boolean;
  json?: boolean;
  cli?: readonly string[];
}

/** Read the two live v1 sensors. No writes. */
export async function observeRegulation(
  cfg: Config,
  graph?: Graph,
  options: Pick<RegulateOptions, "since"> = {},
): Promise<RegulationReading> {
  const observations: RegulationObservation[] = [];
  const limitations: string[] = [];

  const control = inspectLifecycleHook(cfg);
  if (!control.valid) {
    const errors = control.files.filter((file) => !file.valid)
      .map((file) => `${file.path}: ${file.error ?? "invalid settings"}`);
    observations.push({
      rule: "canonical-lifecycle-control",
      status: "unavailable",
      evidence: errors.join("; ") || "lifecycle settings could not be interpreted",
    });
  } else if (!control.launcher.targetPresent) {
    observations.push({
      rule: "canonical-lifecycle-control",
      status: "unavailable",
      evidence: `${control.launcher.targetPath}: lifecycle target is missing; install this coherence version in the project first`,
    });
  } else if (control.present) {
    observations.push({
      rule: "canonical-lifecycle-control",
      status: "satisfied",
      evidence: "the canonical five-event bundle, launcher, root mapping, and target are present",
    });
  } else {
    observations.push({
      rule: "canonical-lifecycle-control",
      status: "violated",
      evidence: control.warnings[0] ?? "the complete canonical runnable lifecycle control is absent",
    });
  }

  try {
    const change = await analyzeChange(cfg, graph, options.since ?? "HEAD");
    const state = signalState(change.novelty, change.signals.anchorsAdded, !!change.attestation);
    observations.push({
      rule: "significant-growth-needs-address",
      status: state === "needs-decision" ? "violated" : "satisfied",
      evidence: state === "needs-decision"
        ? `patch ${change.fingerprint} adds significant behavioral surface with zero anchors and no standing patch decision`
        : !change.changed.length
          ? "the working tree is clean"
          : `patch ${change.fingerprint} is ${state} under the current change signal`,
      fingerprint: change.fingerprint,
    });
  } catch (error) {
    if (!(error instanceof Unrunnable)) throw error;
    observations.push({
      rule: "significant-growth-needs-address",
      status: "unavailable",
      evidence: error.report.join(" "),
    });
  }

  return { doctrine: DOCTRINE_ID, scope: "shared-worktree", observations, limitations };
}

/** Explicit CLI surface. Report mode observes; --check turns intervention into a gate. */
export async function regulate(cfg: Config, graph: Graph | undefined, options: RegulateOptions = {}): Promise<number> {
  const decision = selectRegulation(await observeRegulation(cfg, graph, options));
  for (const line of formatRegulation(decision, options)) console.log(line);
  if (decision.action === "refuse") return 2;
  if (options.check && decision.action !== "release") return 1;
  return 0;
}
