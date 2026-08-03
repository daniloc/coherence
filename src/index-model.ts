// index-model.ts — THE INDEX: what a human needs after the agents have been working.
//
// WHY THIS EXISTS. Every other browser artifact this harness emits is a DUMP OF EVERYTHING
// AT ONE MOMENT: `_graph.html` is 364KB of outline, `_overview.html` is every component's
// prose, `_contract.html` is the whole promise network. They are complete, they are
// correct, and they go unread — because a complete picture has no attention budget in it
// and no delta, so a returning human cannot tell what is NEW from what has been true for
// three weeks. The tooling has served the AGENT exhaustively and the HUMAN barely.
//
// THE THESIS: code-level diffs are not useful in LLM development. Thousands of lines move
// in an afternoon and reading them is not how anyone learns what happened. What you want
// is the diff of a HIGHER ABSTRACTION — the architecture and the system's design — plus
// the record of what the agents DECIDED and where they got STUCK. So: three views, no more.
//
//   MAP         the structures as they stand — the ORGANS, the regions, the guarded
//               crossings between them, the gates, and a TRUST reading. The crossings ARE a
//               picture: `from`/`to` are nodes, the guard's symbol names the arrow, `tier`
//               is how strong the guarantee is and `heat` is the traffic through it. The
//               render draws that (see render-index.ts); this model does not know it is
//               being drawn.
//
//               THE DIAGRAM ALONE SHOWED THE PLUMBING AND HID THE ORGANS. `authed-user`,
//               `storage`, `public-egress` are TOPOLOGY labels — true, and they explain
//               nothing about what the system is for. The MEANING is in the components,
//               which every project already names and DESCRIBES ("Meter — a windowed
//               counter, one bare Durable Object per scope name…"), and the Index was
//               burying that prose behind a drill-down. So `IndexComponent.intent` carries
//               the sentence and `IndexComponent.guards` carries the JOIN that says which
//               organ holds which piece of the perimeter — see `crossingOwners`. Neither is
//               a new source: the intent is the graph node's `sub`, the join is the graph's
//               own symbol → file → component parentage crossed with the atlas record.
//   JOURNAL     what the agents decided. `blocked` FIRST: an agent saying it could not do
//               something is the highest-value line a human can read, and no gate will
//               ever report it.
//   TRAJECTORY  movement, AT THE LEVEL OF THE ABSTRACTION — what changed in the
//               invariant/boundary set, not which files moved.
//
// ── THE RULES THIS FILE OBEYS, EACH LEARNED EXPENSIVELY ELSEWHERE IN THIS REPO ────────
//
// 1. DERIVE NOTHING NEW. Every number here comes from a derivation that already exists:
//    the graph (derive.ts), the promise model (promise.ts), the run record
//    (.coherence/status.json), the journals (decisions.ts), and evolution.ts's history
//    reads. Where a reading is OWNED by a command that writes artifacts — `drift`'s
//    trajectory windows, `atlas`'s tier grades — this reads the RECORD that command filed
//    and never re-computes it. A second spelling of a domain drifts; this repo has killed
//    that four times, and the newest instrument is the worst place to reintroduce it.
//
// 2. EVERY NUMBER CARRIES ITS DENOMINATOR, and an unread source is SAID OUT LOUD. A blank
//    section must never read as health — that is green-by-absence (floor.ts), the defect
//    this project spent a day eliminating. So the model carries `sources`, and a reading
//    that could not be taken is `total: null` (UNMEASURABLE) rather than `0`.
//
// 3. NOVELTY GATES THE LIST; SEVERITY ONLY ORDERS WHAT SURVIVES. An anomaly is NEWS, not
//    merely a bad thing. A three-day-old impasse the reader has seen on every visit is not
//    news, however severe. Hence the FRAME (see `resolveFrame`) and the `news` flag on
//    every journal entry.
//
// 4. THE WITHHELD TAIL IS STATED, NEVER SILENTLY TRUNCATED — raise.ts's cap/withheld
//    idiom, applied to a render. `capList` is the only place a list is shortened, and it
//    returns the withheld count so no caller can drop it by forgetting.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Config, Graph, GraphNode } from "./types.ts";
import type { PromiseModel, Grade } from "./promise-model.ts";
import { buildPromiseModel } from "./promise.ts";
import { isDocumented } from "./derive.ts";
import { claimedFilePaths } from "./tree.ts";
import { refutedInvariants } from "./walk.ts";
import { parseBoundary } from "./boundary.ts";
import { readStatus, gitStamp, type StatusRecord, type AtlasSection } from "./status.ts";
import { readJournal, resolve as resolveJournal, type DecisionRecord } from "./decisions.ts";
import { readCommitLog, fileChurn, gitPrefix, rebaseCommits, CHURN_WINDOW } from "./evolution.ts";
import { diffGraphs, graphAtRef, locDelta, type StructuralDiff } from "./structural.ts";
import { arrow } from "./drift.ts";
import { readJsonOrRefuse, Unrunnable } from "./floor.ts";

/** The artifact pair this command owns, under `outputDir`. `index.json` is the MODEL and
 *  `_index.html` is a pure function of it — so anything the page says can be checked
 *  against a file a `jq` one-liner can read, and the render is never the only witness. */
export const INDEX_JSON = "index.json";
/** The page itself. Underscore-prefixed like every other generated HTML render, so the
 *  walk skips it and the artifact never becomes a node in the graph it describes. */
export const INDEX_HTML = "_index.html";

// ── the cap idiom (raise.ts's, applied to a render) ───────────────────────────────────

/** A list that was shortened, WITH the count it withheld. There is no way to consume this
 *  and quietly drop the tail: the field is not optional. */
export interface Capped<T> { shown: T[]; withheld: number; total: number }

/** Shorten a list and SAY what was held back. The only truncation in this module.
 *  A cap of 0 means "count only" — a section that collapses to a number by design. */
export function capList<T>(xs: readonly T[], cap: number): Capped<T> {
  const shown = cap <= 0 ? [] : xs.slice(0, cap);
  return { shown, withheld: xs.length - shown.length, total: xs.length };
}

/**
 * THE CAPS, per section, each a claim about a reader's attention rather than about the
 * data. They are here together so the page's total length is one visible decision instead
 * of eight scattered ones — the page is for someone who has ten minutes, and a page that
 * grows without bound with the project is the artifact this one replaces.
 */
export const CAPS = {
  /** Gates worth listing individually. A grade-A passing gate is collapsed into its
   *  component's row; only the graded exceptions get a line. */
  gates: 24,
  /** Crossings. Tier-3 first — an undeclared junction is the one worth a row. */
  crossings: 16,
  /** Journal lists. `blocked` gets the most: it is the section the whole view leads with. */
  blocked: 12,
  open: 10,
  decisions: 10,
  /** Named subjects behind a darkness reading (which invariants are unwitnessed, …). */
  dark: 8,
  /** Structural changes per kind, in the trajectory. */
  structural: 12,
} as const;

// ── what was read, and what could not be ──────────────────────────────────────────────

/**
 * ONE SOURCE THIS PAGE TRIED TO READ. `ok: false` is the load-bearing case: a section
 * rendered from an unread source must say so, or its emptiness reads as health. `stale`
 * is the third state between them — a record that WAS read, honestly, but at a different
 * commit (status.ts's doctrine: the record is the last known truth, honestly dated).
 */
export interface SourceRead {
  name: string;
  ok: boolean;
  /** What it holds, or — when `ok` is false — WHY it could not be read, in a sentence. */
  detail: string;
  at?: string;
  commit?: string | null;
  stale?: boolean;
}

// ── the frame ─────────────────────────────────────────────────────────────────────────

/**
 * HOW "SINCE I LAST LOOKED" WAS DECIDED. Novelty gates every list on this page, so the
 * frame is the page's most consequential number and it is stated at the top rather than
 * assumed.
 *
 *   since   — an explicit `--since <ref>`. Always wins.
 *   cursor  — the HEAD the PREVIOUS index run recorded, read back out of `index.json`.
 *             This is what "since I last looked" actually means.
 *   tag     — the last tag, and only when it is not HEAD itself.
 *   first   — nothing to compare against. A FIRST LOOK HAS NO NEWS BY DEFINITION, and the
 *             page says that instead of dumping the project's whole history as if it were.
 *
 * THE ORDER WAS MEASURED, not assumed. "Since the last tag" was the briefed default and it
 * degenerates in both projects this was built against: in coherence the last tag IS HEAD
 * (v0.24.1 at d9053b8, `git rev-list --count v0.24.1..HEAD` = 0), so the frame is empty; in
 * the consuming project `git tag` is empty, so it does not resolve at all. A default that
 * fails in two of two measured projects is not a default — the cursor is, because it needs
 * no releases and no tags.
 */
export type FrameKind = "since" | "cursor" | "tag" | "first";

/** The resolved frame — which earlier state this page calls "then". */
export interface Frame {
  kind: FrameKind;
  /** The ref as a reader would type it (`v0.24.1`, a short commit) — null for a first look. */
  ref: string | null;
  /** The frame's start commit, resolved. */
  commit: string | null;
  /** ISO time of that commit — the cut the JOURNAL's novelty flag uses. Journal entries
   *  carry a wall-clock `at` and no reachability, so time is the only honest join. */
  at: string | null;
  /** Commits from the frame's start to HEAD, or null when it could not be counted. */
  commits: number | null;
  /** One sentence: how this frame was chosen, so the reader can disagree with it. */
  why: string;
}

// ── the MAP ───────────────────────────────────────────────────────────────────────────

/** One component's row. Every count here is paired with the denominator it is a count OF —
 *  `anchored` is meaningless beside `invariants` alone, and `accountedFiles` beside
 *  `files` is the trial balance the contract already prints. */
export interface IndexComponent {
  label: string;
  dir: string;
  /**
   * THE ORGAN'S OWN SENTENCE — the `# <Name>` heading's intent line from the component's
   * spec, straight off the graph node's `sub`. It is the best human-written prose in the
   * whole system and until now the Index buried it behind a drill-down while showing the
   * plumbing (`authed-user`, `storage`, `public-egress`) at glance level. Empty string when
   * the spec declares no intent line — that is a real state and it renders as one.
   */
  intent: string;
  zone: string | null;
  /**
   * THE CROSSINGS THIS COMPONENT OWNS — the atlas `sym`s whose chokepoint lives in a file
   * this component owns. See `crossingOwners`. Non-empty is the PERIMETER; empty is the
   * INTERIOR, and empty is a reading rather than a defect: a crossing is where trust
   * changes hands, and a component whose contract is entirely internal never takes that
   * transfer. Empty for EVERY component when no atlas ran — which is why the render tests
   * `atlas === null` before it says anything about the split.
   */
  guards: string[];
  files: number;
  lines: number;
  accountedFiles: number;
  claims: number;
  gates: number;
  /** The grade histogram — A..U. Rendered as a distribution, never as an average: the
   *  grade is ordinal and a mean over an ordinal is a number about nothing. */
  grades: Record<Grade, number>;
  /** Gates whose verdict is `fail` at the last recorded run. */
  breaches: number;
  invariants: number;
  anchored: number;
  witnessed: number;
  symbols: number;
  undocumented: number;
  /** Cross-component reliances with no gate on the wall they cross. */
  naked: number;
}

/** One gate, listed because it is NOT a fresh passing A. */
export interface IndexGate {
  comp: string;
  inv: string;
  chokepoint: string;
  verb: string;
  oracle: string;
  grade: Grade;
  verdict: "pass" | "fail" | "stale" | "unknown";
  crossing: { from: string; to: string } | null;
  reliants: number;
  witnessed: boolean;
}

/**
 * One atlas crossing, straight from the RECORD the atlas filed — plus the ONE joined field.
 *
 * `owner` is the component that owns the guard's chokepoint. It is a JOIN of two things the
 * model already holds (the atlas's `sym`, the graph's symbol → file → component parentage),
 * not a new derivation and not a new source: see `crossingOwners`. It is what lets the Map
 * answer "which organ holds this piece of the perimeter" in the same picture that shows
 * where the perimeter runs.
 */
export interface IndexCrossing {
  sym: string; from: string; to: string; tier: number;
  security: boolean; present: boolean; heat: number | null;
  /** The owning component's label, or null when the join could not land it. */
  owner: string | null;
  /** WHY there is no owner. Present exactly when `owner` is null, never otherwise —
   *  "no component owns this" and "this was never looked up" must not look alike. */
  ownerWhy?: string;
}

/**
 * ONE OF THE FOUR DARKNESSES. They are named separately and NEVER merged, because a single
 * "dark region" number is a lie: an undocumented symbol, a file no claim names, an
 * invariant nobody has watched fail, and a file being edited that the graph does not own
 * are four different problems with four different repairs.
 *
 * `total: null` means UNMEASURABLE — the reading could not be taken — and is rendered as
 * such. It is never rendered as a zero denominator, because 0/0 and 0/500 must not look
 * alike (floor.ts, in the harness's own words).
 */
export interface Darkness {
  key: "undocumented" | "unclaimed" | "unwitnessed" | "unvisited";
  label: string;
  /** What "dark" means for this reading, one clause. */
  what: string;
  dark: number;
  total: number | null;
  unit: string;
  /** Why `total` is null. Present exactly when it is. */
  unmeasurable?: string;
  /** The leading dark subjects, so the number is addressable rather than merely alarming. */
  worst: Capped<string>;
}

/** VIEW ONE: the structures as they stand. Components and their zones, the gates that are
 *  not quiet greens, the crossings where trust changes hands, and the trust reading. */
export interface MapView {
  components: IndexComponent[];
  zones: Array<{ name: string; intent: string; inside: string | null }>;
  gates: Capped<IndexGate>;
  /** Gates NOT listed because they are fresh passing A's — the greens, collapsed to a count. */
  gatesClean: number;
  gatesTotal: number;
  grades: Record<Grade, number>;
  crossings: Capped<IndexCrossing>;
  /** The atlas record's own verdict fields, or null when no atlas reading exists at all. */
  atlas: { at: string; stale: boolean; tiers: AtlasSection["tiers"]; drift: number; dangling: number; overclaimed: number; tier3Security: string[]; hazards: string[] } | null;
  darknesses: Darkness[];
}

// ── the JOURNAL ───────────────────────────────────────────────────────────────────────

/** One journal entry, flattened for rendering. `news` is the novelty gate: true when the
 *  entry was written inside the frame. */
export interface IndexEntry {
  id: string;
  kind: DecisionRecord["kind"];
  at: string;
  agent: string;
  session: string;
  commit: string | null;
  chose: string;
  because: string;
  over: string[];
  couldBe: string[];
  discriminatedBy: string;
  news: boolean;
}

/**
 * ONE RECORD AS A POINT IN TIME — the whole standing journal, uncapped, carrying no text.
 *
 * WHY THIS EXISTS BESIDE THE CAPPED LISTS. The journal renders as a TIMELINE, and a
 * timeline drawn from the capped lists would be a picture of the cap rather than of the
 * history: measured on the consuming project, the three lists carry 28 of 182 standing
 * records. Plotting 28 and labelling the axis with dates is the same green-by-absence shape
 * this page exists to refuse — the reader would take a quiet stretch for a quiet month.
 *
 * So NOVELTY and TIME are complete here while TEXT stays capped: `shown` says whether this
 * record's sentences are carried by one of the lists above, and a mark whose text was
 * withheld renders as a hairline tick that cannot be opened. The cap is still on attention
 * — a tick costs none — and the record is no longer misrepresented by it.
 */
export interface IndexMark {
  id: string;
  lane: "blocked" | "open" | "decision";
  at: string;
  news: boolean;
  /** True when one of the capped lists carries this record's text, so it can be opened. */
  shown: boolean;
}

/** VIEW TWO: what the agents decided, ordered by NEWS and led by impasses. */
export interface JournalView {
  /** BLOCKED FIRST. An agent recording that it could not do something is the single
   *  highest-value line here and no gate anywhere will ever report it. */
  blocked: Capped<IndexEntry>;
  open: Capped<IndexEntry>;
  decisions: Capped<IndexEntry>;
  /** EVERY standing record as a point on the time axis, oldest first. See `IndexMark`. */
  marks: IndexMark[];
  /** Settled work collapses to counts — that is what settled means. */
  settled: { resolved: number; dismissed: number; retracted: number; inFrame: number };
  totals: { blocked: number; open: number; decisions: number; records: number; sessions: number; unreadable: number };
  /** How many of each survived the novelty gate — the headline the reader acts on. */
  news: { blocked: number; open: number; decisions: number };
}

// ── the TRAJECTORY ────────────────────────────────────────────────────────────────────

/** The invariant/boundary movement across the frame — `coherence log`'s ledger, as data. */
export interface StructuralView {
  componentsAdded: Capped<string>;
  componentsRemoved: Capped<string>;
  invAdded: Capped<{ comp: string; inv: string }>;
  invRemoved: Capped<{ comp: string; inv: string }>;
  boundaryAdded: Capped<{ comp: string; inv: string; chokepoint: string; oracle: string }>;
  boundaryRemoved: Capped<{ comp: string; inv: string; chokepoint: string; oracle: string }>;
  boundaryRewired: Capped<{ comp: string; inv: string; before: string; after: string }>;
  claimDelta: Array<{ comp: string; added: number; removed: number }>;
  changes: number;
  losses: number;
}

/** VIEW THREE: movement at the level of the abstraction. Every field is nullable and each
 *  null carries its own reason, because "nothing moved" and "nothing was read" are
 *  different facts and a trajectory that confused them would be the worst lie on the page. */
export interface TrajectoryView {
  structural: StructuralView | null;
  /** Why the structural diff is absent, when it is. */
  structuralWhy: string | null;
  /** LOC added/deleted across the frame, over code files only (structural.ts's `locDelta`). */
  loc: { added: number; deleted: number } | null;
  /** The long net-LOC-per-window series the mass ratchet recorded — the background trend
   *  the frame sits inside. From the RECORD, with its stamp. */
  mass: { at: string; stale: boolean; series: number[] } | null;
  /** The architectural drift arrow, from the record `coherence drift` filed. */
  drift: { at: string; stale: boolean; locality: number[]; spread: number[]; verdict: string; localityArrow: string; spreadArrow: string } | null;
}

// ── the model ─────────────────────────────────────────────────────────────────────────

/** THE MODEL. Written to `index.json` beside the page, so every figure rendered is
 *  checkable against a file, and so the next run has a cursor to frame against. */
export interface IndexModel {
  project: string;
  intent: string;
  generatedAt: string;
  head: { commit: string | null; dirty: boolean };
  frame: Frame;
  sources: SourceRead[];
  map: MapView;
  journal: JournalView;
  trajectory: TrajectoryView;
  /** TRUE when there is genuinely nothing to show — no components, no claims, no journal,
   *  no history. The page then says so in one sentence instead of rendering eight empty
   *  tables that read as a clean bill of health. */
  empty: boolean;
}

// ── git, narrowly ─────────────────────────────────────────────────────────────────────

const git = (cfg: Config, args: string[]) =>
  spawnSync("git", args, { cwd: cfg.root, encoding: "utf8" });

const gitLine = (cfg: Config, args: string[]): string | null => {
  const r = git(cfg, args);
  return r.status === 0 ? (r.stdout || "").trim() || null : null;
};

// ── the frame ─────────────────────────────────────────────────────────────────────────

/** The prior run's HEAD, read back out of `index.json` — the CURSOR.
 *
 *  Through `readJsonOrRefuse` and not a `catch → null`, because this file is a MEMORY in
 *  exactly floor.ts's sense: an unreadable one is not an absent one. Defaulting past a
 *  corrupt index.json would silently retitle the page "FIRST LOOK — no prior index" for a
 *  project that has one, which is the page lying about its own frame. */
export async function readCursor(cfg: Config): Promise<{ commit: string | null } | null> {
  const prior = await readJsonOrRefuse<{ head?: { commit?: string | null } }>(
    join(cfg.root, cfg.outputDir, INDEX_JSON),
    {
      label: `${cfg.outputDir}/${INDEX_JSON}`,
      what: "the previous Index run's model — its HEAD is the cursor this page frames news against",
      absentMeans: "no index has been rendered yet, which is a FIRST LOOK and is stated as one",
      consequence: [
        `framing this page as a FIRST LOOK for a project that already has an index, which`,
        `means every standing decision and every old impasse is re-reported as news — the`,
        `precise noise that makes a "since I last looked" view stop being read.`,
      ],
    },
  );
  const commit = prior?.head?.commit ?? null;
  return commit ? { commit } : null;
}

/** Does this ref resolve to a commit in THIS repo? A cursor from a rebased or squashed
 *  history names a commit that is gone, and framing against a commit git cannot find would
 *  silently produce an empty diff that reads as "nothing changed". */
const resolves = (cfg: Config, ref: string): boolean =>
  git(cfg, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0;

/** Pick the frame. See the `Frame` doctrine above for why the order is what it is. */
export function resolveFrame(cfg: Config, opts: { since?: string | null; cursor?: string | null }): Frame {
  const none = (why: string): Frame => ({ kind: "first", ref: null, commit: null, at: null, commits: null, why });

  if (!gitLine(cfg, ["rev-parse", "--git-dir"])) {
    return none("no git repository here, so there is no earlier state to frame against — everything below is the CURRENT reading and none of it is news.");
  }

  const build = (kind: Exclude<FrameKind, "first">, ref: string, why: string): Frame => ({
    kind, ref,
    commit: gitLine(cfg, ["rev-parse", "--short", ref]),
    at: gitLine(cfg, ["log", "-1", "--format=%cI", ref]),
    commits: Number(gitLine(cfg, ["rev-list", "--count", `${ref}..HEAD`]) ?? NaN) || 0,
    why,
  });

  if (opts.since) {
    if (!resolves(cfg, opts.since)) {
      return none(`--since ${opts.since} does not resolve to a commit in this repository, so nothing could be framed against it. Naming a ref that exists (\`git rev-parse ${opts.since}\` proves it) restores the delta.`);
    }
    return build("since", opts.since, `you asked for it: --since ${opts.since}.`);
  }

  if (opts.cursor && resolves(cfg, opts.cursor)) {
    return build("cursor", opts.cursor, "the HEAD this Index recorded the last time it ran — literally since you last looked.");
  }

  const tag = gitLine(cfg, ["describe", "--tags", "--abbrev=0"]);
  const head = gitLine(cfg, ["rev-parse", "HEAD"]);
  if (tag && gitLine(cfg, ["rev-list", "-n1", tag]) !== head) {
    return build("tag", tag, `no prior index to frame against, so the last tag (${tag}) stands in.`);
  }

  return none(
    opts.cursor
      ? "the previous Index recorded a commit this repository no longer has (a rebase, a squash, a fresh clone), and no tag stands before HEAD — so there is no earlier state to frame against."
      : tag
        ? `no prior index, and the last tag (${tag}) IS HEAD — there is nothing between them. A FIRST LOOK has no news by definition: everything below is the standing state, not a delta.`
        : "no prior index and no tags in this repository. A FIRST LOOK has no news by definition: everything below is the standing state, not a delta.",
  );
}

// ── the MAP ───────────────────────────────────────────────────────────────────────────

const ZERO_GRADES = (): Record<Grade, number> => ({ A: 0, B: 0, C: 0, D: 0, U: 0 });

/**
 * THE FOUR DARKNESSES, each with its own denominator and its own repair.
 *
 * `unvisited` is the one that needs history, and it is therefore the one that can be
 * UNMEASURABLE. It is the complement of economy's closure: a path recent concern commits
 * keep touching that the graph does not own is a path no closure can ever be computed for,
 * so every read-side cost this harness reports silently excludes it. That is why it is a
 * darkness and not merely a statistic.
 */
export function darknesses(
  cfg: Config, graph: Graph,
  churn: { paths: string[]; considered: number } | null,
): Darkness[] {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const symbols = graph.nodes.filter((n) => n.kind === "symbol");
  const fileNodes = graph.nodes.filter((n) => n.kind === "file");
  const pathOf = (f: GraphNode) => f.path ?? f.label;

  // 1. UNDOCUMENTED — derive.ts's single `isDocumented`, the same predicate verify's
  //    coverage line and mass's `undocumented|symbols` dimension read.
  const undoc = symbols.filter((s) => !isDocumented(s));

  // 2. UNCLAIMED — tree.ts's `claimedFilePaths`, the ONE definition of which file a claim
  //    blesses. Files with no owning component cannot be blessed by anything, so they are
  //    dark by construction and are counted here rather than dropped.
  const filesByDir = new Map<string, GraphNode[]>();
  for (const f of fileNodes) {
    const k = (f.parent ?? "").slice(2);
    (filesByDir.get(k) ?? filesByDir.set(k, []).get(k)!).push(f);
  }
  const unclaimed: string[] = [];
  for (const [dir, files] of filesByDir) {
    const comp = comps.find((c) => c.id === `c:${dir}`);
    const blessed = comp ? claimedFilePaths(comp.claims ?? [], files) : new Set<string>();
    for (const f of files) if (!blessed.has(pathOf(f))) unclaimed.push(pathOf(f));
  }

  // 3. UNWITNESSED — an invariant with no `## refutations` entry. LEAD WITH THIS ONE: a
  //    green claim and an unfalsifiable one are indistinguishable from outside, and this
  //    is the only reading on the page that separates them.
  const unwitnessed: string[] = [];
  let invTotal = 0;
  for (const c of comps) {
    const witnessed = refutedInvariants(c.refutations);
    for (const inv of c.invariants ?? []) {
      invTotal++;
      if (!witnessed.has(inv)) unwitnessed.push(`${c.label} — ${inv}`);
    }
  }

  // 4. UNVISITED — churn with no reading closure: a path recent work keeps touching that
  //    the graph does not own.
  const owned = new Set(fileNodes.map(pathOf));
  const unvisited = churn ? churn.paths.filter((p) => !owned.has(p)).sort() : [];

  return [
    {
      key: "unwitnessed", label: "unwitnessed",
      what: "invariants with no observed negative control — nothing has ever been seen to break them",
      dark: unwitnessed.length, total: invTotal || null, unit: "declared invariants",
      unmeasurable: invTotal ? undefined : "no component declares a `## invariants` section, so there is nothing that could be witnessed.",
      worst: capList(unwitnessed.sort(), CAPS.dark),
    },
    {
      key: "unclaimed", label: "unclaimed",
      what: "files no claim names — code inside the map that nothing in the spec points at",
      dark: unclaimed.length, total: fileNodes.length || null, unit: "files in the graph",
      unmeasurable: fileNodes.length ? undefined : "the graph derived no files, so there is no population to be claimed.",
      worst: capList(unclaimed.sort(), CAPS.dark),
    },
    {
      key: "undocumented", label: "undocumented",
      what: "symbols with no docblock — meaning a reader has to derive from the body",
      dark: undoc.length, total: symbols.length || null, unit: "symbols",
      unmeasurable: symbols.length ? undefined : "the graph derived no symbols, so there is nothing to document.",
      worst: capList(undoc.map((s) => `${s.path ?? ""}#${s.label}`).sort(), CAPS.dark),
    },
    {
      key: "unvisited", label: "unvisited",
      what: "paths recent work keeps touching that the graph does not own — no closure can be computed for them, so every read-cost figure here excludes them",
      dark: unvisited.length,
      total: churn ? churn.paths.length || null : null,
      unit: "paths touched in the concern band",
      unmeasurable: churn
        ? (churn.paths.length ? undefined : `no commit in the last ${CHURN_WINDOW} carried a concern signal, so nothing was touched to be visited.`)
        : `history could not be read here (${cfg.root} is not inside a git repository, or git declined), so churn is UNMEASURED — not zero.`,
      worst: capList(unvisited, CAPS.dark),
    },
  ];
}

/**
 * WHICH COMPONENT OWNS EACH GUARDED CROSSING — the join that turns a topology diagram into
 * a roster of organs. `symbolDir` is label → the dirs of the components owning a symbol of
 * that name; it comes from the graph's OWN parentage (symbol → file → component), which is
 * the same chain `symbolsByDir` walks a few lines above. Longest-matching-dir-prefix over
 * the symbol's `path` gives the identical answer on the consuming project (14/14, checked
 * crossing by crossing) and would be a SECOND spelling of component ownership; this file's
 * rule 1 forbids that, so the existing chain is read instead of a new one written.
 *
 * THE TWO WAYS IT DOES NOT LAND, each named rather than collapsed into a shrug:
 *   · the guard's symbol is nowhere in the graph — an anchor pointing at code that is not
 *     there, which is precisely the `present: false` DANGLING state the atlas already
 *     grades. The crossing keeps its arrow and its row; nothing pretends to own it.
 *   · the name resolves inside more than one component. Then no component owns it MORE than
 *     the others and picking one would be inventing a fact. It is AMBIGUOUS, it says which
 *     components it could be, and it counts toward nobody's perimeter.
 */
export function crossingOwners(
  crossings: readonly { sym: string; present: boolean }[],
  symbolDir: ReadonlyMap<string, ReadonlySet<string>>,
  labelByDir: ReadonlyMap<string, string>,
): Map<string, { owner: string | null; dir: string | null; why?: string }> {
  const out = new Map<string, { owner: string | null; dir: string | null; why?: string }>();
  for (const c of crossings) {
    const dirs = [...(symbolDir.get(c.sym) ?? [])].filter((d) => labelByDir.has(d));
    if (dirs.length === 1) { out.set(c.sym, { owner: labelByDir.get(dirs[0])!, dir: dirs[0] }); continue; }
    if (dirs.length === 0) {
      out.set(c.sym, {
        owner: null, dir: null,
        why: `no component owns a symbol named \`${c.sym}\`${c.present ? "" : " — the atlas already grades this chokepoint DANGLING"}, so this crossing counts toward nobody's perimeter.`,
      });
      continue;
    }
    const names = dirs.map((d) => labelByDir.get(d)!).sort();
    out.set(c.sym, {
      owner: null, dir: null,
      why: `\`${c.sym}\` resolves in ${names.length} components (${names.join(", ")}), so no one of them owns it more than the others. AMBIGUOUS, and it counts toward nobody's perimeter rather than toward an arbitrary one.`,
    });
  }
  return out;
}

/** The MAP, assembled from the promise model (components, zones, gates, grades), the graph
 *  (the darknesses) and the atlas RECORD (the crossings). */
export function buildMap(
  cfg: Config, graph: Graph, promise: PromiseModel, status: StatusRecord,
  head: string | null, churn: { paths: string[]; considered: number } | null,
): MapView {
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const nodeByDir = new Map(comps.map((c) => [c.id.slice(2), c]));
  const symbolsByDir = new Map<string, GraphNode[]>();
  // label → the dirs of every component holding a symbol of that name. ONE walk feeds both
  // the per-component symbol counts and the guard→organ join; see `crossingOwners`.
  const symbolDir = new Map<string, Set<string>>();
  const fileParent = new Map(graph.nodes.filter((n) => n.kind === "file").map((f) => [f.id, (f.parent ?? "").slice(2)]));
  for (const s of graph.nodes) {
    if (s.kind !== "symbol" || !s.parent) continue;
    const dir = fileParent.get(s.parent) ?? "";
    (symbolsByDir.get(dir) ?? symbolsByDir.set(dir, []).get(dir)!).push(s);
    (symbolDir.get(s.label) ?? symbolDir.set(s.label, new Set()).get(s.label)!).add(dir);
  }

  const grades = ZERO_GRADES();
  const gateRows: IndexGate[] = [];
  let gatesClean = 0, gatesTotal = 0;

  // THE JOIN, taken before the component rows are built, because each row carries the
  // crossings it owns and the ROSTER'S ORDER is a function of that.
  const labelByDir = new Map(promise.components.map((pc) => [pc.dir, pc.label]));
  const owners = crossingOwners(status.atlas?.crossings ?? [], symbolDir, labelByDir);
  const guardsOf = new Map<string, string[]>();
  for (const c of status.atlas?.crossings ?? []) {
    const d = owners.get(c.sym)?.dir;
    if (d !== null && d !== undefined) (guardsOf.get(d) ?? guardsOf.set(d, []).get(d)!).push(c.sym);
  }

  const components: IndexComponent[] = promise.components.map((pc) => {
    const node = nodeByDir.get(pc.dir);
    const witnessed = refutedInvariants(node?.refutations);
    const anchoredInv = new Set((node?.claims ?? []).map(parseBoundary).filter(Boolean).map((b) => b!.inv));
    const invs = node?.invariants ?? [];
    const g = ZERO_GRADES();
    let breaches = 0;
    for (const gate of pc.gates) {
      gatesTotal++;
      g[gate.grade]++; grades[gate.grade]++;
      if (gate.verdict === "fail") breaches++;
      // THE GREENS COLLAPSE TO A COUNT — where GREEN means "a machine oracle ran and it
      // passed", which is grades A (fresh) and B (aging) alike. Everything else earns a
      // line, and the exception list is exactly the four things a returning human should
      // look at: a FAIL, a C (human-judged, or declared with no verdict yet), a D (declared,
      // never verified) and a U (the record shows a skip — the claim could not even be read).
      //
      // B WAS ORIGINALLY EXCLUDED FROM THE COLLAPSE AND THE FIRST REAL RUN REFUTED IT. On
      // the 14-component consuming project the verify record was filed at another commit —
      // the ordinary state of any tree with uncommitted work — so all 47 machine-checked
      // gates degraded to `stale`/B at once and the collapse fired ZERO times, producing 47
      // rows carrying one bit between them. That is render-contract.ts's alarm-flood finding
      // arriving a second time. Staleness is a fact about the RECORD, not about a gate: it
      // is stated once, loudly, in the sources strip, and repeating it per row buys nothing.
      if ((gate.grade === "A" || gate.grade === "B") && gate.verdict !== "fail") { gatesClean++; continue; }
      gateRows.push({
        comp: pc.label, inv: gate.inv, chokepoint: gate.chokepoint, verb: gate.verb,
        oracle: gate.oracle, grade: gate.grade, verdict: gate.verdict,
        crossing: gate.crossing, reliants: gate.reliants.length,
        witnessed: witnessed.has(gate.inv),
      });
    }
    const syms = symbolsByDir.get(pc.dir) ?? [];
    return {
      label: pc.label, dir: pc.dir,
      // The intent line the spec's `# <Name>` heading already carries. `sub` on the
      // component node IS that line — derive.ts put it there and `_overview.html` has been
      // printing it all along; the Index simply stops hiding it.
      intent: node?.sub ?? "",
      zone: pc.zone,
      guards: (guardsOf.get(pc.dir) ?? []).slice().sort(),
      files: pc.mass.files, lines: pc.mass.lines,
      accountedFiles: pc.accounted.files,
      claims: node?.claims?.length ?? 0,
      gates: pc.gates.length, grades: g, breaches,
      invariants: invs.length,
      anchored: invs.filter((i) => anchoredInv.has(i)).length,
      witnessed: invs.filter((i) => witnessed.has(i)).length,
      symbols: syms.length,
      undocumented: syms.filter((s) => !isDocumented(s)).length,
      naked: pc.relies.filter((r) => r.via === null && r.crossing !== null && r.crossing.from !== r.crossing.to).length,
    };
  });

  // SEVERITY ORDERS WHAT SURVIVED THE COLLAPSE: a breach first, then the weakest grade,
  // then the gate carrying the most reliants (a demoted promise is felt by everyone
  // holding it — the contract's double-entry, read as an ordering).
  const gradeRank: Record<Grade, number> = { U: 0, D: 1, C: 2, B: 3, A: 4 };
  gateRows.sort((a, b) =>
    Number(b.verdict === "fail") - Number(a.verdict === "fail")
    || gradeRank[a.grade] - gradeRank[b.grade]
    || b.reliants - a.reliants
    || a.comp.localeCompare(b.comp) || a.inv.localeCompare(b.inv));

  // THE ROSTER'S ORDER, and it is DERIVED so that reading it top to bottom teaches the
  // shape of the system: the components holding the most of the trust perimeter first, down
  // through the ones holding one crossing, then the INTERIOR — everything that owns none.
  // Alphabetical would order by an accident of naming; spec-tree order (dir sort, entry
  // first) orders by where the files happen to sit. Neither says anything. This says: here
  // is who takes the trust transfers, in order of how much of that they take.
  //
  // The sort is STABLE and the only key is the guard count, so spec-tree order survives
  // intact inside each band — the split is the ONLY thing this reorders. Measured: 6/8 on
  // the consuming project (perimeter hoist-chat 5, auth 4, env 2, then web, Patient, model
  // at 1 each). With NO atlas record every count is 0, the order is unchanged, and the
  // render says the split is UNREAD rather than calling everything interior.
  components.sort((x, y) => y.guards.length - x.guards.length);

  const a = status.atlas;
  // Tier-3 first — an undeclared junction is the row worth having — then hottest first
  // within a tier. A crossing with NO heat reading sorts last rather than as cold: absence
  // is not zero (atlas.ts's rule, kept here so the two renders cannot disagree).
  const crossings: IndexCrossing[] = (a?.crossings ?? [])
    .map((c) => {
      const o = owners.get(c.sym) ?? { owner: null, why: "this crossing was not looked up." };
      return {
        sym: c.sym, from: c.from, to: c.to, tier: c.tier, security: c.security, present: c.present,
        heat: typeof c.heat === "number" ? c.heat : null,
        owner: o.owner, ...(o.owner === null ? { ownerWhy: o.why } : {}),
      };
    })
    // ASCENDING by tier — the STRONGEST crossing leads. It sorted descending, which put
    // the single enshrined crossing LAST and therefore first in line for any cap: on a
    // project that grew to 18 crossings the tier-1 `OwnedScope` edge was silently dropped
    // and the spine was then derived from what survived, losing a stage. A cap that eats
    // the most important row first is worse than no cap.
    .sort((x, y) =>
      x.tier - y.tier
      || Number(y.security) - Number(x.security)
      || (y.heat ?? -1) - (x.heat ?? -1)
      || x.sym.localeCompare(y.sym));

  return {
    components,
    zones: promise.zones.map((z) => ({ name: z.name, intent: z.intent, inside: z.inside })),
    gates: capList(gateRows, CAPS.gates),
    gatesClean, gatesTotal, grades,
    // NOT CAPPED, deliberately. A truncated LIST is honest — it says "and 4 more". A
    // truncated DIAGRAM is a lie: it draws a shape and omits the part that would change
    // it, and the spine here is DERIVED from the crossings it is given. The table below
    // the figure is a list and may cap; the figure draws everything or it misleads.
    crossings: capList(crossings, crossings.length),
    atlas: a ? {
      at: a.at, stale: !!(head && a.commit && a.commit !== head),
      tiers: a.tiers, drift: a.drift.length, dangling: a.dangling.length,
      overclaimed: a.overclaimed.length, tier3Security: a.tier3Security, hazards: a.hazards ?? [],
    } : null,
    darknesses: darknesses(cfg, graph, churn),
  };
}

// ── the JOURNAL ───────────────────────────────────────────────────────────────────────

/**
 * IS `a` AT OR AFTER `b` — ON THE CLOCK, not in the alphabet.
 *
 * FOUND BY DOGFOODING, and it had shipped: the novelty gate compared the two ISO strings
 * directly, and the two sides do not come from the same producer. Git's `%cI` carries a
 * NUMERIC OFFSET (`2026-07-31T02:49:18-04:00`) while a journal record carries `Z`, so a
 * lexicographic compare reads the offset's digits as time-of-day. Measured on the consuming
 * project: two impasses written at 02:54Z and 03:24Z were flagged NEW against a frame that
 * opened at 06:49Z — four hours of history reported as news, in the one gate whose entire
 * job is separating news from standing. The timeline is what exposed it: the marks were
 * drawn LEFT of the frame rule and outlined as news in the same picture.
 *
 * Falls back to the string compare only when a stamp does not parse at all, so a malformed
 * record degrades to the old behaviour instead of silently becoming "not news".
 */
const atOrAfter = (a: string, b: string): boolean => {
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x >= y : a >= b;
};

const toEntry = (r: DecisionRecord, cut: string | null): IndexEntry => ({
  id: r.id, kind: r.kind, at: r.at, agent: r.agent, session: r.session, commit: r.commit,
  chose: r.chose, because: r.because, over: r.over ?? [], couldBe: r.couldBe ?? [],
  discriminatedBy: r.discriminatedBy ?? "",
  // TIME, not reachability. A journal record carries a wall-clock stamp and a commit that
  // may be on a branch that never merged, so "was this written after the frame opened" is
  // the only join that is both cheap and honest. It over-reports across a long-lived
  // branch and under-reports nothing, which is the right way round for a novelty gate.
  news: cut !== null && atOrAfter(r.at, cut),
});

/**
 * THE JOURNAL VIEW — `blocked` first, then open conjectures, then decisions; settled work
 * collapses to counts.
 *
 * NEWS FIRST WITHIN EACH SECTION, and this is the whole behavioural point: a three-day-old
 * impasse the reader has already seen is not news however severe it is, so it sinks below
 * the entries written inside the frame rather than being dropped (it is still standing, and
 * a standing impasse that vanished from the page would be worse than one that scrolled).
 */
export function buildJournal(records: DecisionRecord[], sessions: number, unreadable: number, cut: string | null): JournalView {
  const { standing, blocked, open, resolved, dismissed, retracted } = resolveJournal(records);
  const order = (xs: DecisionRecord[]) => xs
    .map((r) => toEntry(r, cut))
    .sort((a, b) => Number(b.news) - Number(a.news) || b.at.localeCompare(a.at));

  const b = order(blocked), o = order(open), d = order(standing);
  const inFrame = cut === null ? 0
    : [...resolved, ...dismissed, ...retracted].filter((s) => atOrAfter(s.by.at, cut)).length;

  // THE MARKS — every standing record, uncapped, text-free. `shown` is read off the SAME
  // cap the lists use rather than restated, so a cap change can never desynchronise the two
  // (a mark advertised as openable with nothing behind it is a dead click).
  const marks: IndexMark[] = [];
  for (const [xs, lane, cap] of [[b, "blocked", CAPS.blocked], [o, "open", CAPS.open], [d, "decision", CAPS.decisions]] as const) {
    xs.forEach((e, i) => marks.push({ id: e.id, lane, at: e.at, news: e.news, shown: i < cap }));
  }
  marks.sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));

  return {
    blocked: capList(b, CAPS.blocked),
    open: capList(o, CAPS.open),
    decisions: capList(d, CAPS.decisions),
    marks,
    settled: { resolved: resolved.length, dismissed: dismissed.length, retracted: retracted.length, inFrame },
    totals: {
      blocked: b.length, open: o.length, decisions: d.length,
      records: records.length, sessions, unreadable,
    },
    news: {
      blocked: b.filter((x) => x.news).length,
      open: o.filter((x) => x.news).length,
      decisions: d.filter((x) => x.news).length,
    },
  };
}

// ── the TRAJECTORY ────────────────────────────────────────────────────────────────────

const fmtBoundary = (b: { chokepoint: string; verb: string; oracle: string }) =>
  `${b.chokepoint}${b.oracle ? ` via ${b.verb} "${b.oracle}"` : ""}`;

/** `coherence log`'s structural ledger, as data rather than as printed lines. */
export function structuralView(d: StructuralDiff): StructuralView {
  const losses = d.componentsRemoved.length + d.invRemoved.length + d.boundaryRemoved.length + d.parityRemoved.length;
  const changes = losses + d.componentsAdded.length + d.invAdded.length + d.boundaryAdded.length
    + d.boundaryRewired.length + d.parityAdded.length + d.parityRewired.length;
  return {
    componentsAdded: capList(d.componentsAdded, CAPS.structural),
    componentsRemoved: capList(d.componentsRemoved, CAPS.structural),
    invAdded: capList(d.invAdded, CAPS.structural),
    invRemoved: capList(d.invRemoved, CAPS.structural),
    boundaryAdded: capList(d.boundaryAdded.map((x) => ({ comp: x.comp, inv: x.b.inv, chokepoint: x.b.chokepoint, oracle: x.b.oracle })), CAPS.structural),
    boundaryRemoved: capList(d.boundaryRemoved.map((x) => ({ comp: x.comp, inv: x.b.inv, chokepoint: x.b.chokepoint, oracle: x.b.oracle })), CAPS.structural),
    boundaryRewired: capList(d.boundaryRewired.map((x) => ({ comp: x.comp, inv: x.inv, before: fmtBoundary(x.before), after: fmtBoundary(x.after) })), CAPS.structural),
    claimDelta: d.claimDelta,
    changes, losses,
  };
}

// ── assembly ──────────────────────────────────────────────────────────────────────────

/** What the CLI hands the model builder: the reader's frame override, and the run stamp
 *  (so the model owns no clock of its own and the render is a pure function of it). */
export interface IndexOpts {
  /** `--since <ref>`. Overrides the stored cursor. */
  since?: string | null;
  /** The render stamp, supplied by the CLI so the model has no clock of its own. */
  stamp: string;
}

/**
 * BUILD THE MODEL. Every history read is INDIVIDUALLY guarded and individually reported:
 * a project with no git is a perfectly ordinary consumer (a shallow CI clone, a source
 * export), and one unreadable source must cost that source's section, never the page. An
 * `Unrunnable` thrown by the structural diff is caught HERE rather than at the CLI's total
 * handler for exactly that reason — the CLI's handler is the right answer for a command
 * whose whole job needs history, and the wrong one for a page with three views.
 */
export async function buildIndexModel(cfg: Config, graph: Graph, opts: IndexOpts): Promise<IndexModel> {
  const status = await readStatus(cfg);
  const head = gitStamp(cfg.root);
  const promise = await buildPromiseModel(cfg, graph, status);
  const cursor = await readCursor(cfg);
  const frame = resolveFrame(cfg, { since: opts.since ?? null, cursor: cursor?.commit ?? null });

  const sources: SourceRead[] = [];
  const comps = graph.nodes.filter((n) => n.kind === "component");
  const claimCount = comps.reduce((n, c) => n + (c.claims?.length ?? 0), 0);
  sources.push({
    name: "graph",
    ok: comps.length > 0,
    detail: comps.length
      ? `${comps.length} component(s), ${claimCount} claim(s), ${graph.nodes.filter((n) => n.kind === "file").length} file(s) derived from the spec tree`
      : "the walk found no *.spec.md declaring a component, so there is no map to draw. `coherence verify` prints the adoption ladder for this state.",
  });
  sources.push({
    name: ".coherence/status.json — verify",
    ok: !!status.verify,
    detail: status.verify
      ? `${status.verify.claims.length} claim verdict(s), ${status.verify.failures} failure(s), tier ${status.verify.tier}`
      : "no verify has ever filed a report here, so every gate below carries the grade its DECLARATION earns and no verdict at all.",
    at: status.verify?.at, commit: status.verify?.commit,
    stale: !!(head.commit && status.verify && status.verify.commit !== head.commit),
  });
  sources.push({
    name: ".coherence/status.json — atlas",
    ok: !!status.atlas,
    detail: status.atlas
      ? `${status.atlas.crossings.length} crossing(s) graded`
      : "no atlas reading recorded — either this project declares no `atlas` config, or `coherence atlas` has not run. The crossings table is EMPTY BECAUSE NOTHING WAS READ, not because there are none.",
    at: status.atlas?.at, commit: status.atlas?.commit,
    stale: !!(head.commit && status.atlas && status.atlas.commit !== head.commit),
  });

  // HISTORY. One read, shared by the churn darkness and the trajectory's LOC delta.
  let churn: { paths: string[]; considered: number } | null = null;
  if (head.commit === null) {
    sources.push({
      name: "git history",
      ok: false,
      detail: `${cfg.root} is not inside a git repository (or it has no commits), so nothing here has a past: the frame, the churn reading and the structural diff are all UNMEASURED rather than empty.`,
    });
  } else {
    const { byFile, considered } = fileChurn(rebaseCommits(readCommitLog(cfg, CHURN_WINDOW), gitPrefix(cfg)));
    churn = { paths: [...byFile.keys()], considered };
    sources.push({
      name: "git history",
      ok: true,
      detail: `${considered} concern-carrying commit(s) in the last ${CHURN_WINDOW}, touching ${byFile.size} path(s)`,
      commit: head.commit,
    });
  }

  const { records, sessions, unreadable } = readJournal(cfg);
  sources.push({
    name: ".coherence/decisions",
    ok: records.length > 0,
    detail: records.length
      ? `${records.length} record(s) across ${sessions.length} session(s)${unreadable ? `, ${unreadable} line(s) UNREADABLE and skipped` : ""}`
      : "no journal here. Nothing recorded what the agents decided or where they got stuck — the most valuable half of this page has no source.",
  });

  const journal = buildJournal(records, sessions.length, unreadable, frame.at);

  // THE STRUCTURAL DIFF — the expensive one (a detached worktree plus a second graph
  // build), so it runs only when there is a frame to diff against.
  let structural: StructuralView | null = null;
  let structuralWhy: string | null = null;
  if (frame.commit === null) {
    structuralWhy = frame.why;
  } else {
    try {
      structural = structuralView(diffGraphs(await graphAtRef(cfg, frame.commit), graph));
      sources.push({ name: `structural diff vs ${frame.ref}`, ok: true, detail: `${structural.changes} structural change(s), ${structural.losses} loss(es)`, commit: frame.commit });
    } catch (e) {
      structuralWhy = e instanceof Unrunnable ? e.report[0].replace(/^\s*[✗·]\s*/, "") : String(e);
      sources.push({ name: `structural diff vs ${frame.ref}`, ok: false, detail: structuralWhy });
    }
  }

  const loc = frame.commit ? locDelta(cfg, frame.commit, null) : null;
  const m = status.mass;
  const d = status.drift;

  const trajectory: TrajectoryView = {
    structural, structuralWhy, loc,
    mass: m?.series?.locDelta?.length
      ? { at: m.at, stale: !!(head.commit && m.commit !== head.commit), series: m.series.locDelta }
      : null,
    drift: d?.locality.length
      ? {
        at: d.at, stale: !!(head.commit && d.commit !== head.commit),
        locality: d.locality, spread: d.spread, verdict: d.verdict,
        // drift.ts's own arrow, with drift.ts's own epsilons — imported, not restated.
        localityArrow: arrow(d.locality[0], d.locality[d.locality.length - 1], 0.03),
        spreadArrow: arrow(d.spread[0], d.spread[d.spread.length - 1], 0.15),
      }
      : null,
  };

  const map = buildMap(cfg, graph, promise, status, head.commit, churn);

  return {
    project: graph.root,
    intent: promise.intent,
    generatedAt: opts.stamp,
    head,
    frame,
    sources,
    map,
    journal,
    trajectory,
    // NOTHING TO SHOW is a state this page has to be able to NAME. The test is not "is the
    // project small" but "does any of the three views have a subject": no gate to grade, no
    // decision recorded, no history to move through. A project in that state gets one honest
    // sentence rather than eight empty tables a reader would take for a clean bill of health
    // — the degenerate-project case test/vacuity.test.ts enumerates every command against.
    empty: comps.length === 0 || (map.gatesTotal === 0 && records.length === 0 && churn === null),
  };
}
