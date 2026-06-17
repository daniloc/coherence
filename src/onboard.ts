// onboard.ts — bootstrap the coherence skeleton for a repo that has no specs.
// Derives the structure that IS derivable, suggests a component decomposition, and
// emits why-from-history jobs. Output is PROPOSALS for a human to review and attest
// — never mutations to the target repo. This is the "adopt the harness" on-ramp.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import type { Config, Graph, GraphNode } from "./types.ts";

export async function onboard(cfg: Config, graph: Graph): Promise<void> {
  const root = cfg.root;
  const outDir = join(root, ".coherence-out");
  const jobsDir = join(root, ".coherence");
  await mkdir(outDir, { recursive: true });
  await mkdir(jobsDir, { recursive: true });

  const files = graph.nodes.filter((n) => n.kind === "file");
  const symbols = graph.nodes.filter((n) => n.kind === "symbol");
  const childrenOf = (id: string) => graph.nodes.filter((n) => n.parent === id);
  const project = basename(resolve(root));

  // candidate components: the entrypoint + each runtime entity (e.g. a Durable Object),
  // located at the file that defines its class.
  const entities = graph.bindings?.entities ?? [];
  const defining = (className: string) => symbols.find((s) => s.label === className && s.kind === "class")?.path;
  const candidates = [
    { name: project, role: "entrypoint / the project as a whole", file: graph.bindings?.meta.entry || "" },
    ...entities.map((e) => ({ name: e.className, role: `runtime entity (binding ${e.name})`, file: defining(e.className) || "(class not found in source)" })),
  ];

  // significant files = those that export symbols (worth a why); rank by symbol count.
  const significant = files
    .map((f) => ({ f, n: childrenOf(f.id).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  // why-from-history jobs (one per significant file)
  const jobs = significant.map(({ f }) => ({ kind: "infer-why", id: f.id, file: f.path, symbols: childrenOf(f.id).map((s) => s.label) }));
  await writeFile(join(jobsDir, "onboard-jobs.json"), JSON.stringify(jobs, null, 2) + "\n");

  // a draft root spec the human can refine and promote to <Project>.spec.md
  const draft = `# ${project}

<!-- TODO: one-line intent (≤140 chars). What is this project, in a sentence? -->

## works when
- typechecks
${graph.bindings?.meta.entry ? `- ${graph.bindings.meta.entry} exists at root` : ""}

## why

<!-- Bootstrapped from git history — see .coherence-out/why-proposals.md. Review & attest. -->
`;
  await writeFile(join(outDir, `${project}.spec.md.draft`), draft);

  // the onboarding report
  const r: string[] = [];
  r.push(`# Onboarding ${project}`, "", `Derived ${files.length} files, ${symbols.length} symbols, ${graph.edges.length} edges.`, "");
  r.push("## Suggested components (you decide — the harness can't invent your boundaries)", "");
  for (const c of candidates) r.push(`- **${c.name}** — ${c.role}  ·  \`${c.file}\``);
  r.push("", "A flat repo has no folders to attach specs to. Either (a) author a spec per boundary above (place it where that boundary's code lives), or (b) start with one root spec and split later.", "");
  r.push("## Draft root spec", "", "Written to `.coherence-out/" + project + ".spec.md.draft` — refine the intent, then promote to a real `*.spec.md`.", "");
  r.push("## Why bootstrap (the high-value part)", "", `${jobs.length} files queued for why-from-history inference (\`.coherence/onboard-jobs.json\`). Dispatch a subagent:`, "");
  r.push("> For each job, run `git log --format='%h %s%n%b' -- <file>`, read the file, and propose a 1–2 sentence `@why` grounded in the commit decisions (cite the commits; do not fabricate). Write proposals to `.coherence-out/why-proposals.md`.", "");
  r.push("Then a human reviews `why-proposals.md`, attests the good ones, and applies them as `@why` lines / `## why` sections.", "");
  r.push("Top files by symbol count:", "");
  for (const { f, n } of significant.slice(0, 12)) r.push(`- \`${f.path}\` (${n} symbols)`);
  await writeFile(join(outDir, "onboarding.md"), r.join("\n") + "\n");

  console.log(`onboarding ${project}: ${files.length} files, ${symbols.length} symbols`);
  console.log(`  suggested components: ${candidates.map((c) => c.name).join(", ")}`);
  console.log(`  wrote .coherence-out/onboarding.md + ${project}.spec.md.draft`);
  console.log(`  ${jobs.length} why-from-history jobs → .coherence/onboard-jobs.json (dispatch a subagent to fill .coherence-out/why-proposals.md)`);
}
