// claude.test.ts — the CLAUDE.md fence splicer. `coherence claude` regenerates ONLY the
// fenced block and must preserve all authored prose around it — and must REFUSE (return
// null, never clobber) a file that hasn't opted in by carrying the markers.
import test from "node:test";
import assert from "node:assert/strict";
import { spliceBlock, extractBlock, renderClaude, resolveClaudeMdPath, CLAUDE_BEGIN, CLAUDE_END } from "../src/render-claude.ts";
import { graph, comp, sym, cfg } from "./_helpers.ts";

test("spliceBlock — refuses (null) a file with no fence markers (never clobber)", () => {
  assert.equal(spliceBlock("# My CLAUDE.md\n\nall authored, no fences.\n", "BLOCK"), null);
});

test("spliceBlock — replaces only between the markers, preserving prose on both sides", () => {
  const existing = `BEFORE\n${CLAUDE_BEGIN}\nold generated\n${CLAUDE_END}\nAFTER`;
  const spliced = spliceBlock(existing, `${CLAUDE_BEGIN}\nnew generated\n${CLAUDE_END}`);
  assert.equal(spliced, `BEFORE\n${CLAUDE_BEGIN}\nnew generated\n${CLAUDE_END}\nAFTER`);
  assert.match(spliced!, /BEFORE/);
  assert.match(spliced!, /AFTER/);
  assert.doesNotMatch(spliced!, /old generated/);
});

test("spliceBlock — refuses reversed/again-malformed markers (end before begin)", () => {
  const broken = `${CLAUDE_END}\nx\n${CLAUDE_BEGIN}`;
  assert.equal(spliceBlock(broken, "BLOCK"), null);
});

test("extractBlock — returns the marker-inclusive block, or null when absent", () => {
  const existing = `head\n${CLAUDE_BEGIN}\nbody\n${CLAUDE_END}\ntail`;
  assert.equal(extractBlock(existing), `${CLAUDE_BEGIN}\nbody\n${CLAUDE_END}`);
  assert.equal(extractBlock("no markers here"), null);
});

test("resolveClaudeMdPath — defaults to CLAUDE.md sibling of the specs", () => {
  assert.equal(resolveClaudeMdPath(cfg("/project/sub")), "/project/sub/CLAUDE.md");
});

test("resolveClaudeMdPath — `../`-relative path escapes cfg.root (repo root above a sub-package)", () => {
  // The common case: coherence.config.json lives in `mnemion-js/` and the authored
  // CLAUDE.md lives at the repo root one level up. The splice target moves; coherence
  // still operates on cfg.root for spec walking and code analysis.
  assert.equal(
    resolveClaudeMdPath(cfg("/repo/mnemion-js", { claudeMdPath: "../CLAUDE.md" })),
    "/repo/CLAUDE.md",
  );
});

test("renderClaude — when ANY file has prose, emits a per-file bullet list with the prose as the role", () => {
  const g = graph([
    comp(".", { label: "Hive", intent: "the DO" }),
    // A file WITH prose and a file WITHOUT — the list should pivot to bullets,
    // with the prose-less file appearing as a bare label.
    { id: "f:hive.ts", parent: "c:.", label: "hive.ts", kind: "file", path: "hive.ts", prose: "DO kernel — the capability split" },
    { id: "f:util.ts", parent: "c:.", label: "util.ts", kind: "file", path: "util.ts" },
  ]);
  const block = renderClaude(g, "2026-06-22");
  assert.match(block, /- `hive\.ts` — DO kernel — the capability split/);
  assert.match(block, /- `util\.ts`(?!\s*—)/); // bare label, no `—`
});

test("renderClaude — when NO file has prose, emits the compact one-line file list (legibility for organizational dirs)", () => {
  const g = graph([
    comp(".", { label: "Routing" }),
    { id: "f:a.ts", parent: "c:.", label: "a.ts", kind: "file", path: "a.ts" },
    { id: "f:b.ts", parent: "c:.", label: "b.ts", kind: "file", path: "b.ts" },
  ]);
  const block = renderClaude(g, "2026-06-22");
  assert.match(block, /_files:_ `a\.ts`, `b\.ts`/);
  assert.doesNotMatch(block, /^- `a\.ts`/m);
});

test("renderClaude — emits a fenced block carrying the boundary table derived from claims", () => {
  const g = graph([
    comp(".", {
      label: "Hive",
      intent: "the durable object",
      claims: ['boundary "kernel write" at executeMutate via test "write totality"'],
    }),
    sym("executeMutate"),
  ]);
  const block = renderClaude(g, "2026-06-22");
  assert.ok(block.startsWith(CLAUDE_BEGIN));
  assert.ok(block.trimEnd().endsWith(CLAUDE_END));
  // the derived invariants table surfaces the chokepoint + oracle
  assert.match(block, /kernel write/);
  assert.match(block, /executeMutate/);
  assert.match(block, /write totality/);
  // round-trips through the splicer it is meant to feed
  const host = `intro\n${CLAUDE_BEGIN}\nstale\n${CLAUDE_END}\noutro`;
  const spliced = spliceBlock(host, block);
  assert.match(spliced!, /intro[\s\S]*kernel write[\s\S]*outro/);
});
