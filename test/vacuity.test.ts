// vacuity.test.ts — NO INSTRUMENT MAY CLAIM HEALTH IT DID NOT MEASURE.
//
// THE CATEGORY. Every instrument turns a reading into a verdict, and a reading has two
// halves: the POPULATION it examined and what it found in it. Drop the population from the
// report and `0 of 0` renders exactly like `0 of 500` — "I looked and found nothing wrong"
// becomes indistinguishable from "I did not look". That is GREEN-BY-ABSENCE, and coherence
// already forbids it for claims in its own words: *a claim goes green only on positive
// evidence its oracle ran*, and *a vanished oracle reds its claim, never green-by-absence*.
// Every instance below was an instrument exempt from the harness's own rule.
//
// FOUND BY MEASUREMENT, not by review — all fourteen checking commands were run against the
// degenerate project this file builds (valid config, one spec, ZERO code files, not a git
// repo). Three sub-shapes:
//   · VACUOUS GREEN — `why-lint --check` printed "✓ no ## why sentence restates an anchored
//     chokepoint/oracle mechanism" over zero why sentences; `mass --check` printed
//     "✓ mass ratchet held" over a reading that had collapsed to nothing, and then
//     prescribed re-pinning it, which is how a broken deriver gets banked as the new floor.
//   · DENOMINATOR-LESS NULL — `decompose` reported "no decomposition smells surfaced"
//     without ever saying over what.
//   · ILLEGIBLE REFUSAL — `signal --check` threw an unhandled Error out of structural.ts
//     with a stack trace and a Node version banner, instead of a sentence naming the
//     problem. An instrument that cannot run must SAY SO; a stack trace is not a report.
//
// AND THE CURE ALREADY EXISTED HERE, five times over, which is why this is enforced rather
// than merely documented: `drift` says "only 0 mapped development commits", `economy` says
// "no closures to measure: nothing in the last 400 commits touched a file the graph owns",
// `calibrate` says "no samples yet", `lint-sinks` prints "total reviewed surface: 0",
// `conventions` prints "0 candidate convention(s)", and `atlas`/`contracts` decline outright
// with "no config — nothing to check". The right spelling was in the codebase the whole
// time and was simply never generalized — which is, verbatim, the finding `redundancy`
// reports about other people's code.
//
// WHY THE FIXTURE IS THE ORACLE. A per-command assertion list would be a second spelling of
// the command registry and would drift like every other one this repo has killed. This
// ENUMERATES `COMMANDS` and runs each verb against a world where there is genuinely nothing
// to be healthy about — so a command added tomorrow is covered the day it is registered,
// and the check reads the world instead of a list someone maintained.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { COMMANDS } from "../src/commands.ts";
import { tmpProject, cleanup } from "./_helpers.ts";

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = promisify(execFile);

/** A project where nothing can honestly be pronounced healthy: the config and one spec
 *  exist, so commands get far enough to REPORT rather than bailing on a missing config,
 *  but there is not a single code file and not a git repo. Every instrument's population
 *  is empty here — which is precisely the state in which a verdict must not be a ✓. */
const DEGENERATE = {
  "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: "app" }),
  "app/app.spec.md": "# app\n\nThe component.\n\n## works when\n\n- app.ts exists at this node\n",
};

/** The health glyph. If an instrument prints this, it is asserting that it checked
 *  something and that something was good. */
const HEALTH = "✓";

/** An unhandled throw, recognised by the shape node prints it in. A command may FAIL — many
 *  should here — but it must fail as a report, not as a crash. */
const isCrash = (s: string) => /^\s+at .*\(?file:\/\//m.test(s) || /\bNode\.js v\d/.test(s);

interface Ran { name: string; out: string }

/** Run every registered verb against the degenerate project. Exit codes are NOT asserted:
 *  a refusal (1), a clean decline (0) and a usage error are all legitimate answers to "there
 *  is nothing here". What is asserted is what the command SAYS. */
async function runAll(): Promise<Ran[]> {
  return Promise.all(COMMANDS.map(async (c) => {
    const dir = await tmpProject(DEGENERATE);
    try {
      // `--check` is the gating shape and the one CI runs, so it is what gets audited.
      // A command that does not take the flag ignores it.
      const p = run(process.execPath, [CLI_PATH, c.name, "--check"], { cwd: dir, timeout: 60_000 });
      // `hook` reads its payload from stdin and would otherwise block until the timeout.
      p.child.stdin?.end();
      const r = await p.catch((e: { stdout?: string; stderr?: string }) => e);
      return { name: c.name, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
    } finally { await cleanup(dir); }
  }));
}

/** Both assertions below are UNIVERSAL QUANTIFIERS over command output — "no command
 *  printed ✓", "no command crashed" — and a universal quantifier over an empty set is
 *  gloriously true. So the population is checked BEFORE it is judged.
 *
 *  THIS FILE SHIPPED WITHOUT THIS CHECK AND AN ADVERSARIAL REVIEW BROKE IT IMMEDIATELY:
 *  inserting `process.exit(2)` in cli.ts right after `const cmd = process.argv[2]` means no
 *  command can ever dispatch and nothing is ever printed — and both tests passed, green, in
 *  a file whose entire subject is instruments that cannot tell "I found nothing wrong" from
 *  "I did not look". The idiom was already in this suite twice (commands.test.ts's
 *  `live.length >= 20`, and `observed.length >= 3` in both totality oracles); it simply was
 *  not copied here. Writing the rule down is not the same as obeying it.
 *
 *  SUBSTANTIVE means: the process said something that is not merely the usage banner. A
 *  command rejected for a missing positional prints usage and is not evidence that the
 *  reporting path ran at all. */
function assertPopulationObserved(ran: Ran[]): void {
  const substantive = ran.filter((r) => {
    const t = r.out.trim();
    return t.length > 0 && !t.startsWith("usage: coherence");
  });
  assert.ok(substantive.length >= 8,
    `the oracle observed only ${substantive.length} substantive report(s) across ${ran.length} command(s) — the INSTRUMENT is broken, not the CLI. ` +
    `Every assertion in this file is a claim about command output; with no output they all pass vacuously, which is the exact defect this file exists to hunt.`);
}

test("VACUITY — no instrument claims health in a project where nothing was examined", async () => {
  const ran = await runAll();
  assertPopulationObserved(ran);
  const offenders = ran.filter((r) => r.out.includes(HEALTH));
  assert.deepEqual(offenders.map((r) => r.name), [],
    `these commands printed the health glyph "${HEALTH}" against a project with zero code files and no git history, which asserts a check that never had anything to check:\n` +
    offenders.map((r) => `  ${r.name}: ${(r.out.split("\n").find((l) => l.includes(HEALTH)) ?? "").trim()}`).join("\n") +
    `\n\nState the denominator instead — "0 of 0 examined", "nothing to check" — the way drift, economy, calibrate, lint-sinks and conventions already do.`);
});

test("VACUITY — an instrument that cannot run says so, and never emits a stack trace", async () => {
  // The degenerate project is NOT a git repo, which is the realistic version of this: a
  // shallow CI clone, a source export, a worktree that lost its .git. An instrument that
  // needs history must name that requirement in a sentence. Handing an operator a stack
  // trace is the same defect as green-by-absence wearing the opposite face — in both cases
  // the report fails to say what was and was not measured.
  const ran = await runAll();
  assertPopulationObserved(ran);
  const crashed = ran.filter((r) => isCrash(r.out));
  assert.deepEqual(crashed.map((r) => r.name), [],
    `these commands crashed instead of reporting. An instrument that cannot run must say WHY in a sentence:\n` +
    crashed.map((r) => `  ${r.name}: ${(r.out.split("\n").find((l) => /Error|error/.test(l)) ?? "").trim().slice(0, 120)}`).join("\n"));
});
