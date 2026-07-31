#!/usr/bin/env node
// run-named-test.mjs — the per-claim oracle runner for node:test.
//
// WHY THIS EXISTS. `verify` answers an executable claim by spawning
// `config.test` with the test's name appended, and node:test cannot serve that
// shape directly: with MORE THAN ONE file argument node runs a subprocess per
// file and reports FILE-level counts, so `--test-name-pattern` stops being
// legible in the summary — a real name and a name that exists nowhere produce
// byte-identical output. Wiring that as `config.test` would make every claim
// green whether or not its oracle exists, which is the exact vacuity this
// harness exists to catch.
//
// With exactly ONE file argument the pattern filters correctly and the summary
// reports individual tests. So this shim resolves the name to its owning file
// first, then runs that file alone. It also sidesteps a second hazard: two of
// this repo's suites fail under node's PARALLEL multi-file mode while passing
// in isolation, so one-file-at-a-time is the honest execution mode regardless.
//
// A name that matches no file exits NONZERO by design — a claim citing an
// oracle that does not exist must fail, not pass quietly.
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const name = process.argv[2];
if (!name) {
  console.error("run-named-test: no test name given");
  process.exit(2);
}

// `verify` regex-escapes the name before handing it over (it is a
// --test-name-pattern), so undo that to find the literal title in source.
const literal = name.replace(/\\([.*+?^${}()|[\]\\])/g, "$1");

const dir = "test";
const owners = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => readFileSync(join(dir, f), "utf8").includes(literal));

if (owners.length === 0) {
  console.error(`run-named-test: no test file contains "${literal}"`);
  process.exit(1);
}

// A title living in two files is ambiguous for a claim to cite: run them all
// and let any failure fail the claim, rather than silently picking one.
let failed = false;
for (const f of owners) {
  const r = spawnSync("node", ["--test", "--test-name-pattern", name, join(dir, f)], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
