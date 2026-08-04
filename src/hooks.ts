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
// stays silent when the host marks the follow-up stop as active. Exit 2 would make the
// journal a gate, and a gate acquires an incentive to be complete — at which point it is
// a transcript again, which is the thing it exists to compress.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJournal, openSession, resolve } from "./decisions.ts";
import {
  canonicalLifecycleHookSettings, inspectLifecycleHook, setLifecycleHook,
  LIFECYCLE_HOOK_SCRIPT, lifecycleRootMapping, resolveClaudeProjectRoot,
  type LifecycleHookInspection,
} from "./control.ts";
import { readDue, formatDue } from "./due.ts";
import type { Config } from "./types.ts";

/** Use the source entrypoint only while this repository dogfoods itself. Consumers get
 * the installed binary. Keeping this choice here also means the injected command is the
 * command an agent can actually run, rather than release-oriented prose copied locally. */
function projectCli(cfg: Config): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cfg.root, "package.json"), "utf8"));
    if (pkg?.name === "coherence-harness" && existsSync(join(cfg.root, "src", "cli.ts"))) return "node src/cli.ts";
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

/** `coherence hook <event>` — the hook body itself, so nothing has to be written to
 *  disk or kept in sync with a script file. Reads the event payload on stdin (unused
 *  today, but hooks are fed JSON and ignoring it silently would be rude to the next
 *  person who needs a field from it) and prints the documented output shape. */
export async function runHook(cfg: Config, event: string): Promise<number> {
  const raw = await readStdin(); // drained deliberately: an unread pipe can SIGPIPE the caller
  let payload: unknown = {};
  try { payload = raw.trim() ? JSON.parse(raw) : {}; } catch { /* hooks must survive a host's malformed payload */ }
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const hostScope = p.agent_id ?? p.agentId ?? p.session_id ?? p.sessionId;

  if (event === "SubagentStart" || event === "SessionStart") {
    // The session is OPENED here, by the hook, once per agent — which is the only
    // place that can guarantee one id per agent rather than one per shell command.
    const rec = openSession(cfg, {
      session: hostScope === undefined ? undefined : String(hostScope),
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
    emit(event, [agentInstructions(rec.session, cli, rec.agent), ...due].join("\n"));
    return 0;
  }

  // The CHEAP tick: collect only explicit file paths. No graph build, no git worktree,
  // and no attempt to reverse-engineer shell command strings. These transient rows are
  // what `calibrate` later compares with economy's predicted closure.
  if (event === "PostToolUse") {
    const { recordHookReads } = await import("./read-trace.ts");
    recordHookReads(cfg, payload);
    return 0;
  }

  if (event === "SubagentStop" || event === "Stop") {
    // Stop additionalContext gives the agent one feedback turn. Without this host flag
    // guard, that turn stops again, receives the same feedback again, and loops until the
    // host's hard cap — expensive signaling turning into an accidental gate.
    if (stopFeedbackActive(payload)) return 0;
    // The EXPENSIVE tick runs once, when a patch is about to leave the context that made
    // it. Snapshot any observed reads, then put the patch's anchor signal directly in the
    // final instruction. Neither operation gates the stop hook; CI's `signal --check` is
    // the enforcement point after the agent has had this chance to settle it.
    const session = String(hostScope ?? process.env.COHERENCE_SESSION ?? "unknown");
    const [{ recordCalibrationSample }, { analyzeChange, formatSignal }] = await Promise.all([
      import("./calibration.ts"), import("./signal.ts"),
    ]);
    await recordCalibrationSample(cfg, session).catch(() => null);
    const change = await analyzeChange(cfg).then((s) => formatSignal(s).join("\n"))
      .catch((e: unknown) => `CHANGE SIGNAL unavailable: ${e instanceof Error ? e.message : String(e)}`);
    emit(event, `${stopReport(cfg)}\n\n${change}`);
    return 0;
  }

  // An unknown event is not an error: hook sets grow, and a harness that crashes on a
  // new event name breaks every session that added one.
  return 0;
}

/** What an agent is told as it finishes. Split out of `runHook` so it is reachable
 *  without a stdin pipe — the hook body drains stdin, and a report you can only observe
 *  by feeding a process is a report nobody tests. */
export function stopReport(cfg: Config): string {
  const cli = projectCli(cfg);
  const { records, unreadable } = readJournal(cfg);
  const n = records.filter((r) => r.kind !== "session").length;
  // A REPORT, NOT A QUESTION — and that distinction is load-bearing, because the first
  // version got it wrong in a way that was invisible until agents started answering it.
  // It ended "anything you decided and did not log is about to leave with your context",
  // which is a yes/no question, and a Stop hook that asks "did you do X?" gets "yes, X is
  // done" in the reply. Agents began padding their final messages with compliance
  // liturgy — "nothing unlogged remains" — which is worse than silence: it spends the
  // caller's attention asserting a process was followed instead of saying what was found.
  //
  // So this states the count and stops. An agent that wants to log something can; the
  // reminder does not need to be a prompt, because `decide` was already in the startup
  // instruction and the agent has it. The only DIRECTIVE here is the restatement below,
  // and it asks for substance rather than for a status report on compliance.
  const msg = n === 0
    ? "DECISION JOURNAL: nothing logged this session."
    : `DECISION JOURNAL: ${n} entr${n === 1 ? "y" : "ies"} recorded`
      + (unreadable ? ` (${unreadable} unreadable line(s), skipped)` : "")
      + ".";
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
  // and reported none of it. Stop is the last moment the context still exists to say so.
  const restate = "\n\nYOUR REPLY MUST RESTATE YOUR FINAL REPORT — IT IS THE ONLY THING"
    + " YOUR CALLER SEES. A terse sign-off discards everything you learned that is not"
    + " already in the code.";
  return msg + restate + (open.length
    ? `\n\n${open.length} OPEN CONJECTURE(S) in this repo — noticed, not yet chased.`
      + ` If your work settled one, close it with \`${cli} resolved <id> --because ...\`;`
      + ` if one is not worth chasing, \`${cli} dismiss <id> --because ...\` retires it.`
      + ` \`${cli} decisions --open\` lists them.`
    : "");
}

function emit(event: string, additionalContext: string): void {
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
  control: LifecycleHookInspection;
  observation: { sessionsOpenedByHook: number; journalEntries: number; sessions: number };
}

/** Structural control state and historical runtime evidence are adjacent, never fused. */
export function hookStatus(cfg: Config): HookStatus {
  const control = inspectLifecycleHook(cfg);
  const { records, sessions } = readJournal(cfg);
  const opened = records.filter((r) => r.kind === "session");
  const entries = records.length - opened.length;
  return {
    control,
    observation: { sessionsOpenedByHook: opened.length, journalEntries: entries, sessions: sessions.length },
  };
}

function printHookStatus(status: HookStatus, json = false): void {
  if (json) { console.log(JSON.stringify(status, null, 2)); return; }
  const { control, observation } = status;
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
  console.log(`runtime observation: ${observation.sessionsOpenedByHook
    ? `OBSERVED — ${observation.sessionsOpenedByHook} session(s) opened by a hook`
    : "UNOBSERVED — no hook-opened session is recorded"}`);
  console.log(`journal: ${observation.journalEntries} entr${observation.journalEntries === 1 ? "y" : "ies"} across ${observation.sessions} session(s)`);
  for (const warning of control.warnings) console.log(`warning: ${warning}`);
}

/** `coherence hooks status` — report the switch and the observation beside it. */
export function reportHooks(cfg: Config, json = false): number {
  const status = hookStatus(cfg);
  printHookStatus(status, json);
  return status.control.valid ? 0 : 2;
}

/** `coherence hooks --check` — the binary current-control gate. Observation never redeems absence. */
export function checkHooks(cfg: Config, json = false): number {
  const status = hookStatus(cfg);
  printHookStatus(status, json);
  if (!status.control.valid) return 2;
  return status.control.present ? 0 : 1;
}

export async function installHooks(cfg: Config, json = false): Promise<number> {
  const result = await setLifecycleHook(cfg, true);
  if (result.errors.length) {
    if (json) console.log(JSON.stringify({ errors: result.errors, control: result.inspection }, null, 2));
    else for (const error of result.errors) console.error(`cannot install lifecycle hook: ${error}`);
    return 2;
  }
  if (!json) console.log(result.changed.length ? "installed lifecycle hook in shared project settings" : "lifecycle hook already installed");
  const status = hookStatus(cfg);
  printHookStatus(status, json);
  // The moment the control turns ON is the one moment the operator is guaranteed to be
  // reading — and it is exactly when the journal starts being written. Say where to watch.
  if (!json && status.control.present)
    console.log("\nwatch it live: npx coherence journal — entries stream in as agents write them");
  return status.control.present ? 0 : 1;
}

export async function uninstallHooks(cfg: Config, json = false): Promise<number> {
  const result = await setLifecycleHook(cfg, false);
  if (result.errors.length) {
    if (json) console.log(JSON.stringify({ errors: result.errors, control: result.inspection }, null, 2));
    else for (const error of result.errors) console.error(`cannot uninstall lifecycle hook: ${error}`);
    return 2;
  }
  if (!json) console.log(result.changed.length ? "uninstalled lifecycle hook" : "lifecycle hook already absent");
  const status = hookStatus(cfg);
  printHookStatus(status, json);
  return status.control.valid && !status.control.present ? 0 : 1;
}

/** `coherence hooks` — print the block to paste into .claude/settings.json, plus the
 *  instruction text so a reader can see what agents will actually be told. */
export function printHooks(cfg: Config): void {
  const block = canonicalLifecycleHookSettings();
  const claudeRoot = resolveClaudeProjectRoot(cfg);
  console.log(`Canonical control for ${claudeRoot}. Prefer \`coherence hooks install\`; it preserves unrelated hooks.`);
  console.log("The settings value, stable launcher, and root mapping are:\n");
  console.log(JSON.stringify(block, null, 2));
  console.log(`\n--- .claude/coherence-hook ---\n${LIFECYCLE_HOOK_SCRIPT}--- .claude/coherence-root ---\n${lifecycleRootMapping(cfg)}`);
  console.log(`
SubagentStart / SessionStart inject the instruction below into the agent's context.
PostToolUse records explicit file reads and writes for per-agent economy calibration; it
emits no instruction and uses a dedicated dependency-light entrypoint.
SubagentStop / Stop report what the journal holds AND the current patch's change signal —
they return non-error feedback once, then stay silent when the host marks the follow-up
stop active. They never fail a stop, because a journal that can fail a build acquires an
incentive to be complete, and a complete journal is a transcript again.

The journal lives in .coherence/decisions/ — ONE APPEND-ONLY FILE PER AGENT SESSION,
so two branches merge without a conflict and writers can never interleave. Commit the
folder; it is the record, not a cache. Read the merged timeline across every session,
job and branch with \`coherence decisions [--job X] [--agent Y] [--branch B] [--sessions] [--md]\`.
\`coherence decisions --open\` narrows it to the OPEN CONJECTURES — the standing list of
things this project noticed and did not chase, which is the entry most likely to decay
because the agent that saw it is gone.

--- what each agent is told (with a fresh session id per agent) ----------------
${agentInstructions("s-<minted per agent>")}
-------------------------------------------------------------------------------`);
}
