// regulate.test.ts — the anti-entropy regulator selects one strongest obligation.
//
// The doctrine is the domain. These tests deliberately derive rule ids, responses, and
// commands from its live registry: adding or changing a rule must change the contract,
// rather than slipping past a hand-maintained fixture list.
import test from "node:test";
import assert from "node:assert/strict";
import { commandFor } from "../src/commands.ts";
import {
  ANTI_ENTROPY_DOCTRINE,
  type DoctrineRule,
  type RegulationAction,
} from "../src/doctrine.ts";
import {
  formatRegulation,
  renderRegulationCommand,
  selectRegulation,
  type RegulationDecision,
  type RegulationObservation,
  type RegulationReading,
} from "../src/regulate.ts";

const rules = ANTI_ENTROPY_DOCTRINE.rules;

function ruleFor(response: DoctrineRule["response"]): DoctrineRule {
  const matching = rules.filter((rule) => rule.response === response);
  assert.equal(matching.length, 1,
    `v1 must have exactly one ${response} rule; changing the live doctrine requires an explicit contract change`);
  return matching[0]!;
}

function observation(
  rule: DoctrineRule,
  status: RegulationObservation["status"],
  evidence = `${rule.id}:${status}`,
  fingerprint?: string,
): RegulationObservation {
  return { rule: rule.id, status, evidence, ...(fingerprint ? { fingerprint } : {}) };
}

function reading(
  observations: RegulationObservation[],
  limitations: string[] = [],
): RegulationReading {
  return {
    doctrine: ANTI_ENTROPY_DOCTRINE.id,
    scope: "shared-worktree",
    observations,
    limitations,
  };
}

function withStatuses(
  statuses: ReadonlyMap<string, RegulationObservation["status"]>,
): RegulationObservation[] {
  return rules.map((rule) => observation(rule, statuses.get(rule.id) ?? "satisfied",
    `${rule.id}:${statuses.get(rule.id) ?? "satisfied"}`,
    rule.response === "require-decision" ? "patch-a1" : undefined));
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length < 2) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i]!, ...tail]);
  }
  return out;
}

function commandCount(decision: RegulationDecision): number {
  return decision.selected?.command ? 1 : 0;
}

test("regulate — ordered potential is permutation-invariant and monotone", () => {
  assert.deepEqual([...ANTI_ENTROPY_DOCTRINE.potential],
    ["refuse", "require-decision", "redirect", "release"],
    "the potential is strongest-first API; reversing it makes a weaker obligation mask a stronger one");
  assert.equal(Object.isFrozen(ANTI_ENTROPY_DOCTRINE.potential), true,
    "the versioned potential must be runtime-immutable, not only readonly to TypeScript");
  assert.ok(rules.length > 0, "an empty doctrine would release every reading vacuously");
  assert.equal(new Set(rules.map((rule) => rule.id)).size, rules.length, "rule ids are addresses and must be unique");

  const redirectRule = ruleFor("redirect");
  const decisionRule = ruleFor("require-decision");
  const rank = new Map<RegulationAction, number>(
    ANTI_ENTROPY_DOCTRINE.potential.map((action, index) => [action, index]),
  );

  // Exercise every live rule, not merely the two ids known when this test was authored.
  for (const rule of rules) {
    const observations = rules.map((candidate) => observation(
      candidate,
      candidate.id === rule.id ? "violated" : "satisfied",
      `${candidate.id}:${candidate.id === rule.id ? "violated" : "satisfied"}`,
      candidate.id === rule.id ? "patch-live-rule" : undefined,
    ));
    const selected = selectRegulation(reading(observations));
    assert.equal(selected.action, rule.response, `${rule.id} must contribute its declared response`);
    assert.equal(selected.selected?.rule, rule.id);
    assert.equal(commandCount(selected), rule.command ? 1 : 0,
      `${rule.id} must expose a command exactly when the live doctrine declares one`);
  }

  const released = selectRegulation(reading(withStatuses(new Map())));
  const redirected = selectRegulation(reading(withStatuses(new Map([[redirectRule.id, "violated"]]))));
  const decision = selectRegulation(reading(withStatuses(new Map([[decisionRule.id, "violated"]]))));
  const both = selectRegulation(reading(withStatuses(new Map([
    [redirectRule.id, "violated"],
    [decisionRule.id, "violated"],
  ]))));

  assert.equal(released.action, "release");
  assert.deepEqual(released.potential, { unavailable: 0, requireDecision: 0, redirect: 0 });
  assert.equal(redirected.action, "redirect");
  assert.deepEqual(redirected.potential, { unavailable: 0, requireDecision: 0, redirect: 1 });
  assert.equal(decision.action, "require-decision");
  assert.deepEqual(decision.potential, { unavailable: 0, requireDecision: 1, redirect: 0 });
  assert.equal(both.action, "require-decision", "a redirect cannot mask a required decision");
  assert.deepEqual(both.potential, { unavailable: 0, requireDecision: 1, redirect: 1 });
  assert.equal(both.remaining, 1, "the lower obligation is counted, not emitted as a second action");

  const ordered = [released, redirected, decision];
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(rank.get(ordered[i]!.action)! < rank.get(ordered[i - 1]!.action)!,
      "adding the next stronger obligation must move monotonically upward in the live potential");
  }

  // Missing and unavailable observations fail above every assessable obligation. Iterate
  // the live domain so a future required rule cannot become green-by-absence.
  for (const absent of rules) {
    const lower = rules.filter((rule) => rule.id !== absent.id)
      .map((rule) => observation(rule, "violated", `${rule.id}:still-owed`, "patch-missing"));
    const missing = selectRegulation(reading(lower));
    assert.equal(missing.action, "refuse", `missing ${absent.id} must fail closed`);
    assert.ok(missing.potential.unavailable >= 1);

    const unavailable = selectRegulation(reading(rules.map((rule) => observation(
      rule,
      rule.id === absent.id ? "unavailable" : "violated",
      `${rule.id}:${rule.id === absent.id ? "sensor unavailable" : "still owed"}`,
      "patch-unavailable",
    ))));
    assert.equal(unavailable.action, "refuse", `unavailable ${absent.id} must outrank lower obligations`);
    assert.ok(unavailable.potential.unavailable >= 1);
  }

  const canonicalObservations = withStatuses(new Map([
    [redirectRule.id, "violated"],
    [decisionRule.id, "violated"],
  ]));
  const canonical = selectRegulation(reading(canonicalObservations, ["z-limit", "a-limit"]));

  for (const permuted of permutations(canonicalObservations)) {
    assert.deepEqual(selectRegulation(reading(permuted, ["a-limit", "z-limit"])), canonical,
      "observation and limitation order cannot choose the action or move its stable id");
  }

  const duplicated = canonicalObservations.flatMap((item) => [item, { ...item }]);
  for (const permuted of permutations(duplicated)) {
    assert.deepEqual(selectRegulation(reading(permuted, ["z-limit", "a-limit", "z-limit"])), canonical,
      "exact duplicate observations collapse before potential and identity are computed");
  }

  const conflict = selectRegulation(reading([
    observation(redirectRule, "violated", "first lifecycle reading"),
    observation(redirectRule, "satisfied", "second lifecycle reading"),
    observation(decisionRule, "violated", "growth still needs a decision", "patch-conflict"),
  ]));
  assert.equal(conflict.action, "refuse", "conflicting duplicates are unknown, never a vote");
  assert.equal(conflict.potential.unavailable, 1);
  assert.equal(conflict.potential.requireDecision, 1);
  assert.equal(conflict.remaining, 1);
  assert.equal(commandCount(conflict), 0, "a refusal must not leak the withheld lower-priority command");

  const exactConflictDuplicate = selectRegulation(reading([
    observation(redirectRule, "violated", "first lifecycle reading"),
    observation(redirectRule, "violated", "first lifecycle reading"),
    observation(redirectRule, "satisfied", "second lifecycle reading"),
    observation(decisionRule, "violated", "growth still needs a decision", "patch-conflict"),
  ]));
  assert.deepEqual(exactConflictDuplicate, conflict,
    "duplicating one side of a conflict cannot outvote the other side or move decision identity");

  const unknown = selectRegulation(reading([
    ...withStatuses(new Map()),
    { rule: "foreign-rule", status: "violated", evidence: "not in the live doctrine" },
  ]));
  assert.equal(unknown.action, "refuse");
  assert.equal(commandCount(unknown), 0);

  const invalidScope = selectRegulation({
    ...reading(withStatuses(new Map())),
    scope: "per-agent" as "shared-worktree",
  });
  assert.equal(invalidScope.action, "refuse", "a foreign runtime scope cannot release");
  assert.equal(invalidScope.scope, "shared-worktree", "the decision never repeats an unsupported scope");

  const invalidStatus = selectRegulation(reading([
    ...withStatuses(new Map()).slice(1),
    { ...observation(rules[0]!, "satisfied"), status: "satified" as "satisfied" },
  ]));
  assert.equal(invalidStatus.action, "refuse", "a mistyped runtime status fails closed");

  const changedPatch = selectRegulation(reading(withStatuses(new Map([[decisionRule.id, "violated"]]))
    .map((item) => item.rule === decisionRule.id ? { ...item, fingerprint: "patch-b2" } : item)));
  assert.notEqual(changedPatch.id, decision.id, "a materially different patch must move decision identity");

  for (const result of [released, redirected, decision, both, conflict, unknown]) {
    assert.ok(commandCount(result) <= 1, `${result.action} emitted more than one selected command`);
  }
});

test("regulate — formatter emits one action and live commands never redirect to the regulator", () => {
  for (const rule of rules) {
    if (!rule.command) continue;
    const live = commandFor(rule.command.name);
    assert.ok(live, `${rule.id} names unknown command ${rule.command.name}`);
    assert.notEqual(live!.name, "regulate", `${rule.id} creates a regulation self-loop`);
  }

  const redirectRule = ruleFor("redirect");
  const decisionRule = ruleFor("require-decision");
  const decisions = [
    selectRegulation(reading(withStatuses(new Map()))),
    selectRegulation(reading(withStatuses(new Map([[redirectRule.id, "violated"]])))),
    selectRegulation(reading(withStatuses(new Map([[decisionRule.id, "violated"]])))),
    selectRegulation(reading(rules.slice(1).map((rule) => observation(rule, "violated", "lower obligation")))),
  ];

  assert.equal(renderRegulationCommand(redirectRule.command!, ["npx", "coherence"]),
    "npx coherence hooks install", "a multiword launcher is an argv prefix, not one quoted executable");
  assert.equal(renderRegulationCommand({ name: "hooks", args: ["an arg's value"] }, ["runner with space"]),
    `'runner with space' hooks 'an arg'\"'\"'s value'`, "every emitted shell word is independently quoted");

  for (const decision of decisions) {
    const lines = formatRegulation(decision);
    assert.equal(lines.filter((line) => /^REGULATION (?:refuse|require-decision|redirect|release)\b/.test(line)).length, 1,
      `${decision.action} must render one action header`);
    assert.ok(lines.filter((line) => /^  next: /.test(line)).length <= 1,
      `${decision.action} must render at most one executable next step`);

    const encoded = formatRegulation(decision, { json: true });
    assert.equal(encoded.length, 1, "JSON mode is one document, not a stream of competing actions");
    assert.deepEqual(JSON.parse(encoded[0]!), decision);
  }

  const withheld = selectRegulation(reading(withStatuses(new Map([
    [redirectRule.id, "violated"],
    [decisionRule.id, "violated"],
  ]))));
  const text = formatRegulation(withheld, { cli: ["npx", "coherence"] });
  assert.ok(text.filter((line) => /^  next: /.test(line)).length <= 1);
  assert.match(text.join("\n"), /1 lower-priority obligation\(s\) withheld/);
  assert.doesNotMatch(text.join("\n"), /hooks install/,
    "the withheld redirect may be counted but must not leak as a second command");
});
