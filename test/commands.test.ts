// commands.test.ts — THE TOTALITY ORACLE for the command registry.
//
// The command list used to be spelled in three places and enforced in none: the usage
// banner, the `cmd === "…"` dispatch chain, and README.md's `## Commands`. In two days it
// drifted three times (a merge conflict on the banner literal, banner 29 vs dispatch 30,
// README 20 vs dispatch 32). `coherence redundancy` reported the banner/dispatch pair every
// single run — "identical today, tied together by nothing" — and was right every time.
//
// Two of the three spellings are now DERIVED from src/commands.ts, so they cannot drift.
// The dispatch is still hand-written, which is what this file is for. It ENUMERATES THE
// LIVE DISPATCH — every `cmd === "<literal>"` in src/cli.ts, read out of the TypeScript
// AST, not out of a list maintained here — and asserts set equality with the registry. A
// hand-written expected list would be a FOURTH spelling of the domain and would drift like
// the other three; the point of a totality oracle is that it reads the world.
//
// The AST is used rather than a regex on purpose: a regex would also match `cmd === "x"`
// inside a comment or a string, and an oracle that can be fooled by a code comment is not
// one. Comments are not in the AST at all.
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  COMMANDS, commandNames, commandFor, dispatchTokens, usageBanner, renderCommandsBlock,
  COMMANDS_BEGIN, COMMANDS_END, renderPhrasebookBlock, PHRASEBOOK_BEGIN, PHRASEBOOK_END,
} from "../src/commands.ts";
import { CLAIM_FORMS } from "../src/phrasebook.ts";
import { spliceBlock, extractBlock } from "../src/render-claude.ts";
import { tmpProject, cleanup } from "./_helpers.ts";

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const README_PATH = fileURLToPath(new URL("../README.md", import.meta.url));
const FENCE = { begin: COMMANDS_BEGIN, end: COMMANDS_END };
const run = promisify(execFile);

/**
 * Read the LIVE dispatch out of src/cli.ts: every string literal compared against the
 * `cmd` identifier with `===`/`!==`/`==`. This is the enumeration the oracle compares
 * against — the branch set as it actually exists, whatever anyone remembered to write down.
 */
async function liveDispatch(): Promise<string[]> {
  const src = await readFile(CLI_PATH, "utf8");
  const sf = ts.createSourceFile(CLI_PATH, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Set<string>();
  const isCmd = (n: ts.Node) => ts.isIdentifier(n) && n.text === "cmd";
  const walk = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      const eq = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken
        || op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
      if (eq) {
        if (isCmd(n.left) && ts.isStringLiteral(n.right)) found.add(n.right.text);
        if (isCmd(n.right) && ts.isStringLiteral(n.left)) found.add(n.left.text);
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return [...found];
}

test("the AST scanner actually reads the dispatch (an oracle that scans nothing passes vacuously)", async () => {
  // THE INSTRUMENT CHECK, and it comes first deliberately. Every assertion below is a set
  // comparison against this scanner's output; if the scan silently returned [] — a renamed
  // local, a restructured dispatch, a ts API change — the equality tests would go GREEN on
  // two empty sets and report that the registry is perfectly in sync with nothing. That is
  // the exact silent-no-op defect this harness exists to catch, so the scanner is checked
  // before it is trusted: it must find a dispatch of plausible size, and it must find the
  // handful of branches nobody is likely to delete.
  const live = await liveDispatch();
  assert.ok(live.length >= 20, `the dispatch scan found only ${live.length} branches — the scanner is broken, not the CLI`);
  for (const anchor of ["graph", "verify", "docs", "decide"]) {
    assert.ok(live.includes(anchor), `dispatch scan missed \`${anchor}\` — the scanner is broken`);
  }
});

test("TOTALITY: the registry covers every dispatched command, and every registry entry is dispatched", async () => {
  const live = new Set(await liveDispatch());
  const declared = new Set(dispatchTokens());

  const undeclared = [...live].filter((c) => !declared.has(c)).sort();
  const undispatched = [...declared].filter((c) => !live.has(c)).sort();

  assert.deepEqual(undeclared, [], `cli.ts dispatches ${undeclared.length} command(s) the registry does not declare: ${undeclared.join(", ")}\n  → add them to COMMANDS in src/commands.ts (they are invisible in the banner and the README index)`);
  assert.deepEqual(undispatched, [], `the registry declares ${undispatched.length} command(s) cli.ts does not dispatch: ${undispatched.join(", ")}\n  → either add the branch to cli.ts or drop the entry; as it stands the banner and README advertise a verb that prints usage and exits 2`);
  assert.equal(live.size, declared.size);
});

test("aliases are representable: an alias is dispatched, but is never a command of its own", async () => {
  const live = new Set(await liveDispatch());
  const names = new Set(commandNames());
  const aliases = COMMANDS.flatMap((c) => (c.aliases ?? []).map((a) => ({ alias: a, of: c.name })));

  // The case that motivated the field: `resolve` is an alias of `resolved`.
  assert.ok(aliases.some((a) => a.alias === "resolve" && a.of === "resolved"), "resolve should be declared as an alias of resolved");

  for (const { alias, of } of aliases) {
    assert.ok(live.has(alias), `alias \`${alias}\` is declared but the dispatch does not accept it`);
    assert.ok(!names.has(alias), `\`${alias}\` is an alias of \`${of}\` and must not also be a command name`);
    // Neither derived spelling may present it as a command in its own right.
    assert.ok(!usageBanner()[0].includes(`|${alias}|`), `alias \`${alias}\` leaked into the banner's <a|b|c> list`);
    assert.ok(!renderCommandsBlock().includes(`\`coherence ${alias} `), `alias \`${alias}\` leaked into the README index as its own entry`);
    assert.ok(!renderCommandsBlock().includes(`\`coherence ${alias}\``), `alias \`${alias}\` leaked into the README index as its own entry`);
  }
});

test("commandFor — a guard keyed on a flag reads it through the ALIAS too, never through the name alone", () => {
  // THE LATENT BYPASS THIS CLOSES. The non-vacuity floor guarding the generators matched
  // `c.name === cmd` and nothing else, so a writing command that acquired a second
  // spelling would have walked straight past it. No current victim — `resolve`, the only
  // alias in the registry, writes nothing — which is exactly why it is worth closing now:
  // an alias costs one array entry and the exemption would be silent.
  //
  // Pinned at the LOOKUP rather than as a list of writing commands, because a list is a
  // claim about what somebody remembered. cli.ts now reads its flags through this
  // function, and floor.test.ts demands the refusal from every DISPATCH TOKEN carrying
  // `writesArtifacts` — so the day a generator gains an alias, both halves follow it.
  const aliases = COMMANDS.flatMap((c) => (c.aliases ?? []).map((a) => ({ alias: a, of: c })));
  assert.ok(aliases.length > 0, "no alias is declared, so this oracle would be checking nothing");
  for (const { alias, of } of aliases) {
    assert.equal(commandFor(alias), of, `\`${alias}\` must resolve to the \`${of.name}\` ENTRY — flags and all, not just a name match`);
    assert.equal(commandFor(alias)?.writesArtifacts, of.writesArtifacts);
    assert.equal(commandFor(alias)?.writesBaseline, of.writesBaseline);
  }
  for (const c of COMMANDS) assert.equal(commandFor(c.name), c, `\`${c.name}\` must still resolve by its own name`);
  // A token nobody declared, and the no-argument invocation, resolve to nothing rather
  // than to the first entry — the guard must not fire on `coherence` with no verb.
  assert.equal(commandFor("nosuchverb"), undefined);
  assert.equal(commandFor(undefined), undefined);
});

test("the banner is DERIVED — no command-name alternation literal survives in cli.ts", async () => {
  // The pin on "the string literal goes away entirely". `redundancy` scored the old banner
  // literal against the dispatch chain at 31.30 with 31 shared tokens; if anyone reinstates
  // a hand-written `a|b|c` help line, this catches it before the advisory has to.
  const src = await readFile(CLI_PATH, "utf8");
  const names = new Set(commandNames());
  for (const m of src.matchAll(/"([^"\\\n]*\|[^"\\\n]*)"/g)) {
    const tokens = m[1].split("|").map((t) => t.trim().replace(/^[<[(]+|[>\])]+$/g, ""));
    const hits = tokens.filter((t) => names.has(t));
    assert.ok(hits.length < 3, `cli.ts still spells the command list by hand: "${m[1]}" — derive it from COMMANDS instead`);
  }
  // And the derived banner really does list all of them.
  assert.equal(usageBanner()[0], `usage: coherence <${commandNames().join("|")}> [options]`);
  for (const c of COMMANDS) assert.ok(usageBanner().some((l) => l.includes(c.name)), `banner omits ${c.name}`);
});

test("the README block is an INDEX of every command, and carries each one's summary", () => {
  const block = renderCommandsBlock();
  assert.ok(block.startsWith(COMMANDS_BEGIN));
  assert.ok(block.trimEnd().endsWith(COMMANDS_END));
  for (const c of COMMANDS) {
    assert.ok(block.includes(`\`coherence ${c.name}`), `README index omits ${c.name}`);
    assert.ok(block.includes(c.summary), `README index omits ${c.name}'s summary`);
  }
  assert.ok(block.includes(`_${COMMANDS.length} commands.`), "the derived count should be in the block");
  // NOT a markdown table, and that is load-bearing: `redundancy` reads a table's first
  // column as an enumerated domain, so a generated table would hand it a fresh
  // README↔dispatch pair — the very finding this change removes.
  assert.ok(!/^\|/m.test(block), "the index must be a bullet list, not a markdown table");
});

test("the block round-trips through spliceBlock, preserving authored prose on both sides", () => {
  const host = `## Commands\n\nauthored intro\n\n${COMMANDS_BEGIN}\nstale\n${COMMANDS_END}\n\n### In detail\n\nauthored reasoning\n`;
  const spliced = spliceBlock(host, renderCommandsBlock(), FENCE);
  assert.ok(spliced !== null);
  assert.match(spliced!, /authored intro/);
  assert.match(spliced!, /authored reasoning/);
  assert.doesNotMatch(spliced!, /^stale$/m);
  // The CLAUDE.md fence must not be able to reach this block, nor vice versa.
  assert.equal(extractBlock(spliced!), null, "the command index must not be visible through CLAUDE.md's fence");
});

test("this repo's own committed README block is CURRENT (the gate that protects the harness)", async () => {
  // `docs --check` is the mechanism, but this repo declares no components, so `coherence
  // docs` is not meaningful here and nothing in CI runs it. `npm test` IS the harness's own
  // gate, so the freshness of its own generated block belongs in the suite: if the registry
  // changes and nobody re-runs `coherence docs`, this goes red.
  const readme = await readFile(README_PATH, "utf8");
  const current = extractBlock(readme, FENCE);
  assert.ok(current !== null, `README.md is missing the command-index markers ${COMMANDS_BEGIN} / ${COMMANDS_END}`);
  assert.equal(current, renderCommandsBlock(), "README.md's command index is stale — run `node src/cli.ts docs`");
});

test("`docs --check` FAILS on a stale command block, and names README.md", async () => {
  // End-to-end through the real CLI, in a throwaway project that has opted in by carrying
  // the markers. The other two artifacts are generated first and left alone, so README.md
  // enters the stale list because of the BLOCK and nothing else — the coverage claim is
  // that `docs --check` sees this block, not merely that some artifact was stale.
  const dir = await tmpProject({
    "README.md": `# fixture\n\nauthored above.\n\n${COMMANDS_BEGIN}\nstale — nothing like the real block\n${COMMANDS_END}\n\nauthored below.\n`,
    "app/app.spec.md": "# app\n\nThe fixture component.\n\n## works when\n\n- app.ts exists at this node\n",
    "app/app.ts": "export const x = 1;\n",
    "coherence.config.json": "{}\n",
  });
  try {
    // 1. regenerate everything, so graph/overview/README are all current
    await run(process.execPath, [CLI_PATH, "docs"], { cwd: dir });
    const fresh = await run(process.execPath, [CLI_PATH, "docs", "--check"], { cwd: dir });
    assert.match(fresh.stdout, /docs current/);

    // 2. corrupt ONLY the owned block
    const readme = await readFile(`${dir}/README.md`, "utf8");
    await writeFile(`${dir}/README.md`, spliceBlock(readme, `${COMMANDS_BEGIN}\nhand-edited, one release behind\n${COMMANDS_END}`, FENCE)!);

    const stale = await run(process.execPath, [CLI_PATH, "docs", "--check"], { cwd: dir })
      .then(() => ({ code: 0, stdout: "" }), (e: { code: number; stdout: string }) => e);
    assert.equal(stale.code, 1, "a stale command block must fail `docs --check`");
    assert.match(stale.stdout, /stale: README\.md/);

    // 3. `docs` puts it back, and the authored prose outside the fence survives
    await run(process.execPath, [CLI_PATH, "docs"], { cwd: dir });
    const rewritten = await readFile(`${dir}/README.md`, "utf8");
    assert.match(rewritten, /authored above\./);
    assert.match(rewritten, /authored below\./);
    assert.equal(extractBlock(rewritten, FENCE), renderCommandsBlock());
    const after = await run(process.execPath, [CLI_PATH, "docs", "--check"], { cwd: dir });
    assert.match(after.stdout, /docs current/);
  } finally {
    await cleanup(dir);
  }
});

test("`docs --check` does NOT fail a project that never opted in (absent markers ≠ stale)", async () => {
  // Every consuming project runs `docs --check`. A gate that reds on a README the project
  // never fenced is a gate that gets switched off wholesale.
  const dir = await tmpProject({
    "README.md": "# fixture\n\nNo coherence markers anywhere in this file.\n",
    "app/app.spec.md": "# app\n\nThe fixture component.\n\n## works when\n\n- app.ts exists at this node\n",
    "app/app.ts": "export const x = 1;\n",
    "coherence.config.json": "{}\n",
  });
  try {
    const w = await run(process.execPath, [CLI_PATH, "docs"], { cwd: dir });
    // Silent skips are the defect this harness hunts: say which case it took.
    assert.match(w.stdout, /no command-index markers/);
    const before = await readFile(`${dir}/README.md`, "utf8");
    const c = await run(process.execPath, [CLI_PATH, "docs", "--check"], { cwd: dir });
    assert.match(c.stdout, /docs current/);
    assert.equal(await readFile(`${dir}/README.md`, "utf8"), before, "an un-fenced README must never be touched");
  } finally {
    await cleanup(dir);
  }
});

// ── the phrasebook block — the claim-form table, derived exactly like the command index ──
//
// The hand-kept table this replaces drifted precisely as its own caveat predicted: 8 forms
// listed while CLAIM_FORMS carried 9 (`lives in` missing entirely), and a boundary grammar
// that had lost the `[crossing <zone> -> <zone>]` clause. Same defect class as the command
// index, same fix, same oracle discipline.

test("the phrasebook block is TOTAL over CLAIM_FORMS: every form's name, grammar and example, in registry order", () => {
  const block = renderPhrasebookBlock();
  assert.ok(block.startsWith(PHRASEBOOK_BEGIN));
  assert.ok(block.trimEnd().endsWith(PHRASEBOOK_END));
  let cursor = -1;
  for (const f of CLAIM_FORMS) {
    const at = block.indexOf(`- **${f.name}**`);
    assert.ok(at >= 0, `phrasebook block omits form \`${f.name}\``);
    assert.ok(at > cursor, `form \`${f.name}\` is out of registry order — the order IS the precedence, so the render must keep it`);
    cursor = at;
    assert.ok(block.includes(`\`${f.grammar}\``), `phrasebook block omits \`${f.name}\`'s grammar`);
    assert.ok(block.includes(`\`${f.example}\``), `phrasebook block omits \`${f.name}\`'s example`);
    assert.ok(block.includes(`[${f.tier}]`), `phrasebook block omits \`${f.name}\`'s tier`);
  }
  assert.ok(block.includes(`_${CLAIM_FORMS.length} claim forms`), "the derived count should be in the block");
  // The regression this derivation exists to kill: the two entries the hand-kept table lost.
  assert.ok(block.includes("- **lives in**"), "`lives in` was the form the hand-kept table dropped entirely");
  assert.ok(block.includes("[crossing <zone> -> <zone>]"), "the boundary grammar must carry the crossing clause the hand-kept table lost");
  // Same constraint as the command index, same reason: `redundancy` reads a table's first
  // column as an enumerated domain, so a generated table would hand it a fresh pair.
  assert.ok(!/^\|/m.test(block), "the phrasebook block must be a bullet list, not a markdown table");
});

test("the phrasebook block round-trips through spliceBlock, and no other fence can see it", () => {
  const host = `intro\n\n${PHRASEBOOK_BEGIN}\nstale\n${PHRASEBOOK_END}\n\nauthored notes\n`;
  const spliced = spliceBlock(host, renderPhrasebookBlock(), { begin: PHRASEBOOK_BEGIN, end: PHRASEBOOK_END });
  assert.ok(spliced !== null);
  assert.match(spliced!, /authored notes/);
  assert.doesNotMatch(spliced!, /^stale$/m);
  // Three owned blocks now exist (CLAUDE.md's, the command index, this); each fence must
  // be blind to the other two, or one command clobbers another's zone.
  assert.equal(extractBlock(spliced!), null, "the phrasebook block must not be visible through CLAUDE.md's fence");
  assert.equal(extractBlock(spliced!, FENCE), null, "the phrasebook block must not be visible through the command-index fence");
});

test("this repo's own committed README phrasebook block is CURRENT", async () => {
  // Same gate as the command index above: `npm test` is the harness's own gate, so if
  // CLAIM_FORMS changes (a new form, an edited grammar) and nobody re-runs `coherence
  // docs`, this goes red instead of the README silently teaching last release's grammar.
  const readme = await readFile(README_PATH, "utf8");
  const current = extractBlock(readme, { begin: PHRASEBOOK_BEGIN, end: PHRASEBOOK_END });
  assert.ok(current !== null, `README.md is missing the phrasebook markers ${PHRASEBOOK_BEGIN} / ${PHRASEBOOK_END}`);
  assert.equal(current, renderPhrasebookBlock(), "README.md's claim-form table is stale — run `node src/cli.ts docs`");
});

test("`docs --check` FAILS on a stale phrasebook block, and names README.md", async () => {
  const P_FENCE = { begin: PHRASEBOOK_BEGIN, end: PHRASEBOOK_END };
  const dir = await tmpProject({
    "README.md": `# fixture\n\n${PHRASEBOOK_BEGIN}\nstale — nothing like the real block\n${PHRASEBOOK_END}\n`,
    "app/app.spec.md": "# app\n\nThe fixture component.\n\n## works when\n\n- app.ts exists at this node\n",
    "app/app.ts": "export const x = 1;\n",
    "coherence.config.json": "{}\n",
  });
  try {
    await run(process.execPath, [CLI_PATH, "docs"], { cwd: dir });
    const fresh = await run(process.execPath, [CLI_PATH, "docs", "--check"], { cwd: dir });
    assert.match(fresh.stdout, /docs current/);

    const readme = await readFile(`${dir}/README.md`, "utf8");
    await writeFile(`${dir}/README.md`, spliceBlock(readme, `${PHRASEBOOK_BEGIN}\none registry entry behind\n${PHRASEBOOK_END}`, P_FENCE)!);

    const stale = await run(process.execPath, [CLI_PATH, "docs", "--check"], { cwd: dir })
      .then(() => ({ code: 0, stdout: "" }), (e: { code: number; stdout: string }) => e);
    assert.equal(stale.code, 1, "a stale phrasebook block must fail `docs --check`");
    assert.match(stale.stdout, /stale: .*README\.md \(phrasebook\)/);

    await run(process.execPath, [CLI_PATH, "docs"], { cwd: dir });
    assert.equal(extractBlock(await readFile(`${dir}/README.md`, "utf8"), P_FENCE), renderPhrasebookBlock());
  } finally {
    await cleanup(dir);
  }
});

test("every registry entry is well-formed (a blank summary would render an empty index row)", () => {
  const seen = new Set<string>();
  for (const c of COMMANDS) {
    assert.ok(/^[a-z][a-z-]*$/.test(c.name), `command name \`${c.name}\` is not a plain lowercase verb`);
    assert.ok(c.summary.trim().length > 10, `\`${c.name}\` has no usable summary`);
    assert.ok(!c.summary.includes("\n"), `\`${c.name}\`'s summary must be ONE line — both spellings render it inline`);
    assert.ok(!seen.has(c.name), `\`${c.name}\` is declared twice`);
    seen.add(c.name);
  }
  for (const a of COMMANDS.flatMap((c) => c.aliases ?? [])) {
    assert.ok(!seen.has(a), `alias \`${a}\` collides with a command name`);
  }
});

// ── writesArtifacts: the flag the floor reads, checked against OBSERVED behavior ────────

/** Every file under `outputDir`, plus the two generated files that live at the project
 *  root, content-addressed. Comparing this before and after a command is how "did it write
 *  a generated artifact" gets ANSWERED rather than assumed. */
async function artifactSnapshot(dir: string): Promise<string> {
  const parts: string[] = [];
  // README.md is in the watch set because `docs` splices its command-index and phrasebook
  // blocks into it — a fact this snapshot originally missed. An adversarial review proved
  // the blind spot by making an UNDECLARED command write README.md at the fixture root: the
  // oracle passed. No current generator writes only there, so there is no live offender —
  // but the oracle's entire justification is the FUTURE generator that forgets the flag, and
  // a root-markdown-only writer is precisely that shape.
  for (const rel of ["AGENTS.md", "CLAUDE.md", "README.md"]) {
    parts.push(rel + ":" + await readFile(join(dir, rel), "utf8").catch(() => ""));
  }
  const out = join(dir, "public");
  const names = await readdir(out).catch(() => [] as string[]);
  for (const name of names.sort()) {
    parts.push("public/" + name + ":" + await readFile(join(out, name), "utf8").catch(() => ""));
  }
  return parts.join(" ");
}

test("TOTALITY: every command that writes a generated artifact declares `writesArtifacts`", async () => {
  // WHY THIS IS BEHAVIORAL AND NOT A LIST. `writesArtifacts` exists so the non-vacuity
  // floor can stop a broken deriver from overwriting a good map with a blank one. A flag
  // that is only declared protects nothing on the day someone adds a seventh generator and
  // forgets to set it — and that omission is SILENT, because an unguarded generator behaves
  // perfectly normally right up until the deriver breaks. So this oracle RUNS every command
  // in the registry against a real fixture and observes which ones actually move an
  // artifact, the same way the dispatch oracle above reads the AST instead of a list
  // someone maintains. Each command gets its OWN fixture, so one writer's output can never
  // be credited to the command that runs after it.
  //
  // Commands are run BARE, with no flags, and that is deliberate: a command whose default
  // is read-only but which writes under `--update-baseline` (the ratchets) is correctly not
  // flagged here. The floor guards GENERATION; re-baselining is an explicit human act that
  // leaves a reviewable diff. Whether a broken deriver should also be barred from zeroing a
  // baseline is a real and separate question — left open in the journal rather than settled
  // by a flag nobody reasoned about.
  const FIXTURE = {
    "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: "app" }),
    "app/app.spec.md": "# app\n\nThe fixture component.\n\n## works when\n\n- app.ts exists at this node\n",
    "app/app.ts": "export const x = 1;\n",
  };
  const observed: string[] = [];
  await Promise.all(COMMANDS.map(async (c) => {
    const dir = await tmpProject(FIXTURE);
    try {
      const before = await artifactSnapshot(dir);
      // A nonzero exit is fine and expected for every command that needs arguments — the
      // only question asked here is whether an artifact moved. A timeout would be a failure
      // of THIS oracle rather than of the registry, so it is generous and still bounded.
      //
      // STDIN IS CLOSED IMMEDIATELY, and it has to be: `hook` is a hook HANDLER that reads
      // its payload from stdin, so against an open pipe it blocks until the timeout and
      // charges the whole oracle for it (measured: 120s of a 120s budget, versus ~1.6s for
      // every other command). Closing stdin makes it read EOF and exit like the rest.
      const p = run(process.execPath, [CLI_PATH, c.name], { cwd: dir, timeout: 60_000 });
      p.child.stdin?.end();
      await p.catch(() => {});
      if (await artifactSnapshot(dir) !== before) observed.push(c.name);
    } finally { await cleanup(dir); }
  }));

  const declared = COMMANDS.filter((c) => c.writesArtifacts).map((c) => c.name);
  const missing = observed.filter((n) => !declared.includes(n)).sort();
  assert.deepEqual(missing, [], `these commands WROTE a generated artifact but do not declare \`writesArtifacts\`, so the non-vacuity floor does not guard them: ${missing.join(", ")}`);
  // The instrument has to be able to see anything at all: an artifactSnapshot that silently
  // returned a constant would make the assertion above vacuously true — which is precisely
  // the failure mode this release exists to close, so it is checked rather than trusted.
  assert.ok(observed.length >= 3, `the oracle observed only ${observed.length} writer(s) — the instrument is broken, not the registry`);
});

// ── writesBaseline: the flag the ratchet floor reads, enforced from BOTH directions ─────
//
// The question these two oracles settle was left OPEN in the journal when `writesArtifacts`
// landed, in the comment above: "whether a broken deriver should also be barred from
// zeroing a baseline is a real and separate question". It is answered, by measurement: a
// gutted `buildGraph` made `mass --check` print "✓ mass ratchet held" over a reading that
// had collapsed to nothing, then prescribe the re-pin that banks it, and the resulting
// baseline of zeroes INVERTED once derivation was restored — the project's own untouched
// mass then read as GROWTH. So the flag exists, and it is load-bearing in both directions:
// declared → the refusal is DEMANDED of it here; observed → it must be declared.

/** A ratchet fixture with something to find in every ratchet's own unit: a guard called at
 *  two sites (a convention), a raw SQL identifier and a raw HTML value (two sinks), and
 *  files and symbols (mass). Every baseline it pins is NON-EMPTY, which is what makes the
 *  second half of the test — empty the tree, keep the baseline — a real collapse. */
const RATCHET_FIXTURE = {
  "coherence.config.json": JSON.stringify({ outputDir: "public", entryDir: "app" }),
  "app/app.spec.md": "# app\n\nThe fixture component.\n\n## works when\n\n- app.ts exists at this node\n",
  "app/app.ts":
    "export function isAllowed(x: string) { return x === \"ok\"; }\n"
    + "export const q = (t: string) => `select * from \"${t}\"`;\n"
    + "export const h = (v: string) => `<div>${v}</div>`;\n"
    + "export const a = () => isAllowed(\"a\");\n"
    + "export const b = () => isAllowed(\"b\");\n",
};

/** Every `*baseline*.json` under `outputDir`, content-addressed — the same before/after
 *  comparison `artifactSnapshot` makes, over the files a ratchet pins. */
async function baselineSnapshot(dir: string): Promise<string> {
  const out = join(dir, "public");
  const names = (await readdir(out).catch(() => [] as string[])).filter((n) => n.includes("baseline"));
  return (await Promise.all(names.sort().map(async (n) =>
    n + ":" + await readFile(join(out, n), "utf8").catch(() => "")))).join(" ");
}

test("TOTALITY: every command that pins a baseline declares `writesBaseline`", async () => {
  // OBSERVED, not listed — the `writesArtifacts` argument, one file over. `--update-baseline`
  // is passed to every command in the registry; a command that does not take the flag
  // ignores it, and only the ones that actually move a baseline file are counted.
  const observed: string[] = [];
  await Promise.all(COMMANDS.map(async (c) => {
    const dir = await tmpProject(RATCHET_FIXTURE);
    try {
      const before = await baselineSnapshot(dir);
      const p = run(process.execPath, [CLI_PATH, c.name, "--update-baseline"], { cwd: dir, timeout: 60_000 });
      p.child.stdin?.end(); // `hook` reads stdin; see the artifact oracle above
      await p.catch(() => {});
      if (await baselineSnapshot(dir) !== before) observed.push(c.name);
    } finally { await cleanup(dir); }
  }));

  const declared = COMMANDS.filter((c) => c.writesBaseline).map((c) => c.name);
  assert.deepEqual(observed.filter((n) => !declared.includes(n)).sort(), [],
    `these commands PINNED a baseline but do not declare \`writesBaseline\`, so nothing demands they refuse an empty reading: ${observed.filter((n) => !declared.includes(n)).join(", ")}`);
  // Instrument-check first: a snapshot that saw nothing would make the line above vacuously
  // true, which is the exact defect this release exists to close.
  assert.ok(observed.length >= 3, `the oracle observed only ${observed.length} baseline writer(s) — the instrument is broken, not the registry`);
});

test("TOTALITY: every `writesBaseline` command REFUSES an empty reading over a live baseline", async () => {
  // THE DIRECTION THAT MATTERS. The oracle above only proves the flag matches what the
  // commands do; this one proves the flag BUYS something. For each declared ratchet: pin a
  // baseline over a real population, then delete the population and leave the pin. Both
  // seams must refuse — `--check` must not report "held" over nothing, and
  // `--update-baseline` must not overwrite the pin with the collapse.
  //
  // Deleting the code file is the honest general collapse: it empties the graph (mass's
  // denominator) and the source scan (conventions' and lint-sinks') at once, WITHOUT the
  // test having to know which of them any given ratchet reads. A fourth ratchet added next
  // month is covered on the day it is registered, whatever it measures.
  const declared = COMMANDS.filter((c) => c.writesBaseline);
  assert.ok(declared.length >= 3, "the registry declares fewer baselined ratchets than this repo has");

  for (const c of declared) {
    const dir = await tmpProject(RATCHET_FIXTURE);
    try {
      const pin = await run(process.execPath, [CLI_PATH, c.name, "--update-baseline"], { cwd: dir, timeout: 60_000 });
      assert.match(pin.stdout, /^Pinned \d+ /m, `${c.name} --update-baseline did not pin anything against the ratchet fixture`);
      const pinned = await baselineSnapshot(dir);
      assert.ok(pinned.length > 0, `${c.name} declares writesBaseline but pinned no file this oracle can see`);

      await rm(join(dir, "app", "app.ts"));

      const checked = await run(process.execPath, [CLI_PATH, c.name, "--check"], { cwd: dir, timeout: 60_000 })
        .then(() => ({ code: 0, stdout: "", stderr: "" }), (e: { code: number; stdout: string; stderr: string }) => e);
      assert.notEqual(checked.code, 0,
        `${c.name} --check exited 0 over an EMPTY reading with a live baseline — a ratchet that "holds" when it measured nothing reports success over nothing`);
      assert.match(`${checked.stdout}${checked.stderr}`, /\[floor\]/,
        `${c.name} --check failed without naming the floor — the refusal has to say that NOTHING was examined, not merely fail`);

      const updated = await run(process.execPath, [CLI_PATH, c.name, "--update-baseline"], { cwd: dir, timeout: 60_000 })
        .then(() => ({ code: 0, stdout: "", stderr: "" }), (e: { code: number; stdout: string; stderr: string }) => e);
      assert.notEqual(updated.code, 0,
        `${c.name} --update-baseline pinned an EMPTY reading over a live baseline — that is how a broken reading becomes the new floor`);
      assert.equal(await baselineSnapshot(dir), pinned,
        `${c.name} --update-baseline MODIFIED the baseline while refusing — the refusal must not write`);
    } finally { await cleanup(dir); }
  }
});
