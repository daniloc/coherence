// mass.ts — THE MASS RATCHET: how much machine there is, pinned.
//
// Every other ratchet in this harness counts a KIND OF DEBT — unguarded interpolation
// sinks, guards with no contract, over-claimed crossings. None of them counts the thing a
// reader of an agent-built repo actually asks first: how much is there NOW, and did it
// grow? A codebase does not decohere only by smearing concerns across boundaries; it also
// decoheres by quietly accumulating — a helper here, a dependency there, four hundred
// lines nobody chose. Each edit is defensible in isolation, which is exactly why the
// aggregate needs a pin rather than a review.
//
// SO THIS IS A RATCHET AND NOT A REPORT. `mass` alone prints the dimensions; `--check`
// compares them against `<outputDir>/mass-baseline.json` and FAILS on growth past the
// per-key tolerance; `--update-baseline` re-pins. The mechanics are conventions.ts's,
// deliberately identical — a second ratchet that behaves differently from the first is a
// second thing to learn.
//
// THE FAILURE MESSAGE PRESCRIBES `coherence decide`, and that is the whole design. A
// numeric diff ("lines|total 12,400 → 12,860") tells a reader what a `git diff --stat`
// already told them and settles nothing: the ratchet cannot know whether 460 lines bought
// a feature or an accident, and the only party who can say is the one who wrote them. So
// the gate's instruction is not "justify this to me", it is "write down what the new mass
// buys, then re-pin" — the movement gained parts, and the record should say who fitted
// them and why.
//
// TWO RULES THE DIMENSIONS THEMSELVES OBEY:
//
//   ABSENCE IS NOT EMPTINESS. No package.json means the `deps|direct`/`deps|dev`
//   dimensions are OMITTED, not reported as 0 — a project with no manifest and a project
//   with no dependencies are different facts, and a baseline that cannot tell them apart
//   turns "the lockfile disappeared" into "nice, zero transitive deps".
//
//   AN UNMEASURABLE MEASURE FAILS CLOSED. A project `measure` whose command exits
//   nonzero, or prints nothing a number can be read out of, is reported LOUDLY and fails
//   `--check` with exit 1. The tempting alternative — treat it as 0 and carry on — makes
//   a broken bundle probe read as a heroic size reduction, which is the single most
//   dangerous thing a growth ratchet can say.
//
//   A RENAME IS NOT GROWTH. A dimension's key embeds a NAME someone chose (a component's
//   spec H1, a measure's config key), so renaming the thing re-addresses its pin — and
//   before `reconcileMass`, a one-line H1 edit printed "the movement gained parts nobody
//   named" two lines under an UNCHANGED total (measured on hoist, 2026-07-30: 35 lines
//   relabeled, zero gained, SECURITY-adjacent gate red). The fix is lint-sinks's
//   count-conserving reconciliation, translated: an unmatched new key inherits a vanished
//   pin ONLY IF family, unit and EXACT value all match, and each vanished pin absorbs
//   exactly one. What this deliberately does NOT do: fuzzy value matching. A rename that
//   also changed the value absorbs nothing and still fails — the ratchet cannot tell
//   "renamed and grew" from "new component beside an unrelated deletion", and guessing
//   in the permissive direction is how growth gets laundered through renames.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Config, Graph, GraphNode } from "./types.ts";
import { readBaseline, writeBaseline } from "./sidecar.ts";
import { fileStats } from "./scene.ts";
import { isDocumented } from "./derive.ts";
import { spark } from "./drift.ts";
import { commitDeltas, locDeltaSeries, readCommitLog } from "./evolution.ts";
import { recordMass } from "./status.ts";
import { readJournal } from "./decisions.ts";
import { raiseFindings, formatRaise, type Finding } from "./raise.ts";

const BASELINE = "mass-baseline.json";
/** History window for the mass-over-time spark. Matches drift's — the same recent past,
 *  read once per process by the shared evolution memo. */
const HIST = 400;

/** Defaults applied AT THE CONSUMER (the REDUNDANCY_DEFAULTS pattern), so config.ts stays
 *  a loader and a project that never mentions `mass` gets the same behaviour as one that
 *  spells the defaults out. */
export const MASS_DEFAULTS = { deps: true, measures: [] as NonNullable<Config["mass"]>["measures"], tolerance: {} as Record<string, number> };

export interface MassDim { key: string; value: number; unit?: string }

/** A `measure` whose command could not produce a number. Kept as its own type rather than
 *  a `value: null` dimension: an unmeasurable probe is not a measurement with a missing
 *  field, and nothing downstream (baseline, tolerance, raise) should be able to treat it
 *  as one by forgetting a null check. */
export interface Unmeasurable { key: string; cmd: string[]; why: string }

// ── the dimensions ────────────────────────────────────────────────────────────────────

/** lines (total + per component), files, symbols — read from the graph the CLI already
 *  built plus one disk pass through `fileStats` (scene.ts's, the same one the towers use,
 *  so a file's height in the scene and its contribution here can never disagree). */
export async function structuralDims(cfg: Config, graph: Graph): Promise<MassDim[]> {
  const files = graph.nodes.filter((n) => n.kind === "file");
  const symbols = graph.nodes.filter((n) => n.kind === "symbol");
  const stats = await fileStats(cfg, files);
  const labelOf = new Map<string, string>();
  for (const n of graph.nodes) if (n.kind === "component") labelOf.set(n.id, n.label);
  const byComp = new Map<string, number>();
  let total = 0;
  for (const f of files as GraphNode[]) {
    const lines = stats.get(f.path ?? f.label)?.lines ?? 0;
    total += lines;
    // A baseline key is an ADDRESS a reader has to be able to type, so the fallback for a
    // file whose parent has no component node is the DIR (`c:` stripped), never the raw
    // graph id: `lines|src` is a place; `lines|c:src` is an internal identifier leaking
    // into a file people diff and quote at each other for the life of the project.
    const label = f.parent ? labelOf.get(f.parent) ?? f.parent.replace(/^c:/, "") : "(unowned)";
    byComp.set(label, (byComp.get(label) ?? 0) + lines);
  }
  return [
    { key: "lines|total", value: total, unit: "lines" },
    ...[...byComp.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, lines]) => ({ key: `lines|${label}`, value: lines, unit: "lines" })),
    { key: "files|total", value: files.length, unit: "files" },
    { key: "symbols|total", value: symbols.length, unit: "symbols" },
    // UNDECLARED SURFACE, pinned. `symbols|total` counts how much there is; this counts how
    // much of it a reader has to derive by reading the body — the inference mass the header
    // above says byte mass cannot see. The predicate is `derive.ts`'s single `isDocumented`,
    // the same one verify's coverage line and its `[doc]` jobs read: a symbol the advisory
    // calls undocumented is exactly one this key counts.
    { key: "undocumented|symbols", value: symbols.filter((s) => !isDocumented(s)).length, unit: "symbols" },
  ];
}

/** DEPENDENCY mass — the part of a codebase nobody wrote and everybody ships. Direct and
 *  dev come from package.json; transitive is the npm lockfile's `packages` map minus its
 *  root entry (`""`), which is v2/v3's own count of what actually installs.
 *
 *  An ABSENT file omits its dimensions entirely (see the header). A PRESENT file that
 *  cannot be read as expected — malformed JSON, or a v1 lockfile with no `packages` —
 *  also omits, and says so in `notes`: silence about a file that IS there would be the
 *  same lie in the other direction. */
export async function depDims(cfg: Config): Promise<{ dims: MassDim[]; notes: string[] }> {
  const dims: MassDim[] = [], notes: string[] = [];
  const pkgRaw = await readFile(join(cfg.root, "package.json"), "utf8").catch(() => null);
  if (pkgRaw !== null) {
    try {
      const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      dims.push({ key: "deps|direct", value: Object.keys(pkg.dependencies ?? {}).length, unit: "deps" });
      dims.push({ key: "deps|dev", value: Object.keys(pkg.devDependencies ?? {}).length, unit: "deps" });
    } catch { notes.push("package.json is present but will not parse — deps|direct / deps|dev omitted (NOT zero)"); }
  }
  const lockRaw = await readFile(join(cfg.root, "package-lock.json"), "utf8").catch(() => null);
  if (lockRaw !== null) {
    try {
      const lock = JSON.parse(lockRaw) as { packages?: Record<string, unknown> };
      if (lock.packages) dims.push({ key: "deps|transitive", value: Object.keys(lock.packages).filter((k) => k !== "").length, unit: "deps" });
      else notes.push("package-lock.json has no `packages` map (lockfile v1?) — deps|transitive omitted (NOT zero)");
    } catch { notes.push("package-lock.json is present but will not parse — deps|transitive omitted (NOT zero)"); }
  }
  return { dims, notes };
}

/** The LAST numeric token of stdout, which is the shape a probe naturally prints
 *  (`bundle: 41.2 kB`, `1284`). Returns null when there is nothing to read — the caller
 *  turns that into an Unmeasurable rather than a zero. */
export function lastNumber(stdout: string): number | null {
  const m = [...stdout.matchAll(/-?\d+(?:\.\d+)?/g)];
  return m.length ? Number(m[m.length - 1][0]) : null;
}

/** PROJECT MEASURES — whatever this project can measure about itself and nobody else can
 *  guess: bundle bytes, table count, generated-code size. The harness owns the mechanism
 *  (spawn, parse, pin, ratchet); the project owns the probe. */
export function measureDims(cfg: Config): { dims: MassDim[]; unmeasurable: Unmeasurable[] } {
  const dims: MassDim[] = [], unmeasurable: Unmeasurable[] = [];
  for (const m of cfg.mass?.measures ?? MASS_DEFAULTS.measures ?? []) {
    if (!m.cmd?.length) { unmeasurable.push({ key: m.key, cmd: m.cmd ?? [], why: "no command declared" }); continue; }
    const r = spawnSync(m.cmd[0], m.cmd.slice(1), { cwd: cfg.root, encoding: "utf8" });
    if (r.error) { unmeasurable.push({ key: m.key, cmd: m.cmd, why: `could not run: ${r.error.message}` }); continue; }
    if (r.status !== 0) { unmeasurable.push({ key: m.key, cmd: m.cmd, why: `exited ${r.status}${(r.stderr ?? "").trim() ? `: ${(r.stderr ?? "").trim().split("\n")[0]}` : ""}` }); continue; }
    const n = lastNumber(r.stdout ?? "");
    if (n === null) { unmeasurable.push({ key: m.key, cmd: m.cmd, why: "exited 0 but printed no number" }); continue; }
    dims.push({ key: `measure|${m.key}`, value: n, unit: m.unit });
  }
  return { dims, unmeasurable };
}

// ── rename reconciliation ─────────────────────────────────────────────────────────────

export interface MassRename { from: string; to: string; value: number; unit?: string }
export interface MassReconciled { renamed: MassRename[]; base: MassDim[] }

/** The family half of a key — `lines`, `deps`, `measure` — which is the part a rename can
 *  never change: relabeling a component moves `lines|ids` to `lines|identifiers`, it does
 *  not turn line count into a dependency count. */
export const familyOf = (k: string) => { const i = k.indexOf("|"); return i < 0 ? k : k.slice(0, i); };

/** The move-invariant address of a dimension: WHAT it measures (family + unit) and HOW
 *  MUCH it measured (the exact value) — everything except what it is called. */
const addrOf = (d: MassDim) => `${familyOf(d.key)}|${d.unit ?? ""}|${d.value}`;

/** Split the current dimensions' unmatched keys against the baseline into RENAMES and
 *  keys that must still face the ratchet as new.
 *
 *  Same shape as lint-sinks's `reconcile`, same honesty property: a rename is a **matched
 *  disappearance**. An unpinned live key inherits a pin only if some baselined key with
 *  the same family, unit and EXACT value has VANISHED from the live set, and each vanished
 *  pin absorbs exactly ONE key. Mass is therefore conserved per address — a genuinely new
 *  dimension finds nothing to absorb it (its value matches no vanished pin) and still
 *  fails, and a rename that also grew absorbs nothing either, so growth cannot ride in
 *  under a new name.
 *
 *  What this deliberately does NOT promise: when two same-family dimensions carry the same
 *  value and both vanish while two new names appear, WHICH old name maps to which new one
 *  is arbitrary (keys are paired in sorted order for determinism, not meaning) — the
 *  guarantee is the count, exactly as in lint-sinks. And it is, honestly, a loosening: a
 *  deleted 35-line component plus a genuinely new 35-line one reads as a rename. The
 *  rename is printed by name, `old → new`, so a reader can catch the coincidence; the
 *  totals it would have to hide behind are pinned in the same table. */
export function reconcileMass(current: MassDim[], base: MassDim[]): MassReconciled {
  const liveKeys = new Set(current.map((d) => d.key));
  const baseKeys = new Set(base.map((b) => b.key));

  // Baselined dimensions no longer live, bucketed by move-invariant address.
  const vanished = new Map<string, MassDim[]>();
  for (const b of base) {
    if (liveKeys.has(b.key)) continue;
    const bucket = vanished.get(addrOf(b));
    if (bucket) bucket.push(b); else vanished.set(addrOf(b), [b]);
  }
  for (const bucket of vanished.values()) bucket.sort((x, y) => x.key.localeCompare(y.key));

  const renamed: MassRename[] = [];
  const consumed = new Set<string>();
  for (const d of [...current].sort((x, y) => x.key.localeCompare(y.key))) {
    if (baseKeys.has(d.key)) continue;
    const hit = vanished.get(addrOf(d))?.shift();
    if (!hit) continue;
    consumed.add(hit.key);
    renamed.push({ from: hit.key, to: d.key, value: d.value, ...(d.unit ? { unit: d.unit } : {}) });
  }
  if (!renamed.length) return { renamed, base };

  // The effective baseline: consumed pins re-addressed to the names that inherited them,
  // so everything downstream (the table, excursions, the gone-list) sees the rename as
  // already reconciled. Values are the BASELINE's — equal to the live ones by construction.
  const effective = [
    ...base.filter((b) => !consumed.has(b.key)),
    ...renamed.map((r) => ({ key: r.to, value: r.value, ...(r.unit ? { unit: r.unit } : {}) })),
  ].sort((a, b) => a.key.localeCompare(b.key));
  return { renamed, base: effective };
}

// ── the ratchet ───────────────────────────────────────────────────────────────────────

export interface MassExcursion { key: string; value: number; baseline: number | null; tolerance: number }

/** NEW keys and keys grown past their tolerance — the ratchet's whole verdict, as data.
 *  Shrinkage NEVER fails: a ratchet that punishes deletion is a ratchet that teaches
 *  people to stop deleting. */
export function excursions(dims: MassDim[], base: MassDim[], tolerance: Record<string, number>): MassExcursion[] {
  const baseBy = new Map(base.map((b) => [b.key, b.value]));
  const out: MassExcursion[] = [];
  for (const d of dims) {
    const tol = tolerance[d.key] ?? 0;
    if (!baseBy.has(d.key)) out.push({ key: d.key, value: d.value, baseline: null, tolerance: tol });
    else if (d.value > baseBy.get(d.key)! + tol) out.push({ key: d.key, value: d.value, baseline: baseBy.get(d.key)!, tolerance: tol });
  }
  return out;
}

/** An excursion as a QUESTION for the journal. The subject is the ADDRESSABLE KEY and
 *  nothing else — no value, no delta, no rank — so re-running after another 200 lines
 *  land does not mint a second question about the same dimension (see raise.ts's header:
 *  a key containing a magnitude is the volatile-identity failure, spelled out). */
export function massFindings(exc: MassExcursion[]): Finding[] {
  return exc.map((e) => ({
    advisory: "mass",
    subject: e.key,
    observation: e.baseline === null
      ? `${e.key} is a NEW mass dimension at ${e.value} — nothing was pinned here before`
      : `${e.key} grew ${e.baseline} → ${e.value}, past its tolerance of ${e.tolerance}`,
    because:
      "The mass ratchet pins how much machine there is, per dimension. Growth here is not"
      + " a defect and not a virtue — it is an unexplained fact, and the party who can say"
      + " what it bought is the one who wrote it, this run, not a reader six months from now.",
    couldBe: [
      "the growth bought something named — a feature, a component, a dependency the project chose",
      "the growth is accretion — helpers, copies and transitive installs nobody decided on individually",
      e.baseline === null
        ? "the graph changed shape — a component split, or renamed while it also changed size (an UNCHANGED rename is reconciled before it can raise this)"
        : "the dimension moved because the MEASURE moved (a probe, a lockfile format, a walk boundary), not because the codebase did",
    ],
    discriminatedBy:
      `run \`coherence mass\` and read this key's line, then \`git diff --stat\` over the range that moved it.`
      + ` If the delta maps to something you can name, record it — \`coherence decide "<what the new mass buys>"`
      + ` --because "..."\` — and re-pin with \`coherence mass --update-baseline\`. If it maps to nothing you can`
      + ` name, that is the finding, and the fix is deletion rather than a larger baseline.`,
  }));
}

// ── the command ───────────────────────────────────────────────────────────────────────

export interface MassOpts { raise?: boolean; raiseCap?: number; session?: string; agent?: string }

export async function mass(cfg: Config, graph: Graph, mode: "report" | "check" | "update", opts: MassOpts = {}): Promise<number> {
  const tolerance = { ...MASS_DEFAULTS.tolerance, ...(cfg.mass?.tolerance ?? {}) };
  const depsOn = cfg.mass?.deps ?? MASS_DEFAULTS.deps;

  const dims: MassDim[] = [...await structuralDims(cfg, graph)];
  const notes: string[] = [];
  if (depsOn) { const d = await depDims(cfg); dims.push(...d.dims); notes.push(...d.notes); }
  const { dims: mDims, unmeasurable } = measureDims(cfg);
  dims.push(...mDims);

  const sorted = [...dims].sort((a, b) => a.key.localeCompare(b.key));

  if (mode === "update") {
    // An unmeasurable probe must not be pinned away by silence: `update` still says it,
    // because a baseline written while a measure was broken is a baseline missing a key.
    for (const u of unmeasurable) console.error(`  UNMEASURABLE ${u.key} — ${u.why}  [${u.cmd.join(" ")}]  (not pinned)`);
    const p = await writeBaseline(cfg, BASELINE, sorted.map((d) => ({ key: d.key, value: d.value, ...(d.unit ? { unit: d.unit } : {}) })));
    console.log(`Pinned ${sorted.length} mass dimension(s) to ${p}`);
    await recordMass(cfg, { dims: sorted, series: undefined }).catch(() => {});
    return 0;
  }

  const rawBase = await readBaseline<MassDim[]>(cfg, BASELINE);
  // Reconcile renames BEFORE anything reads the baseline: the table, the excursions, the
  // status record and the gone-list all see the effective (re-addressed) pins, so a
  // renamed dimension shows its inherited baseline instead of a false `NEW`.
  const rec = rawBase ? reconcileMass(dims, rawBase) : null;
  const base = rec ? rec.base : rawBase;
  const renamed = rec?.renamed ?? [];
  const baseBy = new Map((base ?? []).map((b) => [b.key, b.value]));

  // ── the report (printed in every non-update mode) ──
  const pad = (s: unknown, n: number) => String(s).padEnd(n);
  const width = Math.max(12, ...dims.map((d) => d.key.length));
  console.log("\n  MASS — how much machine there is, by dimension\n");
  console.log(`  ${pad("dimension", width)} ${"value".padStart(10)} ${"baseline".padStart(10)}  unit`);
  console.log(`  ${"-".repeat(width)} ${"-".repeat(10)} ${"-".repeat(10)}  ${"-".repeat(8)}`);
  for (const d of dims) {
    const b = baseBy.get(d.key);
    const delta = b === undefined ? (base ? "  NEW" : "") : d.value > b ? `  +${d.value - b}` : d.value < b ? `  ${d.value - b}` : "";
    console.log(`  ${pad(d.key, width)} ${String(d.value).padStart(10)} ${String(b ?? "—").padStart(10)}  ${d.unit ?? ""}${delta}`);
  }
  if (renamed.length) {
    console.log(`\n  ${renamed.length} dimension(s) RENAMED — the same pinned mass under a new name, not growth:`);
    for (const r of renamed) console.log(`    ~ ${r.from} → ${r.to}  (${r.value}${r.unit ? ` ${r.unit}` : ""} conserved)`);
    console.log("  A rename is not growth, but the baseline still pins the old name — re-pin with --update-baseline to follow it.");
  }
  for (const n of notes) console.log(`\n  note: ${n}`);
  for (const u of unmeasurable) console.error(`\n  ✗ UNMEASURABLE ${u.key} — ${u.why}  [${u.cmd.join(" ")}]`);
  if (unmeasurable.length) console.error("    A probe that cannot be read is NOT zero. Fix the command, or drop it from config.mass.measures.");

  // MASS OVER TIME — the growth ratchet's missing dimension: a pin says whether today is
  // bigger than the last pin, and says nothing about the shape of the road here.
  let series: number[] | undefined;
  if (mode === "report") {
    series = locDeltaSeries(commitDeltas(cfg, HIST), readCommitLog(cfg, HIST));
    if (series.length) {
      const lo = Math.min(...series), hi = Math.max(...series);
      const net = series.reduce((a, b) => a + b, 0);
      // The universe is named on the line, because it is NOT the table's. git --shortstat
      // counts every TRACKED file (README, release notes, the journal, committed
      // artifacts); the dimensions above count the graph's files only. Measured on this
      // harness the two differ by ~4k lines, and a reader who assumed one universe would
      // have read that gap as a defect in whichever number they trusted less.
      console.log(`\n  net LOC per window  ${spark(series, lo, hi)}   oldest → newest over the last ${HIST} commits`
        + ` (net ${net >= 0 ? "+" : ""}${net}, low ${lo}, high ${hi}) — ALL tracked files, not just the graph's`);
    }
  }

  const exc = base ? excursions(dims, base, tolerance) : [];
  await recordMass(cfg, {
    dims: dims.map((d) => ({ ...d, ...(baseBy.has(d.key) ? { baseline: baseBy.get(d.key) } : {}) })),
    series: series ? { locDelta: series } : undefined,
  }).catch(() => {});

  // RAISING. A mass excursion becomes a QUESTION only under `--raise`, never an implicit
  // `observed` call: `observed` is for a metric with a declared band whose owner already
  // decided what "outside" means, and mass has no such band — the baseline is a pin, not
  // a threshold. Auto-feeding it would write to the journal on every report run, which is
  // the surprising-write failure raise.ts exists to avoid.
  const report = raiseFindings(cfg, readJournal(cfg).records, massFindings(exc), {
    enabled: opts.raise, cap: opts.raiseCap, session: opts.session, agent: opts.agent,
  });
  for (const line of formatRaise(report)) console.log(line);

  if (mode !== "check") { console.log(""); return 0; }

  if (!base) { console.error("\n  --check: no baseline. Run with --update-baseline first."); return 2; }

  if (unmeasurable.length) {
    console.error(`\n  ✗ mass ratchet FAILED — ${unmeasurable.length} measure(s) could not be read, and an unreadable probe is not a zero.`);
    console.error("");
    return 1;
  }

  if (exc.length) {
    // A NEW key beside a vanished same-family pin is PROBABLY a rename that also changed
    // value. It still fails — only a value-conserving rename inherits a pin — but the
    // report must say what it sees, not leave the vanished evidence off the page.
    const stillVanished = (base ?? []).filter((b) => !dims.some((d) => d.key === b.key));
    console.error(`\n  ✗ mass ratchet FAILED — the movement gained parts nobody named:`);
    for (const e of exc) {
      if (e.baseline === null) {
        console.error(`    - NEW dimension: ${e.key} = ${e.value}`);
        for (const v of stillVanished.filter((b) => familyOf(b.key) === familyOf(e.key)))
          console.error(`      (${v.key} (${v.value}) vanished this run — if ${e.key} is that dimension renamed, its mass ALSO changed ${v.value} → ${e.value}, and only a value-conserving rename inherits a pin)`);
      } else {
        console.error(`    - ${e.key} grew ${e.baseline}→${e.value}${e.tolerance ? ` (tolerance ${e.tolerance})` : ""}`);
      }
    }
    console.error("  Say what the new mass BUYS, then re-pin:");
    console.error('    coherence decide "<what the new mass buys>" --because "<why this project is now bigger>"');
    console.error("    coherence mass --update-baseline");
    console.error("");
    return 1;
  }

  console.log("\n  ✓ mass ratchet held — nothing grew past its tolerance.");
  const shrunk = dims.filter((d) => baseBy.has(d.key) && d.value < baseBy.get(d.key)!);
  if (shrunk.length) console.log(`  ${shrunk.length} dimension(s) SHRANK since the pin (never a failure) — re-pin to bank it.`);
  const gone = (base ?? []).filter((b) => !dims.some((d) => d.key === b.key));
  for (const g of gone) console.log(`    - ${g.key} (${g.value}) — gone from the project; drop from baseline`);
  console.log("");
  return 0;
}
