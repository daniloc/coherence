// run-named-test.ts — the per-claim oracle runner for node:test, INSIDE the evidence
// perimeter. This logic lived in scripts/run-named-test.mjs, which `sources: ["src"]`
// could not see: the component that decides whether a named oracle exists was itself
// neither tested nor claimable — the exact vacuity class it was written to close.
// The .mjs survives as a two-line entry so `config.test` is unchanged.
//
// WHY THIS EXISTS. `verify` answers an executable claim by spawning `config.test` with
// the test's name appended, and node:test cannot serve that shape directly: with MORE
// THAN ONE file argument node runs a subprocess per file and reports FILE-level counts,
// so `--test-name-pattern` stops being legible in the summary — a real name and a name
// that exists nowhere produce byte-identical output. Wiring that as `config.test` would
// make every claim green whether or not its oracle exists.
//
// With exactly ONE file argument the pattern filters correctly and the summary reports
// individual tests. So this resolves the name to its owning file first, then runs that
// file alone. It also sidesteps a second hazard: two of this repo's suites fail under
// node's PARALLEL multi-file mode while passing in isolation, so one-file-at-a-time is
// the honest execution mode regardless.
//
// A name that matches no file exits NONZERO by design — a claim citing an oracle that
// does not exist must fail, not pass quietly. That property is what the serial canary
// (`proveSerialRunnerCanFail`, phrasebook.ts) probes for on every serial verify.
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** `verify` regex-escapes the name before handing it over (it is a --test-name-pattern);
 *  undo that to find the literal title in source. */
export const unescapeTestName = (name: string): string =>
  name.replace(/\\([.*+?^${}()|[\]\\])/g, "$1");

/**
 * Run the ONE named test and return the exit code the shim should exit with:
 *   0 — every owning file's filtered run passed
 *   1 — a run failed, OR no test file contains the name (the vanished oracle)
 *   2 — no name given (a usage error, distinct from a red oracle)
 */
export function runNamedTest(name: string | undefined, testDir = "test"): number {
  if (!name) {
    console.error("run-named-test: no test name given");
    return 2;
  }
  const literal = unescapeTestName(name);
  const owners = readdirSync(testDir)
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => readFileSync(join(testDir, f), "utf8").includes(literal));

  if (owners.length === 0) {
    console.error(`run-named-test: no test file contains "${literal}"`);
    return 1;
  }

  // A title living in two files is ambiguous for a claim to cite: run them all
  // and let any failure fail the claim, rather than silently picking one.
  //
  // POSITIVE EVIDENCE, NOT EXIT CODES ALONE. Measured on node v25.2.1: a single-file run
  // whose --test-name-pattern matches NOTHING exits 0 AND reports "tests 1 · pass 1" —
  // byte-close enough to a real pass that even a `testMatch` like "pass [1-9]" is satisfied
  // vacuously. So a title that survives only as a STRING (a comment, another test's body)
  // would pass while enforcing nothing. The discriminator every reporter provides is the
  // executed test's own name echoed in the output (`✔ <title>` / `ok N - <title>`), so a
  // green here additionally requires the literal title to appear in some owner's run.
  // The child must not inherit NODE_TEST_CONTEXT: when this runner is itself exercised
  // under `node --test` (its own contract tests), the flag makes the child believe it is
  // a nested run and SKIP every file — a skip that would read as "no test ran".
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  let failed = false;
  let evidenced = false;
  for (const f of owners) {
    const r = spawnSync("node", ["--test", "--test-name-pattern", name, join(testDir, f)], {
      encoding: "utf8",
      env,
    });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) failed = true;
    else if (((r.stdout ?? "") + (r.stderr ?? "")).includes(literal)) evidenced = true;
  }
  if (failed) return 1;
  if (!evidenced) {
    console.error(
      `run-named-test: "${literal}" appears in ${owners.join(", ")} but no test with this name ran`
      + ` — the title is a string in the file, not a test (renamed? commented out?)`,
    );
    return 1;
  }
  return 0;
}
