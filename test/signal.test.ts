// signal.test.ts — per-change pressure: surface must gain an anchor or a patch-bound reason.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  anchorsAddedByChange, attestationFinding, findAttestation, signalState, formatSignal, signal, type ChangeSignal,
} from "../src/signal.ts";
import { loadConfig } from "../src/config.ts";
import type { DecisionRecord } from "../src/decisions.ts";
import type { NoveltyVerdict } from "../src/novelty.ts";
import { tmpProject, cleanup, runCaptured, graph, comp } from "./_helpers.ts";

const verdict = (level: NoveltyVerdict["level"]): NoveltyVerdict => ({ level, surface: 12, proviso: false });
const rec = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: "d-1", session: "s-1", at: "2026-01-01T00:00:00Z", kind: "decision",
  agent: "a", job: "j", branch: "main", commit: "abc", dirty: true,
  chose: "no new invariant", over: [], because: "existing boundary covers it",
  ...over,
});

test("only a zero-anchor alarm without attestation needs a decision", () => {
  assert.equal(signalState(verdict("quiet"), 0, false), "quiet");
  assert.equal(signalState(verdict("outpacing"), 1, false), "anchored");
  assert.equal(signalState(verdict("alarm"), 1, false), "anchored");
  assert.equal(signalState(verdict("alarm"), 0, true), "attested");
  assert.equal(signalState(verdict("alarm"), 0, false), "needs-decision");
});

test("anchors inside a brand-new component count even when the ledger summarizes it", () => {
  const structural: ChangeSignal["structural"] = {
    componentsAdded: ["Core"], componentsRemoved: [], invAdded: [], invRemoved: [],
    boundaryAdded: [], boundaryRemoved: [], boundaryRewired: [], parityAdded: [],
    parityRemoved: [], parityRewired: [], claimDelta: [],
  };
  const after = graph([comp("src", {
    label: "Core", invariants: ["writes are scoped"],
    claims: ['boundary "writes are scoped" at recordHookReads'],
  })]);
  assert.equal(anchorsAddedByChange(structural, after), 2);
});

test("attestation is structured, patch-specific, and retraction-aware", () => {
  const finding = attestationFinding("abc123");
  const decision = rec({ id: "d-waive", finding });
  assert.equal(findAttestation([decision], "abc123")?.id, "d-waive");
  assert.equal(findAttestation([decision], "different"), undefined, "a changed patch cannot inherit the waiver");
  const retract = rec({ id: "d-retract", kind: "retraction", supersedes: "d-waive", finding: undefined });
  assert.equal(findAttestation([decision, retract], "abc123"), undefined, "a withdrawn reason is not authority");
});

test("arbitrary prose cannot impersonate an attestation", () => {
  const prose = rec({ chose: "no new invariant for patch abc123", finding: undefined });
  assert.equal(findAttestation([prose], "abc123"), undefined);
});

test("the failure renders the exact two ways to settle it", () => {
  const s: ChangeSignal = {
    ref: "HEAD", changed: ["src/x.ts"], fingerprint: "abc123", novelty: verdict("alarm"),
    signals: {
      newExports: ["x"], removedExports: 0, newVariants: 0, newDomains: [],
      locAdded: 500, locDeleted: 0, anchorsAdded: 0, componentsAdded: 0,
    },
    structural: {
      componentsAdded: [], componentsRemoved: [], invAdded: [], invRemoved: [],
      boundaryAdded: [], boundaryRemoved: [], boundaryRewired: [], parityAdded: [],
      parityRemoved: [], parityRewired: [], claimDelta: [],
    },
  };
  const out = formatSignal(s).join("\n");
  assert.match(out, /Add an invariant\/boundary\/parity claim/);
  assert.match(out, /--attest-no-invariant/);
  assert.match(out, /patch abc123/);
});

test("signal attestation binds to the code patch, not to its own journal line", async () => {
  const root = await tmpProject({
    "coherence.config.json": JSON.stringify({ codeExt: ["ts"], language: "typescript", platform: null,
      novelty: { minSurface: 1, minLoc: 1, ratio: 12 } }),
    "README.md": "fixture\n",
  });
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    git("add", ".");
    assert.equal(git("commit", "-q", "-m", "base").status, 0);
    await writeFile(join(root, "feature.ts"), "export const feature = 1;\n");
    const c = await loadConfig(root);

    assert.equal((await runCaptured(() => signal(c, undefined, { check: true }))).code, 1);
    assert.equal((await runCaptured(() => signal(c, undefined, {
      attestBecause: "the existing public contract already names this value", session: "agent-test",
    }))).code, 0);
    assert.equal((await runCaptured(() => signal(c, undefined, { check: true }))).code, 0,
      "writing the attestation must not invalidate its own fingerprint");

    await writeFile(join(root, "feature.ts"), "export const feature = 2;\nexport const another = 1;\n");
    assert.equal((await runCaptured(() => signal(c, undefined, { check: true }))).code, 1,
      "changing the assessed patch invalidates yesterday's reason");
  } finally { await cleanup(root); }
});
