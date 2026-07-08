// dictionary.test.ts — the `conforms to <Word>` claim macro. A word is a CONTRACT grown
// from the project's own code: an intent + a commitment list, one `<Word>.md` per word.
// `conforms to <Word>` expands the commitments against the DECLARING component (same node
// dir, same anchoring) and aggregates. The load-bearing properties, each pinned below:
//   - pass/fail aggregation (all green → pass; any red → fail naming the first failure)
//   - a missing/unparseable word file is RED (the verb was recognized — not a dialect gap)
//   - a commitment matching no claim form is RED (inside a word, a typo is not a silent skip)
//   - `conforms to` cycles are detected and go RED
//   - a `boundary` commitment ANCHORS its invariant on the declaring component (coverage)
//   - PROPAGATION: editing a word flips every conforming component on the next verify
//   - a project with no dictionary is unaffected (overview render unchanged)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runVerify } from "../src/verify.ts";
import { loadDictionary } from "../src/phrasebook.ts";
import { renderOverview } from "../src/render-overview.ts";
import { tmpProject, cleanup, runCaptured, cfg, comp, sym, graph } from "./_helpers.ts";

const withProject = async (files: Record<string, string>, fn: (root: string) => Promise<void>) => {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
};

const word = (name: string, intent: string, commitments: string[]) =>
  [`# ${name}`, intent, "", "## commitments", ...commitments.map((c) => `- ${c}`)].join("\n");

test("conforms to — all commitments green → pass", async () => {
  await withProject(
    { "dictionary/Tidy.md": word("Tidy", "Everything typechecks and its files exist.", ["typechecks", "present.txt exists at root"]), "present.txt": "" },
    async (root) => {
      const g = graph([comp(".", { claims: ["conforms to Tidy"], why: "r" })]);
      const r = await runCaptured(() => runVerify(cfg(root, { typecheck: ["true"] }), g, { fast: true }));
      assert.equal(r.code, 0);
      assert.match(r.out, /1 green/); // the single `conforms to` claim resolves green
      assert.match(r.out, /✓ coherent/);
    },
  );
});

test("conforms to — a failing commitment fails the claim, naming the word + commitment", async () => {
  await withProject(
    { "dictionary/Tidy.md": word("Tidy", "…", ["typechecks", "missing.txt exists at root"]) },
    async (root) => {
      const g = graph([comp(".", { claims: ["conforms to Tidy"], why: "r" })]);
      const r = await runCaptured(() => runVerify(cfg(root, { typecheck: ["true"] }), g, { fast: true }));
      assert.equal(r.code, 1);
      assert.match(r.out, /word "Tidy": commitment "missing\.txt exists at root" failed/);
    },
  );
});

test("conforms to — a MISSING word file is RED (recognized verb, broken reference — not a dialect gap)", async () => {
  await withProject({}, async (root) => {
    const g = graph([comp(".", { claims: ["conforms to Ghost"], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /word "Ghost" not found/);
  });
});

test("conforms to — an unparseable word file (no `## commitments`) is RED", async () => {
  await withProject({ "dictionary/Half.md": "# Half\njust an intent, no commitments section" }, async (root) => {
    const g = graph([comp(".", { claims: ["conforms to Half"], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /word "Half".*unparseable/);
  });
});

test("conforms to — a commitment matching NO claim form is RED (a word forbids the silent skip)", async () => {
  await withProject({ "dictionary/Typo.md": word("Typo", "…", ["typechecks", "this is not a claim verb"]) }, async (root) => {
    const g = graph([comp(".", { claims: ["conforms to Typo"], why: "r" })]);
    const r = await runCaptured(() => runVerify(cfg(root, { typecheck: ["true"] }), g, { fast: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /matches no claim form/);
  });
});

test("conforms to — a cycle (A→B→A) is detected and RED", async () => {
  await withProject(
    { "dictionary/A.md": word("A", "…", ["conforms to B"]), "dictionary/B.md": word("B", "…", ["conforms to A"]) },
    async (root) => {
      const g = graph([comp(".", { claims: ["conforms to A"], why: "r" })]);
      const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
      assert.equal(r.code, 1);
      assert.match(r.out, /conforms-to cycle/);
    },
  );
});

test("conforms to — a `boundary` commitment ANCHORS its invariant on the declaring component (coverage passes)", async () => {
  await withProject(
    { "dictionary/Scoped.md": word("Scoped", "Reads stay in scope.", ['boundary "scoped reads" at Choke via guard "g"']) },
    async (root) => {
      // The component DECLARES the invariant but anchors it only THROUGH the word — coverage
      // must still see it anchored (the boundary form runs with the declaring component's ctx).
      const g = graph([
        comp(".", { claims: ["conforms to Scoped"], invariants: ["scoped reads"], why: "r" }),
        sym("Choke"),
      ]);
      const r = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
      assert.equal(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /not anchored/);
    },
  );
});

test("conforms to — the SAME invariant, unanchored because the word omits its boundary, FAILS coverage", async () => {
  await withProject(
    { "dictionary/Empty.md": word("Empty", "no boundary here", ["typechecks"]) },
    async (root) => {
      const g = graph([comp(".", { claims: ["conforms to Empty"], invariants: ["scoped reads"], why: "r" })]);
      const r = await runCaptured(() => runVerify(cfg(root, { typecheck: ["true"] }), g, { fast: true }));
      assert.equal(r.code, 1);
      assert.match(r.out, /invariant "scoped reads".*not anchored/);
    },
  );
});

test("conforms to — PROPAGATION: editing a word flips every conforming component on the next verify", async () => {
  await withProject({ "good.txt": "" }, async (root) => {
    const wordFile = join(root, "dictionary", "Shared.md");
    await mkdir(join(root, "dictionary"), { recursive: true });
    // Two components conform to the one word. The graph is FIXED across both runs — only the
    // word file on disk changes, proving the word is re-read (a dictionary edit propagates).
    const g = graph([
      comp("a", { label: "a", claims: ["conforms to Shared"], why: "r" }),
      comp("b", { label: "b", claims: ["conforms to Shared"], why: "r" }),
    ]);

    await writeFile(wordFile, word("Shared", "the file exists", ["good.txt exists at root"]));
    const green = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(green.code, 0, green.out);

    // Edit the word's single commitment to something false. BOTH conformers must now be red.
    await writeFile(wordFile, word("Shared", "the file exists", ["nope.txt exists at root"]));
    const red = await runCaptured(() => runVerify(cfg(root), g, { fast: true }));
    assert.equal(red.code, 1);
    assert.match(red.out, /\[a\] conforms to Shared/);
    assert.match(red.out, /\[b\] conforms to Shared/);
  });
});

test("overview — a dictionary renders a Dictionary section listing each word + its conformers", async () => {
  await withProject({ "dictionary/OwnedScope.md": word("OwnedScope", "Stays in the owner's scope.", ["typechecks"]) }, async (root) => {
    const g = graph([comp(".", { label: "hive", claims: ["conforms to OwnedScope"], why: "r" })]);
    const words = await loadDictionary(cfg(root), g);
    assert.deepEqual(words, [{ word: "OwnedScope", intent: "Stays in the owner's scope.", conformers: ["hive"] }]);
    const { md } = renderOverview(g, "stamp", words);
    assert.match(md, /## Dictionary/);
    assert.match(md, /### OwnedScope/);
    assert.match(md, /_conforms:_ `hive`/);
  });
});

test("overview — a project with NO dictionary is unaffected (no Dictionary section, byte-identical)", async () => {
  await withProject({}, async (root) => {
    const g = graph([comp(".", { label: "hive", claims: ["typechecks"], why: "r" })]);
    const words = await loadDictionary(cfg(root), g);
    assert.deepEqual(words, []);
    const withArg = renderOverview(g, "stamp", words);
    const without = renderOverview(g, "stamp");
    assert.equal(withArg.md, without.md);
    assert.equal(withArg.html, without.html);
    assert.doesNotMatch(withArg.md, /Dictionary/);
  });
});
