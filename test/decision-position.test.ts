import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDecisionPositions } from "../src/decision-position.ts";
import type { DecisionAuthority, DecisionRecord } from "../src/decisions.ts";

function decision(id: string, subject: string | undefined, chose: string, authority?: DecisionAuthority): DecisionRecord {
  return {
    ...(subject ? { version: 2 as const, subject, ...(authority ? { authority } : {}) } : {}),
    id, session: "session", at: `2026-01-01T00:00:0${id.at(-1) ?? "0"}.000Z`, kind: "decision",
    agent: "agent", job: "job", branch: "main", commit: "a".repeat(40), dirty: false,
    chose, over: [], because: "evidence",
  };
}

test("decision positions compare only explicit shared subjects", () => {
  const positions = analyzeDecisionPositions([
    decision("d-00000001", undefined, "one"), decision("d-00000002", undefined, "two"),
    decision("d-00000003", "storage", "sqlite"), decision("d-00000004", "storage", "sqlite"),
  ]);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].state, "aligned");
});

test("local alternatives need ratification; an explicit stronger choice settles them", () => {
  const proposals = [
    decision("d-00000001", "queue", "redis", "local-proposal"),
    decision("d-00000002", "queue", "postgres", "local-proposal"),
  ];
  assert.equal(analyzeDecisionPositions(proposals)[0].state, "needs-ratification");
  const ratified = analyzeDecisionPositions([
    ...proposals, decision("d-00000003", "queue", "postgres", "orchestrator-accepted"),
  ])[0];
  assert.equal(ratified.state, "ratified");
  assert.equal(ratified.selected?.chose, "postgres");
});

test("incompatible choices at the highest authority remain contested", () => {
  const position = analyzeDecisionPositions([
    decision("d-00000001", "release", "ship", "user-directed"),
    decision("d-00000002", "release", "hold", "user-directed"),
  ])[0];
  assert.equal(position.state, "contested");
  assert.equal(position.selected, null);
});
