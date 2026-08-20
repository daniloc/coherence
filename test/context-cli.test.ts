import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tmpProject } from "./_helpers.ts";

const exec = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const run = (root: string, args: string[]) => exec(process.execPath, [CLI, ...args], { cwd: root })
  .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
  .catch((error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));

test("context CLI is bounded by default, expands explicitly, and refuses an impossible budget", async () => {
  const rationale = Array.from({ length: 900 }, (_, index) => `Reason ${index} names a distinct architectural consequence.`).join(" ");
  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({ entryDir: "app", codeExt: ["ts"], language: "typescript", platform: null }),
    "README.md": "repository guide\n",
    "app/app.spec.md": `# App\n\nFixture.\n\n## works when\n\n- app.ts exists at this node\n\n## why\n\n${rationale}\n`,
    "app/app.ts": "export const value = 1;\n",
  });
  try {
    const bounded = await run(root, ["context", "app/app.ts"]);
    assert.equal(bounded.code, 0, bounded.stderr);
    assert.ok(Buffer.byteLength(bounded.stdout) <= 12_001, `default packet was ${Buffer.byteLength(bounded.stdout)} bytes`);
    assert.match(bounded.stdout, /WITHHOLDING|withheld/i);

    const expanded = await run(root, ["context", "app/app.ts", "--all"]);
    assert.equal(expanded.code, 0, expanded.stderr);
    assert.ok(Buffer.byteLength(expanded.stdout) > Buffer.byteLength(bounded.stdout));

    const repositorySurface = await run(root, ["context", "README.md", "--max-bytes", "4000"]);
    assert.equal(repositorySurface.code, 0, repositorySurface.stderr);
    assert.match(repositorySurface.stdout, /README\.md/);
    assert.match(repositorySurface.stdout, /graph ownership unavailable/);

    const impossible = await run(root, ["context", "app/app.ts", "--max-bytes", "100"]);
    assert.equal(impossible.code, 2);
    assert.match(impossible.stderr, /cannot hold mandatory framing; minimum is \d+/);
    assert.doesNotMatch(impossible.stderr, /at .*src\/context\.ts/);

    const ambiguous = await run(root, ["context", "app/app.ts", "--all", "--max-bytes", "1000"]);
    assert.equal(ambiguous.code, 2);
    assert.match(ambiguous.stderr, /mutually exclusive/);
  } finally { await cleanup(root); }
});
