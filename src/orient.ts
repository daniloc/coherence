// orient.ts — one compact, deterministic heading across the swarm's durable instruments.
//
// Each source keeps its own epistemic boundary: the work ledger owns coordination state,
// the trusted journal owns decisions, consequences own assessed relationships, and the
// status record owns the last verification verdict. Orientation composes those readings;
// it does not mutate any of them and never promotes proximity into a relationship.
import { spawnSync } from "node:child_process";
import type { Config } from "./types.ts";
import { readTrustedJournal, resolve as resolveJournal } from "./decisions.ts";
import { analyzeDecisionPositions, type DecisionPosition } from "./decision-position.ts";
import { readWork, type WorkLedger, type WorkStats } from "./work.ts";
import {
  formatConsequenceRef, readConsequences, type ConsequenceLedger, type ConsequenceRef,
} from "./consequence.ts";
import { readExperiments } from "./experiment.ts";
import { readDefects } from "./defects.ts";
import { gitStamp, readStatus } from "./status.ts";

export type OrientationAction =
  | "refuse"
  | "resolve-conflict"
  | "repair-navigation"
  | "unblock"
  | "synthesize"
  | "dispatch"
  | "continue"
  | "verify"
  | "steady";

export interface OrientationSource {
  name: "decisions" | "work" | "consequences" | "experiments" | "defects" | "verification";
  ok: boolean;
  detail: string;
}

export interface DanglingConsequenceRef {
  ref: ConsequenceRef;
  links: string[];
  reason: string;
}

export interface VerificationOrientation {
  state: "never" | "current" | "stale" | "failing";
  at: string | null;
  commit: string | null;
  failures: number | null;
  tier: "fast" | "full" | null;
}

export interface Orientation {
  action: OrientationAction;
  reasons: string[];
  sources: OrientationSource[];
  decisions: {
    standing: number;
    /** Historical incident reports; unlike work state, these have no close lifecycle. */
    historicalBlockedReports: number;
    openConjectures: number;
    positions: DecisionPosition[];
    contested: string[];
    needsRatification: string[];
  } | null;
  work: {
    stats: WorkStats;
    ready: string[];
    active: string[];
    blocked: string[];
    completed: string[];
    conflicts: Array<{ left: string; right: string; scope: string }>;
    unsynthesized: Array<{ parent: string; child: string }>;
  } | null;
  consequences: {
    links: number;
    dangling: DanglingConsequenceRef[];
    uncheckedVerificationRefs: string[];
    /** Completed work with no explicit `verification --verifies--> work` edge. */
    unverifiedCompletedWork: string[];
  } | null;
  verification: VerificationOrientation | null;
  limitations: string[];
}

const byteCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(byteCompare);
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

function source(
  sources: OrientationSource[],
  name: OrientationSource["name"],
  ok: boolean,
  detail: string,
): void {
  sources.push({ name, ok, detail });
}

function canonicalTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

export function verifyOrientation(section: unknown, head: string | null): VerificationOrientation {
  if (!section) return { state: "never", at: null, commit: null, failures: null, tier: null };
  if (typeof section !== "object" || Array.isArray(section)) throw new Error("verify section must be an object");
  const row = section as Record<string, unknown>;
  if (!canonicalTime(row.at)) throw new Error("verify.at must be canonical UTC ISO time");
  if (row.commit !== null && (typeof row.commit !== "string" || !/^[a-f0-9]{4,64}$/.test(row.commit))) {
    throw new Error("verify.commit must be null or a lowercase Git object abbreviation");
  }
  if (typeof row.dirty !== "boolean") throw new Error("verify.dirty must be boolean");
  if (row.tier !== "fast" && row.tier !== "full") throw new Error("verify.tier must be fast or full");
  if (typeof row.failures !== "number" || !Number.isSafeInteger(row.failures) || row.failures < 0) {
    throw new Error("verify.failures must be a nonnegative integer");
  }
  const commit = row.commit as string | null;
  // Missing repository or report provenance cannot prove currency. It stays stale until
  // both addresses exist and agree; absence is not evidence of sameness.
  const sameCommit = !!head && !!commit && (head.startsWith(commit) || commit.startsWith(head));
  return {
    state: row.failures > 0 ? "failing" : sameCommit && !row.dirty ? "current" : "stale",
    at: row.at as string,
    commit,
    failures: row.failures,
    tier: row.tier,
  };
}

function commitExists(root: string, id: string): boolean {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id)) return false;
  return spawnSync("git", ["cat-file", "-e", `${id}^{commit}`], { cwd: root }).status === 0;
}

function auditRefs(
  cfg: Config,
  ledger: ConsequenceLedger,
  known: Map<ConsequenceRef["kind"], Set<string>>,
): { dangling: DanglingConsequenceRef[]; uncheckedVerificationRefs: string[] } {
  const byRef = new Map<string, { ref: ConsequenceRef; links: Set<string> }>();
  for (const row of ledger.records) {
    for (const endpoint of [row.from, row.to]) {
      const key = formatConsequenceRef(endpoint);
      const found = byRef.get(key) ?? { ref: endpoint, links: new Set<string>() };
      found.links.add(row.id);
      byRef.set(key, found);
    }
  }
  const dangling: DanglingConsequenceRef[] = [];
  const uncheckedVerificationRefs: string[] = [];
  for (const { ref, links } of byRef.values()) {
    if (ref.kind === "verification") {
      // Verification runs are currently a rolling status record, not an append-only
      // identity registry. Keep the ceiling explicit instead of calling them dangling.
      uncheckedVerificationRefs.push(formatConsequenceRef(ref));
      continue;
    }
    const present = ref.kind === "commit" ? commitExists(cfg.root, ref.id) : known.get(ref.kind)?.has(ref.id) === true;
    if (!present) dangling.push({
      ref, links: [...links].sort(byteCompare),
      reason: ref.kind === "commit" ? "Git cannot resolve this exact commit" : `no trusted ${ref.kind} record owns this id`,
    });
  }
  return {
    dangling: dangling.sort((a, b) => byteCompare(formatConsequenceRef(a.ref), formatConsequenceRef(b.ref))),
    uncheckedVerificationRefs: uniqueSorted(uncheckedVerificationRefs),
  };
}

function workProjection(ledger: WorkLedger): NonNullable<Orientation["work"]> {
  return {
    stats: ledger.stats,
    ready: ledger.ready.map((item) => item.work).sort(byteCompare),
    active: ledger.works.filter((item) => item.state === "active").map((item) => item.work).sort(byteCompare),
    blocked: ledger.blocked.map((item) => item.work).sort(byteCompare),
    completed: ledger.works.filter((item) => item.state === "completed").map((item) => item.work).sort(byteCompare),
    conflicts: ledger.scopeConflicts.map((item) => ({
      left: item.left, right: item.right, scope: `${item.leftScope} ↔ ${item.rightScope}`,
    })),
    unsynthesized: ledger.unsynthesized.map(({ parent, child }) => ({ parent, child })),
  };
}

/** Read every ledger independently. A failed source is preserved as a source failure and
 * makes the heading REFUSE; it never turns into an empty population. */
export async function observeOrientation(cfg: Config): Promise<Orientation> {
  const sources: OrientationSource[] = [];
  let decisions: Orientation["decisions"] = null;
  let work: Orientation["work"] = null;
  let consequences: Orientation["consequences"] = null;
  let verification: Orientation["verification"] = null;
  const known = new Map<ConsequenceRef["kind"], Set<string>>();

  try {
    const trusted = readTrustedJournal(cfg);
    if (!trusted.ok) {
      source(sources, "decisions", false, `${trusted.damage.length} damage item(s); trusted projection unavailable`);
    } else {
      const resolved = resolveJournal(trusted.records);
      const positions = analyzeDecisionPositions(trusted.records);
      decisions = {
        standing: resolved.standing.length,
        historicalBlockedReports: resolved.blocked.length,
        openConjectures: resolved.open.length,
        positions,
        contested: positions.filter((item) => item.state === "contested").map((item) => item.subject),
        needsRatification: positions.filter((item) => item.state === "needs-ratification").map((item) => item.subject),
      };
      known.set("decision", new Set(trusted.records.map((record) => record.id)));
      source(sources, "decisions", true, `${trusted.records.length} trusted row(s); ${positions.length} addressed subject(s)`);
    }
  } catch (error) {
    source(sources, "decisions", false, errorText(error));
  }

  let workLedger: WorkLedger | null = null;
  try {
    workLedger = readWork(cfg);
    work = workProjection(workLedger);
    known.set("work", new Set(workLedger.works.map((item) => item.work)));
    source(sources, "work", true, `${workLedger.stats.total} work order(s); ${workLedger.stats.scopeConflicts} active write conflict(s)`);
  } catch (error) {
    source(sources, "work", false, errorText(error));
  }

  try {
    const ledger = readExperiments(cfg);
    known.set("experiment", new Set(ledger.experiments.flatMap((item) => [item.opened.id, ...(item.closed ? [item.closed.id] : [])])));
    source(sources, "experiments", true, `${ledger.experiments.length} experiment(s)`);
  } catch (error) {
    source(sources, "experiments", false, errorText(error));
  }

  try {
    const ledger = readDefects(cfg);
    known.set("defect", new Set(ledger.records.map((record) => record.id)));
    source(sources, "defects", true, `${ledger.records.length} defect(s)`);
  } catch (error) {
    source(sources, "defects", false, errorText(error));
  }

  let consequenceLedger: ConsequenceLedger | null = null;
  try {
    consequenceLedger = readConsequences(cfg);
    source(sources, "consequences", true, `${consequenceLedger.records.length} explicit link(s)`);
  } catch (error) {
    source(sources, "consequences", false, errorText(error));
  }

  try {
    const status = await readStatus(cfg);
    if (!status || typeof status !== "object" || Array.isArray(status) || status.version !== 1) {
      throw new Error("status record must be a version 1 object");
    }
    const head = gitStamp(cfg.root).commit;
    verification = verifyOrientation(status.verify, head);
    source(sources, "verification", true, verification.state === "never"
      ? "no verification report has been filed"
      : `${verification.state} ${verification.tier} report at ${verification.at}`);
  } catch (error) {
    source(sources, "verification", false, errorText(error));
  }

  if (consequenceLedger) {
    const audited = auditRefs(cfg, consequenceLedger, known);
    const verifiedWork = new Set(consequenceLedger.records
      .filter((record) => record.relation === "verifies" && record.from.kind === "verification" && record.to.kind === "work")
      .map((record) => record.to.id));
    consequences = {
      links: consequenceLedger.records.length,
      ...audited,
      unverifiedCompletedWork: (work?.completed ?? []).filter((id) => !verifiedWork.has(id)),
    };
  }

  let action: OrientationAction = "steady";
  let reasons: string[] = [];
  const failedSources = sources.filter((item) => !item.ok);
  if (failedSources.length) {
    action = "refuse";
    reasons = failedSources.map((item) => `${item.name}: ${item.detail}`);
  } else if ((work?.stats.graphProblems ?? 0) > 0) {
    action = "refuse";
    reasons = [`work graph has ${work!.stats.graphProblems} structural problem(s)`];
  } else if ((decisions?.contested.length ?? 0) > 0 || (decisions?.needsRatification.length ?? 0) > 0
    || (work?.conflicts.length ?? 0) > 0) {
    action = "resolve-conflict";
    reasons = [
      ...((decisions?.contested ?? []).map((subject) => `highest-authority decisions conflict on ${subject}`)),
      ...((decisions?.needsRatification ?? []).map((subject) => `local alternatives on ${subject} need ratification`)),
      ...((work?.conflicts ?? []).map((item) => `${item.left} and ${item.right} concurrently claim ${item.scope}`)),
    ];
  } else if ((consequences?.dangling.length ?? 0) > 0) {
    action = "repair-navigation";
    reasons = consequences!.dangling.map((item) => `${formatConsequenceRef(item.ref)}: ${item.reason}`);
  } else if ((work?.blocked.length ?? 0) > 0) {
    action = "unblock";
    reasons = work?.blocked.map((id) => `work ${id} is blocked`) ?? [];
  } else if ((work?.unsynthesized.length ?? 0) > 0) {
    action = "synthesize";
    reasons = work!.unsynthesized.map((item) => `${item.parent} has not synthesized ${item.child}`);
  } else if ((work?.ready.length ?? 0) > 0) {
    action = "dispatch";
    reasons = work!.ready.map((id) => `${id} is ready and dependency-clear`);
  } else if ((work?.active.length ?? 0) > 0) {
    action = "continue";
    reasons = work!.active.map((id) => `${id} is active`);
  } else if ((consequences?.unverifiedCompletedWork.length ?? 0) > 0) {
    action = "verify";
    reasons = consequences!.unverifiedCompletedWork.map((id) => `${id} is completed without an explicit verification link`);
  } else if (verification?.state === "failing" || verification?.state === "stale") {
    action = "verify";
    reasons = [`last verification is ${verification.state}`];
  } else {
    reasons = [work?.stats.total ? "all recorded work is terminal and synthesized" : "no work is currently recorded"];
  }

  return {
    action,
    reasons: uniqueSorted(reasons),
    sources,
    decisions,
    work,
    consequences,
    verification,
    limitations: [
      "orientation selects one heading from recorded evidence; it neither executes work nor proves semantic correctness",
      "historical journal blocked reports remain visible evidence but only closeable work state selects a live unblock heading",
      "verification references remain unchecked until verification receipts become append-only identities",
      "shared paths, commits, and timestamps never create consequence links",
    ],
  };
}

function visible(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, (char) =>
    `\\u${char.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}

export function renderOrientation(reading: Orientation): string {
  const lines = [
    `ORIENTATION ${reading.action.toUpperCase()}`,
    ...reading.reasons.map((reason) => `  → ${visible(reason)}`),
    "",
    "SOURCES",
    ...reading.sources.map((item) => `  ${item.ok ? "✓" : "✗"} ${item.name} — ${visible(item.detail)}`),
  ];
  if (reading.decisions) {
    lines.push(
      "",
      `DECISIONS  ${reading.decisions.standing} standing · ${reading.decisions.openConjectures} open conjecture(s) · ${reading.decisions.historicalBlockedReports} historical blocked report(s)`,
    );
    for (const position of reading.decisions.positions) {
      lines.push(`  ${position.state} ${visible(position.subject)} — ${visible(position.reason)}`);
    }
  }
  if (reading.work) {
    lines.push(
      "",
      `WORK  ${reading.work.stats.total} total · ${reading.work.ready.length} ready · ${reading.work.active.length} active · ${reading.work.blocked.length} blocked`,
    );
    for (const id of reading.work.ready) lines.push(`  ready ${visible(id)}`);
    for (const collision of reading.work.conflicts) lines.push(`  conflict ${visible(collision.left)} ↔ ${visible(collision.right)} at ${visible(collision.scope)}`);
  }
  if (reading.consequences) {
    lines.push("", `LINKS  ${reading.consequences.links} explicit · ${reading.consequences.dangling.length} dangling`);
    for (const item of reading.consequences.dangling) lines.push(`  ! ${visible(formatConsequenceRef(item.ref))} — ${visible(item.reason)}`);
    for (const id of reading.consequences.unverifiedCompletedWork) lines.push(`  ? completed ${visible(id)} has no explicit verification link`);
    if (reading.consequences.uncheckedVerificationRefs.length) {
      lines.push(`  ? ${reading.consequences.uncheckedVerificationRefs.length} verification reference(s) cannot yet be existence-checked`);
    }
  }
  lines.push("", "LIMITS", ...reading.limitations.map((limit) => `  - ${limit}`));
  return lines.join("\n");
}
