// declared-root.test.ts — the walk floor: a configless directory refuses, and `{}` is
// a complete declaration. Born from a real incident: `npx coherence verify` started in
// a home directory walked every .ts file under it with full confidence.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpProject, cleanup } from "./_helpers.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const exec = promisify(execFile);

async function run(root: string, args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  return exec(process.execPath, [CLI, ...args], { cwd: root })
    .then((r) => ({ code: 0, stderr: r.stderr, stdout: r.stdout }))
    .catch((e: { code: number; stderr: string; stdout: string }) => ({ code: e.code, stderr: e.stderr, stdout: e.stdout }));
}

test("declared root — a configless directory refuses the walk and an empty config declares it", async () => {
  const root = await tmpProject({
    "app.spec.md": "# app\n\nFixture.\n\n## works when\n\n- app.ts exists at this node\n\n## why\n\nA fixture needs a reason too.\n",
    "app.ts": "export const x = 1;\n",
  });
  try {
    const refused = await run(root, ["verify"]);
    assert.equal(refused.code, 2, "an undeclared tree is an Unrunnable, exit 2");
    assert.match(refused.stderr, /UNDECLARED tree/);
    assert.match(refused.stderr, /coherence\.config\.json/, "the refusal carries the one-line bootstrap");

    const ratchet = await run(root, ["lint-sinks"]);
    assert.equal(ratchet.code, 2, "ratchet scans are walks too");

    // Journal verbs never walk — they must work in an undeclared directory.
    const journal = await run(root, ["decide", "test entry", "--because", "floor check", "--session", "s-declared-root", "--agent", "guard"]);
    assert.equal(journal.code, 0, journal.stderr);

    // `{}` is a complete declaration: presence is the point, defaults do the rest.
    await writeFile(join(root, "coherence.config.json"), "{}\n");
    const declared = await run(root, ["verify", "--fast"]);
    assert.equal(declared.code, 0, `an empty config runs on the defaults\n${declared.stderr}\n${declared.stdout}`);
  } finally { await cleanup(root); }
});
