// config.ts — load coherence.config.json from a project root, over sane defaults.
import { join } from "node:path";
import { readJsonOrRefuse } from "./floor.ts";
import type { Config } from "./types.ts";

const DEFAULTS: Omit<Config, "root"> = {
  outputDir: "public",
  entryDir: ".",
  tooling: [],
  ignore: ["node_modules", ".git", "dist", ".turbo", ".wrangler"],
  codeExt: ["ts"],
  typecheck: ["npm", "run", "typecheck"],
  test: [],
  language: "typescript",
  platform: null,
  dictionary: "dictionary",
};

/**
 * THE PROJECT'S CONFIG over the defaults — and a REFUSAL when a config is there and
 * cannot be read (floor.ts's `readJsonOrRefuse`). ABSENT is legitimate and stays exactly
 * as it was: every field has a default, and running with none of them overridden is the
 * first rung of the adoption ladder.
 *
 * UNPARSEABLE never was. It used to degrade to the DEFAULTS silently, which is not a
 * milder version of the same thing — it is a harness reading a different tree than the
 * one it was configured to read, and reporting on it with full confidence. `ignore`,
 * `codeExt` and `sources` all revert, so the walk changes shape; and `name` reverts to
 * absent, which resurrects the cross-checkout `docs --check` false positive b32965d
 * shipped to kill. Every downstream refusal on this page is then computed over the
 * wrong population.
 */
export async function loadConfig(root: string): Promise<Config> {
  const file = await readJsonOrRefuse<Partial<Config>>(join(root, "coherence.config.json"), {
    label: "coherence.config.json",
    what: "this project's configuration — which tree the harness walks and what it grades",
    absentMeans: "journal, hook, and reference commands run without one; WALKING commands refuse until `{}` declares the root (see requireDeclaredRoot)",
    consequence: [
      `walking a DIFFERENT TREE than you configured: \`ignore\`, \`codeExt\`, \`sources\``,
      `and \`name\` all revert to defaults. Every floor in this harness would then be`,
      `graded over that wrong population, and report on it with full confidence.`,
    ],
  });
  return { ...DEFAULTS, ...(file ?? {}), root, declared: file != null };
}
