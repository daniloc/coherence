// render-contract.test.ts — the promise-anatomy renderer's load-bearing guarantees. It
// emits ONE complete, SELF-CONTAINED HTML document (no external resource can sneak in); the
// model survives the JSON embed round-trip; every declared string (labels, zone names, gate
// invariants, event details) surfaces for the eye; a hostile `</script>` label cannot break
// out of the blob; and — because the anatomy is built CLIENT-SIDE from that blob — the
// marks exist only after the inline script RUNS. A DOM stub (below) executes that script
// against a fake document so we can assert on the produced tree and drive its
// hover/click/keyboard interaction.
//
// This round also pins the AGGREGATE-BY-DEFAULT redesign (learned against real data where
// 16 identical U chips flooded a row and 17 same-fact arcs made a hairball):
//   · collapsed rows are the default — one line per component, no chip flood;
//   · the gates lane is bounded by construction (grid tracks + capped exception chips);
//   · arcs are exception + demand — naked always, covered/undeclared only for active rows;
//   · the ledger groups by kind — alarms expanded, good news collapsed to counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderContract } from "../src/render-contract.ts";
import type { PromiseModel } from "../src/promise-model.ts";

// ── the standing fixture: 3 zones (one nested) + an undeclared band ─────────────────────
// core (most trusted) ▸ core/crypto (nested inside core) ▸ edge; plus a component with a
// null zone that must gather in "undeclared residence". Gates hit EVERY grade A/B/C/D/U,
// include a verdict:"fail" breach and an UNPLACED gate (crossing null); reliances cover the
// three arc kinds (covered · naked · undeclared); one component wears a hostile <script>
// label that must never go live.
const model: PromiseModel = {
  root: "acme-vault",
  intent: "a signing service with a trusted kernel",
  generatedAt: "2026-07-13T12:00:00.000Z",
  head: "abc1234",
  dirty: true,
  zones: [
    { name: "core", intent: "the trusted kernel", inside: null },
    { name: "core/crypto", intent: "key custody", inside: "core" }, // NESTED inside core
    { name: "edge", intent: "speaks to the outside", inside: null },
  ],
  components: [
    {
      // the entry component — fully accounted; an A gate + an UNPLACED U gate. The U is
      // WORSE than the modal grade (tie A/U breaks toward the better A), so it itemizes
      // as an exception chip even in the collapsed row.
      label: "kernel",
      dir: ".",
      intent: "owns the boot invariant",
      zone: "core",
      gates: [
        { inv: "boot-sealed", chokepoint: "seal", verb: "test", oracle: "seal totality",
          crossing: { from: "edge", to: "core" }, grade: "A", verdict: "pass",
          freshest: "2026-07-13T11:00:00.000Z", reliants: ["edge/http"] },
        { inv: "entropy-fresh", chokepoint: "reseed", verb: "", oracle: "",
          crossing: null, grade: "U", verdict: "unknown", reliants: [] }, // UNPLACED + grade U
      ],
      relies: [
        { to: "core/crypto/keys", crossing: { from: "core", to: "core/crypto" }, via: "keys-guarded" }, // COVERED
      ],
      mass: { files: 6, lines: 200 },
      accounted: { files: 6, lines: 200 }, // clean → no exposure ink
    },
    {
      // the nested-zone resident — one human-judged guard (grade C, ⚑): a uniform row,
      // so its collapsed pose is capsule-only; partly unaccounted.
      label: "keys",
      dir: "core/crypto/keys",
      intent: "custodies signing keys",
      zone: "core/crypto",
      gates: [
        { inv: "keys-guarded", chokepoint: "withdrawKey", verb: "guard", oracle: "custody judgement",
          crossing: { from: "core", to: "core/crypto" }, grade: "C", verdict: "pass",
          freshest: "2026-07-12T08:00:00.000Z", reliants: ["."] },
      ],
      relies: [],
      mass: { files: 3, lines: 120 },
      accounted: { files: 2, lines: 70 }, // 50/120 → ~42% unaccounted
    },
    {
      // the edge — a stale B gate + a D gate whose verdict FAILS (breach: always itemized);
      // a covered reliance on the kernel and a NAKED reliance on keys.
      label: "http",
      dir: "edge/http",
      intent: "terminates TLS and routes requests",
      zone: "edge",
      gates: [
        { inv: "authenticated", chokepoint: "requireToken", verb: "test", oracle: "token totality",
          crossing: { from: "edge", to: "core" }, grade: "B", verdict: "stale",
          freshest: "2026-06-30T08:00:00.000Z", reliants: ["."] }, // grade B (aging green)
        { inv: "rate-limited", chokepoint: "bucket", verb: "guard", oracle: "",
          crossing: { from: "edge", to: "edge" }, grade: "D", verdict: "fail", reliants: [] }, // grade D + BREACH
      ],
      relies: [
        { to: ".", crossing: { from: "edge", to: "core" }, via: "boot-sealed" },        // COVERED
        { to: "core/crypto/keys", crossing: { from: "edge", to: "core/crypto" }, via: null }, // NAKED (red, loud)
      ],
      mass: { files: 9, lines: 300 },
      accounted: { files: 5, lines: 180 }, // 120/300 → 40% unaccounted
    },
    {
      // a HOSTILE label + UNDECLARED residence (zone null) + a reliance whose crossing is
      // null (an undeclared-residence arc: drawn only on demand). Fully unaccounted.
      label: "<script>alert('pwn')</script>",
      dir: "edge/webhook",
      intent: "delivers outbound webhooks",
      zone: null,
      gates: [],
      relies: [
        { to: "edge/http", crossing: null, via: null }, // UNDECLARED (crossing null)
      ],
      mass: { files: 2, lines: 40 },
      accounted: { files: 0, lines: 0 }, // 100% unaccounted + residence undeclared
    },
  ],
  review: null,
};

const doc = renderContract(model, "2026-07-13T12:00:00.000Z");

// ── the DENSE fixture: the real-data failure case — a Hive-like component with 16 gates.
// Uniform variant: 16 identical U gates (no exceptions → capsule only, ZERO chips).
// Fail variant: one of the 16 breaches (verdict fail) — the ONE exception itemizes.
function denseComponent(withFail: boolean): PromiseModel {
  const gates = [];
  for (let i = 0; i < 16; i++) {
    gates.push({
      inv: "law-" + i, chokepoint: "cp" + i, verb: "" as const, oracle: "",
      crossing: { from: "hive", to: "hive" }, grade: "U" as const,
      verdict: (withFail && i === 7 ? "fail" : "unknown") as "fail" | "unknown", reliants: [],
    });
  }
  return {
    root: "mnemion",
    intent: "a dense real-world module",
    generatedAt: "2026-07-13T12:00:00.000Z",
    head: "beef123",
    dirty: false,
    zones: [{ name: "hive", intent: "the swarm", inside: null }],
    components: [{
      label: "Hive", dir: "hive", intent: "sixteen laws, none assessed", zone: "hive",
      gates, relies: [], mass: { files: 12, lines: 800 }, accounted: { files: 10, lines: 672 },
    }],
    review: null,
  };
}
const denseUniform = denseComponent(false);
const denseFail = denseComponent(true);

// ── the review variant: same anatomy + a kind-grouped ledger with every alarm kind + the
// good-news kinds (including "placed"), and a duplicate kind to exercise group counts. ──
const reviewModel: PromiseModel = {
  ...model,
  generatedAt: "2026-07-13T13:00:00.000Z",
  head: "def5678",
  dirty: false,
  components: model.components.map((c) =>
    c.dir === "edge/webhook" ? { ...c, change: "added" as const } : c),
  review: {
    base: "main",
    // severity-ordered: alarms first (demoted with non-empty blast, withdrawn, naked), then
    // the calm kinds (promoted, covered ×2, placed, arrived). One of every required kind.
    events: [
      { kind: "demoted", comp: "edge/http", inv: "authenticated", from: "A", to: "B",
        detail: "oracle went stale — green aging, 2 commits since the last pass",
        blast: [".", "edge/webhook"] }, // DEMOTED with a non-empty blast
      { kind: "withdrawn", comp: "core/crypto/keys", inv: "old-rotation",
        detail: "the rotation gate was removed", blast: ["."] },
      { kind: "naked", comp: "edge/http", inv: "",
        detail: "a new import of keys crosses an ungated wall", blast: [] },
      { kind: "promoted", comp: ".", inv: "boot-sealed", from: "C", to: "A",
        detail: "a machine oracle now proves it at HEAD", blast: [] },
      { kind: "covered", comp: "core/crypto/keys", inv: "keys-guarded",
        detail: "a guard now stands at the custody wall", blast: [] },
      { kind: "covered", comp: "edge/http", inv: "authenticated",
        detail: "a token oracle now stands at the edge wall", blast: [] },
      { kind: "placed", comp: ".", inv: "entropy-fresh", from: "unplaced", to: "edge→core",
        detail: "the gate's crossing was declared — the promise now stands on a named wall",
        blast: [] }, // PLACED — an unplaced gate's crossing declared (good-news family)
      { kind: "arrived", comp: "edge/webhook",
        detail: "a new component appeared", blast: [] },
    ],
    outside: { added: 1, removed: 0, changed: 2 }, // 3 files the graph does not own
  },
};

const reviewDoc = renderContract(reviewModel, "2026-07-13T13:00:00.000Z");

test("(a) emits one complete, self-standing HTML document", () => {
  assert.ok(doc.startsWith("<!doctype"), "starts with a doctype");
  assert.match(doc, /<html[\s>]/);
  assert.match(doc, /<\/html>\s*$/);
  assert.match(doc, /<section id="instrument"/, "carries the instrument host");
  assert.match(doc, /<svg id="arcs"/, "carries the arc-gutter svg overlay");
  assert.match(doc, /do not edit; run the harness\./, "carries the standard footer stamp");
});

test("(b) SELF-CONTAINMENT — zero external resources (no http(s):// anywhere)", () => {
  assert.equal(/https?:\/\//.test(doc), false, "no external URL may appear in the document");
  assert.equal(/https?:\/\//.test(reviewDoc), false, "…nor in a review anatomy");
});

test("(c) component labels, zone names, gate invariants and event details surface", () => {
  assert.ok(doc.includes("kernel"), "component label present");
  assert.ok(doc.includes("core/crypto"), "a nested zone name present");
  assert.ok(doc.includes("edge"), "a zone name present");
  assert.ok(doc.includes("boot-sealed"), "a gate invariant present");
  assert.ok(doc.includes("entropy-fresh"), "the unplaced gate's invariant present");
  assert.ok(doc.includes("rate-limited"), "the breached gate's invariant present");
  // event detail sentences surface in the review doc (they ride the embedded JSON blob)
  assert.ok(reviewDoc.includes("oracle went stale"), "a demoted event's detail surfaces");
  assert.ok(reviewDoc.includes("a new import of keys crosses an ungated wall"), "a naked event's detail surfaces");
});

test("(d) the embedded model round-trips through JSON.parse", () => {
  const m = doc.match(/<script id="contract-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, "found the embedded JSON blob");
  const parsed = JSON.parse(m![1]);
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(model)), "blob parses back to the model");
});

test("(e) a hostile <script> label is embedded escaped, never live", () => {
  assert.equal(doc.includes("<script>alert"), false, "the injected tag must not appear unescaped");
  assert.ok(doc.includes("\\u003cscript>alert"), "it is present, but the opening < is neutralized to \\u003c");
});

// ── (g) REVIEW CHROME is server-conditional: present ONLY when model.review is non-null ──
test("(g) review chrome (masthead chip, outside tally, ledger panel) appears only in a review", () => {
  assert.ok(reviewDoc.includes("review vs main"), "review masthead names the base ref");
  assert.equal(doc.includes("review vs"), false, "a standing anatomy carries NO review masthead");
  assert.ok(reviewDoc.includes("3 changes outside the map"), "the outside tally sums the unowned changes");
  assert.equal(doc.includes("outside the map"), false, "a standing anatomy carries NO outside tally");
  assert.ok(reviewDoc.includes('id="ledger"'), "the ledger panel shell is present in a review");
  assert.equal(doc.includes('id="ledger"'), false, "a standing anatomy carries NO ledger panel");
  assert.ok(reviewDoc.includes('"review":{"base":"main"'), "review descriptor embedded");
  assert.ok(doc.includes('"review":null'), "standing anatomy embeds review:null");
});

// ════════════════════════════════════════════════════════════════════════════════════
//  DOM-STUB HARNESS — run the inline client script against a fake document so we can
//  assert on the rows/arcs/ledger it builds and drive pointer + keyboard interaction.
//  (mirrors render-scene.test.ts's harness discipline)
// ════════════════════════════════════════════════════════════════════════════════════
type StubEl = any;

function matchSel(e: StubEl, sel: string): boolean {
  if (!e || !e.attributes) return false;
  if (sel[0] === ".") return (e.attributes.class || "").split(/\s+/).indexOf(sel.slice(1)) >= 0;
  if (sel[0] === "#") return e.attributes.id === sel.slice(1);
  return e.tagName === sel.toLowerCase();
}

function runContract(m: PromiseModel) {
  const html = renderContract(m, "2026-07-13T13:00:00.000Z");
  const registry: Record<string, StubEl> = {};

  function mkEl(tag: string): StubEl {
    const e: StubEl = { tagName: (tag || "").toLowerCase(), attributes: {}, children: [], parentNode: null, listeners: {}, _text: "", style: {} };
    e.setAttribute = (k: string, v: any) => { e.attributes[k] = String(v); if (k === "id") registry[v] = e; };
    e.getAttribute = (k: string) => (k in e.attributes ? e.attributes[k] : null);
    e.hasAttribute = (k: string) => k in e.attributes;
    e.appendChild = (c: StubEl) => { c.parentNode = e; e.children.push(c); return c; };
    e.removeChild = (c: StubEl) => { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); c.parentNode = null; return c; };
    Object.defineProperty(e, "firstChild", { get: () => e.children[0] || null, configurable: true });
    Object.defineProperty(e, "textContent", {
      get: () => (e._text !== "" ? e._text : e.children.map((c: StubEl) => c.textContent || "").join(" ")),
      set: (v: any) => { e._text = String(v); e.children = []; }, configurable: true,
    });
    Object.defineProperty(e, "className", { get: () => e.attributes.class || "", set: (v: any) => { e.attributes.class = String(v); }, configurable: true });
    e.classList = {
      add: (c: string) => { const s = (e.attributes.class || "").split(/\s+/).filter(Boolean); if (s.indexOf(c) < 0) s.push(c); e.attributes.class = s.join(" "); },
      remove: (c: string) => { e.attributes.class = (e.attributes.class || "").split(/\s+/).filter(Boolean).filter((x: string) => x !== c).join(" "); },
      contains: (c: string) => (e.attributes.class || "").split(/\s+/).indexOf(c) >= 0,
    };
    e.addEventListener = (t: string, fn: any) => { (e.listeners[t] = e.listeners[t] || []).push(fn); };
    e.matches = (sel: string) => matchSel(e, sel);
    e.closest = (sel: string) => { let n: StubEl = e; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; } return null; };
    return e;
  }

  // the fixed elements the server-rendered shell would provide (the script only queries
  // these); wired parent→child the way the HTML nests them so closest() walks the chain
  const contractData = mkEl("script"); contractData.setAttribute("id", "contract-data");
  const jsonBlob = html.match(/<script id="contract-data" type="application\/json">([\s\S]*?)<\/script>/)![1];
  contractData._text = jsonBlob; // exactly what the browser hands JSON.parse
  const instrument = mkEl("section"); instrument.setAttribute("id", "instrument");
  const arcs = mkEl("svg"); arcs.setAttribute("id", "arcs");
  const bands = mkEl("div"); bands.setAttribute("id", "bands");
  instrument.appendChild(arcs); instrument.appendChild(bands);
  if (m.review) { const ol = mkEl("ol"); ol.setAttribute("id", "ledger-list"); }

  const docListeners: Record<string, any[]> = {};
  const document = {
    createElementNS: (_ns: string, tag: string) => mkEl(tag),
    createElement: (tag: string) => mkEl(tag),
    createTextNode: (t: any) => ({ textContent: String(t), tagName: "#text", nodeType: 3, parentNode: null }),
    getElementById: (id: string) => registry[id] || null,
    querySelectorAll: (_sel: string) => [] as StubEl[],
    addEventListener: (t: string, fn: any) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  };

  const context: any = { document, Math, JSON, Date, console };
  vm.createContext(context);
  const code = html.slice(html.indexOf("(function(){"), html.lastIndexOf("</script>"));
  vm.runInContext(code, context);

  function fire(el: StubEl, type: string, evt: any) { (el.listeners[type] || []).forEach((fn: any) => fn(evt)); }
  function fireDoc(type: string, evt: any) { (docListeners[type] || []).forEach((fn: any) => fn(evt)); }
  function walk(el: StubEl, out: StubEl[] = []) { out.push(el); (el.children || []).forEach((c: StubEl) => { if (c.children) walk(c, out); }); return out; }
  const byClass = (root: StubEl, c: string) => walk(root).filter((e) => e.attributes && (e.attributes.class || "").split(/\s+/).indexOf(c) >= 0);
  const rows = () => byClass(bands, "crow");
  const row = (dir: string) => rows().find((r: StubEl) => r.attributes["data-dir"] === dir);
  const arcsOf = (cls: string) => byClass(arcs, cls).filter((e: StubEl) => (e.attributes.class || "").split(/\s+/).indexOf("rarc") >= 0);
  const ev = (over: any = {}) => ({ preventDefault() {}, stopPropagation() {}, ...over });

  return { html, instrument, arcs, bands, registry, fire, fireDoc, walk, byClass, rows, row, arcsOf, ev };
}

// ── COLLAPSED BY DEFAULT — the balance-sheet steady state ────────────────────────────────
test("(f) collapsed rows are the default: one line per component; a uniform-grade 16-gate row shows ZERO chips", () => {
  const H = runContract(denseUniform);
  const rws = H.rows();
  assert.equal(rws.length, 1, "one row per component");
  const hive = rws[0];
  assert.equal(hive.classList.contains("open"), false, "the row arrives collapsed");
  // the gates lane: ONE summary capsule, NO individual chips (16 identical U chips carried
  // one bit — the flood collapses to the aggregate)
  const gatesCell = hive.children.find((c: StubEl) => (c.attributes.class || "") === "c-gates");
  const chips = H.byClass(gatesCell, "gchip");
  assert.equal(chips.length, 0, "a uniform-grade row itemizes NOTHING in its collapsed pose");
  const sums = H.byClass(gatesCell, "gsum");
  assert.equal(sums.length, 1, "exactly one summary capsule");
  assert.ok(sums[0].textContent.includes("16"), "the capsule counts all 16 gates");
  assert.ok(sums[0].textContent.includes("U"), "…and names the uniform grade (U prints, never blank)");
  // the state sentence's verb: a uniform-U row says why it is quiet violet
  const notes = H.byClass(gatesCell, "gnote");
  assert.ok(notes.some((n: StubEl) => n.textContent.includes("never assessed")), "the uniform-U note reads 'never assessed'");
});

test("(f1) exception chips itemize: a fail among 16 Us renders exactly ONE breach chip beside the capsule", () => {
  const H = runContract(denseFail);
  const gatesCell = H.byClass(H.bands, "c-gates")[0];
  const chips = H.byClass(gatesCell, "gchip");
  assert.equal(chips.length, 1, "exactly one exception chip (the breach) itemizes");
  assert.ok(chips[0].classList.contains("breach"), "…and it is the breach treatment (verdict fail)");
  assert.ok(H.byClass(gatesCell, "gsum").length === 1, "the capsule still aggregates the rest");
});

test("(f2) NO-OVERLAP BY CONSTRUCTION: lanes are grid tracks; gates content lives only in the gates lane", () => {
  // the collision class of the first cut: 16 chips at absolute x offsets running INTO the
  // exposure text. Now a row is a CSS grid (real tracks — pinned here as the shipped
  // stylesheet) and every gate mark is a DOM child of the .c-gates cell, a SIBLING of the
  // .c-exposure cell — the layout engine owns the boundary, so intrusion is impossible.
  assert.ok(H0().html.includes("grid-template-columns"), "rows are real grid tracks, not absolute offsets");
  function H0() { return runContract(denseFail); }
  const H = runContract(denseFail);
  const r = H.rows()[0];
  const cellClasses = r.children.map((c: StubEl) => c.attributes.class);
  // canonical lane order, as sibling cells
  assert.deepEqual(cellClasses.slice(0, 4), ["c-name", "c-gates", "c-exposure", "c-mass"],
    "the canonical pose is four sibling lane cells in fixed order");
  // every gate mark (capsule, chip, overflow badge) is inside the gates cell — none anywhere else
  const gatesCell = r.children[1], expCell = r.children[2];
  const gateMarks = [...H.byClass(r, "gchip"), ...H.byClass(r, "gsum"), ...H.byClass(r, "gate-badge")];
  const collapsedMarks = gateMarks.filter((mk: StubEl) => !mk.closest(".c-detail"));
  assert.ok(collapsedMarks.length >= 2, "the collapsed row has gate marks to check (" + collapsedMarks.length + ")");
  assert.ok(collapsedMarks.every((mk: StubEl) => mk.closest(".c-gates") === gatesCell),
    "every collapsed gate mark is contained in the gates lane");
  assert.equal(H.byClass(expCell, "gchip").length, 0, "the exposure lane contains zero gate chips");
  assert.equal(H.byClass(expCell, "gsum").length, 0, "…and zero capsules");
  // the exposure lane still got its own ink (the 16% unaccounted from the dense fixture)
  assert.ok(H.byClass(expCell, "ink").length >= 1, "the exposure lane carries its own guaranteed ink");
  // and the collapsed chip population is CAPPED (bounded by construction, not by luck)
  assert.ok(H.byClass(gatesCell, "gchip").length <= 4, "collapsed exception chips are hard-capped");
});

test("(f2b) WRAPPING EXPOSURE never meets the mass strip: ink wraps in-lane; the strip is a sibling grid cell, nothing absolute", () => {
  // the second collision class from real data: a two-line exposure mark ("2 reliances
  // unassessable — residence undeclared") with the mass strip drawn across its second
  // line. Structural fix, pinned here: (a) ink is allowed to WRAP inside its own track —
  // no white-space:nowrap on .ink, overflow-wrap set — so a long mark grows the row
  // instead of escaping the lane; (b) the strip lives in the SIBLING .c-mass grid cell of
  // the same row (normal grid auto height — the tallest cell drives the row); (c) nothing
  // in any lane is absolutely positioned, so cells cannot float over one another.
  const wrapModel: PromiseModel = JSON.parse(JSON.stringify(model));
  wrapModel.components.push({
    label: "session", dir: "edge/session", intent: "session tokens", zone: null,
    gates: [],
    relies: [
      { to: "edge/http", crossing: null, via: null },
      { to: ".", crossing: null, via: null },  // 2 crossing-null → the long two-line mark
    ],
    mass: { files: 4, lines: 260 }, accounted: { files: 1, lines: 60 },
  });
  const H = runContract(wrapModel);
  const r = H.row("edge/session");
  const expCell = r.children[2], massCell = r.children[3];
  assert.equal(expCell.attributes.class, "c-exposure", "exposure is the third lane cell");
  assert.equal(massCell.attributes.class, "c-mass", "the mass strip's cell is its SIBLING, the fourth lane");
  // the long aggregate mark is present in the exposure lane…
  const inks = H.byClass(expCell, "ink").map((t: StubEl) => t.textContent);
  assert.ok(inks.some((s: string) => s === "2 reliances unassessable — residence undeclared"),
    "the long two-line-prone mark lives in the exposure lane");
  // …and the strip (frame + accounted fill) is entirely inside the mass cell
  const frames = H.byClass(massCell, "mass-frame");
  assert.equal(frames.length, 1, "exactly one mass strip, inside the mass cell");
  assert.equal(H.byClass(expCell, "mass-frame").length, 0, "the exposure cell contains no strip");
  // the client sets only the fill's width — never any positioning
  const fill = H.byClass(massCell, "mass-acc")[0];
  assert.ok(/%$/.test(fill.style.width), "the accounted fill is a width percentage");
  assert.equal(fill.style.position, undefined, "the client positions nothing absolutely");
  // the shipped stylesheet: ink wraps in-lane, and no lane/strip rule is absolute/fixed
  const css = H.html.slice(H.html.indexOf("<style>"), H.html.indexOf("</style>"));
  const rule = (sel: string) => {
    const m = css.match(new RegExp(sel.replace(/[.#]/g, "\\$&") + "\\{[^}]*\\}"));
    return m ? m[0] : "";
  };
  assert.ok(!/white-space:nowrap/.test(rule(".ink")), "ink is NOT nowrap — a long mark wraps inside its track");
  assert.ok(/overflow-wrap/.test(rule(".ink")), "ink wraps even for unbroken strings");
  for (const sel of [".c-name", ".c-gates", ".c-exposure", ".c-mass", ".mass-frame", ".mass-acc", ".crow"]) {
    assert.ok(!/position:(absolute|fixed)/.test(rule(sel)), sel + " is in normal grid flow, never absolute/fixed");
  }
  assert.ok(/display:grid/.test(rule(".crow")), "the row remains a real grid");
});

test("(f2c) the ledger occupies its OWN layout track — never a fixed overlay over the instrument", () => {
  // the third collision class: row content running underneath the panel. Pinned: the
  // stage is a two-track grid (instrument column + an auto column the ledger fills), and
  // the ledger is position:sticky WITHIN that track — never fixed/absolute, so there is
  // no viewport width at which content can slide beneath it.
  const css = reviewDoc.slice(reviewDoc.indexOf("<style>"), reviewDoc.indexOf("</style>"));
  const stageRule = css.match(/#stage\{[^}]*\}/)![0];
  assert.ok(/display:grid/.test(stageRule), "the stage is a grid, not a free overlay surface");
  assert.ok(/grid-template-columns:minmax\(0,1fr\) auto/.test(stageRule),
    "instrument + ledger are two explicit tracks (the ledger's reserves itself when present)");
  const ledgerRules = [...css.matchAll(/#ledger\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(ledgerRules.some((r) => /position:sticky/.test(r)), "the ledger is sticky within its own track");
  assert.ok(ledgerRules.every((r) => !/position:fixed/.test(r) && !/position:absolute/.test(r)),
    "the ledger is never fixed/absolute over the instrument");
  // and in the DOM the ledger aside is a SIBLING of the instrument, not a child overlay
  assert.match(reviewDoc, /<\/section>\s*<aside id="ledger"/, "the ledger is the instrument's sibling in the stage");
  // below the two-track threshold the ledger leaves the side track (single column, in
  // flow) — so no viewport width exists where the rows and the panel share pixels
  assert.ok(/@media \(max-width:1100px\)\{[^@]*grid-template-columns:minmax\(0,1fr\)/.test(css),
    "narrow viewports collapse the stage to one column");
  assert.ok(/@media \(max-width:1100px\)\{[^@]*#ledger\{position:static/.test(css),
    "…with the ledger dropping into normal flow");
  // the row-grid track minimums must FIT the narrowest two-track instrument column
  // (~600px of row width at an 1100px viewport): minimums that exceed the column make
  // the last track overflow the row — the same occlusion in another costume.
  const crowRule = css.match(/\.crow\{[^}]*\}/)![0];
  const mins = [...crowRule.matchAll(/minmax\((\d+)px/g)].map((m) => +m[1]);
  assert.equal(mins.length, 4, "all four lanes declare a px minimum");
  const gaps = 3 * 16 + 20; // three column gaps + the row's own padding
  assert.ok(mins.reduce((a, b) => a + b, 0) + gaps <= 600,
    "lane minimums (+gaps) fit the narrowest two-track column (" + mins.join("+") + "+" + gaps + " ≤ 600)");
});

test("(f3) zone bands render in declared order, a nested band + the undeclared-residence band", () => {
  const H = runContract(model);
  const names = H.byClass(H.bands, "band-name").map((t: StubEl) => t.textContent);
  assert.deepEqual(names, ["core", "core/crypto", "edge", "undeclared residence"],
    "bands descend in declared order with the nested child inside its parent and exposure last");
  const bands = H.byClass(H.bands, "band");
  assert.ok(bands.some((b: StubEl) => b.classList.contains("nested") && b.attributes["data-zone"] === "core/crypto"),
    "the inside-pointer zone renders as a nested band");
  const undecl = H.byClass(H.bands, "undeclared");
  assert.ok(undecl.some((t: StubEl) => t.textContent === "undeclared residence"), "the exposure band names itself");
  assert.equal(H.rows().length, model.components.length, "one canonical row per component");
});

test("(f4) exposure ink aggregates the same-fact flood; a clean row says nothing", () => {
  const H = runContract(model);
  const inkTexts = H.byClass(H.bands, "ink").map((t: StubEl) => t.textContent);
  assert.ok(inkTexts.some((s: string) => /% unaccounted$/.test(s)), "an unaccounted share prints");
  assert.ok(inkTexts.some((s: string) => /naked/.test(s)), "a naked-reliance count prints");
  // the 17-arcs-for-one-fact lesson: crossing-null reliances collapse to ONE ink line
  assert.ok(inkTexts.some((s: string) => /unassessable — residence undeclared/.test(s)),
    "crossing-null reliances aggregate to one 'unassessable — residence undeclared' line");
  // STEADY STATE IS QUIET: the clean kernel row carries no exposure ink at all
  const kernelRow = H.row(".");
  const kernelExp = kernelRow.children.find((c: StubEl) => (c.attributes.class || "") === "c-exposure");
  assert.equal(H.byClass(kernelExp, "ink").length, 0, "a fully-accounted, placed, covered row shows nothing");
});

test("(f5) every grade letter A–U surfaces even in the collapsed sheet (capsules + exceptions)", () => {
  const H = runContract(model);
  const gateText = H.byClass(H.bands, "c-gates").map((c: StubEl) => c.textContent).join(" ");
  for (const g of ["A", "B", "C", "D", "U"]) {
    assert.ok(gateText.indexOf(g) >= 0, "grade " + g + " prints in the collapsed sheet (U is ink, never blank)");
  }
  // the vocabulary marks survive aggregation: the breach chip + the unplaced dashed chip
  // itemize as exceptions (kernel's U is worse-than-modal; http's D fails)
  assert.ok(H.byClass(H.bands, "breach").length >= 1, "a failing verdict itemizes as a breach chip");
  assert.ok(H.byClass(H.bands, "unplaced").length >= 1, "the crossing-null gate itemizes as an UNPLACED (dashed) chip");
  const guards = H.byClass(H.bands, "guard");
  assert.ok(guards.some((g: StubEl) => g.textContent === "⚑"), "a verb=guard gate appends the ⚑ flag");
});

// ── EXPAND ON DEMAND ─────────────────────────────────────────────────────────────────────
test("(h) click expands a row into the full anatomy; second click and Escape collapse", () => {
  const H = runContract(denseFail);
  const r = H.rows()[0];
  assert.equal(r.classList.contains("open"), false, "collapsed at rest");
  // click anywhere in the row expands
  H.fire(H.instrument, "click", H.ev({ target: r.children[0] }));
  assert.ok(r.classList.contains("open"), "click expands the row");
  // the detail area itemizes EVERY gate chip, wrapped — the full roster on demand
  const detail = r.children.find((c: StubEl) => (c.attributes.class || "") === "c-detail");
  assert.equal(H.byClass(detail, "gchip").length, 16, "the expanded anatomy shows all 16 chips");
  // each chip carries the full-posting tooltip (inv → chokepoint → … → crossing → reliants)
  const chip = H.byClass(detail, "gchip")[0];
  assert.ok(/law-0 → cp0 → no oracle → unknown → hive→hive → held by none/.test(chip.attributes.title),
    "the chip tooltip walks the whole posting (" + chip.attributes.title + ")");
  // the untruncated intent lives in the expanded row
  assert.ok(detail.textContent.includes("sixteen laws, none assessed"),
    "the full intent surfaces on expansion");
  // clicking inside the detail area does NOT collapse (interacting with the anatomy)
  H.fire(H.instrument, "click", H.ev({ target: chip }));
  assert.ok(r.classList.contains("open"), "clicking the anatomy keeps the row open");
  // a second row-click collapses
  H.fire(H.instrument, "click", H.ev({ target: r.children[0] }));
  assert.equal(r.classList.contains("open"), false, "second click collapses");
  // and Escape collapses too
  H.fire(H.instrument, "click", H.ev({ target: r.children[0] }));
  assert.ok(r.classList.contains("open"), "re-expanded");
  H.fireDoc("keydown", H.ev({ key: "Escape" }));
  assert.equal(r.classList.contains("open"), false, "Escape returns the sheet to steady state");
});

// ── ARCS: EXCEPTION + DEMAND ─────────────────────────────────────────────────────────────
test("(h2) only NAKED arcs draw by default; hover draws + lights a row's other arcs, both directions", () => {
  const H = runContract(model);
  // at rest: the single naked reliance is the only arc (findings are the exception ink)
  assert.equal(H.arcsOf("rarc").length, 1, "exactly the naked arc draws at rest");
  assert.equal(H.arcsOf("naked").length, 1, "…and it is the naked one");
  assert.equal(H.arcsOf("covered").length, 0, "covered arcs stay undrawn at rest");
  assert.equal(H.arcsOf("undeclared").length, 0, "undeclared arcs stay undrawn at rest");
  // hover the kernel: its covered reliance on keys AND http's covered reliance on it
  // (both directions) materialize and light
  const kernelRow = H.row(".");
  H.fire(H.instrument, "mousemove", H.ev({ target: kernelRow.children[0] }));
  assert.equal(H.arcsOf("covered").length, 2, "hover draws the covered arcs touching the row, both directions");
  const lit = H.arcsOf("lit");
  assert.ok(lit.length >= 2, "the hovered row's arcs light (" + lit.length + ")");
  assert.ok(kernelRow.classList.contains("active"), "the hovered row is marked active");
  const related = H.rows().filter((r: StubEl) => r.classList.contains("related")).map((r: StubEl) => r.attributes["data-dir"]);
  assert.ok(related.indexOf("core/crypto/keys") >= 0 && related.indexOf("edge/http") >= 0,
    "both counterpart rows are related (reliant and relied-upon)");
  // leaving the instrument returns to the exception-only state
  H.fire(H.instrument, "mouseleave", H.ev({}));
  assert.equal(H.arcsOf("rarc").length, 1, "leaving restores the naked-only gutter");
  assert.equal(H.rows().filter((r: StubEl) => r.classList.contains("active")).length, 0, "…and clears the active row");
});

test("(h3) an EXPANDED row keeps its arcs drawn without hover; undeclared arcs are demand-only", () => {
  const H = runContract(model);
  const webhookRow = H.row("edge/webhook");
  // expand the undeclared-residence component: its crossing-null arc materializes dashed
  H.fire(H.instrument, "click", H.ev({ target: webhookRow.children[0] }));
  assert.equal(H.arcsOf("undeclared").length, 1, "expansion draws the row's undeclared arc");
  // it persists with the pointer elsewhere (expanded = active, no hover needed)
  H.fire(H.instrument, "mouseleave", H.ev({}));
  assert.equal(H.arcsOf("undeclared").length, 1, "the expanded row's arc persists without hover");
  // collapse → the same-fact arc folds back into the exposure ink
  H.fire(H.instrument, "click", H.ev({ target: webhookRow.children[0] }));
  assert.equal(H.arcsOf("undeclared").length, 0, "collapse returns the arc to its aggregate ink");
});

// ── THE LEDGER: GROUPED BY KIND ──────────────────────────────────────────────────────────
test("(h4) the ledger groups by kind with counts — alarms expanded, good news collapsed", () => {
  const H = runContract(reviewModel);
  const list = H.registry["ledger-list"];
  const groups = H.byClass(list, "lgroup");
  // 7 distinct kinds in the fixture (covered appears twice → one group of 2)
  assert.equal(groups.length, 7, "one group per kind");
  const byKind: Record<string, StubEl> = {};
  groups.forEach((g: StubEl) => { byKind[g.attributes["data-kind"]] = g; });
  // ALARM kinds arrive EXPANDED
  for (const k of ["demoted", "withdrawn", "naked"]) {
    assert.ok(byKind[k].classList.contains("open"), k + " (alarm) arrives expanded");
    assert.ok(byKind[k].classList.contains("alarm"), k + " wears the alarm family class");
  }
  // GOOD-NEWS kinds arrive COLLAPSED to their count header
  for (const k of ["promoted", "covered", "placed", "arrived"]) {
    assert.equal(byKind[k].classList.contains("open"), false, k + " (good news) arrives collapsed");
    assert.equal(byKind[k].classList.contains("alarm"), false, k + " is not alarm-tinted");
  }
  // count headers: covered groups its two events
  const coveredCount = H.byClass(byKind["covered"], "lg-count")[0];
  assert.equal(coveredCount.textContent, "2", "the covered header counts both events");
  // a header click expands a collapsed good-news group
  const placedHd = H.byClass(byKind["placed"], "lg-hd")[0];
  H.fire(list, "click", H.ev({ target: placedHd }));
  assert.ok(byKind["placed"].classList.contains("open"), "clicking the header expands the group");
  // …revealing the placed entry with its unplaced→wall delta and detail sentence
  const placedEntry = H.byClass(byKind["placed"], "levent")[0];
  assert.ok(placedEntry.textContent.includes("unplaced") && placedEntry.textContent.includes("edge→core"),
    "the from→to delta (unplaced → the named wall) surfaces");
  assert.ok(placedEntry.textContent.includes("stands on a named wall"), "the detail sentence surfaces");
  assert.ok(H.byClass(byKind["placed"], "kind-placed").length === 1, "the placed badge wears its own good-news chip");
  // a second header click collapses again
  H.fire(list, "click", H.ev({ target: placedHd }));
  assert.equal(byKind["placed"].classList.contains("open"), false, "the header toggles");
});

test("(h5) clicking a ledger entry selects its component: row + chips + arcs light, others recede; Escape clears", () => {
  const H = runContract(reviewModel);
  const list = H.registry["ledger-list"];
  const entries = H.byClass(list, "levent");
  assert.equal(entries.length, reviewModel.review!.events.length, "one entry per event across the groups");
  const demoted = entries.find((e: StubEl) =>
    e.attributes["data-comp"] === "edge/http" && (e.attributes.class || "").indexOf("alarm") >= 0);
  assert.ok(demoted, "the demoted event is in the alarm family");
  assert.ok(demoted.textContent.includes("held by:"), "the demoted entry names its blast list");
  H.fire(list, "click", H.ev({ target: demoted }));
  assert.ok(demoted.classList.contains("on"), "the clicked entry is marked");
  const httpRow = H.row("edge/http");
  assert.ok(httpRow.classList.contains("selected"), "the event's component row is selected");
  assert.equal(httpRow.classList.contains("receded"), false, "the selected row does NOT recede");
  const others = H.rows().filter((r: StubEl) => r.attributes["data-dir"] !== "edge/http");
  assert.ok(others.length >= 1 && others.every((r: StubEl) => r.classList.contains("receded")), "untouched rows recede");
  // the selection lights the component's arcs (it owns the naked finding) and marks its chips
  assert.ok(H.arcsOf("lit").length >= 1, "the selected component's arcs are lit");
  assert.ok(H.byClass(httpRow, "sel").length >= 1, "the selected component's gate marks are highlighted");
  // Escape clears the whole selection
  H.fireDoc("keydown", H.ev({ key: "Escape" }));
  assert.equal(H.rows().filter((r: StubEl) => r.classList.contains("selected")).length, 0, "Escape clears the selected row");
  assert.equal(H.rows().filter((r: StubEl) => r.classList.contains("receded")).length, 0, "Escape restores the receded rows");
  assert.equal(H.arcsOf("lit").length, 0, "Escape quiets the arcs");
  assert.equal(demoted.classList.contains("on"), false, "Escape unmarks the ledger entry");
});

test("(h6) a demoted gate chip wears its A→B delta inline wherever it renders (review only)", () => {
  const H = runContract(reviewModel);
  // expand edge/http: its full roster includes the demoted 'authenticated' chip + delta
  const httpRow = H.row("edge/http");
  H.fire(H.instrument, "click", H.ev({ target: httpRow.children[0] }));
  const deltas = H.byClass(httpRow, "chip-delta").map((t: StubEl) => t.textContent);
  assert.ok(deltas.some((s: string) => s === "A→B"), "the demoted gate shows its grade delta inline (" + deltas.join(",") + ")");
  // a standing anatomy carries no review deltas
  const P = runContract(model);
  const kernelRow = P.row(".");
  P.fire(P.instrument, "click", P.ev({ target: kernelRow.children[0] }));
  assert.equal(P.byClass(P.bands, "chip-delta").length, 0, "a standing anatomy carries no review deltas");
});

test("(h7) an unknown event kind still prints — a neutral fallback group, never a blank badge", () => {
  // DEFENSIVE: a blob from a newer harness (or a hand-edited one) may carry a kind outside
  // the closed vocabulary. The renderer must not render a blank badge or crash — it groups
  // under the neutral kind-unknown chip, prints the kind's text, and defensively EXPANDS
  // (what we cannot classify must not also be hidden).
  const weird: PromiseModel = JSON.parse(JSON.stringify(reviewModel));
  (weird.review!.events as any[]).push(
    { kind: "transmogrified", comp: "edge/http", detail: "a kind from the future", blast: [] },
    { kind: "", comp: ".", detail: "an empty kind must still badge", blast: [] });
  const H = runContract(weird);
  const list = H.registry["ledger-list"];
  const entries = H.byClass(list, "levent");
  assert.equal(entries.length, weird.review!.events.length, "every event renders an entry, unknown kinds included");
  const unknownGroups = H.byClass(list, "lgroup").filter((g: StubEl) =>
    H.byClass(g, "kind-unknown").length > 0);
  assert.equal(unknownGroups.length, 2, "both out-of-vocabulary kinds fell back to the neutral chip");
  assert.ok(unknownGroups.every((g: StubEl) => g.classList.contains("open")), "unknown groups are defensively expanded");
  const badgeTexts = unknownGroups.map((g: StubEl) => H.byClass(g, "kind")[0].textContent);
  assert.ok(badgeTexts.indexOf("transmogrified") >= 0, "an unknown kind prints its own text");
  assert.ok(badgeTexts.indexOf("event") >= 0, "an empty kind prints the 'event' placeholder");
  // …and the known kinds still classify normally alongside them
  assert.ok(H.byClass(list, "kind-demoted").length >= 1, "known kinds keep their fixed chips");
});
