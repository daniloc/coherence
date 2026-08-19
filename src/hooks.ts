// hooks.ts — how the decision journal actually gets written.
//
// A CLI nobody invokes is worth nothing, and an agent mid-way through a 400k-token
// job will not remember a convention it read once. So the instruction is INJECTED at
// the moment each agent starts, by a `SubagentStart` hook, and the journal's state is
// read back at `SubagentStop`.
//
// WHY A CLI AND NOT AN MCP SERVER. An MCP tool's schema is loaded into the context of
// every agent that might call it — five agents, five copies, paid on every turn
// whether or not a decision gets made. A shell line costs nothing until it runs, has
// no server lifecycle to fail, and works from any agent that can run Bash. The
// journal's whole premise is that context is the scarce resource; a mechanism that
// spends context to save context is self-defeating.
//
// THE NUDGE DOES NOT FAIL THE STOP. `SubagentStop` returns non-error feedback once, then
// stays silent when the host marks the follow-up stop as active. Main-agent `Stop` is a
// different surface: the user already saw its report, and a shared worktree cannot prove
// which agent owns an unsettled patch. It records calibration with byte-empty stdout.
// Exit 2 would make the journal a gate, and a gate acquires an incentive to be complete —
// at which point it is a transcript again, which is the thing it compresses.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJournal, openSession, resolve } from "./decisions.ts";
import {
  canonicalLifecycleHookSettings, inspectLifecycleHook, setLifecycleHook,
  lifecycleHookScript, lifecycleRootMapping, resolveHookProjectRoot, LIFECYCLE_HOOK_EVENTS,
  type HookHost, type LifecycleHookInspection, type LifecycleHookEvent,
} from "./control.ts";
import { composeHookText, readHookText, HOOK_TEXT_DIR } from "./hook-text.ts";
import { readDue, formatDue } from "./due.ts";
import {
  activityReplayKey, readActivity, recordActivity,
  type ActivityRow,
  type ActivityHost, type ActivityTransport,
} from "./activity.ts";
import { readTraceDetailed } from "./read-trace.ts";
import { readExperiments } from "./experiment.ts";
import type { Config } from "./types.ts";

/** Use the source entrypoint only while this repository dogfoods itself. Consumers get
 * the installed binary. Keeping this choice here also means the injected command is the
 * command an agent can actually run, rather than release-oriented prose copied locally. */
function projectCli(cfg: Config): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cfg.root, "package.json"), "utf8"));
    if (pkg?.name === "@danilocampos/coherence" && existsSync(join(cfg.root, "src", "cli.ts"))) return "node src/cli.ts";
  } catch { /* an absent package is an ordinary consumer project */ }
  return "npx coherence";
}

/** The text every agent is handed at startup. Short on purpose: it is paid for by
 *  every agent on every job, and an instruction nobody finishes reading is a comment. */
export function agentInstructions(session: string, cli = "npx coherence", agent?: string): string {
  const scope = `--session ${JSON.stringify(session)}${agent ? ` --agent ${JSON.stringify(agent)}` : ""}`;
  return [
    "DECISION JOURNAL — this repo keeps one, and you are expected to write to it.",
    "",
    "When you make a decision — a point where the work could have gone more than one",
    "way and you picked — record it BEFORE moving on:",
    "",
    `  ${cli} decide "<what you chose>" --over "<what you rejected>" --because "<why>" ${scope}`,
    "",
    `YOUR SESSION ID IS ${session}. Pass it on every call — it is what keeps your`,
    "decisions attributable to you when four other agents are writing at the same time.",
    "",
    "`--over` is repeatable and it is the field that matters most: what you REJECTED is",
    "what stops the next agent re-litigating a settled question. If you rejected nothing,",
    "omit it — an unexamined choice and a forced one should not look alike.",
    "",
    "WHEN A NUMBER SURPRISES YOU, DOUBT THE INSTRUMENT BEFORE THE SUBJECT — and record",
    "the question even if you cannot chase it. An unresolved conjecture is a real entry:",
    "",
    `  ${cli} conjecture "<the surprising observation>" --could-be "<explanation>" \\`,
    `    --discriminated-by "<the test that would separate them>" ${scope}`,
    `  ${cli} resolved <id> --because "<what that test showed>" --as "<which candidate won>" ${scope}`,
    `  ${cli} dismiss <id> --because "<why it is not worth chasing>" ${scope}`,
    "",
    'You need not supply "the instrument is wrong" — it is added for you. It is the',
    "highest-prior explanation for a surprising measurement and the one everyone skips.",
    "",
    "`dismiss` is NOT `resolved`. Use it when the question is real and nobody intends to",
    "answer it — it renders in its own section, saying exactly that, and it stops the",
    "advisories re-raising the same finding. Answering something you did not answer is the",
    "one thing this journal cannot recover from.",
    "",
    "BEFORE YOU ADD A CONCEPT, COUNT ITS INSTANCES. A mechanism with no subjects in this",
    "project is a FINDING, not a feature — and the finding is usually a subtraction that",
    "does the same work. Record what you measured, what you would have built, and the",
    "QUERY that decided it, because the answer is a function of the project and will change:",
    "",
    `  ${cli} decide "not X — measured N instances" --over "<the mechanism you did not build>" \\`,
    `    --because "<the query, so the next agent can re-run it instead of re-arguing>" ${scope}`,
    "",
    "WHEN YOU FIX A BUG, DECIDE WHAT HAPPENS TO ITS CLASS — dissolve > declare > infer.",
    "Best: make the class UNREPRESENTABLE — remove the duplicated state, narrow the type,",
    "collapse the second spelling of the domain that let two copies disagree. Next: PIN it —",
    "an invariant anchored by a boundary whose guard goes red if the class returns, plus a",
    "`## refutations` line recording what you actually observed broken; a fixed bug is a",
    "measured negative control, and it is evidence only if it is written down. The ladder",
    "applies to your own tooling too: a substrate in which the bug class CANNOT BE EXPRESSED",
    "beats a hand-rolled implementation that happens to work — structural soundness is worth",
    "investigating even before a defect is measured, because a single-witness instrument",
    "cannot measure its own category errors. A spot fix",
    "is the floor, not the fix — if the stronger rungs were out of reach, say why:",
    "",
    `  ${cli} decide "spot-fixed <bug>; class survives" --over "dissolving <the state that allows it>" \\`,
    `    --because "<why unrepresentable/pinned was not reachable today>" ${scope}`,
    "",
    "WHEN YOU FORM A MULTI-STEP PLAN, MAKE ITS PREDICTION FALSIFIABLE before acting:",
    `  ${cli} experiment create "<what you expect will work>" --context "<file you expect to need>" \\`,
    `    --action "<planned action>" --success "<observable success criterion>" ${scope}`,
    "The command prints stable action/criterion ids and a close template. Closing derives",
    "success, failure, or inconclusive from evidence for EVERY id; a Stop or a checked box",
    "never becomes success by itself.",
    "",
    "Two more verbs:",
    `  ${cli} blocked "<what you could not do>" --because "<why>" ${scope}`,
    `  ${cli} retract <id> --because "<what refuted it>" ${scope}`,
    "",
    "This gates nothing. It cannot fail your build and it is not a checklist — log the",
    "handful of choices a reader who never saw your transcript would need, not every step.",
    "A job that logs three real decisions is worth more than one that logs thirty steps.",
  ].join("\n");
}

/** A Stop feedback turn stops again. Hosts mark that second pass so a non-blocking nudge
 * can be emitted exactly once instead of accidentally becoming an eight-turn gate. */
export function stopFeedbackActive(payload: unknown): boolean {
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return p.stop_hook_active === true || p.stopHookActive === true;
}

export type StopChangeFeedback =
  | { kind: "available"; text: string }
  | { kind: "unavailable"; text: string };

/**
 * Host semantics make this distinction consequential: any `additionalContext` continues
 * the conversation. A subagent's parent may genuinely need the final report restated;
 * the main user just read it. Main Stop therefore emits nothing. Shared-worktree state
 * cannot be promoted into a task-local obligation merely because this agent stopped.
 */
export function composeStopFeedback(
  event: "SubagentStop" | "Stop",
  subagentReport: string,
  change: StopChangeFeedback,
): string | null {
  if (event === "SubagentStop") return `${subagentReport}\n\n${change.text}`;
  return null;
}

function hookHost(): ActivityHost {
  const host = process.env.COHERENCE_HOOK_HOST;
  return host === "codex" || host === "claude" ? host : "unknown";
}

function hookTransport(): ActivityTransport {
  return process.env.COHERENCE_HOOK_TRANSPORT === "launcher" ? "launcher" : "direct";
}

/** `coherence hook <event>` — the hook body itself, so nothing has to be written to
 *  disk or kept in sync with a script file. Reads the event payload on stdin (unused
 *  today, but hooks are fed JSON and ignoring it silently would be rude to the next
 *  person who needs a field from it) and prints the documented output shape. */
export async function runHook(cfg: Config, event: string): Promise<number> {
  const raw = await readStdin(); // drained deliberately: an unread pipe can SIGPIPE the caller
  let payload: unknown = {};
  try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { /* hooks must survive a host's malformed payload */ }
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const agentScope = p.agent_id ?? p.agentId;
  const sessionScope = p.session_id ?? p.sessionId;
  const hostScope = agentScope ?? sessionScope;
  const host = hookHost();

  // Every lifecycle crossing leaves a cheap, transient heartbeat. Unlike a journal
  // header, this names the host, launcher transport and exact bundle fingerprint, so an
  // old Claude run—or a direct diagnostic invocation—cannot prove that THIS Codex
  // session is currently inside the field.
  try {
    recordActivity(cfg, event, payload, {
      host,
      transport: hookTransport(),
      bundleHash: process.env.COHERENCE_HOOK_BUNDLE_FINGERPRINT ?? null,
      experimentId: null,
    });
  } catch { /* observation loss must not become agent-lifecycle failure */ }

  if (event === "SubagentStart" || event === "SessionStart") {
    // The session is OPENED here, by the hook, once per agent — which is the only
    // place that can guarantee one id per agent rather than one per shell command.
    const session = hostScope === undefined ? undefined : String(hostScope);
    // Codex re-fires SessionStart on resume, clear and compaction. Re-inject the current
    // work order every time, but keep one logical journal opening for one host session.
    const existing = session === undefined ? undefined : readJournal(cfg).records
      .find((record) => record.kind === "session" && record.session === session);
    const rec = existing ?? openSession(cfg, {
      session,
      agent: String(p.agent_type ?? p.agentType ?? process.env.COHERENCE_AGENT ?? "main"),
      job: String(p.session_id ?? p.sessionId ?? process.env.COHERENCE_JOB ?? "-"),
    });
    // THE WORK ORDER IS COMPOSED HERE, not inside `agentInstructions`. That function is
    // printed verbatim by `coherence hooks` and asserted byte-wise by its tests; making it
    // read git and the run record would make a documentation command's output vary by
    // repo state and by day — the hazard commands.ts spends a paragraph on ("no clock,
    // nothing machine-specific, so `docs --check` compares byte-for-byte with zero
    // normalization"). The pure block stays pure; the impure reading is appended.
    //
    // AND IT IS USUALLY EMPTY. `formatDue` returns [] when nothing is due, so this line is
    // a no-op on a project that keeps its instruments current, and the emitted block is
    // byte-identical to what it was before this shipped. A fourth imperative that fired
    // every session would cost the other three their attention.
    const cli = projectCli(cfg);
    const scope = `--session ${JSON.stringify(rec.session)}${rec.agent ? ` --agent ${JSON.stringify(rec.agent)}` : ""}`;
    // A hook that throws breaks every session in every adopting project on repin. This
    // reading is worth strictly less than that, so it can fail to nothing.
    const due = await readDue(cfg).then((r) => formatDue(r, cli, scope)).catch(() => []);
    const canonical = [agentInstructions(rec.session, cli, rec.agent), ...due].join("\n");
    // The project's declared voice composes here — an override replaces the canon, an
    // append follows it. An empty override is a deliberate silence, so a falsy text
    // emits nothing at all.
    const text = composeHookText(canonical, readHookText(cfg, event), { session: rec.session, agent: rec.agent, cli, scope });
    if (text) emit(host, event, text);
    return 0;
  }

  // The CHEAP tick: collect only explicit file paths. No graph build, no git worktree,
  // and no attempt to reverse-engineer shell command strings. These transient rows are
  // what `calibrate` later compares with economy's predicted closure.
  if (event === "PostToolUse") {
    const { recordHookReads } = await import("./read-trace.ts");
    recordHookReads(cfg, payload);
    // Deliberately dependency-light: with nothing declared on disk this is two stat
    // calls and out. The project voice is the only reason this event ever speaks.
    emitProjectVoice(cfg, host, event, hostScope);
    return 0;
  }

  if (event === "Stop") {
    // Stop additionalContext gives the agent one feedback turn. Without this host flag
    // guard, that turn stops again, receives the same feedback again, and loops until the
    // host's hard cap — expensive signaling turning into an accidental gate.
    if (stopFeedbackActive(payload)) return 0;
    // Stop fires once per main-agent turn. Preserve that measurement cadence. The
    // CANONICAL emission stays byte-empty: a shared worktree cannot attribute a
    // patch-wide obligation to the agent that just stopped, and the user already read
    // its report. The one exception is a project-declared voice — an explicit project
    // choice, and one that still sits behind the stop_hook_active loop guard above.
    const session = String(hostScope ?? process.env.COHERENCE_SESSION ?? "unknown");
    const { recordCalibrationSample } = await import("./calibration.ts");
    await recordCalibrationSample(cfg, session).catch(() => null);
    emitProjectVoice(cfg, host, event, session);
    return 0;
  }

  if (event === "SubagentStop") {
    if (stopFeedbackActive(payload)) return 0;
    // The subagent's reply is about to cross an ownership seam. Snapshot its observed
    // reads and give it one chance to return a complete report plus the shared patch signal.
    // A parent session id is NOT a child id: Codex currently omits agent_id on some child
    // events, and charging those rows to the parent would turn concurrency into false
    // precision. In that case the hook still reports the repo-wide signal, but records no
    // child calibration and names the attribution ceiling in the report.
    const childSession = typeof agentScope === "string" && agentScope.length ? agentScope : null;
    const [{ analyzeChange, formatSignal }, calibration] = await Promise.all([
      import("./signal.ts"),
      childSession ? import("./calibration.ts") : Promise.resolve(null),
    ]);
    if (childSession && calibration) {
      await calibration.recordCalibrationSample(cfg, childSession).catch(() => null);
    }
    const change: StopChangeFeedback = await analyzeChange(cfg).then((s) => ({
      kind: "available" as const,
      text: formatSignal(s).join("\n"),
    })).catch((e: unknown) => ({
      kind: "unavailable" as const,
      text: `CHANGE SIGNAL unavailable: ${e instanceof Error ? e.message : String(e)}`,
    }));
    const feedback = composeStopFeedback(event, stopReport(cfg, childSession), change);
    // The project's declared voice composes over the canonical report — override
    // replaces, append follows, and an empty override silences even this surface.
    const text = composeHookText(feedback ?? "", readHookText(cfg, event), {
      cli: projectCli(cfg),
      ...(childSession ? { session: childSession, scope: `--session ${JSON.stringify(childSession)}` } : {}),
    });
    if (text) emit(host, event, text);
    return 0;
  }

  // An unknown event is not an error: hook sets grow, and a harness that crashes on a
  // new event name breaks every session that added one.
  return 0;
}

/** Events with no canonical emission still honor a declared project voice. Kept out of
 *  the hot branches so PostToolUse pays two stat calls, not a token build, when the
 *  project has declared nothing. */
function emitProjectVoice(cfg: Config, host: ActivityHost, event: string, sessionScope: unknown): void {
  const custom = readHookText(cfg, event as LifecycleHookEvent);
  if (custom.override === null && custom.append === null) return;
  const session = sessionScope === undefined || sessionScope === null ? undefined : String(sessionScope);
  const text = composeHookText("", custom, {
    cli: projectCli(cfg),
    ...(session ? { session, scope: `--session ${JSON.stringify(session)}` } : {}),
  });
  if (text) emit(host, event, text);
}

/** What a subagent is told as it finishes. Split out of `runHook` so it is reachable
 *  without a stdin pipe — the hook body drains stdin, and a report you can only observe
 *  by feeding a process is a report nobody tests. */
export function stopReport(cfg: Config, childSession: string | null = null): string {
  const cli = projectCli(cfg);
  const { records, unreadable } = readJournal(cfg);
  const n = childSession === null ? 0 : records
    .filter((r) => r.kind !== "session" && r.session === childSession).length;
  // A REPORT, NOT A QUESTION — and that distinction is load-bearing, because the first
  // version got it wrong in a way that was invisible until agents started answering it.
  // It ended "anything you decided and did not log is about to leave with your context",
  // which is a yes/no question, and a SubagentStop hook that asks "did you do X?" gets "yes, X is
  // done" in the reply. Agents began padding their final messages with compliance
  // liturgy — "nothing unlogged remains" — which is worse than silence: it spends the
  // caller's attention asserting a process was followed instead of saying what was found.
  //
  // So this states the count and stops. An agent that wants to log something can; the
  // reminder does not need to be a prompt, because `decide` was already in the startup
  // instruction and the agent has it. The only DIRECTIVE here is the restatement below,
  // and it asks for substance rather than for a status report on compliance.
  const msg = childSession === null
    ? "DECISION JOURNAL: child-session count unavailable — this SubagentStop supplied"
      + " no exact agent_id. A parent session id cannot identify which child wrote an entry."
    : n === 0
      ? "DECISION JOURNAL: nothing logged by this child session."
      : `DECISION JOURNAL: ${n} entr${n === 1 ? "y" : "ies"} recorded by this child session.`;
  // Damage is known only for the merged repository read. Attaching it parenthetically to
  // the child count would imply we know which session owned the torn rows, so keep it as a
  // separately scoped warning.
  const damage = unreadable
    ? `\n\nREPOSITORY JOURNAL DAMAGE: ${unreadable} unreadable line(s) skipped; child and`
      + " repo-wide counts cover readable rows only."
    : "";
  // STOP IS WHERE AN OPEN QUESTION IS CHEAPEST TO ANSWER AND ABOUT TO BECOME MOST
  // EXPENSIVE — the agent still holds the context that noticed it, and is one turn from
  // losing it. Repo-wide, and phrased as such: attributing another session's open
  // conjecture to this agent would be a lie the journal cannot afford.
  const { open } = resolve(records);
  // AND THE LAST LINE, WHICH IS NOT ABOUT THE JOURNAL AT ALL. A subagent's caller sees
  // ONE message: the final reply. Everything else — the reasoning, the measurements, the
  // thing it found that contradicted its own brief — is in a transcript the caller is
  // told not to read. Agents reliably end with "Complete." or "Nothing further to log",
  // and a real finding dies there: one run tagged six releases, discovered en route that
  // a version in its own brief had never existed, recorded that correctly in the artifact,
  // and reported none of it. SubagentStop is the last moment the context still exists to say so.
  const restate = "\n\nYOUR REPLY MUST RESTATE YOUR FINAL REPORT — IT IS THE ONLY THING"
    + " YOUR CALLER SEES. A terse sign-off discards everything you learned that is not"
    + " already in the code.";
  return msg + damage + restate + (open.length
    ? `\n\n${open.length} OPEN CONJECTURE(S) in this repo — noticed, not yet chased.`
      + ` If your work settled one, close it with \`${cli} resolved <id> --because ...\`;`
      + ` if one is not worth chasing, \`${cli} dismiss <id> --because ...\` retires it.`
      + ` \`${cli} decisions --open\` lists them.`
    : "");
}

function emit(host: ActivityHost, event: string, additionalContext: string): void {
  // Codex SubagentStop has a distinct continuation contract: additionalContext is not a
  // delivery surface there. A block decision gives the child one final turn; the shared
  // stop_hook_active guard above keeps that turn from feeding itself forever.
  if (host === "codex" && event === "SubagentStop") {
    console.log(JSON.stringify({ decision: "block", reason: additionalContext }));
    return;
  }
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
}

function readStdin(): Promise<string> {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res("");
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => res(buf));
    process.stdin.on("error", () => res(buf));
  });
}

export interface HookStatus {
  host: HookHost;
  control: LifecycleHookInspection;
  observation: {
    journalSessionHeaders: number;
    journalEntries: number;
    sessions: number;
    unreadableJournal: number;
    current: CurrentHookObservation | null;
  };
}

export interface CurrentHookObservation {
  session: string;
  state: "observed" | "unobserved" | "stale";
  exactLauncherEvents: number;
  staleLauncherEvents: number;
  directEvents: number;
  lastExactAt: string | null;
  trace: {
    reads: number;
    writes: number;
    /** Weakest row scope in this session file; parent aggregates may include descendants. */
    attribution: "none" | "owner-session" | "parent-session-aggregate" | "unscoped";
    scope: { ownerSession: number; parentSessionAggregate: number; unscoped: number };
    bundle: { exactLauncher: number; staleLauncher: number; direct: number; legacy: number };
    unreadable: number;
  };
  updatePlanEvents: number;
  parentFallbackEvents: number;
  unreadableActivity: number;
  verification: { total: number; success: number; failure: number; unknown: number };
  intervention: { total: number; success: number; failure: number; unknown: number };
  experiment: { open: number; closed: number; latest: string | null; outcome: string | null } | { unavailable: string };
}

/** Which host owns the current shell. Explicit selection always wins. */
export function activeHookHost(explicit?: HookHost | null): HookHost {
  if (explicit) return explicit;
  return process.env.CODEX_THREAD_ID ? "codex" : "claude";
}

/** Never pick the newest session: concurrency makes "latest" an attribution bug. */
export function activeHookSession(host: HookHost, explicit?: string | null): string | null {
  const selected = explicit ?? process.env.COHERENCE_SESSION
    ?? (host === "codex" ? process.env.CODEX_THREAD_ID : undefined)
    ?? null;
  return selected?.trim() ? selected : null;
}

function uniqueActivity(rows: ActivityRow[]): ActivityRow[] {
  const addressed = new Map<string, ActivityRow>();
  const unaddressed: ActivityRow[] = [];
  for (const row of rows) {
    const key = activityReplayKey(row);
    if (key) addressed.set(key, row); // last same-domain replay carries the best result
    else unaddressed.push(row); // no host identity means there is nothing honest to dedupe on
  }
  return [...unaddressed, ...addressed.values()].sort((a, b) => a.at.localeCompare(b.at));
}

function commandCounts(rows: ReturnType<typeof readActivity>["rows"], kind: "verification" | "intervention") {
  const commands = rows.map((row) => row.command).filter((command) => command?.kind === kind);
  return {
    total: commands.length,
    success: commands.filter((command) => command?.result === "success").length,
    failure: commands.filter((command) => command?.result === "failure").length,
    unknown: commands.filter((command) => command?.result === "unknown").length,
  };
}

export function currentObservation(cfg: Config, control: LifecycleHookInspection, session: string): CurrentHookObservation {
  const activityRead = readActivity(cfg, session);
  const activity = uniqueActivity(activityRead.rows);
  const exact = activity.filter((row) => row.transport === "launcher"
    && row.host === control.host && row.bundleHash === control.bundleFingerprint);
  const stale = activity.filter((row) => row.transport === "launcher"
    && (row.host !== control.host || row.bundleHash !== control.bundleFingerprint));
  const direct = activity.filter((row) => row.transport === "direct");
  const traceRead = readTraceDetailed(cfg, session);
  const trace = traceRead.rows;
  const traceScope = { ownerSession: 0, parentSessionAggregate: 0, unscoped: 0 };
  const traceBundle = { exactLauncher: 0, staleLauncher: 0, direct: 0, legacy: 0 };
  for (const row of trace) {
    const observed = row.observation;
    if (!observed) {
      traceScope.unscoped++;
      traceBundle.legacy++;
      continue;
    }
    if ((observed.attribution === "agent" && observed.agentId === row.session)
      || (observed.attribution === "session" && observed.agentId === null && observed.parentSession === null)) {
      traceScope.ownerSession++;
    } else if (observed.attribution === "parent-fallback"
      && observed.agentId === null && observed.parentSession === row.session) {
      traceScope.parentSessionAggregate++;
    } else {
      traceScope.unscoped++;
    }
    if (observed.transport === "direct") traceBundle.direct++;
    else if (observed.host === control.host && observed.bundleHash === control.bundleFingerprint) {
      traceBundle.exactLauncher++;
    } else {
      traceBundle.staleLauncher++;
    }
  }
  let experiment: CurrentHookObservation["experiment"];
  try {
    const ledger = readExperiments(cfg);
    const owned = ledger.experiments.filter((item) => item.opened.session === session);
    const latest = owned.at(-1) ?? null;
    experiment = {
      open: owned.filter((item) => !item.closed).length,
      closed: owned.filter((item) => !!item.closed).length,
      latest: latest?.opened.id ?? null,
      outcome: latest?.closed?.outcome ?? null,
    };
  } catch (error) {
    experiment = { unavailable: error instanceof Error ? error.message : String(error) };
  }
  return {
    session,
    state: session !== "unknown" && exact.length ? "observed" : stale.length ? "stale" : "unobserved",
    exactLauncherEvents: session === "unknown" ? 0 : exact.length,
    staleLauncherEvents: stale.length,
    directEvents: direct.length,
    lastExactAt: session === "unknown" ? null : exact.at(-1)?.at ?? null,
    trace: {
      reads: trace.filter((row) => row.mode === "read").length,
      writes: trace.filter((row) => row.mode === "write").length,
      attribution: traceScope.unscoped ? "unscoped"
        : traceScope.parentSessionAggregate ? "parent-session-aggregate"
          : trace.length ? "owner-session" : "none",
      scope: traceScope,
      bundle: traceBundle,
      unreadable: traceRead.unreadable,
    },
    updatePlanEvents: session === "unknown" ? 0 : exact.filter((row) => row.event === "PostToolUse" && row.tool === "update_plan").length,
    parentFallbackEvents: session === "unknown" ? 0 : exact.filter((row) => row.attribution === "parent-fallback").length,
    unreadableActivity: activityRead.unreadable,
    verification: commandCounts(session === "unknown" ? [] : exact, "verification"),
    intervention: commandCounts(session === "unknown" ? [] : exact, "intervention"),
    experiment,
  };
}

/** Structural configuration, historical memory, and this exact session stay separate. */
export function hookStatus(cfg: Config, host: HookHost = "claude", session?: string | null): HookStatus {
  const control = inspectLifecycleHook(cfg, host);
  const { records, sessions, unreadable } = readJournal(cfg);
  const opened = records.filter((r) => r.kind === "session");
  const entries = records.length - opened.length;
  const currentSession = activeHookSession(host, session);
  return {
    host,
    control,
    observation: {
      journalSessionHeaders: new Set(opened.map((record) => record.session)).size,
      journalEntries: entries,
      sessions: sessions.length,
      unreadableJournal: unreadable,
      current: currentSession ? currentObservation(cfg, control, currentSession) : null,
    },
  };
}

function printHookStatus(status: HookStatus, json = false): void {
  if (json) { console.log(JSON.stringify(status, null, 2)); return; }
  const { control, observation } = status;
  console.log(`host: ${status.host}`);
  console.log(`lifecycle hook: ${!control.valid ? "UNKNOWN" : control.present ? "PRESENT" : "ABSENT"}`);
  console.log(`shared wiring: ${control.wiringPresent ? "PRESENT" : "ABSENT"}`);
  if (control.scopes.length) console.log(`canonical scope(s): ${control.scopes.join(" + ")}`);
  for (const file of control.files) {
    if (!file.exists) console.log(`${file.scope}: no settings file`);
    else if (!file.valid) console.log(`${file.scope}: INVALID — ${file.error ?? "unreadable settings"}`);
    else if (file.complete) console.log(`${file.scope}: canonical five-event bundle present`);
    else if (file.missingEvents.length) console.log(`${file.scope}: INCOMPLETE — missing ${file.missingEvents.join(", ")}`);
    else if (file.matchedEvents.length) console.log(`${file.scope}: NONCANONICAL — duplicate or competing coherence actions`);
    else console.log(`${file.scope}: canonical bundle absent`);
  }
  console.log(`launcher: ${control.launcher.present ? "READY" : "NOT READY"} (${control.launcher.path})`);
  if (!control.launcher.canonical) console.log(`  script: ${control.launcher.exists ? "DRIFTED" : "MISSING"}`);
  if (!control.launcher.mappingPresent) console.log(`  root mapping: ${control.launcher.mappingActual === undefined ? "MISSING" : "DRIFTED"} (expected ${control.launcher.mappingExpected})`);
  console.log(`  target: ${control.launcher.targetPresent ? control.launcher.targetKind.toUpperCase() : "MISSING"} (${control.launcher.targetPath})`);
  console.log(`repository journal history: ${observation.journalEntries} entr${observation.journalEntries === 1 ? "y" : "ies"}`
    + ` across ${observation.sessions} session(s) · ${observation.journalSessionHeaders} session header(s)`
    + " — durable history, not proof this host or bundle ran");
  if (observation.unreadableJournal) {
    console.log(`  journal damage: ${observation.unreadableJournal} unreadable row(s) skipped`);
  }
  if (!observation.current) {
    console.log("current session: UNKNOWN — pass --session (no newest-session fallback)");
  } else {
    const current = observation.current;
    console.log(`current session: ${current.state.toUpperCase()} — ${current.session}`);
    console.log(`  exact launcher/bundle events: ${current.exactLauncherEvents}`
      + `${current.staleLauncherEvents ? ` · stale/other bundle: ${current.staleLauncherEvents}` : ""}`
      + `${current.directEvents ? ` · direct probes: ${current.directEvents}` : ""}`);
    console.log(`  path trace (session file): ${current.trace.reads} read · ${current.trace.writes} write`
      + ` — ${current.trace.attribution}`);
    console.log(`    scope: ${current.trace.scope.ownerSession} owner-session ·`
      + ` ${current.trace.scope.parentSessionAggregate} parent-session aggregate ·`
      + ` ${current.trace.scope.unscoped} unscoped`);
    console.log(`    bundle: ${current.trace.bundle.exactLauncher} exact launcher/bundle ·`
      + ` ${current.trace.bundle.staleLauncher} stale/other launcher ·`
      + ` ${current.trace.bundle.direct} direct · ${current.trace.bundle.legacy} legacy`);
    if (current.trace.unreadable) {
      console.log(`    trace damage: ${current.trace.unreadable} unreadable row(s) skipped`);
    }
    console.log(`  plan tool: ${current.updatePlanEvents} update(s) · verification ${current.verification.success}/${current.verification.total}`
      + ` · regulation ${current.intervention.success}/${current.intervention.total}`);
    if (current.unreadableActivity) console.log(`  activity damage: ${current.unreadableActivity} unreadable row(s) — exact experiment attribution will refuse`);
    if ("unavailable" in current.experiment) console.log(`  experiment: UNAVAILABLE — ${current.experiment.unavailable}`);
    else console.log(`  experiment: ${current.experiment.open} open · ${current.experiment.closed} closed`
      + `${current.experiment.latest ? ` · latest ${current.experiment.latest}${current.experiment.outcome ? ` ${current.experiment.outcome}` : ""}` : ""}`);
    if (current.parentFallbackEvents) console.log(`  attribution ceiling: ${current.parentFallbackEvents} event(s) had parent-session fallback`);
  }
  if (status.host === "codex" && observation.current?.state !== "observed") {
    console.log("activation: UNCONFIRMED — review this exact project hook in Codex /hooks, then start or resume a session");
  } else if (status.host === "codex") {
    console.log("activation: OBSERVED — this exact Codex bundle reached the hook body for this session");
  }
  for (const warning of control.warnings) console.log(`warning: ${warning}`);
  if (status.host === "codex") console.log("ceiling: user, managed, and plugin hook layers are outside project inspection");
}

/** `coherence hooks status` — report the switch and the observation beside it. */
export function reportHooks(cfg: Config, json = false, host: HookHost = "claude", session?: string | null): number {
  const status = hookStatus(cfg, host, session);
  printHookStatus(status, json);
  return status.control.valid ? 0 : 2;
}

/** `coherence hooks --check` — the binary current-control gate. Observation never redeems absence. */
export function checkHooks(cfg: Config, json = false, host: HookHost = "claude", session?: string | null): number {
  const status = hookStatus(cfg, host, session);
  printHookStatus(status, json);
  if (!status.control.valid) return 2;
  if (!status.control.present) return 1;
  // With an exact session in scope, configured-but-untrusted/unfired is not active.
  if (status.observation.current && status.observation.current.state !== "observed") return 1;
  return 0;
}

export async function installHooks(cfg: Config, json = false, host: HookHost = "claude", session?: string | null): Promise<number> {
  const result = await setLifecycleHook(cfg, true, host);
  if (result.errors.length) {
    if (json) console.log(JSON.stringify({ errors: result.errors, control: result.inspection }, null, 2));
    else for (const error of result.errors) console.error(`cannot install lifecycle hook: ${error}`);
    return 2;
  }
  if (!json) console.log(result.changed.length ? `installed ${host} lifecycle hook in shared project settings` : `${host} lifecycle hook already installed`);
  const status = hookStatus(cfg, host, session);
  printHookStatus(status, json);
  // The moment the control turns ON is the one moment the operator is guaranteed to be
  // reading — and it is exactly when the journal starts being written. Say where to watch.
  if (!json && status.control.present)
    console.log("\nwatch it live: npx coherence journal — entries stream in as agents write them");
  return status.control.present ? 0 : 1;
}

export async function uninstallHooks(cfg: Config, json = false, host: HookHost = "claude", session?: string | null): Promise<number> {
  const result = await setLifecycleHook(cfg, false, host);
  if (result.errors.length) {
    if (json) console.log(JSON.stringify({ errors: result.errors, control: result.inspection }, null, 2));
    else for (const error of result.errors) console.error(`cannot uninstall lifecycle hook: ${error}`);
    return 2;
  }
  if (!json) console.log(result.changed.length ? "uninstalled lifecycle hook" : "lifecycle hook already absent");
  const status = hookStatus(cfg, host, session);
  printHookStatus(status, json);
  return status.control.valid && !status.control.present ? 0 : 1;
}

/** `coherence hooks review` — every event's EFFECTIVE emission, with its provenance.
 *  The hook body degrades an unreadable customization to canon silently, because a torn
 *  file must not break a session; THIS is the loud surface where that damage lands, and
 *  the exit code carries it. */
export function reviewHooks(cfg: Config): number {
  const cli = projectCli(cfg);
  const problems: string[] = [];
  console.log(`Effective lifecycle emissions — what each event will actually say for this project.

A project customizes an event with \`.coherence/hooks/<Event>.override.md\` (replaces the
canonical emission) and \`.coherence/hooks/<Event>.append.md\` (follows it). An EMPTY
override silences the event entirely. An unreadable customization file degrades to the
canonical emission at runtime — silently there, loudly here, as warnings below.

Tokens {{session}} {{agent}} {{cli}} {{scope}} substitute at emission; they are shown
unsubstituted below, exactly as authored ({{agent}} is only guaranteed at
SubagentStart/SessionStart).`);
  for (const event of LIFECYCLE_HOOK_EVENTS) {
    const custom = readHookText(cfg, event);
    problems.push(...custom.problems);
    const overridePath = join(HOOK_TEXT_DIR, `${event}.override.md`);
    const appendPath = join(HOOK_TEXT_DIR, `${event}.append.md`);
    const provenance = custom.override && custom.append
      ? `override (${overridePath}) + append (${appendPath})`
      : custom.override ? `override (${overridePath})`
        : custom.append ? `canonical + append (${appendPath})`
          : "canonical";
    console.log(`\n--- ${event} · ${provenance} ---`);
    const parts: string[] = [];
    if (custom.override) {
      // Mirror the runtime composition exactly: a byte-empty override composes to a
      // falsy text and the event emits nothing at all.
      parts.push(custom.override.text === "" ? "(silenced — empty override)" : custom.override.text);
    } else if (event === "SubagentStart" || event === "SessionStart") {
      parts.push(`${agentInstructions("s-<minted per agent>", cli)}\n<appended at runtime: due instrument advisories, when any are live>`);
    } else if (event === "SubagentStop") {
      parts.push("<composed at stop time: the child session's journal count, repository"
        + " damage if any, the final-report restatement, open conjectures, and the change signal>");
    } else if (event === "Stop") {
      parts.push("(no canonical emission — main Stop is byte-silent by design)");
    } else {
      parts.push("(no canonical emission — records file reads only)");
    }
    if (custom.append) parts.push(custom.append.text);
    console.log(parts.join("\n\n"));
  }
  for (const problem of problems) console.log(`warning: ${problem}`);
  return problems.length ? 1 : 0;
}

/** `coherence hooks` — print one host's canonical block, plus the
 *  instruction text so a reader can see what agents will actually be told. */
export function printHooks(cfg: Config, host: HookHost = "claude"): void {
  const block = canonicalLifecycleHookSettings(host);
  const hostRoot = resolveHookProjectRoot(cfg, host);
  const hostDir = host === "codex" ? ".codex" : ".claude";
  console.log(`Canonical ${host} control for ${hostRoot}. Prefer \`coherence hooks install --host ${host}\`; it preserves unrelated hooks.`);
  console.log("The settings value, stable launcher, and root mapping are:\n");
  console.log(JSON.stringify(block, null, 2));
  console.log(`\n--- ${hostDir}/coherence-hook ---\n${lifecycleHookScript(host)}--- ${hostDir}/coherence-root ---\n${lifecycleRootMapping(cfg, host)}`);
  console.log(`
SubagentStart / SessionStart inject the instruction below into the agent's context.
PostToolUse records explicit file reads and writes for per-agent economy calibration; it
emits no instruction and uses a dedicated dependency-light entrypoint.
SubagentStop reports what the journal holds AND the current patch's change signal, then
stays silent when the host marks the follow-up stop active. Main-agent Stop records the
calibration sample with byte-empty stdout: a shared-worktree reading cannot prove that an
obligation belongs to the agent that just stopped. It never repeats a report the user
already saw. Neither event fails a stop, because a journal that can fail a build acquires
an incentive to be complete, and a complete journal is a transcript again.

The journal lives in .coherence/decisions/ — ONE APPEND-ONLY FILE PER AGENT SESSION,
so two branches merge without a conflict and writers can never interleave. Commit the
folder; it is the record, not a cache. Read the merged timeline across every session,
job and branch with \`coherence decisions [--job X] [--agent Y] [--branch B] [--sessions] [--md]\`.
\`coherence decisions --open\` narrows it to the OPEN CONJECTURES — the standing list of
things this project noticed and did not chase, which is the entry most likely to decay
because the agent that saw it is gone.

A project may put its own voice into these emissions — \`.coherence/hooks/<Event>.override.md\`
replaces an event's canonical text, \`<Event>.append.md\` follows it — and \`coherence hooks
review\` prints every event's effective emission with its provenance.

--- what each agent is told (with a fresh session id per agent) ----------------
${agentInstructions("s-<minted per agent>")}
-------------------------------------------------------------------------------`);
}
