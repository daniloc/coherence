// sinks-ruby.test.ts — ruby gains the injection ratchet through the shared query table:
// no ruby-specific scanner exists, only capture data, which is the whole point of 2b.
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

async function run(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return exec(process.execPath, [CLI, ...args], { cwd: root })
    .then((r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }))
    .catch((e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
}

test("ruby sinks — an interpolation into a SQL context is a site and the safe pattern exempts", async () => {
  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({
      entryDir: "app", codeExt: ["rb"], language: "ruby", platform: null,
      sources: ["app"], sinks: { safeSql: "^quote_ident\\(" },
    }),
    "app/app.spec.md": "# app\n\nRuby sink fixture.\n\n## works when\n\n- report.rb exists at this node\n",
    "app/report.rb": [
      "# builds the status report",
      "def safe_rows(table)",
      '  db.execute("select status from #{quote_ident(table)}")',
      "end",
      "",
      "def badge(status)",
      '  "<span class=\\"badge\\">#{status}</span>"',
      "end",
      "",
    ].join("\n"),
  });
  try {
    // The safe SQL expression is exempt, so the pinned surface is the one html site.
    const pin = await run(root, ["lint-sinks", "--update-baseline"]);
    assert.match(pin.stdout, /Pinned 1 reviewed interpolation site/,
      "quote_ident(table) is graded by safeSql and never becomes a site; #{status} in markup is one");
    assert.equal((await run(root, ["lint-sinks", "--check"])).code, 0);

    // A raw identifier interpolation into a select-from literal reds the ratchet by name.
    await writeFile(join(root, "app", "rows.rb"), [
      "def rows(table)",
      '  db.execute("select status, count(*) from #{table} group by status")',
      "end",
      "",
    ].join("\n"));
    const red = await run(root, ["lint-sinks", "--check"]);
    assert.equal(red.code, 1, red.stdout);
    assert.match(red.stderr, /\[sql-ident\] app\/rows\.rb.*\$\{table\}/,
      "the new ruby site is named with its context, file, and bare expression");
  } finally { await cleanup(root); }
});
