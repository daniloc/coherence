// run-named-test.test.ts — the serial oracle runner's own contract, now INSIDE the
// evidence perimeter (src/run-named-test.ts; scripts/run-named-test.mjs is a thin entry).
// The property that matters is the one the whole executable tier leans on: a name that
// exists NOWHERE exits nonzero — a claim citing a vanished oracle must fail, not pass
// quietly. This is the runner-side half of what the serial canary probes at verify time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runNamedTest, unescapeTestName } from "../src/run-named-test.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("runner contract — a name that exists nowhere exits nonzero (the vanished oracle cannot pass)", async () => {
  const root = await mkdtemp(join(tmpdir(), "rnt-"));
  try {
    await mkdir(join(root, "t"));
    await writeFile(join(root, "t", "a.test.ts"), 'import { test } from "node:test";\ntest("a real title", () => {});\n');
    assert.notEqual(runNamedTest("a title nobody ever wrote", join(root, "t")), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runner contract — a real name resolves to its owning file and exits 0 when it passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "rnt-"));
  try {
    await mkdir(join(root, "t"));
    await writeFile(join(root, "t", "a.test.ts"), 'import { test } from "node:test";\ntest("a real title", () => {});\n');
    assert.equal(runNamedTest("a real title", join(root, "t")), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runner contract — no name at all is a usage error (2), distinct from a red oracle (1)", () => {
  assert.equal(runNamedTest(undefined), 2);
});

test("runner contract — a title that survives only as a STRING fails: green needs a test that ran", async () => {
  // Measured on node v25.2.1: a zero-match --test-name-pattern run exits 0 and reports
  // "tests 1 · pass 1" — so exit codes and count-matching alone cannot tell a renamed
  // test (title left in a comment) from a real one. Positive evidence is the executed
  // title echoed by the reporter, and this pins that a comment is not evidence.
  const root = await mkdtemp(join(tmpdir(), "rnt-"));
  try {
    await mkdir(join(root, "t"));
    await writeFile(join(root, "t", "a.test.ts"),
      'import { test } from "node:test";\n// the old title lingers here: a ghost title in a comment\ntest("something else", () => {});\n');
    assert.notEqual(runNamedTest("a ghost title in a comment", join(root, "t")), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runner contract — the escaped form verify hands over is unescaped before the source grep", () => {
  assert.equal(unescapeTestName("rejects unknown \\(a\\+b\\)"), "rejects unknown (a+b)");
  assert.equal(unescapeTestName("plain title"), "plain title");
});

test("runner contract — the thin .mjs entry carries the same exit codes (the wiring is real)", () => {
  // Spawned exactly as config.test does, from the repo root: the entry must reach the
  // src logic and relay its verdict. A bogus name reads the real test/ dir and exits 1.
  const r = spawnSync("node", [join(repoRoot, "scripts", "run-named-test.mjs"), "a title nobody ever wrote 8f3a1c"], {
    cwd: repoRoot, encoding: "utf8",
  });
  assert.equal(r.status, 1);
  // The bogus title appears in THIS file as a string, so the entry resolves an owner and
  // must then refuse on zero matching tests (either message is the fail-closed path).
  assert.match(r.stderr, /no test file contains|no test with this name ran/);
});
