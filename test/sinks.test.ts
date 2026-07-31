// sinks.test.ts — the INTERPOLATION-SURFACE RATCHET (src/lint-sinks.ts), and specifically
// its addressing. The scanning half is a pair of regexes; the half that can actually lie is
// how a live site is matched against the reviewed baseline:
//   · A MOVE READ AS NEW RISK — the baseline keys a site by `context|file|expr`, so
//     relocating a file used to re-address every sink inside it. A refactor then produced
//     false alarms in proportion to how much code it moved, and a ratchet whose alarms are
//     routinely wrong is a ratchet reviewers learn to wave through. (Observed live: eight
//     subsystems extracted out of one module, "7 new sites", four of them untouched.)
//   · A COPY READ AS A MOVE — the fix for the above must not become a laundering channel.
//     Dropping the path from identity would let an already-reviewed expression reappear in
//     a new and more dangerous file for free. Absorption is COUNT-CONSERVING: only a
//     baselined site that VANISHED can absorb a relocated one, one for one.
// Both directions are pinned below; reversing either fails a test by name.
import test from "node:test";
import assert from "node:assert/strict";
import { rename, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { lintSinks, reconcile, type Finding } from "../src/lint-sinks.ts";
import { tmpProject, cleanup, cfg, runCaptured } from "./_helpers.ts";

const at = (file: string, expr: string, context = "sql-ident", line = 1): Finding => ({ context, file, expr, line });
const key = (x: Finding) => `${x.context}|${x.file}|${x.expr}`;

// ── the pure layer: reconcile ────────────────────────────────────────────────────────────

test("a baselined sink whose file moved is a MOVE, not a novel site", () => {
  const before = at("entities/Patient/patient.ts", "u.characteristic");
  const after = at("shared/paths/tools.ts", "u.characteristic");
  const { moved, novel } = reconcile([key(before)], [after]);
  assert.deepEqual(novel, [], "relocation is not new risk");
  assert.equal(moved.length, 1);
  assert.equal(moved[0].from, "entities/Patient/patient.ts");
  assert.equal(moved[0].to.file, "shared/paths/tools.ts");
});

test("a COPIED sink is novel — the original still lives, so nothing absorbs the duplicate", () => {
  const orig = at("entities/Patient/patient.ts", "u.characteristic");
  const copy = at("shared/paths/tools.ts", "u.characteristic");
  const { moved, novel } = reconcile([key(orig)], [orig, copy]);
  assert.deepEqual(moved, [], "the baselined site never vanished");
  assert.deepEqual(novel.map((n) => n.file), ["shared/paths/tools.ts"]);
});

test("a genuinely new expression at a new path is novel even when other sinks moved", () => {
  const base = [key(at("a/old.ts", "u.characteristic"))];
  const { moved, novel } = reconcile(base, [at("b/new.ts", "u.characteristic"), at("b/new.ts", "req.query.sort")]);
  assert.equal(moved.length, 1);
  assert.deepEqual(novel.map((n) => n.expr), ["req.query.sort"], "a different expression has nothing to inherit");
});

test("absorption is count-conserving — two vanished sites absorb two, and the third is novel", () => {
  const base = [key(at("a/one.ts", "row.name")), key(at("a/two.ts", "row.name"))];
  const now = [at("b/x.ts", "row.name"), at("b/y.ts", "row.name"), at("b/z.ts", "row.name")];
  const { moved, novel } = reconcile(base, now);
  assert.equal(moved.length, 2);
  assert.equal(novel.length, 1, "the surface grew by one and the ratchet must say so");
});

test("a sink that changed CONTEXT is novel — an SQL identifier is not an HTML value", () => {
  const base = [key(at("a/q.ts", "u.name", "sql-ident"))];
  const { moved, novel } = reconcile(base, [at("b/v.ts", "u.name", "html-value")]);
  assert.deepEqual(moved, [], "the kind of sink is part of the address; only the path is not");
  assert.equal(novel.length, 1);
});

test("an expression containing a pipe survives the baseline key round trip", () => {
  // `a || b` puts a `|` inside expr; splitting the key on every delimiter would
  // re-address the entry and silently reintroduce the very bug this file fixes.
  const before = at("a/old.ts", "x.id || y.id");
  const { moved, novel } = reconcile([key(before)], [at("b/new.ts", "x.id || y.id")]);
  assert.deepEqual(novel, []);
  assert.equal(moved[0]?.from, "a/old.ts");
});

test("an unchanged, still-baselined site is neither moved nor novel", () => {
  const x = at("a/q.ts", "u.name");
  assert.deepEqual(reconcile([key(x)], [x]), { moved: [], novel: [] });
});

// ── the glue layer: lintSinks over a real tree ───────────────────────────────────────────

const SINK = (expr: string) => "const q = `SELECT \"${" + expr + "}\" FROM t`;\n";

test("sinks — a moved file keeps its baselined identity and a genuinely new site still fails", async (t) => {
  const root = await tmpProject({ "src/entities/Patient/patient.ts": SINK("u.characteristic") });
  t.after(() => cleanup(root));
  const c = cfg(root, { sources: ["src"] });

  await runCaptured(() => lintSinks(c, "update"));
  assert.equal((await runCaptured(() => lintSinks(c, "check"))).code, 0, "the pinned site is clean");

  // 1. THE MOVE. Same context, same expression, new address — the refactor case.
  const moved = join(root, "src/shared/paths/tools.ts");
  await mkdir(dirname(moved), { recursive: true });
  await rename(join(root, "src/entities/Patient/patient.ts"), moved);

  const after = await runCaptured(() => lintSinks(c, "check"));
  assert.equal(after.code, 0, "a refactor must not manufacture a security alarm");
  assert.match(after.out, /1 baselined site\(s\) MOVED/);
  assert.match(after.out, /entities\/Patient\/patient\.ts → src\/shared\/paths\/tools\.ts/);

  // 2. THE GENUINELY NEW SITE. A different expression, at a path nobody reviewed.
  await writeFile(join(root, "src/shared/paths/render.ts"), SINK("req.query.sort"));
  const grown = await runCaptured(() => lintSinks(c, "check"));
  assert.equal(grown.code, 1, "the ratchet must still catch a new sink");
  assert.match(grown.err, /1 new raw interpolation site/);
  assert.match(grown.err, /req\.query\.sort/);
  assert.doesNotMatch(grown.err, /u\.characteristic/, "the moved site is not counted as new");

  // 3. THE COPY. The already-baselined expression, duplicated. Plain content-addressing
  //    would wave this through; conservation must not. The guarantee is the COUNT — with
  //    two byte-identical candidates and one vanished entry, WHICH of them inherited the
  //    review is genuinely arbitrary, and the ratchet only promises that exactly one site
  //    of new surface gets reported.
  await writeFile(join(root, "src/shared/paths/render.ts"), SINK("u.characteristic"));
  const copied = await runCaptured(() => lintSinks(c, "check"));
  assert.equal(copied.code, 1, "a reviewed expression duplicated into a new file is new surface");
  assert.match(copied.err, /1 new raw interpolation site/);
  assert.match(copied.err, /u\.characteristic/);
});
