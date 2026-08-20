import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceTextIsNavigable } from "../src/tree.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = join(ROOT, "src");

async function liveTypeScriptFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await liveTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files.sort();
}

test("source text — every live TypeScript source remains NUL-free and searchable", async () => {
  const files = await liveTypeScriptFiles(SOURCE);
  assert.ok(files.length >= 50, `source enumeration found only ${files.length} files`);
  const damaged: string[] = [];
  for (const file of files) {
    if (!sourceTextIsNavigable(await readFile(file))) damaged.push(relative(ROOT, file));
  }
  assert.deepEqual(damaged, []);
});
