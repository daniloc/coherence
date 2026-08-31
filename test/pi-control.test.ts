import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { cfg, tmpProject } from "./_helpers.ts";
import { HOOK_BODY_BUILD_ID } from "../src/control.ts";
import { PI_EXTENSION_ID, PI_HOOK_BUNDLE_FINGERPRINT, PI_HOOK_PROTOCOL_VERSION, inspectPiLifecycleHook, resolvePiRuntimeRoot, setPiLifecycleHook } from "../src/pi-control.ts";

test("Pi control — install is exact, idempotent, preserving, and nested-root aware", async () => {
  const host = await tmpProject({
    ".pi/settings.json": JSON.stringify({ packages: ["npm:other"], theme: "dark" }, null, 2) + "\n",
  });
  const root = join(host, "app");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@danilocampos/coherence",
    pi: { extensions: ["./dist/pi-extension.js"] },
  }));
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/pi-extension.js"), "export default () => {};\n");
  const config = cfg(root, { piProjectRoot: ".." });

  const first = await setPiLifecycleHook(config, true);
  assert.equal(first.inspection.present, true);
  assert.deepEqual(JSON.parse(await readFile(join(host, ".pi/settings.json"), "utf8")), {
    packages: ["npm:other", "../app"],
    theme: "dark",
  });
  assert.equal(await readFile(join(host, ".pi/coherence-root"), "utf8"), "app\n");
  assert.deepEqual((await setPiLifecycleHook(config, true)).changed, []);
});

test("Pi control — one recognized public competitor converges and multiple competitors refuse", async () => {
  const forms: unknown[] = [
    PI_EXTENSION_ID,
    `npm:${PI_EXTENSION_ID}`,
    `npm:${PI_EXTENSION_ID}@0.37.1`,
    { source: `npm:${PI_EXTENSION_ID}`, extensions: ["./dist/pi-extension.js"] },
  ];
  for (const competitor of forms) {
    const host = await tmpProject({ ".pi/settings.json": JSON.stringify({ packages: ["npm:other", competitor] }) });
    const root = join(host, "app");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: PI_EXTENSION_ID, pi: { extensions: ["./dist/pi-extension.js"] } }));
    await writeFile(join(root, "dist/pi-extension.js"), "x");
    const result = await setPiLifecycleHook(cfg(root, { piProjectRoot: ".." }), true);
    assert.deepEqual(result.errors, [], JSON.stringify(competitor));
    assert.deepEqual(JSON.parse(await readFile(join(host, ".pi/settings.json"), "utf8")).packages, ["npm:other", "../app"]);
  }

  const host = await tmpProject();
  const root = join(host, "app");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: PI_EXTENSION_ID, pi: { extensions: ["./dist/pi-extension.js"] } }));
  const extension = join(root, "dist/pi-extension.js");
  await writeFile(extension, "x");
  await mkdir(join(host, ".pi"), { recursive: true });
  await writeFile(join(host, ".pi/settings.json"), JSON.stringify({ packages: [`npm:${PI_EXTENSION_ID}`], extensions: [extension] }));
  const before = await readFile(join(host, ".pi/settings.json"), "utf8");
  const refused = await setPiLifecycleHook(cfg(root, { piProjectRoot: ".." }), true);
  assert.match(refused.errors.join("\n"), /ambiguous|multiple/i);
  assert.equal(await readFile(join(host, ".pi/settings.json"), "utf8"), before);
});

test("Pi control — local package roots and direct extension entries are recognized competitors", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: PI_EXTENSION_ID, pi: { extensions: ["./dist/pi-extension.js"] } }));
  const extension = join(root, "dist/pi-extension.js");
  await writeFile(extension, "x");
  await mkdir(join(host, ".pi"), { recursive: true });
  await writeFile(join(host, ".pi/settings.json"), JSON.stringify({ packages: ["../app"], extensions: [extension] }));
  const inspection = inspectPiLifecycleHook(cfg(root, { piProjectRoot: ".." }));
  assert.equal(inspection.present, false);
  assert.equal(inspection.settings.managedEntries, 2);
});

test("Pi control — compact settings remain compact after convergence", async () => {
  const host = await tmpProject({ ".pi/settings.json": JSON.stringify({ packages: ["npm:other"], theme: "dark" }) });
  const root = join(host, "app");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: PI_EXTENSION_ID, pi: { extensions: ["./dist/pi-extension.js"] } }));
  await writeFile(join(root, "dist/pi-extension.js"), "x");
  await setPiLifecycleHook(cfg(root, { piProjectRoot: ".." }), true);
  assert.equal(await readFile(join(host, ".pi/settings.json"), "utf8"), JSON.stringify({ packages: ["npm:other", "../app"], theme: "dark" }));
});

test("Pi control — fingerprint binds native and shared lifecycle protocols", () => {
  const expected = createHash("sha256").update(JSON.stringify({
    version: PI_HOOK_PROTOCOL_VERSION,
    hookBodyBuild: HOOK_BODY_BUILD_ID,
    package: PI_EXTENSION_ID,
    settings: { packages: ["local-package-root"], mapping: ".pi/coherence-root" },
    lifecycle: ["session_start", "before_agent_start", "tool_result", "agent_settled:main", "agent_settled:child-once"],
  })).digest("hex");
  assert.equal(PI_HOOK_BUNDLE_FINGERPRINT, `sha256:${expected}`);
});

test("Pi control — malformed and competing settings fail closed", async () => {
  const host = await tmpProject({ ".pi/settings.json": "{broken\n" });
  assert.equal(inspectPiLifecycleHook(cfg(host)).valid, false);
  const root = join(host, "app");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@danilocampos/coherence", pi: { extensions: ["./dist/pi-extension.js"] } }));
  await writeFile(join(root, "dist/pi-extension.js"), "x");
  await writeFile(join(host, ".pi/settings.json"), JSON.stringify({ packages: ["../app", "../app"] }));
  assert.equal(inspectPiLifecycleHook(cfg(root, { piProjectRoot: ".." })).present, false);
});

test("Pi control — missing target refuses and uninstall preserves mapping drift", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@danilocampos/coherence", pi: { extensions: ["./dist/pi-extension.js"] } }));
  const config = cfg(root, { piProjectRoot: ".." });
  assert.match((await setPiLifecycleHook(config, true)).errors.join("\n"), /extension target is missing/i);
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist/pi-extension.js"), "x");
  await setPiLifecycleHook(config, true);
  await writeFile(join(host, ".pi/coherence-root"), "operator changed this\n");
  await setPiLifecycleHook(config, false);
  assert.equal(await readFile(join(host, ".pi/coherence-root"), "utf8"), "operator changed this\n");
});

test("Pi control — runtime activates only the mapped extension", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@danilocampos/coherence", pi: { extensions: ["./dist/pi-extension.js"] } }));
  await writeFile(join(root, "coherence.config.json"), "{}\n");
  const extension = join(root, "dist/pi-extension.js");
  await writeFile(extension, "x");
  const config = cfg(root, { piProjectRoot: ".." });
  await setPiLifecycleHook(config, true);
  await mkdir(join(host, "nested"), { recursive: true });
  assert.deepEqual(resolvePiRuntimeRoot(join(host, "nested"), extension), { active: true, root });
  assert.equal(resolvePiRuntimeRoot(join(host, "nested"), join(root, "other.js")).active, false);
});

test("Pi control — duplicate managed entries refuse installation", async () => {
  const host = await tmpProject();
  const root = join(host, "app");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "@danilocampos/coherence", pi: { extensions: ["./dist/pi-extension.js"] } }));
  await writeFile(join(root, "dist/pi-extension.js"), "x");
  await mkdir(join(host, ".pi"), { recursive: true });
  await writeFile(join(host, ".pi/settings.json"), JSON.stringify({ packages: ["../app", "../app"] }));
  const result = await setPiLifecycleHook(cfg(root, { piProjectRoot: ".." }), true);
  assert.match(result.errors.join("\n"), /ambiguous|duplicate/i);
  assert.deepEqual(result.changed, []);
});

test("Pi control — direct fallback activates only an external copy for one nearest declared root", async () => {
  const host = await tmpProject({ "coherence.config.json": "{}\n" });
  const external = join(host, "..", "global-coherence", "dist", "pi-extension.js");
  await mkdir(join(host, "nested"), { recursive: true });
  assert.deepEqual(resolvePiRuntimeRoot(join(host, "nested"), external), { active: true, root: host });
  assert.equal(resolvePiRuntimeRoot(join(host, "nested"), join(host, "node_modules", PI_EXTENSION_ID, "dist/pi-extension.js")).active, false);

  const nestedRoot = join(host, "nested");
  await writeFile(join(nestedRoot, "coherence.config.json"), "{}\n");
  const ambiguous = resolvePiRuntimeRoot(nestedRoot, external);
  assert.equal(ambiguous.active, false);
  assert.match(ambiguous.reason, /multiple|ambiguous/i);
});

test("Pi control — runtime rejects a foreign mapped package", async () => {
  const host = await tmpProject();
  const root = join(host, "foreign");
  await mkdir(join(root, "dist"), { recursive: true });
  const extension = join(root, "dist/pi-extension.js");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "foreign-package", pi: { extensions: ["./dist/pi-extension.js"] } }));
  await writeFile(extension, "x");
  await mkdir(join(host, ".pi"), { recursive: true });
  await writeFile(join(host, ".pi/coherence-root"), "foreign\n");
  assert.equal(resolvePiRuntimeRoot(host, extension).active, false);
});
