// commands.ts — THE COMMAND REGISTRY: which verbs `coherence` has, declared ONCE.
//
// This file exists because the command list was spelled in three places and enforced in
// none, and in two days it drifted three times:
//   · the usage banner produced v0.14.0's ONLY merge conflict — two branches hand-edited
//     the same `<a|b|c>` string literal.
//   · banner vs dispatch measured 29 vs 30.
//   · README's `## Commands` vs dispatch measured 20 vs 32 — twelve commands undocumented,
//     including `dismiss` listed while its six sibling journal verbs were not, so a reader
//     found a verb for retiring conjectures with nothing explaining what a conjecture is.
// `coherence redundancy` flagged the banner/dispatch pair every run as "identical today,
// tied together by nothing". This is the harness's own convention-tier finding, and the
// fix it recommends is the one applied here: DERIVE ONE SPELLING FROM THE OTHER.
//
// WHY A REGISTRY AND NOT A HANDLER TABLE. The strongest form would delete the
// correspondence outright — a `Record<name, handler>` and no if/else chain at all. That
// refactor was rejected for now: cli.ts's dispatch is 350 lines of early exits, shared
// locals and per-command usage errors, and rewriting it to land a documentation fix trades
// a checked correspondence for an unchecked rewrite. What is here instead: one declarative
// home, two DERIVED spellings (the banner, the README index), and a totality oracle that
// enumerates the LIVE dispatch out of cli.ts's AST and asserts the two sets are equal
// (test/commands.test.ts). The dispatch is still hand-written; it can no longer disagree.
//
// WHY THIS FILE AND NOT cli.ts. cli.ts executes at import: `process.argv[2]`, the if/else
// chain and `process.exit` all run at module scope. A test cannot import it. A source of
// truth its own oracle cannot read is not one.
//
// NO TIMESTAMP IN THE RENDERED BLOCK, on purpose. The block is a pure function of this
// array — no clock, no absolute path, nothing machine-specific — so `docs --check` compares
// it byte-for-byte with zero normalization. Every normalization a freshness gate needs is a
// hole in that gate (see cli.ts's `normGraphHtml`, which has three).

import { CLAIM_FORMS } from "./phrasebook.ts";

/** The README block `coherence docs` owns. A DISTINCT marker pair from CLAUDE.md's:
 *  a project may carry both files, the two blocks hold different things, and a shared
 *  marker would let one command clobber the other's zone. */
export const COMMANDS_BEGIN = "<!-- coherence:commands:begin -->";
export const COMMANDS_END = "<!-- coherence:commands:end -->";

/** The SECOND README block `coherence docs` owns: the claim-form table, derived from the
 *  `CLAIM_FORMS` registry (src/phrasebook.ts) — the same registry `evalClaim` executes.
 *  Its own distinct marker pair, for the same reason as above. The renderer lives HERE
 *  rather than in phrasebook.ts because this file is where README-owned marker pairs and
 *  their splice-ready spellings are declared once and derived from. */
export const PHRASEBOOK_BEGIN = "<!-- coherence:phrasebook:begin -->";
export const PHRASEBOOK_END = "<!-- coherence:phrasebook:end -->";

/** Grouping for both derived spellings. Order comes from first appearance in `COMMANDS`,
 *  so the group sequence is declared exactly once — by the array below — and there is no
 *  second ordering list to fall out of step with it. */
export type CommandGroup =
  | "derive" | "verify" | "journal" | "perceive" | "ratchet" | "advisory" | "bootstrap" | "reference";

/** `Record<CommandGroup, …>` on purpose: tsc refuses a missing or misspelled group, so the
 *  titles cannot drift from the union. That pair is compiler-enforced — tier-1 on the
 *  enforcement ladder — which is why `redundancy` collapses it instead of reporting it. */
const GROUP_TITLE: Record<CommandGroup, string> = {
  derive: "Derive the artifacts",
  verify: "Verify, and diff what is enforced",
  journal: "The decision journal — appends only, gates nothing",
  perceive: "Perceive the project",
  ratchet: "Ratchets and gates",
  advisory: "Advisories — they surface, you judge",
  bootstrap: "Bootstrap and scaffold",
  reference: "Reference and plumbing",
};

export interface Command {
  /** the verb as typed: `coherence <name>`. The dispatch key. */
  name: string;
  /** ONE line. It is an index entry in both spellings, not a description — the reasoning
   *  for the commands that have any lives in README.md's authored detail, below the block. */
  summary: string;
  /** the argument/flag shape, rendered after the name in both spellings. Omit for a
   *  command that takes nothing. */
  usage?: string;
  group: CommandGroup;
  /** alternate spellings the dispatch accepts. An alias is NOT a command: it never appears
   *  in the banner's `<a|b|c>` list nor as its own README entry, and the totality oracle
   *  counts it on the dispatch side. */
  aliases?: string[];
}

export const COMMANDS: Command[] = [
  // ── derive ───────────────────────────────────────────────────────────────────────────
  { name: "graph", group: "derive", usage: "[--check]", summary: "emit `graph.json` + `_graph.html` (the outline) to `outputDir`" },
  { name: "overview", group: "derive", usage: "[--check]", summary: "emit `_overview.html` + `AGENTS.md`" },
  { name: "docs", group: "derive", usage: "[--check]", summary: "graph + overview + this command index; `--check` fails on any stale artifact" },
  { name: "claude", group: "derive", usage: "[--check]", summary: "regenerate the owned fenced block inside `CLAUDE.md`" },

  // ── verify ───────────────────────────────────────────────────────────────────────────
  {
    name: "verify", group: "verify",
    usage: "[--fast] [--staged | --since <ref>] [--raise [--raise-cap N]] [--apply <verdicts>] [--from-report <file>] [--serial-oracles]",
    summary: "run the claims, the evidence chain and coverage — the gate",
  },
  {
    name: "log", group: "verify", usage: "[<refA> [<refB>]] [--strict]",
    summary: "structural diff of the invariant/boundary set between two refs, then the novelty advisory",
  },
  {
    name: "signal", group: "verify", usage: "[--check] [--since <ref>] [--attest-no-invariant --because <why>]",
    summary: "require significant behavioral growth to gain an anchor or a patch-bound decision",
  },

  // ── journal ──────────────────────────────────────────────────────────────────────────
  { name: "decide", group: "journal", usage: '"<chose>" --over "<alt>" --because "<why>"', summary: "log one choice and what it was chosen OVER" },
  { name: "blocked", group: "journal", usage: '"<what>" --because "<why>"', summary: "log what you could NOT do — first-class, not a footnote" },
  {
    name: "conjecture", group: "journal",
    usage: '"<observation>" [--could-be "<explanation>"] --discriminated-by "<the test>"',
    summary: "log what surprised you; `the instrument is wrong` is added if you omit it",
  },
  {
    name: "observed", group: "journal",
    usage: '"<label>" --value <n> --baseline <n> --threshold <n> [--unit U] [--why "<explanation>"]',
    summary: "a tracked metric from the harness that measured it — outside its band and unexplained, one conjecture per label",
  },
  {
    name: "resolved", group: "journal", aliases: ["resolve"],
    usage: '<id> --because "<what the test showed>" [--as "<which candidate won>"]',
    summary: "close a conjecture with what the discriminating test showed",
  },
  {
    name: "dismiss", group: "journal", usage: '<id> --because "<why this is not worth chasing>"',
    summary: "retire a conjecture UNANSWERED — not a resolution, and never raised again",
  },
  {
    name: "retract", group: "journal", usage: '<id> --because "<what refuted it>" [--for "<replacement>"]',
    summary: "withdraw a decision by appending, never by editing",
  },
  {
    name: "decisions", group: "journal",
    usage: "[--job|--agent|--session|--branch|--sessions|--md|--brief|--open|--compact]",
    summary: "the MERGED timeline across every session file; `--open` is what was noticed and not yet chased,"
      + " `--compact` folds committed session files into one per (branch, month) without changing what this prints",
  },

  // ── perceive ─────────────────────────────────────────────────────────────────────────
  { name: "panel", group: "perceive", usage: "[--no-watch | --once]", summary: "live TUI over the graph + the status record" },
  { name: "scene", group: "perceive", usage: "[--diff <ref>]", summary: "the persistent isometric worksite (`_scene.html`); `--diff` renders a review against `<ref>`" },
  { name: "contract", group: "perceive", summary: "the promise graph — graded gates + the reliance ledger (`_contract.html`)" },
  { name: "review", group: "perceive", usage: "<ref>", summary: "diff the contract against `<ref>` and print the event ledger" },
  {
    name: "context", group: "perceive", usage: "[<file>...] [--symbol <name>] [--changed|--staged]",
    summary: "emit the smallest graph-addressed context packet for a file, symbol, or current change",
  },

  // ── ratchet ──────────────────────────────────────────────────────────────────────────
  { name: "lint-sinks", group: "ratchet", usage: "[--check | --update-baseline]", summary: "interpolation-surface ratchet — raw SQL-identifier and HTML sinks" },
  { name: "conventions", group: "ratchet", usage: "[--check | --update-baseline]", summary: "guard-vs-contract detector + growth ratchet" },
  { name: "mass", group: "ratchet", usage: "[--check|--update-baseline] [--raise]", summary: "how much machine there is — lines, files, symbols, deps and project measures, pinned" },
  { name: "atlas", group: "ratchet", usage: "[--check] [--raise]", summary: "trust-graded manifold render + the drift / dangling / over-claim gate" },
  { name: "contracts", group: "ratchet", usage: "[--check]", summary: "producer/consumer contracts across deploy artifacts + the uncovered-surface detector" },

  // ── advisory ─────────────────────────────────────────────────────────────────────────
  { name: "redundancy", group: "advisory", usage: "[--all] [--raise]", summary: "one enumerated domain spelled twice with nothing tying the spellings together" },
  { name: "why-lint", group: "advisory", usage: "[--check]", summary: "`## why` prose restating a mechanism a boundary claim already anchors" },
  { name: "decompose", group: "advisory", summary: "the wise-decomposition report — a LOCALITY score plus the smells that lower it" },
  { name: "drift", group: "advisory", summary: "decompose's derivative — converging on one home, or decohering across boundaries" },
  {
    name: "economy", group: "advisory", usage: "[--raise]",
    summary: "the context closure of a change — what a reader must load to modify one thing safely",
  },
  { name: "premise", group: "advisory", usage: "[--check]", summary: "audit whether standing decisions' named structural addresses still resolve" },
  {
    name: "calibrate", group: "advisory", usage: "[--outcome <clean|defect>] [--session <id>]",
    summary: "compare economy's predicted context with observed agent reads and labeled outcomes",
  },

  // ── bootstrap ────────────────────────────────────────────────────────────────────────
  { name: "onboard", group: "bootstrap", summary: "bootstrap a repo with no specs — output is proposals to review, not writes" },
  {
    // `<kind>`, not `<boundary|component|invariant|parity>`, and the reason is this file's
    // whole subject. Spelling the four kinds here would put a FOURTH copy of that domain in
    // the tree (scaffold.ts's `kind` compare, its usage error, the README's authored detail,
    // and this) — and because the README index is DERIVED, the copy propagates into a file
    // that already spells them in prose, which `redundancy` scored the moment it did. An
    // index owes the SHAPE of a command's arguments; the domain belongs to the command, and
    // `coherence scaffold` with no args prints all four.
    name: "scaffold", group: "bootstrap", usage: "<kind> <name>",
    summary: "the gradient-flip generator — make the complete shape the cheapest thing to ship",
  },

  // ── reference ────────────────────────────────────────────────────────────────────────
  { name: "phrasebook", group: "reference", summary: "print the claim-form table straight from the `CLAIM_FORMS` registry" },
  { name: "hooks", group: "reference", usage: "[--check]", summary: "print the journal-instruction hook block; `--check` asks whether it has ever FIRED" },
  { name: "hook", group: "reference", usage: "<event>", summary: "the hook BODY, invoked by the harness rather than by you" },
];

/** Every command name, in registry order. The `<a|b|c>` list — aliases excluded. */
export const commandNames = (): string[] => COMMANDS.map((c) => c.name);

/** Every token the dispatch must accept: names AND aliases. The totality oracle compares
 *  THIS against the `cmd === "…"` literals it reads out of cli.ts. */
export const dispatchTokens = (): string[] => COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);

/** Groups in first-appearance order, each with the commands that declared it. */
const grouped = (): { group: CommandGroup; title: string; cmds: Command[] }[] => {
  const order: CommandGroup[] = [];
  for (const c of COMMANDS) if (!order.includes(c.group)) order.push(c.group);
  return order.map((g) => ({ group: g, title: GROUP_TITLE[g], cmds: COMMANDS.filter((c) => c.group === g) }));
};

/** Strip the markdown the README wants and the terminal does not. The summaries are
 *  authored once, in markdown, and this is the banner's projection of them. */
const plain = (s: string) => s.replace(/`/g, "");

/** Cross-command notes: flags that belong to no single verb. Authored, deliberately — they
 *  are not commands, so the registry has nothing to say about them. */
const BANNER_NOTES = [
  '  an alias: `resolve` is accepted for `resolved`.',
  '  --raise [--raise-cap N] lets an ADVISORY open a conjecture instead of printing one',
  '                          (default cap 3/run, opt-in, gates nothing).',
];

/**
 * SPELLING ONE — the usage banner, printed to stderr when the verb is unknown or absent.
 * Derived in full: there is no command-name string literal left in cli.ts's help text, so
 * the banner cannot be 29 while the dispatch is 30, and two branches editing different
 * commands can no longer conflict on one line.
 */
export function usageBanner(): string[] {
  const names = commandNames().join("|");
  const lines = [`usage: coherence <${names}> [options]`];
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  for (const { title, cmds } of grouped()) {
    lines.push("", `  ${title}`);
    for (const c of cmds) {
      // Short arg shapes sit on the command's own line; long ones (the journal verbs run to
      // 70+ chars) wrap to a continuation so the summary column stays readable.
      const u = c.usage ? ` ${c.usage}` : "";
      const head = `    ${c.name.padEnd(width)}${u}`;
      if (head.length <= 46) lines.push(`${head.padEnd(46)}  ${plain(c.summary)}`);
      else lines.push(head, `${" ".repeat(46)}  ${plain(c.summary)}`);
    }
  }
  lines.push("", ...BANNER_NOTES.map(plain));
  return lines;
}

/**
 * SPELLING TWO — the README's command index, markers inclusive, ready for `spliceBlock`.
 *
 * A BULLET LIST, not a markdown table, and that is a real constraint rather than taste:
 * `redundancy` reads the first column of every markdown table as an enumerated domain, so
 * a generated table would hand it a fresh README↔dispatch pair to report — trading the
 * finding this change exists to remove for an identical one. A generated block that the
 * project's own detector still flags has not fixed anything.
 *
 * The block is an INDEX and nothing more: name, arg shape, one line. The authored
 * per-command reasoning lives OUTSIDE the markers, below the block, and is not expected to
 * cover every command — completeness is what the derivation owes, depth is what the prose
 * owes, and confusing the two is how the reference got twelve commands behind.
 */
export function renderCommandsBlock(): string {
  const md: string[] = [COMMANDS_BEGIN];
  md.push("<!-- GENERATED by `coherence docs` from the COMMAND registry (src/commands.ts). Do not");
  md.push("     edit by hand — add the command to the registry and re-run. Everything OUTSIDE these");
  md.push("     markers is authored prose. -->");
  md.push("");
  md.push(`_${COMMANDS.length} commands. This index is derived from the registry the dispatch is checked`);
  md.push("against (`test/commands.test.ts` enumerates the live `cmd === …` chain and asserts the two");
  md.push("sets are equal), so it cannot fall behind the CLI. The reasoning for the commands that have");
  md.push("any is in **In detail** below — that half is authored, and does not cover all of them._");
  for (const { title, cmds } of grouped()) {
    md.push("", `**${title}**`, "");
    for (const c of cmds) {
      const u = c.usage ? ` ${c.usage}` : "";
      const alias = c.aliases?.length ? ` (alias: ${c.aliases.map((a) => `\`${a}\``).join(", ")})` : "";
      md.push(`- \`coherence ${c.name}${u}\`${alias} — ${c.summary}`);
    }
  }
  md.push("");
  md.push(COMMANDS_END);
  return md.join("\n");
}

/**
 * The README's claim-form index, markers inclusive, ready for `spliceBlock` — the same
 * treatment the command index got, for the same defect: the hand-kept table listed 8 forms
 * while the registry carried 9 (`lives in` was missing entirely) and its boundary grammar
 * had lost the `[crossing <zone> -> <zone>]` clause. The README even predicted the drift
 * ("nothing compares it against the registry, so it *can* drift"). Now something does.
 *
 * A BULLET LIST, not a markdown table, for the reason renderCommandsBlock records:
 * `redundancy` reads the first column of every markdown table as an enumerated domain, so
 * a generated table would hand it a fresh README↔registry pair to report.
 *
 * The block is the GRAMMAR and nothing more: name, tier, grammar, example — the fields the
 * registry actually carries. The authored per-form reasoning (tier behavior under `--fast`,
 * the meta-oracle, skip-vs-fail semantics) lives OUTSIDE the markers, below the block.
 */
export function renderPhrasebookBlock(): string {
  const md: string[] = [PHRASEBOOK_BEGIN];
  md.push("<!-- GENERATED by `coherence docs` from the CLAIM_FORMS registry (src/phrasebook.ts). Do not");
  md.push("     edit by hand — change the registry and re-run. Everything OUTSIDE these markers is");
  md.push("     authored prose. -->");
  md.push("");
  md.push(`_${CLAIM_FORMS.length} claim forms, in registry order — **first match wins**, so this order IS the`);
  md.push("precedence. Derived from the same registry `evalClaim` executes (`coherence phrasebook`");
  md.push("prints it at the terminal), so it cannot drift from the grammar. The per-form notes below");
  md.push("the block are authored._");
  md.push("");
  for (const f of CLAIM_FORMS) {
    md.push(`- **${f.name}** [${f.tier}] — \`${f.grammar}\``);
    md.push(`  e.g. \`${f.example}\``);
  }
  md.push("");
  md.push(PHRASEBOOK_END);
  return md.join("\n");
}
