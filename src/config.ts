// config.ts — load coherence.config.json from a project root, over sane defaults.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./types.ts";

const DEFAULTS: Omit<Config, "root"> = {
  outputDir: "public",
  entryDir: ".",
  tooling: [],
  ignore: ["node_modules", ".git", "dist", ".turbo", ".wrangler"],
  codeExt: ["ts"],
  typecheck: ["npm", "run", "typecheck"],
  language: "typescript",
  platform: null,
};

export async function loadConfig(root: string): Promise<Config> {
  let file: Partial<Config> = {};
  try { file = JSON.parse(await readFile(join(root, "coherence.config.json"), "utf8")); } catch { /* defaults */ }
  return { ...DEFAULTS, ...file, root };
}
