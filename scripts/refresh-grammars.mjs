#!/usr/bin/env node
// refresh-grammars.mjs — re-derive the vendored grammar binaries from the pinned
// devDependency packages, so grammars/ provenance is a command rather than a story.
// Run after bumping a tree-sitter-<lang> devDependency; commit the result.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRAMMARS = [
  { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  { pkg: "tree-sitter-python", wasm: "tree-sitter-python.wasm" },
  { pkg: "tree-sitter-ruby", wasm: "tree-sitter-ruby.wasm" },
];

const provenance = ["# Vendored tree-sitter grammar binaries", "",
  "Prebuilt wasm shipped by each grammar package, copied verbatim by",
  "`node scripts/refresh-grammars.mjs`. Runtime: web-tree-sitter (see package.json).", ""];
for (const { pkg, wasm } of GRAMMARS) {
  const from = join(root, "node_modules", pkg, wasm);
  copyFileSync(from, join(root, "grammars", wasm));
  const version = JSON.parse(readFileSync(join(root, "node_modules", pkg, "package.json"), "utf8")).version;
  provenance.push(`- ${wasm} — ${pkg}@${version}`);
  console.log(`${wasm} <- ${pkg}@${version}`);
}
writeFileSync(join(root, "grammars", "PROVENANCE.md"), provenance.join("\n") + "\n");
