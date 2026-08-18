// sinks-python.test.ts — the PYTHON GRADE of the interpolation-surface ratchet
// (src/lint-sinks.ts, header: PYTHON GRADE). The JS path reads `${…}` template-literal
// interpolations; this pins that a `.py` f-string flows through the SAME machinery:
//   · a `{expr}` inside a SQL-shaped f-string is a `sql-ident` site — python's sql signal
//     is the literal's own text (select…from), because the f-string's delimiters consume
//     the `"${expr}"` quote wrap that carries the signal in JS;
//   · the configured safe regexes grade the python EXPRESSION identically (a safeSql
//     match is not a site), `{{` escapes are literal braces, format-spec/conversion
//     suffixes are stripped so `{w:>4}` pins the expression `w`;
//   · a python site has ordinary `context|file|expr` identity — pinned by --update-baseline,
//     and a NEW .py site reds --check while the TS sites alongside are untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lintSinks } from "../src/lint-sinks.ts";
import { tmpProject, cleanup, cfg, runCaptured } from "./_helpers.ts";

test("python sinks — an f-string into a SQL context is a site, a safe-pattern expression is not, and the ratchet reds the new site", async (t) => {
  const root = await tmpProject({
    // One raw sql site ({table}); one safe-by-construction expression (quote_ident(col)).
    "src/db.py": [
      "def fetch(table, col):",
      '    q = f"select * from {table} where id = {quote_ident(col)}"',
      "    return q",
    ].join("\n") + "\n",
    // Two html sites ({name!r} → name, {w:>4} → w); one `{{` escape that is NOT a site.
    "src/page.py": [
      "def render(name, w):",
      "    return f\"<div class='{name!r}'>{{literal}} {w:>4}</div>\"",
    ].join("\n") + "\n",
    // The JS path, alongside — proves .py support did not contaminate the TS scan.
    "src/query.ts": 'const q = `SELECT "${u.characteristic}" FROM t`;\n',
  });
  t.after(() => cleanup(root));
  const c = cfg(root, { sources: ["src"], codeExt: ["ts", "py"], sinks: { safeSql: "^quote_ident\\(" } });

  // First run pins. The baseline file is the sharpest witness of classification:
  // context|file|expr keys, one per site.
  await runCaptured(() => lintSinks(c, "update"));
  const base: string[] = JSON.parse(await readFile(join(root, "public/sinks-baseline.json"), "utf8"));
  assert.ok(base.includes("sql-ident|src/db.py|table"), "raw f-string expr into a SQL statement is a sql site");
  assert.ok(base.includes("html-value|src/page.py|name"), "markup-line f-string is html; `!r` conversion stripped");
  assert.ok(base.includes("html-value|src/page.py|w"), "`:>4` format spec stripped — the expr is what precedes `:`");
  assert.ok(base.includes("sql-ident|src/query.ts|u.characteristic"), "the TS path still sees its own site");
  assert.ok(!base.some((k) => k.includes("quote_ident")), "an expr matching sinks.safeSql is NOT a raw site");
  assert.ok(!base.some((k) => k.includes("literal")), "a `{{` escape is a literal brace, not a site");
  assert.equal(base.length, 4, "exactly the four sites above — nothing phantom on either path");

  const held = await runCaptured(() => lintSinks(c, "check"));
  assert.equal(held.code, 0, "the pinned python+ts surface is clean");
  assert.match(held.out, /injection ratchet held/);

  // A NEW python site — a different expression at an unreviewed path — must red the check.
  await writeFile(join(root, "src/evil.py"), 'q = f"delete from {req_table}"\n');
  const grown = await runCaptured(() => lintSinks(c, "check"));
  assert.equal(grown.code, 1, "the ratchet must catch a new .py sink");
  assert.match(grown.err, /1 new raw interpolation site/);
  assert.match(grown.err, /\[sql-ident\] src\/evil\.py/);
  assert.match(grown.err, /req_table/);
  assert.doesNotMatch(grown.err, /u\.characteristic/, "the baselined TS site is not dragged into the alarm");
  assert.doesNotMatch(grown.err, /query\.ts/, "TS fixtures behave exactly as before");
});
