#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function classifyNpmPublicationLookup(status, stdout) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error(`npm view returned invalid JSON (exit ${status})`);
  }

  if (status === 0) {
    if (typeof value !== "string" || !GIT_OBJECT.test(value)) {
      throw new Error("published version has no shaped gitHead");
    }
    return { state: "existing", gitHead: value };
  }

  const code = value && typeof value === "object" && "error" in value
    && value.error && typeof value.error === "object" && "code" in value.error
    ? value.error.code
    : undefined;
  if (code === "E404") {
    if (status !== 1) {
      throw new Error(`npm view reported E404 with unexpected exit ${status}`);
    }
    return { state: "absent" };
  }
  throw new Error(`npm view failed with ${typeof code === "string" ? code : `exit ${status}`}`);
}

export function classifyNpmPublicationProcessResult(result) {
  if (result.error) throw result.error;
  if (result.signal !== null && result.signal !== undefined) {
    throw new Error(`npm view was terminated by signal ${result.signal}`);
  }
  if (!Number.isInteger(result.status)) {
    throw new Error("npm view returned no exit status");
  }
  if (typeof result.stdout !== "string") {
    throw new Error("npm view returned no text output");
  }
  return classifyNpmPublicationLookup(result.status, result.stdout);
}

export function lookupNpmPublication(packageName, version) {
  const result = spawnSync("npm", ["view", `${packageName}@${version}`, "gitHead", "--json"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return classifyNpmPublicationProcessResult(result);
}

function selfTest() {
  const sha = "a".repeat(40);
  assert.deepEqual(classifyNpmPublicationLookup(0, JSON.stringify(sha)), {
    state: "existing",
    gitHead: sha,
  });
  const e404 = JSON.stringify({ error: { code: "E404" } });
  assert.deepEqual(classifyNpmPublicationLookup(1, e404), {
    state: "absent",
  });
  assert.throws(() => classifyNpmPublicationLookup(2, e404), /unexpected exit 2/);
  assert.throws(
    () => classifyNpmPublicationProcessResult({ status: null, signal: "SIGTERM", stdout: e404 }),
    /signal SIGTERM/,
  );
  assert.throws(
    () => classifyNpmPublicationProcessResult({ status: null, signal: null, stdout: e404 }),
    /no exit status/,
  );
  assert.throws(
    () => classifyNpmPublicationLookup(1, JSON.stringify({ error: { code: "EAI_AGAIN" } })),
    /EAI_AGAIN/,
  );
  assert.throws(() => classifyNpmPublicationLookup(0, JSON.stringify("not-a-git-object")), /gitHead/);
  assert.throws(
    () => classifyNpmPublicationLookup(0, JSON.stringify({ error: { code: "E404" } })),
    /gitHead/,
  );
  console.log("npm publication-state self-test: E404-only absence and fail-closed errors passed");
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    if (process.argv[2] === "--self-test") {
      selfTest();
    } else {
      const [, , packageName, version] = process.argv;
      if (!packageName || !version) throw new Error("usage: npm-publication-state.mjs <package> <version>");
      process.stdout.write(`${JSON.stringify(lookupNpmPublication(packageName, version))}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
