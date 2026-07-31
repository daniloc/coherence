// prose.test.ts — the PROSE-ROT detector. The failure it exists to catch: one argument
// cached verbatim on two reading surfaces, one copy updated, the other left to rot — and
// no reader able to see it without diffing both.
//
// The load-bearing tests here are the NEGATIVE CONTROLS, because this is the advisory
// class where one false positive teaches people to ignore the instrument: a genuine
// paraphrase of the same idea must NOT pair (that is a summary doing its job), and a
// sentence stamped into more places than maxDf must NOT pair (that is boilerplate, not a
// cached argument). The positive case — a mostly-verbatim copy with a local edit — must
// pair AND be labeled DIVERGED, ranked above pairs that still agree.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeWords, shinglesOf, unitsFromLines, proseOfMarkdown, headerLines, proseOfHeader,
  pairProse, unitSubject, prosePairSubject, proseFindings, renderProse, shownProse,
  collectProse, prose, PROSE_DEFAULTS, SHINGLE, type ProseUnit,
} from "../src/prose.ts";
import { tmpProject, cleanup, cfg, runCaptured } from "./_helpers.ts";

const u = (file: string, text: string, line = 1): ProseUnit =>
  ({ file, line, text, words: normalizeWords(text) });

// Two copies of one 22-word argument. B edits ONE word near the end — a local drift that
// keeps almost every 6-word run intact, which is exactly the "still mostly verbatim" rot
// the floor is tuned to keep.
const ORIGINAL = "The cached copy of an argument is worth its cost only while it stays cheaper than deriving the argument again from scratch.";
const DRIFTED  = "The cached copy of an argument is worth its cost only while it stays cheaper than deriving the argument again from nothing.";
// The same idea, independently worded — shares topic vocabulary but no 6-word run.
const PARAPHRASE = "Caching a fact only pays off when rereading it costs less than working the fact out again from its original sources.";

// ── the pure math ─────────────────────────────────────────────────────────────────────

test("normalizeWords / shinglesOf — punctuation-blind, k-word runs, short text yields none", () => {
  assert.deepEqual(normalizeWords("The COPIES no-longer agree!"), ["the", "copies", "no", "longer", "agree"]);
  const s = shinglesOf(["a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual([...s], ["a b c d e f", "b c d e f g"]);
  assert.equal(shinglesOf(["too", "short"]).size, 0);
});

test("pairProse — a mostly-verbatim copy with one edited word pairs as DIVERGED, below 1.0", () => {
  const { pairs } = pairProse([u("README.md", ORIGINAL), u("src/a.ts", DRIFTED)]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].identical, false);
  assert.ok(pairs[0].similarity >= PROSE_DEFAULTS.floor && pairs[0].similarity < 1);
});

test("pairProse — an exact copy pairs as IDENTICAL at similarity 1", () => {
  const { pairs } = pairProse([u("README.md", ORIGINAL), u("src/a.ts", ORIGINAL)]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].identical, true);
  assert.equal(pairs[0].similarity, 1);
});

test("pairProse — NEGATIVE CONTROL: a genuine paraphrase of the same idea does not pair", () => {
  const { pairs } = pairProse([u("README.md", ORIGINAL), u("src/a.ts", PARAPHRASE)]);
  assert.equal(pairs.length, 0);
});

test("pairProse — NEGATIVE CONTROL for the floor itself: one shared 6-word run in otherwise different text is suppressed, and counted", () => {
  // The paraphrase control above never reaches the floor (no shared shingle), so it
  // cannot prove the floor exists — mutation testing caught exactly that. This pair
  // SHARES a run ("is worth its cost only while", a quoted phrase) but sits far below
  // the floor: deleting the floor check makes this pair report, and this test fail.
  const quoting = "Nobody disputes an instrument is worth its cost only while its report keeps earning the attention a reader spends on it.";
  const { pairs, suppressed } = pairProse([u("README.md", ORIGINAL), u("src/a.ts", quoting)]);
  assert.equal(pairs.length, 0);
  assert.equal(suppressed.belowFloor, 1); // suppression is counted out loud, never silent
});

test("pairProse — NEGATIVE CONTROL: a sentence stamped into more than maxDf places is idiom, not a cached argument", () => {
  // 8 exact copies (a license-header shape): every shingle's df is 8 > maxDf 6, so none
  // is indexed and nothing pairs. Two copies (df 2) DO pair — tested above.
  const many = Array.from({ length: 8 }, (_, i) => u(`f${i}.md`, ORIGINAL));
  assert.equal(pairProse(many).pairs.length, 0);
});

test("pairProse — same-file repetition is excluded; short sentences are counted out, not silently dropped", () => {
  const same = pairProse([u("README.md", ORIGINAL, 1), u("README.md", DRIFTED, 40)]);
  assert.equal(same.pairs.length, 0);
  const short = pairProse([u("a.md", "Advisory only, gates nothing."), u("b.md", "Advisory only, gates nothing.")]);
  assert.equal(short.pairs.length, 0);
  assert.equal(short.suppressed.short, 2);
});

test("pairProse — DIVERGED ranks above IDENTICAL even when the identical pair is more similar", () => {
  const { pairs } = pairProse([
    u("README.md", ORIGINAL), u("src/a.ts", ORIGINAL),   // identical, similarity 1
    u("RELEASE-NOTES.md", DRIFTED), u("src/b.ts", ORIGINAL + " It also holds one extra trailing sentence of at least twelve additional words to change the set."),
  ]);
  assert.ok(pairs.length >= 2);
  const firstIdentical = pairs.findIndex((p) => p.identical);
  const lastDiverged = pairs.map((p) => p.identical).lastIndexOf(false);
  assert.ok(lastDiverged < firstIdentical, "every DIVERGED pair sorts before the first IDENTICAL one");
});

test("unitSubject — identity is file + a digest of the words: no line, no score; a moved sentence keeps its key", () => {
  const here = u("README.md", ORIGINAL, 10);
  const moved = u("README.md", ORIGINAL, 900);
  assert.equal(unitSubject(here), unitSubject(moved));
  assert.ok(!/:\d+$/.test(unitSubject(here)), "no trailing line number");
  const edited = u("README.md", DRIFTED, 10);
  assert.notEqual(unitSubject(here), unitSubject(edited)); // an edited sentence IS a different sentence
});

test("proseFindings — only DIVERGED pairs become questions, keyed by the pair subject, order-blind", () => {
  const { pairs } = pairProse([
    u("README.md", ORIGINAL), u("src/a.ts", ORIGINAL),
    u("RELEASE-NOTES.md", ORIGINAL, 5), u("src/b.ts", DRIFTED, 9),
  ]);
  const fs = proseFindings(pairs);
  assert.equal(fs.length, pairs.filter((p) => !p.identical).length);
  for (const f of fs) {
    assert.equal(f.advisory, "prose");
    assert.ok(!f.subject.includes("0."), "no similarity score in the subject");
    const flipped = pairs.find((p) => prosePairSubject(p) === f.subject)!;
    assert.equal(prosePairSubject({ ...flipped, a: flipped.b, b: flipped.a }), f.subject);
  }
});

// ── sentence extraction ───────────────────────────────────────────────────────────────

test("proseOfMarkdown — fences, tables, headings and coherence-generated blocks yield nothing; paragraphs split into sentences", () => {
  const md = [
    "# A heading that is long enough to look like a sentence if mishandled today",
    "",
    "First sentence of the paragraph runs long enough to matter. Second one also does, with more words after it.",
    "",
    "```", "code inside a fence is never prose even when it reads like a sentence to a human", "```",
    "| col | col2 |", "| --- | ---- |", "| a table row is redundancy's surface not this one's | x |",
    "<!-- coherence:commands:begin -->",
    "Generated text between coherence markers restates the registry by construction and is skipped.",
    "<!-- coherence:commands:end -->",
    "- a bullet keeps its text once its marker is stripped away from the front of it.",
  ].join("\n");
  const units = proseOfMarkdown(md, "README.md");
  const texts = units.map((x) => x.text);
  assert.equal(units.length, 3);
  assert.ok(texts[0].startsWith("First sentence"));
  assert.ok(texts[1].startsWith("Second one"));
  assert.ok(texts[2].startsWith("a bullet keeps"));
  assert.equal(units[0].line, 3); // the paragraph's own line, not the heading's
});

test("headerLines / proseOfHeader — the header essay is scanned; comments below the first code line are deliberately not", () => {
  const src = [
    "// mod.ts — a header essay that explains why this module exists at all.",
    "// It continues on a second comment line to form one paragraph of prose.",
    "// ── a box-drawing section rule is layout, never a sentence ──────────",
    'import x from "./x.ts";',
    "// This inline comment narrates local code and must never become a unit.",
  ].join("\n");
  const units = proseOfHeader(src, "src/mod.ts");
  assert.ok(units.length >= 1);
  assert.ok(units.every((x) => !x.text.includes("inline comment")));
  assert.ok(units.some((x) => x.text.includes("header essay")));
  // /* … */ headers count too
  const block = proseOfHeader("/* A block-comment header also carries the module's opening essay text. */\nlet y = 1;", "y.ts");
  assert.equal(block.length, 1);
});

test("unitsFromLines — a null line breaks the paragraph; the unit remembers where it started", () => {
  const units = unitsFromLines(["one paragraph here", null, "another paragraph on line three"], "f.md");
  assert.equal(units.length, 2);
  assert.equal(units[0].line, 1);
  assert.equal(units[1].line, 3);
});

// ── glue: the command against a real tree ────────────────────────────────────────────

const FIXTURE = {
  "README.md": `# Fixture\n\n${ORIGINAL}\n\nSomething entirely unrelated fills this second paragraph with enough words to stand on its own.\n`,
  "RELEASE-NOTES.md": `# Notes\n\n${DRIFTED}\n`,
  "src/mod.ts": `// mod.ts — module header.\n// ${ORIGINAL}\nexport const x = 1;\n`,
  "src/mod.test.ts": `// ${ORIGINAL}\nexport {};\n`, // a test file: evidence, never a reading surface
  "AGENTS.md": `${ORIGINAL}\n`,                      // generated: restates by construction
};

test("collectProse — walks markdown + module headers, skips tests and generated markdown", async () => {
  const dir = await tmpProject(FIXTURE);
  try {
    const units = await collectProse(cfg(dir));
    const files = new Set(units.map((x) => x.file));
    assert.ok(files.has("README.md") && files.has("RELEASE-NOTES.md") && files.has("src/mod.ts"));
    assert.ok(!files.has("src/mod.test.ts") && !files.has("AGENTS.md"));
  } finally { await cleanup(dir); }
});

test("prose — advisory exit 0; DIVERGED and IDENTICAL both labeled; the LOWER BOUND is printed", async () => {
  const dir = await tmpProject(FIXTURE);
  try {
    const { code, out } = await runCaptured(() => prose(cfg(dir)));
    assert.equal(code, 0);
    assert.match(out, /DIVERGED/);           // README ⇄ RELEASE-NOTES: the drifted copy
    assert.match(out, /IDENTICAL/);          // README ⇄ src/mod.ts header: agreeing today
    assert.match(out, /LOWER BOUND/);        // the floor names what it gives up
    assert.match(out, /compares TEXT, not meaning/); // honest about what it cannot see
    assert.match(out, /RAISE — /);           // the verb is advertised even with raising off
    const div = out.indexOf("DIVERGED"), idn = out.indexOf("IDENTICAL");
    assert.ok(div >= 0 && idn >= 0 && div < idn, "divergent pairs rank above identical ones");
  } finally { await cleanup(dir); }
});

test("prose --raise — opens conjectures for the DIVERGED pairs only, and the journal holds them", async () => {
  // The fixture holds THREE copies (README original, RELEASE-NOTES drifted, header
  // original): two DIVERGED pairs raise; the identical README⇄header pair must not.
  const dir = await tmpProject(FIXTURE);
  try {
    const { code, out } = await runCaptured(() => prose(cfg(dir), { raise: true, session: "s-prosetest01" }));
    assert.equal(code, 0);
    assert.match(out, /RAISE — 2 question\(s\) opened/);
    const journalDir = join(dir, ".coherence", "decisions");
    const entries = (await Promise.all(
      (await readdir(journalDir)).map((f) => readFile(join(journalDir, f), "utf8")),
    )).join("\n").trim().split("\n").map((l) => JSON.parse(l));
    const raised = entries.filter((r) => typeof r.finding === "string" && r.finding.startsWith("prose:"));
    assert.equal(raised.length, 2); // the identical pair raised nothing
    assert.ok(raised.every((r) => /RELEASE-NOTES\.md#prose:[0-9a-f]{6}/.test(r.finding)), "both questions involve the drifted copy");
  } finally { await cleanup(dir); }
});

test("renderProse / shownProse — the render's floor is the raise floor by construction; a clean tree says so", () => {
  const clean = renderProse([], { short: 0, belowFloor: 3 }, 10, {});
  assert.match(clean, /no duplicated prose above the floor/);
  const { pairs } = pairProse([u("a.md", ORIGINAL), u("b.md", DRIFTED)]);
  assert.deepEqual(shownProse(pairs, { top: 0 }), []); // what is not shown cannot raise
  assert.equal(shinglesOf(normalizeWords(ORIGINAL)).size > 0, true);
  assert.equal(SHINGLE, 6);
});
