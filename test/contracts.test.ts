// contracts.test.ts — producer/consumer contracts across deploy artifacts, and the
// cross-artifact detector. The WHY of the whole mechanism: a typed message produced in
// one compile/deploy unit and consumed in another is invisible to either unit's
// compiler — only the whole-source graph sees both sides — so a declared contract must
// be anchored (a boundary/parity claim on its producer, consumer, or type), and shared
// vocabulary files with importers in disjoint units are flagged until covered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contracts } from "../src/contracts.ts";
import { runCaptured, cfg, comp, sym, graph, fileNode, imp } from "./_helpers.ts";
import type { Config } from "../src/types.ts";

const ARTIFACTS: Config["artifacts"] = {
  worker: ["worker.ts", "entities/**", "shared/**"],
  browser: ["web/**", "shared/**"],
};

// A little world: the Worker's patient.ts produces frames, the browser's sse.ts consumes
// them, shared/types.ts holds the vocabulary — and both sides import it.
const WORLD = [
  comp(".", { label: "App", claims: [], why: "r" }),
  fileNode("entities/patient.ts", "."), fileNode("web/sse.ts", "."), fileNode("shared/types.ts", "."),
  sym("emitFrame", "entities/patient.ts"), sym("readSse", "web/sse.ts"), sym("SseFrames", "shared/types.ts"),
];
const EDGES = [imp("entities/patient.ts", "shared/types.ts"), imp("web/sse.ts", "shared/types.ts")];

const SSE = { producer: "emitFrame", consumer: "readSse", type: "SseFrames" };

const run = (g: ReturnType<typeof graph>, over: Partial<Config>, mode: "render" | "check" = "check") =>
  runCaptured(() => contracts(cfg("/nowhere", { artifacts: ARTIFACTS, ...over }), g, mode));

test("contracts — an anchored cross-artifact contract passes --check and reads CROSS-ARTIFACT", async () => {
  const g = graph([
    ...WORLD.slice(1),
    comp(".", { label: "App", claims: ['parity "frame faithfulness" over SseFrames between emitFrame and readSse via test "t"'], why: "r" }),
  ], EDGES);
  const r = await run(g, { contracts: { "sse-frames": SSE } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\[CROSS-ARTIFACT\]/);
  assert.match(r.out, /anchored by parity "frame faithfulness"/);
});

test("contracts — a boundary claim at the producer chokepoint also anchors", async () => {
  const g = graph([
    ...WORLD.slice(1),
    comp(".", { label: "App", claims: ['boundary "typed egress" at emitFrame via guard "g"'], why: "r" }),
  ], EDGES);
  const r = await run(g, { contracts: { "sse-frames": SSE } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /anchored by boundary "typed egress" at emitFrame/);
});

test("contracts — an UNANCHORED declared contract fails --check (the must-declare pressure)", async () => {
  const g = graph(WORLD, EDGES);
  const r = await run(g, { contracts: { "sse-frames": SSE } });
  assert.equal(r.code, 1);
  assert.match(r.out, /UNANCHORED — 1 declared contract/);
});

test("contracts — a DANGLING symbol (renamed away) fails --check", async () => {
  const g = graph(WORLD, EDGES);
  const r = await run(g, { contracts: { "sse-frames": { ...SSE, producer: "goneSymbol" } } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DANGLING — not in the code graph: goneSymbol/);
});

test("detector — a shared file imported from disjoint artifacts with NO covering claim is flagged", async () => {
  const g = graph(WORLD, EDGES); // no contracts declared, no claims
  const r = await run(g, {}, "render");
  assert.equal(r.code, 0); // advisory — render never fails
  assert.match(r.out, /ADVISORY — 1 cross-artifact shared file/);
  assert.match(r.out, /shared\/types\.ts.*\[browser \| worker\]/);
});

test("detector — a declared contract whose type lives in the shared file covers it", async () => {
  const g = graph([
    ...WORLD.slice(1),
    comp(".", { label: "App", claims: ['parity "frame faithfulness" over SseFrames between emitFrame and readSse via test "t"'], why: "r" }),
  ], EDGES);
  const r = await run(g, { contracts: { "sse-frames": SSE } }, "render");
  assert.match(r.out, /✓ every cross-artifact shared file is covered/);
});

test("detector — a file imported only WITHIN one artifact is not cross-artifact surface", async () => {
  const g = graph([
    ...WORLD.slice(1).filter((n) => n.id !== "f:web/sse.ts" && n.label !== "readSse"),
    comp(".", { label: "App", claims: [], why: "r" }),
    fileNode("entities/other.ts", "."),
  ], [imp("entities/patient.ts", "shared/types.ts"), imp("entities/other.ts", "shared/types.ts")]);
  const r = await run(g, {}, "render");
  assert.doesNotMatch(r.out, /ADVISORY/);
});

test("detector — a shared file in BOTH artifacts' globs still flags when its importers are disjoint", async () => {
  // shared/** matches both worker and browser globs — the file's OWN artifact set
  // overlaps both; what makes it a contract surface is its IMPORTERS being disjoint.
  const g = graph(WORLD, EDGES);
  const r = await run(g, {}, "render");
  assert.match(r.out, /shared\/types\.ts/);
});

test("contracts — no config at all is a clean no-op", async () => {
  const r = await runCaptured(() => contracts(cfg("/nowhere"), graph(WORLD, EDGES), "check"));
  assert.equal(r.code, 0);
  assert.match(r.out, /no `contracts` \/ `artifacts` config/);
});
