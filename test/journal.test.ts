// journal.test.ts — the journal STREAM.
//
// What these pin, in order of how badly it hurts when it breaks:
//   1. EXACTLY ONCE. The tail's whole contract: an append arrives once, a compaction
//      fold (bytes moved between files, sources unlinked, target rewritten) arrives
//      zero times, and a half-written line is never parsed from half its bytes. This
//      is the guard behind the spec's boundary claim.
//   2. THE STREAM AGREES WITH THE COLD READ. Incremental pulls, accumulated, must
//      equal what `readJournal` sees in one pass — same records, same order — or the
//      live view and the settled view describe two different histories.
//   3. THE SNAPSHOT MODE EXITS. A pipe gets a chronological render and a return, not
//      a tail that never ends — which is also what keeps `coherence journal` safe to
//      run bare in any harness that executes every verb.
//   4. THE FRAME IS A PURE FUNCTION. Streams view lists ALL + one row per session;
//      the timeline scopes to one stream; damage is announced, never silent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecision, decisionsDir, readJournal, timelineOrder, deriveSessions, INSTRUMENT_MARKER } from "../src/decisions.ts";
import {
  newTailState, tailJournal, formatEntryLine, formatWhen, entryDetail, renderStreamFrame, initialStreamUI, shownEntry,
  visibleRecords, displayRecords, sessionsByRecency, openConjectures, runJournal, type StreamModel,
} from "../src/journal.ts";
import { runCaptured, cleanup } from "./_helpers.ts";
import type { Config } from "../src/types.ts";

async function root(): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), "coh-jstream-"));
  return { root: dir } as Config;
}
const T = (n: number) => `2026-08-04T09:${String(n).padStart(2, "0")}:00.000Z`;
// The renders speak the MACHINE's wall clock, so expectations must too — computed from
// the same Date the render uses, never hard-coded UTC digits that only pass in one zone.
const P2 = (n: number) => String(n).padStart(2, "0");
const localT = (n: number) => {
  const d = new Date(Date.parse(T(n)));
  return {
    full: `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())} ${P2(d.getHours())}:${P2(d.getMinutes())}:${P2(d.getSeconds())}`,
    hm: `${P2(d.getHours())}:${P2(d.getMinutes())}`,
  };
};
const A = "s-aaaaaaaaaaaa", B = "s-bbbbbbbbbbbb";

test("tail — an appended record arrives exactly once, a compaction fold re-emits nothing and drops nothing, and a half-written line waits for its bytes", async () => {
  const cfg = await root();
  appendDecision(cfg, { kind: "decision", chose: "first", because: "x", session: A, agent: "finder-1", now: T(1) });
  appendDecision(cfg, { kind: "decision", chose: "second", because: "y", session: B, agent: "finder-2", now: T(2) });
  appendDecision(cfg, { kind: "blocked", chose: "third", because: "z", session: A, agent: "finder-1", now: T(3) });

  // Cold pull: everything, once, in timeline order.
  const state = newTailState();
  const first = tailJournal(cfg, state);
  assert.deepEqual(first.fresh.map((r) => r.chose), ["first", "second", "third"]);
  assert.equal(first.unreadable, 0);

  // Idempotent: nothing changed, nothing arrives.
  assert.deepEqual(tailJournal(cfg, state).fresh, []);

  // An append arrives exactly once — the one new record, nothing replayed.
  appendDecision(cfg, { kind: "decision", chose: "fourth", because: "w", session: B, agent: "finder-2", now: T(4) });
  assert.deepEqual(tailJournal(cfg, state).fresh.map((r) => r.chose), ["fourth"]);

  // A COMPACTION FOLD: exactly what compactJournal does — every line moved byte-for-byte
  // into one target, sources unlinked. The tailer holds live offsets into the sources and
  // none into the target; a position-addressed reader would replay all four records here.
  const dir = decisionsDir(cfg);
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const lines = files.flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.trim()));
  lines.sort((a, b) => timelineOrder(JSON.parse(a), JSON.parse(b)));
  writeFileSync(join(dir, "folded-2026-08.jsonl"), lines.join("\n") + "\n");
  for (const f of files) unlinkSync(join(dir, f));
  assert.deepEqual(tailJournal(cfg, state).fresh, [], "a fold moved bytes between files — the stream must recognize every line it already emitted");

  // ...and the fold target still tails: a genuinely new append to it arrives, once.
  appendDecision(cfg, { kind: "decision", chose: "fifth", because: "v", session: "folded-2026-08", agent: "finder-1", now: T(5) });
  assert.deepEqual(tailJournal(cfg, state).fresh.map((r) => r.chose), ["fifth"]);

  // A HALF-WRITTEN LINE: a writer caught mid-append. The complete prefix is not consumed
  // past the partial tail, the partial line is never parsed from half its bytes, and when
  // the rest lands the record arrives whole — once.
  const rec = { id: "d-deadbeef", session: A, at: T(6), kind: "decision", agent: "finder-1", job: "-", branch: null, commit: null, dirty: false, chose: "sixth", over: [], because: "u" };
  const line = JSON.stringify(rec) + "\n";
  appendFileSync(join(dir, "folded-2026-08.jsonl"), line.slice(0, 25));
  const partial = tailJournal(cfg, state);
  assert.deepEqual(partial.fresh, []);
  assert.equal(partial.unreadable, 0, "a partial line is pending bytes, not damage");
  appendFileSync(join(dir, "folded-2026-08.jsonl"), line.slice(25));
  assert.deepEqual(tailJournal(cfg, state).fresh.map((r) => r.chose), ["sixth"]);

  // Garbage is counted and skipped, never thrown on — and never re-counted by an
  // unrelated append later.
  appendFileSync(join(dir, "folded-2026-08.jsonl"), "not json at all\n");
  assert.equal(tailJournal(cfg, state).unreadable, 1);
  appendDecision(cfg, { kind: "decision", chose: "seventh", because: "t", session: A, agent: "finder-1", now: T(7) });
  const after = tailJournal(cfg, state);
  assert.deepEqual(after.fresh.map((r) => r.chose), ["seventh"]);
  assert.equal(after.unreadable, 0);
  await cleanup(cfg.root);

  // A FOLD INTO AN EXISTING TARGET — compaction's other shape, and the nastier one: the
  // target is one of its own sources, so the rewrite interleaves ANOTHER file's line
  // BEFORE the offset the tailer already holds, while the file GROWS. A size-only
  // rewrite check waves this through, splits a line at the stale offset, and never
  // visits the interleaved record at all — the dropped-entry direction of the invariant.
  const cfg2 = await root();
  const st2 = newTailState();
  appendDecision(cfg2, { kind: "decision", chose: "t1", because: "-", session: A, agent: "X", now: T(1) });
  appendDecision(cfg2, { kind: "decision", chose: "t3", because: "-", session: A, agent: "X", now: T(3) });
  assert.equal(tailJournal(cfg2, st2).fresh.length, 2);
  appendDecision(cfg2, { kind: "decision", chose: "t2", because: "-", session: B, agent: "Y", now: T(2) }); // lands between them, NOT yet pulled
  const dir2 = decisionsDir(cfg2);
  const files2 = readdirSync(dir2).filter((f) => f.endsWith(".jsonl")).sort();
  const lines2 = files2.flatMap((f) => readFileSync(join(dir2, f), "utf8").split("\n").filter((l) => l.trim()));
  lines2.sort((a, b) => timelineOrder(JSON.parse(a), JSON.parse(b)));
  const target = files2.find((f) => f.includes("aaaaaaaaaaaa"))!;
  writeFileSync(join(dir2, target), lines2.join("\n") + "\n"); // in-place: t2 now sits before the held offset
  for (const f of files2) if (f !== target) unlinkSync(join(dir2, f));
  const folded = tailJournal(cfg2, st2);
  assert.deepEqual(folded.fresh.map((r) => r.chose), ["t2"], "the record the fold moved in front of the held offset must still arrive — once");
  assert.equal(folded.unreadable, 0, "re-reading from the stale offset would have split a line mid-byte and called it damage");
  assert.deepEqual(tailJournal(cfg2, st2).fresh, []);
  await cleanup(cfg2.root);
});

test("stream ≡ cold read — incremental pulls accumulate to exactly what readJournal sees, in the same order", async () => {
  const cfg = await root();
  const state = newTailState();
  const got: string[] = [];
  // Interleave writes and pulls, out of time order across two sessions — the stream's
  // accumulation must still converge on the merged timeline.
  appendDecision(cfg, { kind: "decision", chose: "b1", because: "-", session: B, agent: "B", now: T(10) });
  got.push(...tailJournal(cfg, state).fresh.map((r) => r.id));
  appendDecision(cfg, { kind: "decision", chose: "a1", because: "-", session: A, agent: "A", now: T(5) });
  appendDecision(cfg, { kind: "conjecture", chose: "odd number", discriminatedBy: "rerun", because: "", session: A, agent: "A", now: T(12) });
  got.push(...tailJournal(cfg, state).fresh.map((r) => r.id));
  const cold = readJournal(cfg);
  assert.deepEqual([...got].sort(), cold.records.map((r) => r.id).sort(), "every record, exactly once");
  const resorted = cold.records.map((r) => r.id);
  const accumulated = cold.records.filter((r) => got.includes(r.id)).map((r) => r.id);
  assert.deepEqual(accumulated, resorted, "same set under the same total order");
  await cleanup(cfg.root);
});

test("format — one line carries when, kind, who, what and the UNCAPPED because; pointer kinds name their target", async () => {
  const cfg = await root();
  const long = "the evidence lives at the end of a rationale ".repeat(8).trim();
  const d = appendDecision(cfg, { kind: "decision", chose: "gamma", over: ["linear"], because: long, session: A, agent: "veri", now: T(1) });
  const line = formatEntryLine(d);
  assert.ok(line.includes(localT(1).full), "the feed line carries the timestamp in local time");
  assert.match(line, /● decision/);
  assert.match(line, /veri · s-aaaaaaaaaaaa/);
  assert.match(line, /gamma/);
  assert.ok(line.includes(long), "the because is uncapped in line mode — clipping is the TUI's job, at the render");
  const r = appendDecision(cfg, { kind: "retraction", chose: "(withdrawn)", because: "refuted", supersedes: d.id, session: B, agent: "audit", now: T(2) });
  assert.ok(formatEntryLine(r).includes(`⇒ ${d.id}`), "a pointer kind must name its target in the feed — the conjecture scrolled past an hour ago");
  // The drill-in carries the empty-over distinction the settled render insists on.
  const forced = appendDecision(cfg, { kind: "decision", chose: "solo", because: "only option", session: A, agent: "veri", now: T(3) });
  assert.ok(entryDetail(forced, 100).some((l) => l.includes("(nothing — forced, or no alternative considered)")));
  // The drill-in breathes between identity and metadata, and speaks the timestamp in
  // human distance — relative up close, calendar far away, garbage passed through.
  assert.strictEqual(entryDetail(forced, 100)[1], "", "a blank line separates the header from the metadata block");
  const t0 = Date.parse("2026-08-04T12:00:00.000Z");
  assert.strictEqual(formatWhen("2026-08-04T11:59:19.000Z", t0), "41 seconds ago");
  assert.strictEqual(formatWhen("2026-08-04T11:59:59.000Z", t0), "1 second ago");
  assert.strictEqual(formatWhen("2026-08-04T11:37:00.000Z", t0), "23 minutes ago");
  assert.strictEqual(formatWhen("2026-08-04T07:00:00.000Z", t0), "5 hours ago");
  assert.match(formatWhen("2026-08-01T12:00:00.000Z", t0), /^Aug 1, 2026 · \d{2}:\d{2}$/); // local HH:MM — the date is the pin, the wall clock is the machine's
  assert.strictEqual(formatWhen("not-a-date", t0), "not-a-date");
  await cleanup(cfg.root);
});

test("frame — streams view lists ALL plus one row per session; the timeline scopes to one stream; damage is announced", async () => {
  const cfg = await root();
  appendDecision(cfg, { kind: "decision", chose: "a1", because: "-", session: A, agent: "finder-1", job: "evo", now: T(1) });
  appendDecision(cfg, { kind: "decision", chose: "b1", because: "-", session: B, agent: "finder-2", job: "evo", now: T(2) });
  appendDecision(cfg, { kind: "decision", chose: "b2", because: "-", session: B, agent: "finder-2", job: "evo", now: T(3) });
  const state = newTailState();
  const model: StreamModel = { records: tailJournal(cfg, state).fresh, unreadable: 1 };

  const ui = initialStreamUI();
  ui.view = "streams";
  const streams = renderStreamFrame(model, ui, { cols: 120, rows: 24 }, false, new Date(T(4))).join("\n");
  assert.match(streams, /ALL/);
  assert.match(streams, new RegExp(A));
  assert.match(streams, new RegExp(B));
  assert.match(streams, /1 unreadable line\(s\)/, "damage is in the masthead, not buried");

  ui.view = "timeline"; ui.stream = B; ui.cursor = 1;
  const scoped = visibleRecords(model, ui);
  assert.deepEqual(scoped.map((r) => r.chose), ["b1", "b2"], "one stream is one session's records, nothing else's");
  const frame = renderStreamFrame(model, ui, { cols: 120, rows: 24 }, false, new Date(T(4))).join("\n");
  assert.match(frame, /stream: s-bbbbbbbbbbbb/);
  assert.match(frame, /b1/);
  assert.doesNotMatch(frame, /\ba1\b/, "the other stream's entries must not leak into a scoped surf");
  assert.equal(deriveSessions(model.records).length, 2);
  await cleanup(cfg.root);
});

test("list order — timeline cells and the streams picker read newest first, the cursor is a visible highlight, and Enter opens exactly the record under it", async () => {
  const cfg = await root();
  const long = "a rationale that keeps going well past what two wrapped lines can hold ".repeat(6).trim();
  appendDecision(cfg, { kind: "decision", chose: "oldest", because: long, session: A, agent: "finder-1", now: T(1) });
  appendDecision(cfg, { kind: "decision", chose: "middle", because: "-", session: B, agent: "finder-2", now: T(2) });
  appendDecision(cfg, { kind: "decision", chose: "newest", because: "-", session: B, agent: "finder-2", now: T(3) });
  const model: StreamModel = { records: tailJournal(cfg, newTailState()).fresh, unreadable: 0 };
  const ui = initialStreamUI();

  // Display order is the model reversed: row 0 is the tip, and the model itself stays
  // chronological (the pipe modes and the tail's total order depend on that).
  assert.deepEqual(displayRecords(model, ui).map((r) => r.chose), ["newest", "middle", "oldest"]);
  assert.deepEqual(model.records.map((r) => r.chose), ["oldest", "middle", "newest"], "reversing the view must not reverse the model");

  const plain = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, false, new Date(T(4)));
  const frame = plain.join("\n");
  assert.ok(frame.indexOf("newest") < frame.indexOf("middle") && frame.indexOf("middle") < frame.indexOf("oldest"), "newest at the top");
  // A CELL, not a table row: the metadata line (glyph · time · agent) is its own line,
  // and the entry text stacks under it.
  const meta = plain.find((l) => l.includes(localT(3).hm) && l.includes("finder-2"));
  assert.ok(meta && !meta.includes("newest"), "metadata and text are separate lines");
  // Long text wraps to at most two lines and announces the cut.
  assert.ok(plain.some((l) => l.trimEnd().endsWith("…")), "a third wrapped line becomes an ellipsis");
  // The selection is VISIBLE: the cursor's cell is the inverted highlight bar.
  const colored = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, true, new Date(T(4)));
  assert.ok(colored.some((l) => l.includes("\x1b[7m") && l.includes("newest")), "the reader can see what ⏎ will open");

  // Enter opens the record under the cursor — in display order, not model order.
  ui.view = "entry"; ui.cursor = 1;
  const entry = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, false, new Date(T(4))).join("\n");
  assert.match(entry, /middle/);

  // The picker orders by most recent ACTIVITY, not by start: A started first, B spoke
  // last — B leads. ALL stays pinned at row 0, the view the picker exists to return to.
  assert.deepEqual(sessionsByRecency(model.records).map((s) => s.id), [B, A]);
  const ui2 = initialStreamUI(); ui2.view = "streams";
  const streams = renderStreamFrame(model, ui2, { cols: 120, rows: 24 }, false, new Date(T(4))).join("\n");
  assert.ok(streams.indexOf("ALL") < streams.indexOf(B) && streams.indexOf(B) < streams.indexOf(A));
  await cleanup(cfg.root);
});

test("entry view — a supersedes pointer is followable: the hint invites only when the target resolves, and the trail's tip decides what renders", async () => {
  const cfg = await root();
  const d = appendDecision(cfg, { kind: "decision", chose: "the original call", because: "seemed right", session: A, agent: "veri", now: T(1) });
  appendDecision(cfg, { kind: "retraction", chose: "(withdrawn)", because: "refuted by measurement", supersedes: d.id, session: A, agent: "veri", now: T(2) });
  const model: StreamModel = { records: tailJournal(cfg, newTailState()).fresh, unreadable: 0 };
  const ui = initialStreamUI();
  ui.view = "entry"; ui.cursor = 0; // display order: the retraction is the tip

  // The footer invites the hop by naming the target; the body is still the retraction.
  const atPointer = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, false, new Date(T(3))).join("\n");
  assert.ok(atPointer.includes(`open ${d.id}`), "a resolvable pointer earns the ⏎ hint");
  assert.match(atPointer, /refuted by measurement/);

  // Following pushes the id; the trail's tip is what renders now, hint gone (no pointer).
  ui.refTrail = [d.id];
  const followed = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, false, new Date(T(3))).join("\n");
  assert.match(followed, /the original call/);
  assert.doesNotMatch(followed, /open d-/, "an entry with no pointer offers no hop");

  // A dangling id says so in words rather than pretending nothing was selected.
  ui.refTrail = ["d-00000000"];
  const dangling = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, false, new Date(T(3))).join("\n");
  assert.match(dangling, /d-00000000.*dangling/);
  assert.equal(shownEntry(model, ui), null);
  await cleanup(cfg.root);
});

test("conjectures view — lists exactly the OPEN questions behind the masthead count, hints the discriminator, drills into the standard detail, and says when there are none", async () => {
  const cfg = await root();
  appendDecision(cfg, { kind: "decision", chose: "a decision, not a question", because: "-", session: A, agent: "finder-1", now: T(1) });
  const answered = appendDecision(cfg, { kind: "conjecture", chose: "settled question", couldBe: ["x"], discriminatedBy: "was rerun", because: "", session: A, agent: "finder-1", now: T(2) });
  appendDecision(cfg, { kind: "resolution", chose: "x", because: "rerun showed it", supersedes: answered.id, session: A, agent: "finder-1", now: T(3) });
  appendDecision(cfg, { kind: "conjecture", chose: "older open question", couldBe: ["cache cold", `${INSTRUMENT_MARKER} instrument error`], discriminatedBy: "rerun with warm cache", because: "", session: A, agent: "finder-1", now: T(4) });
  appendDecision(cfg, { kind: "conjecture", chose: "newer open question", discriminatedBy: "unknown — no test comes to mind", because: "", session: B, agent: "finder-2", now: T(5) });
  const model: StreamModel = { records: tailJournal(cfg, newTailState()).fresh, unreadable: 0 };

  // The list is the masthead's count, newest first — resolved questions are not in it.
  assert.deepEqual(openConjectures(model).map((r) => r.chose), ["newer open question", "older open question"]);
  const ui = initialStreamUI();
  ui.view = "conjectures";
  const plain = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, false, new Date(T(6)));
  const frame = plain.join("\n");
  assert.match(frame, /2 OPEN conjecture\(s\)/);
  assert.match(frame, /newer open question/);
  assert.match(frame, /older open question/);
  assert.doesNotMatch(frame, /settled question/, "an answered conjecture must not haunt the open list");
  assert.doesNotMatch(frame, /a decision, not a question/, "only conjectures belong here");
  // The hint line surfaces what makes the entry a QUESTION: the discriminator (the
  // actionable field, first so clipping cannot eat it), then the candidates.
  assert.match(frame, /discriminated by: rerun with warm cache/);
  assert.match(frame, /could be: cache cold · \[instrument\] instrument error/);
  // The selection is the same inverted bar as every other list.
  const colored = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, true, new Date(T(6)));
  assert.ok(colored.some((l) => l.includes("\x1b[7m") && l.includes("newer open question")), "the reader can see what ⏎ will open");

  // ⏎ opens the standard drill-in for the record under the cursor — cCursor against
  // the open list, not the timeline's cursor — and esc knows to come back here.
  ui.view = "entry"; ui.back = "conjectures"; ui.cCursor = 1;
  const entry = renderStreamFrame(model, ui, { cols: 100, rows: 24 }, false, new Date(T(6))).join("\n");
  assert.match(entry, /older open question/);
  assert.match(entry, /discriminated by: +rerun with warm cache/);

  // Zero open conjectures is a statement, not an empty screen.
  const quiet: StreamModel = { records: model.records.filter((r) => r.kind !== "conjecture"), unreadable: 0 };
  const ui2 = initialStreamUI(); ui2.view = "conjectures";
  const empty = renderStreamFrame(quiet, ui2, { cols: 100, rows: 24 }, false, new Date(T(6))).join("\n");
  assert.match(empty, /no open conjectures/);
  await cleanup(cfg.root);
});

test("snapshot — a pipe gets the chronological render and an exit 0, scoped by the same four filters as `decisions`", async () => {
  const cfg = await root();
  appendDecision(cfg, { kind: "decision", chose: "kept", because: "in scope", session: A, agent: "finder-1", now: T(1) });
  appendDecision(cfg, { kind: "decision", chose: "dropped", because: "out of scope", session: B, agent: "finder-2", now: T(2) });
  const all = await runCaptured(() => runJournal(cfg, { once: true }));
  assert.equal(all.code, 0);
  assert.match(all.out, /2 entries across 2 stream\(s\)/);
  assert.match(all.out, /kept/);
  assert.match(all.out, /dropped/);
  const scoped = await runCaptured(() => runJournal(cfg, { once: true, agent: "finder-1" }));
  assert.match(scoped.out, /kept/);
  assert.doesNotMatch(scoped.out, /dropped/);
  assert.match(scoped.out, /agent finder-1/, "the filter is stated in the header, so a narrow read never masquerades as the whole record");
  const empty = await runCaptured(() => runJournal(cfg, { once: true, agent: "nobody" }));
  assert.match(empty.out, /\(nothing logged\)/, "an empty scope says so — silence is ambiguous between 'quiet' and 'broken filter'");
  await cleanup(cfg.root);
});
