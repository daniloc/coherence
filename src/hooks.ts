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
    emit(event, agentInstructions(rec.session, projectCli(cfg), rec.agent));
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

/** `coherence hooks --check` — IS THE HOOK ACTUALLY FIRING?
 *
 *  This exists because the first real test of the hook path failed SILENTLY: the
 *  settings block was present and well-formed, `coherence hook SubagentStart` emitted
 *  correct JSON when run by hand, and the subagent received nothing at all. No error,
 *  no warning — the mechanism looked installed and did nothing, which is the exact
 *  defect this project's doctrine names ("the readFidelity guard reported green for
 *  hours while gating nothing").
 *
 *  The tell is structural: a hook-opened session writes a `session` header record. If
 *  the journal has decisions but ZERO hook-opened sessions, every entry was logged by
 *  an agent that was told to by hand, and the hook is not running. */
export function checkHooks(cfg: Config): number {
  const settings = join(cfg.root, ".claude", "settings.json");
  const local = join(cfg.root, ".claude", "settings.local.json");
  const configured: string[] = [];
  for (const f of [settings, local]) {
    if (!existsSync(f)) continue;
    try {
      const j = JSON.parse(readFileSync(f, "utf8"));
      for (const ev of Object.keys(j?.hooks ?? {})) {
        const cmds = JSON.stringify(j.hooks[ev]);
        // Accept the general CLI and the dedicated low-cost hook entrypoint, installed
        // or source-local. They all reach `runHook`; spelling must not hide a live hook.
        if (/(?:\bcoherence\s+hook\b|\bcoherence-hook\b|src\/(?:cli|hook-cli)\.ts\b)/.test(cmds)) {
          configured.push(`${ev} (${f.endsWith("local.json") ? "local" : "project"})`);
        }
      }
    } catch { console.log(`  ! ${f} is not valid JSON`); }
  }
  const { records, sessions } = readJournal(cfg);
  const opened = records.filter((r) => r.kind === "session");
  const entries = records.length - opened.length;

  console.log(`hooks configured: ${configured.length ? configured.join(", ") : "NONE"}`);
  console.log(`journal: ${entries} entr${entries === 1 ? "y" : "ies"} across ${sessions.length} session(s)`);
  console.log(`sessions OPENED BY A HOOK: ${opened.length}`);
  console.log("");

  if (!configured.length) {
    console.log("The hook is not configured. Run `coherence hooks` and paste the block.");
    return 1;
  }
  if (opened.length === 0) {
    console.log([
      "CONFIGURED BUT NEVER FIRED. The settings block is present and no hook has ever",
      "opened a session. Either no agent has started since you added it, or this harness",
      "is not running project hooks at all — some embedded/SDK hosts do not. Verify with a",
      "throwaway PostToolUse hook that touches a file, then run any tool: if the file does",
      "not appear, no project hook runs here and agents must be told to log in their brief.",
      "",
      "The journal still works: `coherence decide` is a plain command and needs no hook.",
    ].join("\n"));
    return 1;
  }
  console.log(`FIRING. ${opened.length} session(s) were opened by the hook.`);
  return 0;
}

/** `coherence hooks` — print the block to paste into .claude/settings.json, plus the
 *  instruction text so a reader can see what agents will actually be told. */
export function printHooks(cfg: Config): void {
  const hook = '"${CLAUDE_PROJECT_DIR}/node_modules/.bin/coherence-hook"';
  const block = {
    hooks: {
      SubagentStart: [{ hooks: [{ type: "command", command: `${hook} SubagentStart` }] }],
      SessionStart: [{ hooks: [{ type: "command", command: `${hook} SessionStart` }] }],
      SubagentStop: [{ hooks: [{ type: "command", command: `${hook} SubagentStop` }] }],
      Stop: [{ hooks: [{ type: "command", command: `${hook} Stop` }] }],
      PostToolUse: [{
        matcher: "Read|Grep|Glob|Write|Edit|MultiEdit|NotebookEdit",
        hooks: [{ type: "command", command: `${hook} PostToolUse` }],
      }],
    },
  };
  console.log("Paste into .claude/settings.json (merge with any existing `hooks` key),");
  console.log("then run `coherence hooks --check` to confirm it actually FIRES:\n");
  console.log(JSON.stringify(block, null, 2));
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
  void cfg;
}
