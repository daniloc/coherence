// sinks-rust.test.ts — rust gains the injection ratchet through the format-args strategy:
// placeholders parsed out of a format! literal and mapped to the call's arguments, with
// markup read off the literal so generics on the line are never HTML.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpProject, cleanup } from "./_helpers.ts";
import { formatArgSites } from "../src/lint-sinks.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const exec = promisify(execFile);

async function run(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return exec(process.execPath, [CLI, ...args], { cwd: root })
    .then((r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }))
    .catch((e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
}

test("rust sinks — a format! placeholder into a SQL context is a site, the safe pattern exempts, and generics on the line are not markup", async () => {
  assert.deepEqual(formatArgSites("SELECT {} FROM {}{filter} WHERE {0} {{x}} {n:>4}", ` cols.join(", "), qi(t), n = rows.len()`),
    [`cols.join(", ")`, "qi(t)", "filter", `cols.join(", ")`, "rows.len()"],
    "{} takes the next positional, {0} an explicit one, {name} a named argument or the inline capture; {{ is an escape and :spec is dropped");

  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({
      entryDir: "src", codeExt: ["rs"], language: "rust", platform: null,
      sources: ["src"], sinks: { safeSql: "^qi\\(" },
    }),
    "src/app.spec.md": "# app\n\nRust sink fixture.\n\n## works when\n\n- store.rs exists at this node\n",
    "src/store.rs": [
      "/// Count one table's rows.",
      "pub fn count(db: &Db, table: &str) -> Vec<Row> {",
      '    db.query(&format!("SELECT COUNT(*) FROM {}", qi(table)))',
      "}",
      "pub fn badge(out: &mut String, status: &str) -> Result<Vec<u8>, E> {",
      '    write!(out, "<span class=\\"badge\\">{status}</span>")',
      "}",
      "pub fn label(name: &str) -> Option<Vec<String>> { Some(vec![format!(\"name: {}\", name)]) }",
      "",
    ].join("\n"),
  });
  try {
    // qi(table) is graded safe; {status} inside markup is one site; the label line carries
    // `Vec<String>` but its literal holds no tag, so it is not HTML.
    const pin = await run(root, ["lint-sinks", "--update-baseline"]);
    assert.match(pin.stdout, /Pinned 1 reviewed interpolation site/, pin.stdout + pin.stderr);
    assert.equal((await run(root, ["lint-sinks", "--check"])).code, 0);

    await writeFile(join(root, "src", "drop.rs"), [
      "pub fn drop_all(db: &Db, tables: &[String]) {",
      '    for t in tables { db.exec(&vec![format!("DROP TABLE {}", t)].join(";")); }',
      "}",
      "",
    ].join("\n"));
    const red = await run(root, ["lint-sinks", "--check"]);
    assert.equal(red.code, 1, red.stdout);
    assert.match(red.stderr, /\[sql-ident\] src\/drop\.rs:2 {2}\$\{t\}/,
      "a format! nested in another macro's token tree is still read, and named by its bare argument");
  } finally { await cleanup(root); }
});
