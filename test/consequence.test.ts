import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ConsequenceLedgerError, consequenceSessionPath, parseConsequenceRef,
  readConsequences, recordConsequence, relationProblem, renderConsequences,
  traceConsequences,
} from "../src/consequence.ts";
import { cfg, cleanup, tmpProject } from "./_helpers.ts";

test("explicit consequence edges make the record lifecycle navigable in both directions", async () => {
  const root = await tmpProject();
  const config = cfg(root);
  try {
    recordConsequence(config, {
      session: "orchestrator", agent: "main",
      from: parseConsequenceRef("decision:d-abcd1234"), relation: "authorizes",
      to: parseConsequenceRef("work:wrk-plan"), evidence: "the accepted decision names this work order",
      now: "2026-01-01T00:00:00.000Z",
    });
    recordConsequence(config, {
      session: "worker", agent: "child",
      from: parseConsequenceRef("work:wrk-plan"), relation: "produces",
      to: parseConsequenceRef(`commit:${"a".repeat(40)}`), evidence: "the close names this exact commit",
      now: "2026-01-01T00:01:00.000Z",
    });
    recordConsequence(config, {
      session: "reviewer", agent: "review",
      from: parseConsequenceRef("verification:verify-20260101"), relation: "reveals",
      to: parseConsequenceRef("defect:def-123456789abc"), evidence: "the named verification reproduced it",
      now: "2026-01-01T00:02:00.000Z",
    });
    recordConsequence(config, {
      session: "repairer", agent: "fix",
      from: parseConsequenceRef("work:wrk-repair"), relation: "repairs",
      to: parseConsequenceRef("defect:def-123456789abc"), evidence: "the regression oracle passes with this work",
      now: "2026-01-01T00:03:00.000Z",
    });
    assert.equal(readConsequences(config).records.length, 4);

    const around = traceConsequences(readConsequences(config), parseConsequenceRef("work:wrk-plan"));
    assert.equal(around.records.length, 2, "incoming and outgoing edges are both navigable");
    assert.deepEqual(around.refs.map((item) => `${item.kind}:${item.id}`), [
      `commit:${"a".repeat(40)}`, "decision:d-abcd1234", "work:wrk-plan",
    ]);
    const defect = renderConsequences(config, parseConsequenceRef("defect:def-123456789abc"));
    assert.match(defect.text, /verification:verify-20260101 --reveals--> defect:def-/);
    assert.match(defect.text, /work:wrk-repair --repairs--> defect:def-/);
    assert.match(defect.text, /explicitly assessed/);
  } finally { await cleanup(root); }
});

test("semantic retries dedupe while specialized relation nonsense refuses", async () => {
  const root = await tmpProject();
  const config = cfg(root);
  try {
    const input = {
      session: "one", agent: "main",
      from: parseConsequenceRef("decision:d-abcd1234"), relation: "authorizes" as const,
      to: parseConsequenceRef("work:wrk-one"), evidence: "the decision explicitly grants this work",
      now: "2026-01-01T00:00:00.000Z",
    };
    const first = recordConsequence(config, input);
    const retry = recordConsequence(config, { ...input, now: "2026-01-02T00:00:00.000Z" });
    assert.equal(retry.id, first.id);
    assert.equal((await readFile(consequenceSessionPath(config, "one"), "utf8")).trim().split("\n").length, 1);
    assert.match(relationProblem(
      parseConsequenceRef("defect:def-123456789abc"), "authorizes", parseConsequenceRef("commit:abc"),
    ) ?? "", /does not admit defect->commit/);
    assert.match(relationProblem(
      parseConsequenceRef("work:wrk-one"), "produces", parseConsequenceRef("decision:d-abcd1234"),
    ) ?? "", /does not admit work->decision/);
    assert.throws(() => recordConsequence(config, {
      ...input, from: parseConsequenceRef("defect:def-123456789abc"), to: parseConsequenceRef("commit:abc"),
    }), ConsequenceLedgerError);
  } finally { await cleanup(root); }
});

test("case-distinct consequence sessions have portable, non-aliasing ledger addresses", async () => {
  const root = await tmpProject();
  const config = cfg(root);
  try {
    const common = {
      from: parseConsequenceRef("decision:d-abcd1234"), relation: "authorizes" as const,
      to: parseConsequenceRef("work:wrk-one"), evidence: "explicit source",
    };
    recordConsequence(config, { ...common, session: "Owner", now: "2026-01-01T00:00:00.000Z" });
    recordConsequence(config, { ...common, session: "owner", now: "2026-01-01T00:00:01.000Z" });
    assert.notEqual(consequenceSessionPath(config, "Owner"), consequenceSessionPath(config, "owner"));
    assert.equal(readConsequences(config).records.length, 2);
  } finally { await cleanup(root); }
});

test("damaged, forged, or displaced surviving rows refuse the whole projection", async () => {
  const fixtures: Array<(root: string) => Promise<void>> = [
    async (root) => {
      await mkdir(join(root, ".coherence", "consequences"), { recursive: true });
      await writeFile(consequenceSessionPath(cfg(root), "one"), "{torn\n");
    },
    async (root) => {
      const config = cfg(root);
      const row = recordConsequence(config, {
        session: "one", from: parseConsequenceRef("decision:d-abcd1234"), relation: "authorizes",
        to: parseConsequenceRef("work:wrk-one"), evidence: "explicit source", now: "2026-01-01T00:00:00.000Z",
      });
      await writeFile(consequenceSessionPath(config, "one"), `${JSON.stringify({ ...row, evidence: "rewritten" })}\n`);
    },
    async (root) => {
      const config = cfg(root);
      recordConsequence(config, {
        session: "one", from: parseConsequenceRef("decision:d-abcd1234"), relation: "authorizes",
        to: parseConsequenceRef("work:wrk-one"), evidence: "explicit source", now: "2026-01-01T00:00:00.000Z",
      });
      const bytes = await readFile(consequenceSessionPath(config, "one"), "utf8");
      await writeFile(join(root, ".coherence", "consequences", "other.jsonl"), bytes);
    },
    async (root) => {
      const config = cfg(root);
      recordConsequence(config, {
        session: "one", from: parseConsequenceRef("decision:d-abcd1234"), relation: "authorizes",
        to: parseConsequenceRef("work:wrk-one"), evidence: "explicit source", now: "2026-01-01T00:00:00.000Z",
      });
      await rename(consequenceSessionPath(config, "one"), join(root, ".coherence", "consequences", "one.bak"));
    },
    async (root) => {
      const config = cfg(root);
      recordConsequence(config, {
        session: "one", from: parseConsequenceRef("decision:d-abcd1234"), relation: "authorizes",
        to: parseConsequenceRef("work:wrk-one"), evidence: "explicit source", now: "2026-01-01T00:00:00.000Z",
      });
      const bytes = await readFile(consequenceSessionPath(config, "one"), "utf8");
      await writeFile(consequenceSessionPath(config, "one"), bytes.trimEnd());
    },
    async (root) => {
      const outside = join(root, "outside-ledger");
      await mkdir(outside);
      await symlink(outside, join(root, ".coherence"));
    },
  ];
  for (const prepare of fixtures) {
    const root = await tmpProject();
    try {
      await prepare(root);
      assert.throws(() => readConsequences(cfg(root)), ConsequenceLedgerError);
    } finally { await cleanup(root); }
  }
});

test("co-presence never invents a causal edge", async () => {
  const root = await tmpProject();
  try {
    const rendered = renderConsequences(cfg(root));
    assert.equal(rendered.trace.records.length, 0);
    assert.match(rendered.text, /no recorded links/);
  } finally { await cleanup(root); }
});

test("consequence writes refuse a pre-existing symlink append target", async () => {
  const root = await tmpProject();
  const config = cfg(root);
  try {
    await mkdir(join(root, ".coherence", "consequences"), { recursive: true });
    const outside = join(root, "outside.jsonl");
    await writeFile(outside, "sentinel\n");
    await symlink(outside, consequenceSessionPath(config, "one"));
    assert.throws(() => recordConsequence(config, {
      session: "one", from: parseConsequenceRef("decision:d-abcd1234"), relation: "authorizes",
      to: parseConsequenceRef("work:wrk-one"), evidence: "explicit source",
    }), ConsequenceLedgerError);
    assert.equal(await readFile(outside, "utf8"), "sentinel\n");
  } finally { await cleanup(root); }
});
