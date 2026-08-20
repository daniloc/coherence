// static-oracles.test.ts — the edit-loop floor: source-name existence without execution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runVerify } from "../src/verify.ts";
import {
  indexStaticVitestOracles,
  resolveStaticOracle,
} from "../src/static-oracles.ts";
import { cfg, cleanup, comp, graph, runCaptured, sym, tmpProject } from "./_helpers.ts";

const vitestCfg = (root: string) => cfg(root, { test: ["npx", "vitest", "-t"], oracleDomain: false });

async function withProject(files: Record<string, string>, fn: (root: string) => Promise<void>): Promise<void> {
  const root = await tmpProject(files);
  try { await fn(root); } finally { await cleanup(root); }
}

function commitAll(root: string): void {
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", [
    "-c", "user.name=Coherence Test", "-c", "user.email=coherence@example.invalid",
    "-c", "commit.gpgsign=false",
    "commit", "-q", "-m", "base",
  ], { cwd: root }).status, 0);
}

test("static oracle floor — a renamed literal Vitest oracle reds --fast without running tests", async () => {
  await withProject({
    "clipboard.test.ts": `import { it } from "vitest";\nit("rejects patch on a clipboard-bound pattern", () => {});\n`,
  }, async (root) => {
    const marker = join(root, "runner-was-launched");
    const c = cfg(root, {
      test: ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`, "--", "vitest"],
      oracleDomain: false,
    });
    const g = graph([comp(".", {
      claims: ['passes test "patch on a clipboard-bound pattern is rejected"'], why: "r",
    })]);
    // The command is runner-detectable as Vitest but only writes a marker if launched.
    // Its absence makes the zero-execution assertion direct, not environment-dependent.
    const result = await runCaptured(() => runVerify(c, g, { fast: true }));
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /VANISHED ORACLE \(static\)/);
    assert.match(result.out, /No test was run/);
    await assert.rejects(() => readFile(marker));
  });
});

test("static oracle floor — a renamed tracked literal owner reds despite unrelated dynamic titles", async () => {
  await withProject({
    "clipboard.test.ts": `import { it } from "vitest";\nit("patch on a clipboard-bound pattern is rejected", () => {});\n`,
    "dynamic.test.ts": `import { it } from "vitest";\nit(\`renders \${runtimeName}\`, () => {});\n`,
  }, async (root) => {
    commitAll(root);
    await writeFile(
      join(root, "clipboard.test.ts"),
      `import { it } from "vitest";\nit("rejects patch on a clipboard-bound pattern", () => {});\n`,
    );
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.match(index.incomplete.join("\n"), /title is not a string literal/);
    assert.deepEqual(index.priorOwners, [{
      file: "clipboard.test.ts",
      fullName: "patch on a clipboard-bound pattern is rejected",
      current: "complete",
    }]);
    assert.equal(resolveStaticOracle(index, "patch on a clipboard-bound pattern is rejected").state, "absent");
    assert.equal(resolveStaticOracle(index, "rejects patch on a clipboard-bound pattern").state, "found");
    assert.equal(resolveStaticOracle(index, "a name never owned by HEAD").state, "unknown");

    const marker = join(root, "runner-was-launched");
    const c = cfg(root, {
      test: ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`, "--", "vitest"],
      oracleDomain: false,
    });
    const g = graph([comp(".", {
      claims: ['passes test "patch on a clipboard-bound pattern is rejected"'], why: "r",
    })]);
    const result = await runCaptured(() => runVerify(c, g, { fast: true }));
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /tracked Git HEAD concretely owned this name/);
    await assert.rejects(() => readFile(marker));
  });
});

test("static names — a former owner rewritten dynamically in the same file remains UNKNOWN", async () => {
  await withProject({
    "clipboard.test.ts": `import { it } from "vitest";\nit("clipboard owner", () => {});\n`,
  }, async (root) => {
    commitAll(root);
    await writeFile(
      join(root, "clipboard.test.ts"),
      `import { it } from "vitest";\nit(runtimeFlag ? "clipboard owner" : "other owner", () => {});\n`,
    );
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.priorOwners, [{
      file: "clipboard.test.ts",
      fullName: "clipboard owner",
      current: "incomplete",
    }]);
    assert.equal(resolveStaticOracle(index, "clipboard owner").state, "unknown");
  });
});

test("static names — deleting a tracked literal owner is a claim-local vanished transition", async () => {
  await withProject({
    "clipboard.test.ts": `import { it } from "vitest";\nit("clipboard owner", () => {});\n`,
    "dynamic.test.ts": `import { it } from "vitest";\nit(dynamicTitle, () => {});\n`,
  }, async (root) => {
    commitAll(root);
    await unlink(join(root, "clipboard.test.ts"));
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.priorOwners, [{
      file: "clipboard.test.ts",
      fullName: "clipboard owner",
      current: "deleted",
    }]);
    assert.equal(resolveStaticOracle(index, "clipboard owner").state, "absent");
    assert.equal(resolveStaticOracle(index, "never owned").state, "unknown");
  });
});

test("static names — a non-Git project has no historical owner evidence", async () => {
  await withProject({
    "clipboard.test.ts": `import { it } from "vitest";\nit("rejects patch on a clipboard-bound pattern", () => {});\n`,
    "dynamic.test.ts": `import { it } from "vitest";\nit(dynamicTitle, () => {});\n`,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.priorOwners, []);
    assert.equal(resolveStaticOracle(index, "patch on a clipboard-bound pattern is rejected").state, "unknown");
  });
});

test("static names — historical owners resolve when the configured root is a Git subdirectory", async () => {
  const root = await tmpProject({
    "packages/app/clipboard.test.ts": `import { it } from "vitest";\nit("old nested owner", () => {});\n`,
    "packages/app/dynamic.test.ts": `import { it } from "vitest";\nit(dynamicTitle, () => {});\n`,
  });
  try {
    commitAll(root);
    const app = join(root, "packages", "app");
    await writeFile(
      join(app, "clipboard.test.ts"),
      `import { it } from "vitest";\nit("new nested owner", () => {});\n`,
    );
    const index = await indexStaticVitestOracles(vitestCfg(app));
    assert.equal(resolveStaticOracle(index, "old nested owner").state, "absent");
    assert.equal(resolveStaticOracle(index, "new nested owner").state, "found");
  } finally {
    await cleanup(root);
  }
});

test("static names — nested suites, aliases, namespaces, and conditional/modifier wrappers reconstruct Vitest fullName", async () => {
  await withProject({
    "nested.test.ts": `
      import { describe as context, it as check } from "vitest";
      import * as vi from "vitest";
      context.skipIf(process.env.CI)("outer", () => {
        vi.suite.only("inner", () => {
          check.concurrent("leaf (a+b)", () => {});
        });
      });
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.incomplete, []);
    assert.deepEqual(index.fullNames, ["outer inner leaf (a+b)"]);
    assert.equal(resolveStaticOracle(index, "inner leaf (a+b)").state, "found");

    const g = graph([comp(".", { claims: ['passes test "inner leaf (a+b)"'], why: "r" })]);
    const result = await runCaptured(() => runVerify(vitestCfg(root), g, { fast: true }));
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /static oracle exists; execution still skipped/);
    assert.match(result.out, /1 skipped/);
  });
});

test("static names — parameterized and computed titles are UNKNOWN, never false VANISHED", async () => {
  await withProject({
    "dynamic.test.ts": `
      import { it, test } from "vitest";
      it.each(rows)("case $name", () => {});
      test(prefix + " suffix", () => {});
    `,
  }, async (root) => {
    const g = graph([comp(".", { claims: ['passes test "an oracle the literals do not name"'], why: "r" })]);
    const result = await runCaptured(() => runVerify(vitestCfg(root), g, { fast: true }));
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /static oracle existence UNKNOWN/);
    assert.doesNotMatch(result.out, /VANISHED ORACLE/);
  });
});

test("static names — a local test helper shadows the Vitest global and cannot manufacture a match", async () => {
  await withProject({
    "helper.test.ts": `
      const test = (name: string, fn: () => void) => fn();
      test("not a Vitest oracle", () => {});
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(index.fullNames.includes("not a Vitest oracle"), false);
    assert.equal(resolveStaticOracle(index, "not a Vitest oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /local declaration shadows Vitest global "test"/);
  });
});

test("static names — simple imported Vitest aliases resolve transitively", async () => {
  await withProject({
    "alias.test.ts": `
      import { test as base } from "vitest";
      const check = base;
      const finalCheck = check;
      finalCheck("live oracle", () => {});
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.incomplete, []);
    assert.deepEqual(index.fullNames, ["live oracle"]);
    assert.equal(resolveStaticOracle(index, "live oracle").state, "found");
  });
});

test("static names — namespace and local aliases preserve suite/test fullName reconstruction", async () => {
  await withProject({
    "namespace-alias.test.ts": `
      import * as vi from "vitest";
      const localVi = vi;
      const context = localVi.describe;
      const check = localVi.test;
      context("outer", () => check("leaf", () => {}));
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.incomplete, []);
    assert.deepEqual(index.fullNames, ["outer leaf"]);
    assert.equal(resolveStaticOracle(index, "outer leaf").state, "found");
  });
});

test("static names — a parameter shadowing a resolved alias cannot manufacture Vitest evidence", async () => {
  await withProject({
    "alias-shadow.test.ts": `
      import { test as base } from "vitest";
      const check = base;
      function subject(check: (name: string, fn: () => void) => void) {
        check("not a Vitest oracle", () => {});
      }
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(index.fullNames.includes("not a Vitest oracle"), false);
    assert.equal(resolveStaticOracle(index, "not a Vitest oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /parameter shadows Vitest binding "check"/);
  });
});

test("static names — complex initializers referencing a Vitest alias remain UNKNOWN", async () => {
  await withProject({
    "alias-extension.test.ts": `
      import { test as base } from "vitest";
      const check = base.extend({});
      check("extended oracle", () => {});
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "extended oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /local alias\/extension of the Vitest DSL is unsupported/);
  });
});

test("static names — a fixture-imported test DSL is UNKNOWN, never false absent", async () => {
  await withProject({
    "fixture.test.ts": `
      import { test } from "./fixtures";
      test("fixture-backed oracle", () => {});
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(index.fullNames.includes("fixture-backed oracle"), false);
    assert.equal(resolveStaticOracle(index, "fixture-backed oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /fixture-extended Vitest DSL/);
  });
});

test("static names — a namespace fixture DSL is UNKNOWN, never a false literal absence", async () => {
  await withProject({
    "namespace-fixture.test.ts": `
      import * as fixture from "./fixtures";
      fixture.test("namespace fixture oracle", () => {});
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "namespace fixture oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /namespace-imported test DSL/);
  });
});

test("static names — imported registrars at suite-registration time are UNKNOWN", async () => {
  await withProject({
    "imported-registrar.test.ts": `
      import { describe, test } from "vitest";
      import { registerShared } from "./shared";
      describe("A", () => registerShared());
      test("ordinary oracle", () => {});
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "ordinary oracle").state, "found");
    assert.equal(resolveStaticOracle(index, "A imported leaf").state, "unknown");
    assert.match(index.incomplete.join("\n"), /executes during test registration/);
  });
});

test("static names — a bare side-effect import may register tests and keeps absence UNKNOWN", async () => {
  await withProject({
    "side-effect.test.ts": `import "./register-tests";\n`,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "imported oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /side-effect import.*executes during test registration/);
  });
});

test("static names — top-level and suite dynamic import/require loads keep absence UNKNOWN", async () => {
  const cases = {
    "top-level dynamic import": `await import("./register-tests");`,
    "top-level require": `require("./register-tests");`,
    "suite dynamic import": `import { describe } from "vitest"; describe("A", () => { void import("./register-tests"); });`,
    "suite require": `import { describe } from "vitest"; describe("A", () => { require("./register-tests"); });`,
  };
  for (const [label, source] of Object.entries(cases)) {
    await withProject({ "registration-load.test.ts": `${source}\n` }, async (root) => {
      const index = await indexStaticVitestOracles(vitestCfg(root));
      assert.equal(resolveStaticOracle(index, "runtime-owned oracle").state, "unknown", label);
      assert.match(index.incomplete.join("\n"), /module load.*executes during test registration/, label);
    });
  }
});

test("static names — dynamic import and require inside a test callback are subject execution, not registration uncertainty", async () => {
  await withProject({
    "inside-test-load.test.ts": `
      import { test } from "vitest";
      test("ordinary oracle", async () => {
        await import("./subject");
        require("./legacy-subject");
      });
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.incomplete, []);
    assert.equal(resolveStaticOracle(index, "ordinary oracle").state, "found");
    assert.equal(resolveStaticOracle(index, "missing oracle").state, "absent");
  });
});

test("static names — imported subject calls inside test callbacks do not poison completeness", async () => {
  await withProject({
    "imported-subject.test.ts": `
      import { test } from "vitest";
      import { subject } from "./subject";
      test("ordinary oracle", () => subject());
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.incomplete, []);
    assert.equal(resolveStaticOracle(index, "ordinary oracle").state, "found");
    assert.equal(resolveStaticOracle(index, "missing oracle").state, "absent");
  });
});

test("static names — test registration inside a called helper has runtime suite ancestry and stays UNKNOWN", async () => {
  await withProject({
    "helper-registration.test.ts": `
      import { describe, test } from "vitest";
      function shared() { test("leaf", () => {}); }
      describe("A", () => shared());
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(index.fullNames.includes("leaf"), false);
    assert.equal(resolveStaticOracle(index, "A leaf").state, "unknown");
    assert.match(index.incomplete.join("\n"), /declared inside a runtime helper/);
  });
});

test("static names — test registration inside a class method has runtime ancestry and stays UNKNOWN", async () => {
  await withProject({
    "method-registration.test.ts": `
      import { describe, test } from "vitest";
      class Shared { register() { test("leaf", () => {}); } }
      describe("A", () => new Shared().register());
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(index.fullNames.includes("leaf"), false);
    assert.equal(resolveStaticOracle(index, "A leaf").state, "unknown");
    assert.match(index.incomplete.join("\n"), /declared inside a runtime helper/);
  });
});

test("static names — custom Vitest include evidence keeps conventional-file absence UNKNOWN", async () => {
  await withProject({
    "vitest.config.ts": `export default { test: { include: ["checks/**/*.ts"] } };\n`,
    "standard.test.ts": `import { test } from "vitest"; test("standard oracle", () => {});\n`,
    "checks/custom.ts": `test("custom-named oracle", () => {});\n`,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "standard oracle").state, "found");
    assert.equal(resolveStaticOracle(index, "custom-named oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /custom Vitest collection\/root config \(include\)/);
  });
});

test("static names — Vitest includeSource keeps in-source test ownership UNKNOWN", async () => {
  await withProject({
    "vitest.config.ts": `export default { test: { includeSource: ["src/**/*.ts"] } };\n`,
    "ordinary.test.ts": `import { test } from "vitest"; test("ordinary oracle", () => {});\n`,
    "src/in-source.ts": `test("in-source oracle", () => {});\n`,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "ordinary oracle").state, "found");
    assert.equal(resolveStaticOracle(index, "in-source oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /custom Vitest collection\/root config \(includeSource\)/);
  });
});

test("static names — custom exclude and root/workspace collection config keep absence UNKNOWN", async () => {
  const configs = {
    "custom exclude": `export default { test: { exclude: [] } };`,
    "custom root": `export default { root: "../tests" };`,
    "custom projects": `export default { test: { projects: ["../shared"] } };`,
    "custom workspace": `export default { test: { workspace: ["../shared"] } };`,
  };
  for (const [label, config] of Object.entries(configs)) {
    await withProject({
      "vitest.config.ts": `${config}\n`,
      "ordinary.test.ts": `import { test } from "vitest"; test("ordinary oracle", () => {});\n`,
    }, async (root) => {
      const index = await indexStaticVitestOracles(vitestCfg(root));
      assert.equal(resolveStaticOracle(index, "outside-root oracle").state, "unknown", label);
      assert.match(index.incomplete.join("\n"), /custom Vitest collection\/root config/, label);
    });
  }
});

test("static names — a Vitest workspace config makes root coverage UNKNOWN even without a recognizable literal key", async () => {
  await withProject({
    "vitest.workspace.ts": `export default getProjects();\n`,
    "ordinary.test.ts": `import { test } from "vitest"; test("ordinary oracle", () => {});\n`,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "workspace oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /Vitest workspace config/);
  });
});

test("static names — unicode and hex escapes unsupported by the shared decoder stay UNKNOWN", async () => {
  await withProject({
    "escaped.test.ts": `
      import { test } from "vitest";
      test("unicode \\u2192 oracle", () => {});
      test("hex \\x41 oracle", () => {});
    `,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "unicode → oracle").state, "unknown");
    assert.equal(resolveStaticOracle(index, "hex A oracle").state, "unknown");
    assert.equal(index.fullNames.some((name) => /u2192|x41/.test(name)), false);
    assert.match(index.incomplete.join("\n"), /cannot decode exactly/);
  });
});

test("static names — filesystem fallback does not reuse cfg.ignore to hide tests", async () => {
  await withProject({
    "hidden-by-graph/visible.test.ts": `import { test } from "vitest"; test("outside graph oracle", () => {});\n`,
  }, async (root) => {
    const index = await indexStaticVitestOracles(cfg(root, {
      test: ["npx", "vitest", "-t"],
      ignore: ["hidden-by-graph"],
    }));
    assert.equal(resolveStaticOracle(index, "outside graph oracle").state, "found");
  });
});

test("static names — build and dot directories are conservatively included in the conventional population", async () => {
  await withProject({
    "ordinary.test.ts": `import { test } from "vitest"; test("ordinary oracle", () => {});\n`,
    "build/live.test.ts": `import { test } from "vitest"; test("build oracle", () => {});\n`,
    ".generated/live.test.ts": `import { test } from "vitest"; test("dot oracle", () => {});\n`,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.incomplete, []);
    assert.equal(resolveStaticOracle(index, "build oracle").state, "found");
    assert.equal(resolveStaticOracle(index, "dot oracle").state, "found");
  });
});

test("static names — Vitest v4 default node_modules and .git directories stay excluded", async () => {
  await withProject({
    "ordinary.test.ts": `import { test } from "vitest"; test("ordinary oracle", () => {});\n`,
    "node_modules/pkg/hidden.test.ts": `import { test } from "vitest"; test("dependency oracle", () => {});\n`,
    ".git/hidden.test.ts": `import { test } from "vitest"; test("git oracle", () => {});\n`,
  }, async (root) => {
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.deepEqual(index.incomplete, []);
    assert.equal(resolveStaticOracle(index, "ordinary oracle").state, "found");
    assert.equal(resolveStaticOracle(index, "dependency oracle").state, "absent");
    assert.equal(resolveStaticOracle(index, "git oracle").state, "absent");
  });
});

test("static names — an untraversed directory symlink makes absence UNKNOWN", async () => {
  await withProject({
    "ordinary.test.ts": `import { test } from "vitest"; test("ordinary oracle", () => {});\n`,
    "node_modules/real/linked.test.ts": `import { test } from "vitest"; test("linked directory oracle", () => {});\n`,
  }, async (root) => {
    await symlink(join(root, "node_modules", "real"), join(root, "linked-tests"), "dir");
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "linked directory oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /linked-tests is a symlink/);
  });
});

test("static names — a conventional file symlink is not followed outside the declared root", async () => {
  await withProject({
    "fixtures/target.ts": `import { test } from "vitest"; test("linked file oracle", () => {});\n`,
  }, async (root) => {
    await symlink(join(root, "fixtures", "target.ts"), join(root, "linked.test.ts"), "file");
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(index.fullNames.includes("linked file oracle"), false);
    assert.equal(resolveStaticOracle(index, "linked file oracle").state, "unknown");
    assert.match(index.incomplete.join("\n"), /linked\.test\.ts is a symlink/);
  });
});

test("static names — untracked and gitignored present tests both participate because Vitest can collect them", async () => {
  await withProject({
    ".gitignore": "ignored.test.ts\n",
    "base.ts": "export {};\n",
    "fresh.test.ts": `import { test } from "vitest"; test("fresh oracle", () => {});\n`,
    "ignored.test.ts": `import { test } from "vitest"; test("ignored oracle", () => {});\n`,
  }, async (root) => {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
    assert.equal(spawnSync("git", ["add", ".gitignore", "base.ts"], { cwd: root }).status, 0);
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "fresh oracle").state, "found");
    assert.equal(resolveStaticOracle(index, "ignored oracle").state, "found");
  });
});

test("static names — every executable claim grammar gets the same absent floor", async () => {
  await withProject({
    "present.test.ts": `import { test } from "vitest"; test("another oracle", () => {});\n`,
  }, async (root) => {
    const g = graph([
      comp(".", {
        claims: [
          'passes test "ghost pass"',
          'boundary "guarded" at Guarded via guard "ghost guard"',
          'boundary "tested" at Tested via test "ghost test"',
          'parity "paired" over Domain between Left and Right via test "ghost parity"',
        ],
        invariants: ["guarded", "tested", "paired"],
        why: "r",
      }),
      ...["Guarded", "Tested", "Domain", "Left", "Right"].map((name) => sym(name)),
    ]);
    const result = await runCaptured(() => runVerify(vitestCfg(root), g, { fast: true }));
    assert.equal(result.code, 1, result.out);
    assert.equal((result.out.match(/VANISHED ORACLE \(static\)/g) ?? []).length, 4, result.out);
  });
});

test("static names — non-Vitest runner configuration remains UNKNOWN and never launches", async () => {
  await withProject({
    "node.test.ts": `import test from "node:test"; test("node oracle", () => {});\n`,
    "would-run": "",
  }, async (root) => {
    const marker = join(root, "runner-was-launched");
    const c = cfg(root, { test: ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`] });
    const g = graph([comp(".", { claims: ['passes test "missing"'], why: "r" })]);
    const result = await runCaptured(() => runVerify(c, g, { fast: true }));
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /not statically identifiable as Vitest/);
    await assert.rejects(() => readFile(marker));
  });
});

test("static names — config.staticOracleExistence false disables indexing and keeps fast claims UNKNOWN", async () => {
  await withProject({
    "ordinary.test.ts": `import { test } from "vitest"; test("ordinary oracle", () => {});\n`,
  }, async (root) => {
    const c = cfg(root, {
      test: ["npx", "vitest", "-t"],
      staticOracleExistence: false,
    });
    const g = graph([comp(".", { claims: ['passes test "missing oracle"'], why: "r" })]);
    const result = await runCaptured(() => runVerify(c, g, { fast: true }));
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /disabled by config\.staticOracleExistence/);
    assert.doesNotMatch(result.out, /VANISHED ORACLE/);
  });
});

test("static names — an untracked test added after the first index is visible on the next verify", async () => {
  await withProject({}, async (root) => {
    await writeFile(join(root, "later.test.ts"), `import { test } from "vitest"; test("later oracle", () => {});\n`);
    const index = await indexStaticVitestOracles(vitestCfg(root));
    assert.equal(resolveStaticOracle(index, "later oracle").state, "found");
  });
});
