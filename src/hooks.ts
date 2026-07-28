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
// THE NUDGE DOES NOT BLOCK. `SubagentStop` reports what the agent logged and stops
// there. Exit 2 would make the journal a gate, and a gate acquires an incentive to be
// complete — at which point it is a transcript again, which is the thing it exists to
// compress.
import { readJournal, openSession } from "./decisions.ts";
import type { Config } from "./types.ts";

/** The text every agent is handed at startup. Short on purpose: it is paid for by
 *  every agent on every job, and an instruction nobody finishes reading is a comment. */
export function agentInstructions(session: string): string {
  return [
    "DECISION JOURNAL — this repo keeps one, and you are expected to write to it.",
    "",
    "When you make a decision — a point where the work could have gone more than one",
    "way and you picked — record it BEFORE moving on:",
    "",
    `  npx coherence decide "<what you chose>" --over "<what you rejected>" --because "<why>" --session ${session}`,
    "",
    `YOUR SESSION ID IS ${session}. Pass it on every call — it is what keeps your`,
    "decisions attributable to you when four other agents are writing at the same time.",
    "",
    "`--over` is repeatable and it is the field that matters most: what you REJECTED is",
    "what stops the next agent re-litigating a settled question. If you rejected nothing,",
    "omit it — an unexamined choice and a forced one should not look alike.",
    "",
    "Two more verbs:",
    `  npx coherence blocked "<what you could not do>" --because "<why>" --session ${session}`,
    `  npx coherence retract <id> --because "<what refuted it>" --session ${session}`,
    "",
    "This gates nothing. It cannot fail your build and it is not a checklist — log the",
    "handful of choices a reader who never saw your transcript would need, not every step.",
    "A job that logs three real decisions is worth more than one that logs thirty steps.",
  ].join("\n");
}

/** `coherence hook <event>` — the hook body itself, so nothing has to be written to
 *  disk or kept in sync with a script file. Reads the event payload on stdin (unused
 *  today, but hooks are fed JSON and ignoring it silently would be rude to the next
 *  person who needs a field from it) and prints the documented output shape. */
export async function runHook(cfg: Config, event: string): Promise<number> {
  await readStdin(); // drained deliberately: an unread pipe can SIGPIPE the caller

  if (event === "SubagentStart" || event === "SessionStart") {
    // The session is OPENED here, by the hook, once per agent — which is the only
    // place that can guarantee one id per agent rather than one per shell command.
    const rec = openSession(cfg, { agent: process.env.COHERENCE_AGENT, job: process.env.COHERENCE_JOB });
    emit(event, agentInstructions(rec.session));
    return 0;
  }

  if (event === "SubagentStop" || event === "Stop") {
    const { records, unreadable } = readJournal(cfg);
    const n = records.filter((r) => r.kind !== "session").length;
    // Deliberately a report, not a demand. The agent is finishing; if it logged
    // nothing that is worth SAYING, because a silent zero is indistinguishable from a
    // job in which nothing was decided — and those are very different jobs.
    const msg = n === 0
      ? "DECISION JOURNAL: you logged nothing. If you made no real choices, that is a fine\n"
        + "answer. If you did, name them now with `npx coherence decide` — they are about to\n"
        + "leave with your context."
      : `DECISION JOURNAL: ${n} entr${n === 1 ? "y" : "ies"} recorded`
        + (unreadable ? ` (${unreadable} unreadable line(s), skipped)` : "")
        + ". Anything you decided and did not log is about to leave with your context.";
    emit(event, msg);
    return 0;
  }

  // An unknown event is not an error: hook sets grow, and a harness that crashes on a
  // new event name breaks every session that added one.
  return 0;
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

/** `coherence hooks` — print the block to paste into .claude/settings.json, plus the
 *  instruction text so a reader can see what agents will actually be told. */
export function printHooks(cfg: Config): void {
  const block = {
    hooks: {
      SubagentStart: [{ hooks: [{ type: "command", command: "npx coherence hook SubagentStart" }] }],
      SessionStart: [{ hooks: [{ type: "command", command: "npx coherence hook SessionStart" }] }],
      SubagentStop: [{ hooks: [{ type: "command", command: "npx coherence hook SubagentStop" }] }],
    },
  };
  console.log("Paste into .claude/settings.json (merge with any existing `hooks` key):\n");
  console.log(JSON.stringify(block, null, 2));
  console.log(`
SubagentStart / SessionStart inject the instruction below into the agent's context.
SubagentStop reports what the journal holds — it NEVER blocks, because a journal that
can fail a build acquires an incentive to be complete, and a complete journal is a
transcript again.

The journal lives in .coherence/decisions/ — ONE APPEND-ONLY FILE PER AGENT SESSION,
so two branches merge without a conflict and writers can never interleave. Commit the
folder; it is the record, not a cache. Read the merged timeline across every session,
job and branch with \`coherence decisions [--job X] [--agent Y] [--branch B] [--sessions] [--md]\`.

--- what each agent is told (with a fresh session id per agent) ----------------
${agentInstructions("s-<minted per agent>")}
-------------------------------------------------------------------------------`);
  void cfg;
}
