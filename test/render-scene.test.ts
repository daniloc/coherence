// render-scene.test.ts — the scene renderer's load-bearing guarantees: it emits ONE
// complete, SELF-CONTAINED HTML document (no external resource can sneak in), the model
// survives the embed round-trip, model strings surface for the eye, and a hostile label
// cannot break out of the JSON blob. The pixels are judged by a human; these assertions
// pin the properties a human can't eyeball on every run.
//
// The renderer draws the SVG client-side, so the marks (towers, tokens, ghost wireframes,
// the drag turntable) exist only after the inline script RUNS. A tiny DOM stub (below)
// executes that script against a fake document so we can assert on the produced tree:
// tower-per-file, capped gate tokens, drag-vs-click, the eased 60° snap, and — in a REVIEW
// scene — that ghost/accent marks materialize while the unchanged city recedes.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderScene } from "../src/render-scene.ts";
import type { SceneModel } from "../src/scene-model.ts";

const model: SceneModel = {
  root: "acme-ledger",
  intent: "double-entry ledger for a small bank",
  generatedAt: "2026-07-10T12:00:00.000Z",
  head: "abc1234",
  dirty: true,
  grid: { cols: 3, rows: 2 },
  verify: { lastFastAt: "2026-07-10T11:58:00.000Z", lastFullAt: "2026-07-08T09:00:00.000Z", failures: 1 },
  diff: null,
  components: [
    {
      // lit, mostly-claimed, a steel human-eye gate — the well-tended slab. Per-file
      // symbols sum to mass.symbols (40); the claimed subset sums to claimed.symbols (34).
      label: "Ledger",
      dir: ".",
      intent: "owns the balance invariant",
      why: "A double-entry system must never let debits and credits drift; this is the one home for that rule.",
      lot: { x: 0, y: 0 },
      mass: { files: 8, symbols: 40 },
      claimed: { files: 7, symbols: 34 },
      // 8 files (mass.files), 7 claimed (claimed.files); sorted by label, as scene.ts emits.
      // `lines` is the HEIGHT ruler; symbols the declaration surface. account.ts is the
      // deliberate honesty case: few symbols (6) but a big body (200 lines) → a tall tower,
      // proving height keys on LINES not symbols.
      pieces: [
        { label: "account.ts", path: "account.ts", lines: 200, symbols: 6, claimed: true },
        { label: "balance.ts", path: "balance.ts", lines: 40, symbols: 8, claimed: true },
        { label: "entry.ts", path: "entry.ts", lines: 55, symbols: 5, claimed: true },
        { label: "index.ts", path: "index.ts", lines: 8, symbols: 2, claimed: true },
        { label: "journal.ts", path: "journal.ts", lines: 70, symbols: 6, claimed: true },
        { label: "posting.ts", path: "posting.ts", lines: 44, symbols: 4, claimed: true },
        { label: "reconcile.ts", path: "reconcile.ts", lines: 90, symbols: 6, claimed: false },
        { label: "vault.ts", path: "vault.ts", lines: 30, symbols: 3, claimed: true },
      ],
      unclaimedSample: ["reconcile.ts", "internal/rounding"],
      gates: [
        { inv: "balances-net-zero", chokepoint: "postEntry", verb: "test", oracle: "net-zero totality", material: "steel", verdict: "pass", humanEye: false },
        { inv: "no-negative-vault", chokepoint: "denyOverdraw", verb: "guard", oracle: "vault totality", material: "steel", verdict: "pass", humanEye: true },
      ],
      unanchored: [],
      light: { level: "lit", fails: 0, stale: 0, freshest: "2026-07-10T11:58:00.000Z" },
      heat: 0.7,
      links: ["services/api"],
    },
    {
      // dark, mostly-unclaimed, scaffold gate, unanchored invariants ticking the outline.
      // symbols sum to 60; the 3 claimed files (app/server/session) sum to 10.
      label: "services/api",
      dir: "services/api",
      intent: "speaks HTTP to the outside",
      why: "",
      lot: { x: 2, y: 1 },
      mass: { files: 12, symbols: 60 },
      claimed: { files: 3, symbols: 10 },
      // 12 files, only 3 claimed — mostly-unlit mass, sorted by label
      pieces: [
        { label: "app.ts", path: "services/api/app.ts", lines: 60, symbols: 4, claimed: true },
        { label: "cors.ts", path: "services/api/cors.ts", lines: 35, symbols: 5, claimed: false },
        { label: "errors.ts", path: "services/api/errors.ts", lines: 48, symbols: 6, claimed: false },
        { label: "handlers/pay.ts", path: "services/api/handlers/pay.ts", lines: 120, symbols: 8, claimed: false },
        { label: "health.ts", path: "services/api/health.ts", lines: 12, symbols: 3, claimed: false },
        { label: "middleware/auth.ts", path: "services/api/middleware/auth.ts", lines: 80, symbols: 7, claimed: false },
        { label: "logging.ts", path: "services/api/logging.ts", lines: 40, symbols: 4, claimed: false },
        { label: "ratelimit.ts", path: "services/api/ratelimit.ts", lines: 66, symbols: 6, claimed: false },
        { label: "routes.ts", path: "services/api/routes.ts", lines: 95, symbols: 7, claimed: false },
        { label: "server.ts", path: "services/api/server.ts", lines: 24, symbols: 3, claimed: true },
        { label: "session.ts", path: "services/api/session.ts", lines: 28, symbols: 3, claimed: true },
        { label: "validate.ts", path: "services/api/validate.ts", lines: 40, symbols: 4, claimed: false },
      ],
      unclaimedSample: ["routes.ts", "middleware/auth", "handlers/pay"],
      gates: [
        { inv: "authenticated-only", chokepoint: "requireBearer", verb: "", oracle: "", material: "scaffold", verdict: "unknown", humanEye: false },
      ],
      unanchored: ["rate-limited", "idempotent-writes"],
      light: { level: "dark", fails: 0, stale: 0 },
      heat: 0.1,
      links: ["."],
    },
    {
      // a breached gate + a live failure dot + a HOSTILE label that must not break out.
      // symbols sum to 18; the 4 claimed files sum to 15.
      label: "<script>evil()</script>",
      dir: "services/worker",
      intent: "background settlement",
      why: "Settlement runs off the request path.",
      lot: { x: 1, y: 0 },
      mass: { files: 5, symbols: 18 },
      claimed: { files: 4, symbols: 15 },
      // 5 files, 4 claimed, sorted by label
      pieces: [
        { label: "claim.ts", path: "services/worker/claim.ts", lines: 46, symbols: 4, claimed: true },
        { label: "dedupe.ts", path: "services/worker/dedupe.ts", lines: 52, symbols: 4, claimed: true },
        { label: "queue.ts", path: "services/worker/queue.ts", lines: 30, symbols: 3, claimed: true },
        { label: "retry.ts", path: "services/worker/retry.ts", lines: 22, symbols: 3, claimed: false },
        { label: "settle.ts", path: "services/worker/settle.ts", lines: 38, symbols: 4, claimed: true },
      ],
      unclaimedSample: ["retry.ts"],
      gates: [
        { inv: "at-most-once", chokepoint: "claimJob", verb: "test", oracle: "dedupe totality", material: "breached", verdict: "fail", humanEye: false },
      ],
      unanchored: [],
      light: { level: "dim", fails: 1, stale: 2, freshest: "2026-07-05T09:00:00.000Z" },
      heat: 0.4,
      links: [],
    },
  ],
};

const doc = renderScene(model, "2026-07-10T12:00:00.000Z");

// ── a REVIEW scene: model.diff non-null, per-piece + per-district change flags ─────────
// One added district, one district with an added/removed/grown/shrunk mix, and one wholly
// UNCHANGED district that must recede. Removed pieces/districts carry their BASE symbols.
const diffModel: SceneModel = {
  root: "acme-ledger",
  intent: "double-entry ledger for a small bank",
  generatedAt: "2026-07-11T09:00:00.000Z",
  head: "def5678",
  dirty: false,
  grid: { cols: 3, rows: 2 },
  verify: { lastFastAt: "2026-07-11T08:59:00.000Z", failures: 0 },
  // outside: three files the graph does NOT own changed (a script, a CI file, a doc) — the
  // scene must surface "3 changes outside the map" rather than lie by omission.
  diff: { base: "main", outside: { added: 1, removed: 0, changed: 2 } },
  components: [
    {
      // the CHANGED district: a grown file, a shrunk file, a fresh add, a removed file
      label: "Ledger",
      dir: ".",
      intent: "owns the balance invariant",
      why: "The one home for the debits/credits rule.",
      lot: { x: 0, y: 0 },
      mass: { files: 6, symbols: 44 },
      claimed: { files: 5, symbols: 38 },
      // GREW/SHRANK are now measured in LINES (the height ruler); prevLines drives the
      // former-height markers, prevSymbols rides along as card copy.
      pieces: [
        { label: "balance.ts", path: "balance.ts", lines: 120, symbols: 18, claimed: true, change: "changed", prevSymbols: 8, prevLines: 40 },   // GREW
        { label: "entry.ts", path: "entry.ts", lines: 20, symbols: 4, claimed: true, change: "changed", prevSymbols: 12, prevLines: 90 },         // SHRANK
        { label: "index.ts", path: "index.ts", lines: 8, symbols: 2, claimed: true },                                                             // unchanged
        { label: "journal.ts", path: "journal.ts", lines: 70, symbols: 6, claimed: true },                                                        // unchanged
        { label: "netting.ts", path: "netting.ts", lines: 60, symbols: 9, claimed: true, change: "added" },                                       // NEW
        { label: "posting.ts", path: "posting.ts", lines: 44, symbols: 5, claimed: false, change: "removed" },                                    // GONE (ghost)
      ],
      unclaimedSample: ["posting.ts"],
      gates: [
        { inv: "balances-net-zero", chokepoint: "postEntry", verb: "test", oracle: "net-zero totality", material: "steel", verdict: "pass", humanEye: false },
      ],
      unanchored: [],
      light: { level: "lit", fails: 0, stale: 0, freshest: "2026-07-11T08:59:00.000Z" },
      heat: 0.5,
      links: [],
    },
    {
      // a wholly ADDED district (every file new) — plate rim goes accent, chip reads "+N"
      label: "services/audit",
      dir: "services/audit",
      intent: "append-only audit log",
      why: "Regulators require an immutable trail.",
      lot: { x: 2, y: 1 },
      mass: { files: 3, symbols: 21 },
      claimed: { files: 3, symbols: 21 },
      change: "added",
      pieces: [
        { label: "append.ts", path: "services/audit/append.ts", lines: 74, symbols: 7, claimed: true, change: "added" },
        { label: "index.ts", path: "services/audit/index.ts", lines: 20, symbols: 4, claimed: true, change: "added" },
        { label: "verify.ts", path: "services/audit/verify.ts", lines: 110, symbols: 10, claimed: true, change: "added" },
      ],
      unclaimedSample: [],
      gates: [],
      unanchored: [],
      light: { level: "dim", fails: 0, stale: 0 },
      heat: 0.9,
      links: [],
    },
    {
      // an UNCHANGED district — no change flags anywhere: must carry the `receded` class
      label: "services/api",
      dir: "services/api",
      intent: "speaks HTTP to the outside",
      why: "",
      lot: { x: 1, y: 2 },
      mass: { files: 3, symbols: 14 },
      claimed: { files: 2, symbols: 7 },
      pieces: [
        { label: "app.ts", path: "services/api/app.ts", lines: 60, symbols: 4, claimed: true },
        { label: "routes.ts", path: "services/api/routes.ts", lines: 95, symbols: 7, claimed: false },
        { label: "server.ts", path: "services/api/server.ts", lines: 24, symbols: 3, claimed: true },
      ],
      unclaimedSample: ["routes.ts"],
      gates: [
        { inv: "authenticated-only", chokepoint: "requireBearer", verb: "guard", oracle: "bearer totality", material: "steel", verdict: "pass", humanEye: false },
      ],
      unanchored: [],
      light: { level: "dim", fails: 0, stale: 1 },
      heat: 0.0,
      // imports the CHANGED Ledger district → lands in the BLAST RADIUS even though it is
      // itself unchanged (it must both recede AND wear a persistent blast ring).
      links: ["."],
    },
    {
      // a wholly REMOVED district — exists only in the base. Renders as a ghost plinth +
      // ghost towers on its reserved lot; carries its BASE pieces so the ghost has shape.
      label: "services/legacy",
      dir: "services/legacy",
      intent: "the old settlement path",
      why: "Superseded by services/worker.",
      lot: { x: 3, y: 0 },
      mass: { files: 2, symbols: 12 },
      claimed: { files: 0, symbols: 0 },
      change: "removed",
      pieces: [
        { label: "old-settle.ts", path: "services/legacy/old-settle.ts", lines: 88, symbols: 7, claimed: false, change: "removed" },
        { label: "old-queue.ts", path: "services/legacy/old-queue.ts", lines: 50, symbols: 5, claimed: false, change: "removed" },
      ],
      unclaimedSample: [],
      gates: [],
      unanchored: [],
      light: { level: "dark", fails: 0, stale: 0 },
      heat: 0.0,
      links: [],
    },
  ],
};

const diffDoc = renderScene(diffModel, "2026-07-11T09:00:00.000Z");

test("(a) emits one complete, self-standing HTML document", () => {
  assert.ok(doc.startsWith("<!doctype"), "starts with a doctype");
  assert.match(doc, /<html[\s>]/);
  assert.match(doc, /<\/html>\s*$/);
  assert.match(doc, /<svg[^>]*id="scene"/, "carries the scene svg host");
  assert.match(doc, /do not edit; run the harness\./, "carries the standard footer stamp");
});

test("(b) SELF-CONTAINMENT — zero external resources (no http(s):// anywhere)", () => {
  assert.equal(/https?:\/\//.test(doc), false, "no external URL may appear in the document");
  assert.equal(/https?:\/\//.test(diffDoc), false, "…nor in a review scene");
});

test("(c) component labels and gate invariant names surface in the document", () => {
  assert.ok(doc.includes("Ledger"), "component label present");
  assert.ok(doc.includes("services/api"), "component label with a slash present");
  assert.ok(doc.includes("balances-net-zero"), "gate invariant name present");
  assert.ok(doc.includes("authenticated-only"), "second gate invariant present");
  assert.ok(doc.includes("at-most-once"), "breached gate invariant present");
});

test("(d) the embedded model round-trips through JSON.parse", () => {
  const m = doc.match(/<script id="scene-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, "found the embedded JSON blob");
  const parsed = JSON.parse(m![1]);
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(model)), "blob parses back to the model");
});

test("(e) a hostile <script> label is embedded escaped, never live", () => {
  assert.equal(doc.includes("<script>evil"), false, "the injected tag must not appear unescaped");
  assert.ok(doc.includes("\\u003cscript>evil"), "it is present, but the opening < is neutralized to \\u003c");
});

test("(f) triangular-tower file labels + paths surface in the document (files are countable)", () => {
  // each file is one tower; label + repo path ride in the embedded JSON so a hover can name it
  assert.ok(doc.includes("balance.ts"), "a claimed tower's file label present");
  assert.ok(doc.includes("reconcile.ts"), "an unclaimed tower's file label present");
  assert.ok(doc.includes("handlers/pay.ts"), "a nested file label present");
});

test("(g) the isometric turntable exposes a rotate control", () => {
  // the map-rotate affordance of a management sim — client-side view rotation only
  assert.match(doc, /id="rot-(cw|ccw)"/, "carries a rotate button");
  assert.ok(doc.includes('class="rot"'), "the rotate control is class-tagged for the handler");
});

test("(h) gate tokens carry the capped-overflow discipline (icons never pile)", () => {
  // tokens are drawn client-side, so the static pin is the vocabulary the script ships:
  // class-tagged tokens, a fit-at-fixed-pitch cap, and the "+N" overflow chip — the
  // DOM-stub execution (below) proves a 20-gate district renders ≤ cap tokens + one badge.
  assert.ok(doc.includes("gtoken"), "gate tokens are class-tagged");
  assert.ok(doc.includes("gate-badge"), "the overflow chip class ships in the script");
  assert.match(doc, /Math\.min\(5,Math\.floor\(usable\/PITCH\)\)/, "visible count is fit-driven, capped at 5");
  assert.match(doc, /RANK=\{breached:0,steel:1,scaffold:2\}/, "alarms are never the ones hidden");
  // hidden human-eye overflow rides INSIDE the capsule label — never a separate floating glyph
  assert.match(doc, /\(eyeFrom\(n\)\?" \\u2691":""\)/, "the chip label inlines the hidden-eye flag");
});

// ── (i) diff CHROME is server-conditional: present only when model.diff is non-null ────
test("(i) the diff masthead + legend appear only in a review scene", () => {
  assert.ok(diffDoc.includes("diff vs main"), "review masthead names the base ref");
  assert.equal(doc.includes("diff vs"), false, "a plain scene carries NO diff masthead");
  assert.ok(diffDoc.includes("added tower"), "review legend gains the diff rows");
  assert.equal(doc.includes("added tower"), false, "a plain scene carries NO diff legend rows");
  // the model.diff descriptor (base + outside completeness counts) rides the embedded JSON
  assert.ok(diffDoc.includes('"diff":{"base":"main","outside":{"added":1,"removed":0,"changed":2}}'), "diff descriptor + outside embedded in the review model");
  assert.ok(doc.includes('"diff":null'), "plain scene embeds diff:null");
  // piece change flags survive the embed for the card/tooltip to name
  assert.ok(diffDoc.includes('"change":"added"') && diffDoc.includes('"change":"removed"') && diffDoc.includes('"change":"changed"'),
    "added/removed/changed flags embedded");
  assert.ok(diffDoc.includes('"prevLines":40'), "a grown tower's former LINE count (the height ruler) embedded");
});

// ════════════════════════════════════════════════════════════════════════════════════
//  DOM-STUB HARNESS — run the inline client script against a fake document so we can
//  assert on the SVG tree it builds and drive its pointer/keyboard interaction.
// ════════════════════════════════════════════════════════════════════════════════════
type StubEl = any;

function matchSel(e: StubEl, sel: string): boolean {
  if (!e || !e.attributes) return false;
  if (sel[0] === ".") return (e.attributes.class || "").split(/\s+/).indexOf(sel.slice(1)) >= 0;
  if (sel[0] === "#") return e.attributes.id === sel.slice(1);
  return e.tagName === sel.toLowerCase();
}

function runScene(m: SceneModel, opts: { deadRaf?: boolean } = {}) {
  const html = renderScene(m, "2026-07-11T09:00:00.000Z");
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
      get: () => (e._text !== "" ? e._text : e.children.map((c: StubEl) => c.textContent || "").join("")),
      set: (v: any) => { e._text = String(v); e.children = []; }, configurable: true,
    });
    Object.defineProperty(e, "className", { get: () => e.attributes.class || "", set: (v: any) => { e.attributes.class = String(v); }, configurable: true });
    // innerHTML: the script sets it on the card; store as text so textContent surfaces it
    Object.defineProperty(e, "innerHTML", { get: () => e._html || "", set: (v: any) => { e._html = String(v); e._text = String(v); e.children = []; }, configurable: true });
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

  // fixed elements the server-rendered HTML would provide (the script only queries these)
  const sceneData = mkEl("script"); sceneData.setAttribute("id", "scene-data");
  const jsonBlob = html.match(/<script id="scene-data" type="application\/json">([\s\S]*?)<\/script>/)![1];
  sceneData._text = jsonBlob;                                  // exactly what the browser hands JSON.parse
  const svg = mkEl("svg"); svg.setAttribute("id", "scene");
  for (const id of ["facing", "rot-ccw", "rot-cw", "rot-reset", "card", "tip"]) { const x = mkEl("div"); x.setAttribute("id", id); }

  const docListeners: Record<string, any[]> = {};
  const document = {
    createElementNS: (_ns: string, tag: string) => mkEl(tag),
    createElement: (tag: string) => mkEl(tag),
    createTextNode: (t: any) => ({ textContent: String(t), nodeType: 3, parentNode: null }),
    getElementById: (id: string) => registry[id] || null,
    querySelectorAll: (_sel: string) => [] as StubEl[],
    addEventListener: (t: string, fn: any) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  };
  const winListeners: Record<string, any[]> = {};
  const windowObj = { addEventListener: (t: string, fn: any) => { (winListeners[t] = winListeners[t] || []).push(fn); }, innerWidth: 1280, innerHeight: 800 };

  // a virtual clock so requestAnimationFrame eases deterministically (each flush frame
  // advances time well past the ease duration, so an ease settles in one flush).
  // deadRaf simulates the throttled/embedded contexts where rAF is DEFINED but its
  // callback never fires — the script's setTimeout watchdog must carry the ease alone.
  let clock = 0;
  const rafQ: any[] = [];
  const context: any = {
    document, window: windowObj, innerWidth: 1280, innerHeight: 800, Math, JSON, Date, console,
    performance: { now: () => clock },
    requestAnimationFrame: opts.deadRaf
      ? (_fn: any) => 0                                     // swallowed: never invoked
      : (fn: any) => { rafQ.push(fn); return rafQ.length; },
    setTimeout: (fn: any) => { rafQ.push(fn); return rafQ.length; },
  };
  vm.createContext(context);
  const code = html.slice(html.indexOf("(function(){"), html.lastIndexOf("</script>"));
  vm.runInContext(code, context);

  function flushRAF() { let guard = 0; while (rafQ.length && guard++ < 2000) { const fn = rafQ.shift(); clock += 300; fn(clock); } }
  function fire(el: StubEl, type: string, evt: any) { (el.listeners[type] || []).forEach((fn: any) => fn(evt)); }
  function fireWin(type: string, evt: any) { (winListeners[type] || []).forEach((fn: any) => fn(evt)); }
  function fireDoc(type: string, evt: any) { (docListeners[type] || []).forEach((fn: any) => fn(evt)); }
  function walk(el: StubEl, out: StubEl[] = []) { out.push(el); (el.children || []).forEach((c: StubEl) => { if (c.children) walk(c, out); }); return out; }
  const all = () => walk(svg);
  const byClass = (c: string) => all().filter((e) => e.attributes && (e.attributes.class || "").split(/\s+/).indexOf(c) >= 0);
  const facingText = () => (registry["facing"] ? registry["facing"].textContent : "");
  const cardOn = () => registry["card"].classList.contains("on");

  const ev = (over: any = {}) => ({ preventDefault() {}, stopPropagation() {}, button: 0, ...over });

  return { html, svg, registry, flushRAF, fire, fireWin, fireDoc, all, byClass, facingText, cardOn, ev, mkEl };
}

test("(j) initial render builds a floor, a plinth per district, and a tower per file", () => {
  const H = runScene(model);
  assert.ok(H.svg.children.length >= 3, "svg carries defs + the drawn layers");
  const slabs = H.byClass("slab");
  assert.equal(slabs.length, model.components.length, "one plinth (slab) per district");
  const towers = H.byClass("tower");
  const totalFiles = model.components.reduce((n, c) => n + c.pieces.length, 0);
  assert.equal(towers.length, totalFiles, "one tower per FILE across the whole city");
  // the viewBox got set (a frame was fit around the content)
  assert.ok(H.svg.attributes.viewBox && /\d/.test(H.svg.attributes.viewBox), "a viewBox was computed");
});

test("(k) a drag beyond threshold ROTATES the view and does NOT pin", () => {
  const H = runScene(model);
  const tower = H.byClass("tower")[0];
  assert.equal(H.facingText(), "0°", "starts at the 0° facing");
  H.fire(H.svg, "pointerdown", H.ev({ target: tower, clientX: 100, clientY: 100 }));
  H.fireWin("pointermove", H.ev({ target: tower, clientX: 300, clientY: 104 })); // dx=200 ≫ 5px → a drag
  H.fireWin("pointerup", H.ev({ target: tower, clientX: 300, clientY: 104 }));
  H.flushRAF();
  assert.equal(H.cardOn(), false, "a drag must NEVER pin a card");
  assert.notEqual(H.facingText(), "0°", "the view rotated away from 0°");
});

test("(l) a sub-threshold click PINS the district card", () => {
  const H = runScene(model);
  const slab = H.byClass("slab")[0];
  H.fire(H.svg, "pointerdown", H.ev({ target: slab, clientX: 200, clientY: 200 }));
  H.fireWin("pointerup", H.ev({ target: slab, clientX: 202, clientY: 201 }));       // moved <5px → a click
  assert.equal(H.cardOn(), true, "a click pins the card");
  assert.ok(H.registry["card"].textContent.includes("Ledger"), "the pinned card names the district");
});

test("(m) releasing a drag EASES to the nearest stable 60° facing", () => {
  const H = runScene(model);
  H.fire(H.svg, "pointerdown", H.ev({ target: H.byClass("tower")[0], clientX: 0, clientY: 0 }));
  H.fireWin("pointermove", H.ev({ clientX: 190, clientY: 2 }));   // 190·0.55 ≈ 104.5° mid-drag
  H.fireWin("pointerup", H.ev({ clientX: 190, clientY: 2 }));
  H.flushRAF();
  const deg = parseInt(H.facingText(), 10);
  assert.equal(deg % 60, 0, "the view rests on a multiple of 60° (" + H.facingText() + ")");
});

test("(n) the ⟲/⟳ buttons also animate a 60° step (no snap-cut)", () => {
  const H = runScene(model);
  H.fire(H.registry["rot-cw"], "click", H.ev({}));
  H.flushRAF();
  assert.equal(H.facingText(), "60°", "one CW step eases to 60°");
  H.fire(H.registry["rot-ccw"], "click", H.ev({}));
  H.fire(H.registry["rot-ccw"], "click", H.ev({}));
  H.flushRAF();
  assert.equal(H.facingText(), "300°", "two CCW steps wrap to 300°");
});

test("(o) a 20-gate district still renders ≤ 5 tokens + exactly one overflow capsule", () => {
  const many: SceneModel = JSON.parse(JSON.stringify(model));
  many.components = [many.components[0]];
  many.components[0].gates = [];
  for (let i = 0; i < 20; i++) {
    many.components[0].gates.push({
      inv: "inv-" + i, chokepoint: "cp" + i, verb: "test", oracle: "o" + i,
      material: i === 0 ? "breached" : i < 6 ? "steel" : "scaffold", verdict: "pass", humanEye: i % 5 === 0,
    });
  }
  const H = runScene(many);
  const tokens = H.byClass("gtoken");
  const badges = H.byClass("gate-badge");
  assert.ok(tokens.length <= 5, "no more than the fit-cap of tokens are seated (" + tokens.length + ")");
  assert.equal(badges.length, 1, "exactly one overflow capsule for the hidden gates");
  const badgeText = badges[0].textContent;
  assert.ok(/^\+\d+/.test(badgeText), "the capsule reads +N (" + badgeText + ")");
});

test("(p) tower height keys on LINES, not symbols — HEIGHT IS DEPTH", () => {
  const H = runScene(model);
  const towers = H.byClass("tower");
  const byFile: Record<string, StubEl> = {};
  towers.forEach((t) => { byFile[t.attributes["data-file"]] = t; });
  const tall = byFile["account.ts"];   // 200 lines, only 6 symbols
  const short = byFile["index.ts"];     // 8 lines, 2 symbols
  const extentTall = +tall.attributes["data-basey"] - +tall.attributes["data-topy"];
  const extentShort = +short.attributes["data-basey"] - +short.attributes["data-topy"];
  assert.ok(+tall.attributes["data-topy"] < +tall.attributes["data-basey"], "a tower's top is above its base");
  assert.ok(+tall.attributes["data-h"] > +short.attributes["data-h"], "more lines → a taller tower");
  assert.ok(extentTall > extentShort, "the taller tower's top rises higher above its base");
  // the honesty case: account.ts (6 symbols, 200 lines) must out-tower balance.ts
  // (8 symbols, 40 lines) — MORE symbols but FEWER lines → a SHORTER tower. Height is lines.
  const fewerSymbolsMoreLines = byFile["account.ts"];   // 6 sym · 200 ln
  const moreSymbolsFewerLines = byFile["balance.ts"];   // 8 sym · 40 ln
  assert.ok(+moreSymbolsFewerLines.attributes["data-h"] < +fewerSymbolsMoreLines.attributes["data-h"],
    "a file with MORE symbols but FEWER lines is SHORTER — lines drive height, not symbols");
});

test("(q) a REVIEW scene materializes ghost + accent marks; the unchanged city recedes", () => {
  const H = runScene(diffModel);
  // added: solid accented tower(s) exist (netting.ts, whole services/audit district)
  assert.ok(H.byClass("tower-added").length >= 1, "added towers rise in the construction accent");
  // removed: ghost wireframes (posting.ts + the whole services/legacy district's files)
  assert.ok(H.byClass("tower-removed").length >= 1, "removed towers stand as ghost wireframes");
  assert.ok(H.byClass("ghost").length >= 1, "a removed district renders a ghost plinth");
  // changed: grown/shrunk markers
  assert.ok(H.byClass("tower-changed").length >= 1, "changed towers carry a former-height marker");
  // the district change chip capsule seats by a district
  assert.ok(H.byClass("diff-chip").length >= 1, "a district change chip ('+N −N ~N') is seated");
  // the wholly-unchanged services/api district recedes (both its plinth and its towers)
  const recededSlab = H.byClass("slab").filter((s) => s.classList.contains("receded"));
  assert.ok(recededSlab.length >= 1, "an unchanged district's plinth carries the receded class");
  // …and a CHANGED district must NOT recede
  const changedSlabIdx = 0; // Ledger
  const ledgerSlab = H.byClass("slab").find((s) => s.attributes["data-idx"] === String(changedSlabIdx));
  assert.equal(ledgerSlab.classList.contains("receded"), false, "a changed district stays at full opacity");
});

test("(r) a PLAIN scene renders zero diff marks (no ghost/accent/receded/chip)", () => {
  const H = runScene(model);
  assert.equal(H.byClass("tower-added").length, 0, "no added marks in a plain scene");
  assert.equal(H.byClass("tower-removed").length, 0, "no removed marks");
  assert.equal(H.byClass("tower-changed").length, 0, "no changed marks");
  assert.equal(H.byClass("ghost").length, 0, "no ghost plinths");
  assert.equal(H.byClass("receded").length, 0, "nothing recedes");
  assert.equal(H.byClass("diff-chip").length, 0, "no district change chips");
});

test("(s) STATUS CHROME beats geometry — every chrome mark paints after every tower", () => {
  // Build a district whose towers project well taller than its rim tokens (one monolith
  // file with the scene's max symbols) plus a 20-gate row → tokens, a capsule, ⚑ flags,
  // fail dots AND a tall skyline in one plate. UI markers must never hide behind a
  // building: in document (=paint) order, every chrome element of every district comes
  // AFTER every tower/plinth of every district.
  const chromeModel: SceneModel = JSON.parse(JSON.stringify(model));
  chromeModel.components[0].pieces[1].symbols = 500;           // a monolith tower up front
  chromeModel.components[0].mass.symbols = 532;
  for (let i = 0; i < 18; i++) {
    chromeModel.components[0].gates.push({
      inv: "inv-x" + i, chokepoint: "cp" + i, verb: "test", oracle: "o" + i,
      material: "scaffold", verdict: "unknown", humanEye: i % 4 === 0,
    });
  }
  const H = runScene(chromeModel);
  const flat = H.all();
  const idxOf = (e: StubEl) => flat.indexOf(e);
  const isChrome = (e: StubEl) => {
    const cs = ((e.attributes && e.attributes.class) || "").split(/\s+/);
    return cs.indexOf("gtoken") >= 0 || cs.indexOf("gate-badge") >= 0 || cs.indexOf("fdot") >= 0 || cs.indexOf("diff-chip") >= 0;
  };
  const towers = H.byClass("tower");
  const slabs = H.byClass("slab");
  const chrome = flat.filter(isChrome);
  // tokens (fit-capped), the overflow capsule, fail dots — a real chrome population
  assert.ok(chrome.length >= 5, "the fixture produced a real chrome population (" + chrome.length + ")");
  const lastWorld = Math.max(...towers.map(idxOf), ...slabs.map(idxOf));
  const firstChrome = Math.min(...chrome.map(idxOf));
  assert.ok(firstChrome > lastWorld,
    "every chrome mark paints after every plinth+tower (first chrome @" + firstChrome + " vs last world @" + lastWorld + ")");
  // and in a REVIEW scene, a receded district's chrome dims WITH it (no full-brightness
  // markers floating over a ghost town) while a changed district's chrome stays bright
  const D = runScene(diffModel);
  const chromeGroups = D.byClass("chrome");
  const recededChrome = chromeGroups.filter((g) => g.classList.contains("receded"));
  const apiIdx = diffModel.components.findIndex((c) => c.dir === "services/api");
  assert.ok(recededChrome.some((g) => g.attributes["data-idx"] === String(apiIdx)),
    "the unchanged district's chrome carries the receded class");
  const ledgerChrome = chromeGroups.find((g) => g.attributes["data-idx"] === "0");
  assert.ok(ledgerChrome && !ledgerChrome.classList.contains("receded"),
    "a changed district's chrome stays at full brightness");
  // diff chips are chrome too: they live under a .chrome group, above the skyline
  const dChips = D.byClass("diff-chip");
  assert.ok(dChips.length >= 1 && dChips.every((c) => !!c.closest(".chrome")), "diff chips ride the chrome layer");
});

test("(t) ROTATION IS A CAMERA MOVE — fixed viewBox, rigid towers, static platter", () => {
  const H = runScene(model);

  // (t-a) θ NEVER ALTERS THE VIEWBOX: it is byte-identical before a drag, mid-drag, and
  // after settling at a new facing — only zoom/pan/resize move the camera, deliberately
  // (that side is covered by test (v)).
  const vb0 = H.svg.attributes.viewBox;
  assert.ok(vb0 && /\d/.test(vb0), "a viewBox was computed at load");
  const towers0 = H.byClass("tower");
  // capture per-tower rotated world coords at facing 0 for (t-b)
  const key = (t: StubEl) => t.attributes["data-idx"] + "/" + t.attributes["data-file"];
  const at0: Record<string, { x: number; y: number }> = {};
  towers0.forEach((t) => { at0[key(t)] = { x: +t.attributes["data-wx"], y: +t.attributes["data-wy"] }; });
  // ...and the platter snapshot for (t-c): gFloor is the first layer after defs
  const gFloor = H.svg.children[1];
  const floorPts0 = gFloor.children.map((c: StubEl) => c.attributes.points);
  assert.ok(floorPts0.length > 0, "the platter has cells");

  // drag mid-flight (no release yet): viewBox untouched
  H.fire(H.svg, "pointerdown", H.ev({ target: towers0[0], clientX: 0, clientY: 0 }));
  H.fireWin("pointermove", H.ev({ clientX: 80, clientY: 1 }));       // mid-drag, ~44°
  assert.equal(H.svg.attributes.viewBox, vb0, "viewBox is byte-identical MID-drag");
  H.fireWin("pointerup", H.ev({ clientX: 80, clientY: 1 }));
  H.flushRAF();                                                       // settle at 60°
  assert.equal(H.facingText(), "60°", "the drag settled at the 60° facing");
  assert.equal(H.svg.attributes.viewBox, vb0, "viewBox is byte-identical after settling");

  // (t-b) TOWERS ARE WORLD-FIXED: at the new facing every tower's world position equals
  // the RIGID rotation of its old one (+60° about the plaza) — a transform of the same
  // slot, never a re-assignment to a different slot.
  const rot60 = (p: { x: number; y: number }) => {
    const t = Math.PI / 3;
    return { x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) };
  };
  const towers1 = H.byClass("tower");
  assert.equal(towers1.length, towers0.length, "same tower population at the new facing");
  for (const t of towers1) {
    const before = at0[key(t)];
    assert.ok(before, "tower " + key(t) + " existed at facing 0");
    const expect = rot60(before);
    const gotX = +t.attributes["data-wx"], gotY = +t.attributes["data-wy"];
    assert.ok(Math.hypot(gotX - expect.x, gotY - expect.y) < 0.05,
      key(t) + " moved rigidly: got (" + gotX + "," + gotY + ") expected (" +
      expect.x.toFixed(2) + "," + expect.y.toFixed(2) + ")");
  }

  // (t-c) THE PLATTER IS STATIC: the floor cell set is identical at every angle — same
  // count, same geometry, drawn once and never redrawn or rotated with the drag.
  const floorPts1 = gFloor.children.map((c: StubEl) => c.attributes.points);
  assert.deepEqual(floorPts1, floorPts0, "the platter's cells are untouched by rotation");
});

test("(u) eases complete even when rAF never fires — the setTimeout watchdog drives", () => {
  // Simulates embedded panes / throttled tabs where requestAnimationFrame is defined but
  // a scheduled callback simply never runs (measured in the wild: no rAF in 800ms on a
  // visible page). Buttons, keys, and drag-release snapping must still land, in bounded
  // time, exactly on the target facing — the ~50ms watchdog carries every frame.
  const H = runScene(model, { deadRaf: true });

  // a button step still eases to the next 60° facing
  H.fire(H.registry["rot-cw"], "click", H.ev({}));
  H.flushRAF();                                        // flushes ONLY setTimeout callbacks
  assert.equal(H.facingText(), "60°", "a ⟳ step lands at 60° with rAF dead");

  // a drag release still snaps to the nearest 60° facing (it must not stay at ~104°)
  H.fire(H.svg, "pointerdown", H.ev({ target: H.byClass("tower")[0], clientX: 0, clientY: 0 }));
  H.fireWin("pointermove", H.ev({ clientX: 80, clientY: 1 }));   // 60 + 44 = ~104° mid-drag
  H.fireWin("pointerup", H.ev({ clientX: 80, clientY: 1 }));
  H.flushRAF();
  const deg = parseInt(H.facingText(), 10);
  assert.equal(deg % 60, 0, "the drag snapped to a 60° facing with rAF dead (" + H.facingText() + ")");
  assert.equal(H.facingText(), "120°", "…and specifically the NEAREST one");
});

test("(v) the management-sim camera — wheel zoom to cursor, shift-drag pan, reset round-trip", () => {
  const H = runScene(model);
  const vb = () => H.svg.attributes.viewBox as string;
  const parse = () => vb().split(" ").map(Number) as [number, number, number, number];
  // the stub window is 1280×800; the svg fills it (no getBoundingClientRect in the stub,
  // so the script falls back to window dims — same math as the real meet letterboxing)
  const toWorld = (cx: number, cy: number) => {
    const [x, y, w, h] = parse();
    const sc = Math.min(1280 / w, 800 / h);
    const ox = (1280 - w * sc) / 2, oy = (800 - h * sc) / 2;
    return { x: x + (cx - ox) / sc, y: y + (cy - oy) / sc };
  };
  const vb0 = vb();
  const w0 = parse()[2];

  // WHEEL ZOOM IN: the viewBox shrinks and the world point under the cursor stays put
  const cursor = { clientX: 900, clientY: 300 };
  const before = toWorld(cursor.clientX, cursor.clientY);
  H.fire(H.svg, "wheel", H.ev({ ...cursor, deltaY: -400 }));
  const w1 = parse()[2];
  assert.ok(w1 < w0, "zooming in shrinks the viewBox (" + w1.toFixed(1) + " < " + w0.toFixed(1) + ")");
  const after = toWorld(cursor.clientX, cursor.clientY);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.5,
    "the world point under the cursor is stationary through the zoom");

  // LEFT-DRAG still ROTATES at this zoom — and never pans: viewBox untouched
  const vbZoomed = vb();
  H.fire(H.svg, "pointerdown", H.ev({ target: H.byClass("tower")[0], clientX: 100, clientY: 400 }));
  H.fireWin("pointermove", H.ev({ clientX: 210, clientY: 402 }));
  H.fireWin("pointerup", H.ev({ clientX: 210, clientY: 402 }));
  H.flushRAF();
  assert.equal(H.facingText(), "60°", "left-drag rotated to the next facing");
  assert.equal(vb(), vbZoomed, "rotation left the zoomed viewBox byte-identical");

  // SHIFT+DRAG PANS: viewBox origin moves, θ does not, nothing pins
  const [px0] = parse();
  H.fire(H.svg, "pointerdown", H.ev({ target: H.byClass("tower")[0], clientX: 400, clientY: 400, shiftKey: true }));
  H.fireWin("pointermove", H.ev({ clientX: 250, clientY: 380, shiftKey: true }));
  H.fireWin("pointerup", H.ev({ clientX: 250, clientY: 380, shiftKey: true }));
  H.flushRAF();
  const [px1] = parse();
  assert.ok(px1 > px0, "dragging left pans the view right (x grew: " + px1.toFixed(1) + " > " + px0.toFixed(1) + ")");
  assert.equal(H.facingText(), "60°", "panning never rotates");
  assert.equal(H.cardOn(), false, "panning never pins");

  // DOUBLE-CLICK ON EMPTY GROUND resets zoom+pan to the fitted view, byte-exactly.
  // gFloor is the first layer after defs; its cells have no district ancestry.
  const groundCell = H.svg.children[1].children[0];
  H.fire(H.svg, "dblclick", H.ev({ target: groundCell, clientX: 640, clientY: 400 }));
  assert.equal(vb(), vb0, "double-click on ground round-trips to the fitted viewBox exactly");

  // …but double-click on a TOWER does not reset (those pin)
  H.fire(H.svg, "wheel", H.ev({ ...cursor, deltaY: -200 }));
  const vbz = vb();
  assert.notEqual(vbz, vb0, "zoomed again");
  H.fire(H.svg, "dblclick", H.ev({ target: H.byClass("tower")[0], clientX: 640, clientY: 400 }));
  assert.equal(vb(), vbz, "double-click on a tower leaves the camera alone");

  // the RESET BUTTON does the same round-trip, in the same token vocabulary
  H.fire(H.registry["rot-reset"], "click", H.ev({}));
  assert.equal(vb(), vb0, "the reset control restores the fitted viewBox exactly");

  // ZOOM CLAMP: a huge wheel-out cannot exceed 0.5× fit (w ≤ 2×fitted)
  H.fire(H.svg, "wheel", H.ev({ clientX: 640, clientY: 400, deltaY: 100000 }));
  const wOut = parse()[2];
  assert.ok(wOut <= 2 * w0 + 0.2, "zoom-out clamps at 0.5× fit (w=" + wOut.toFixed(1) + ")");
});

// ── (w) DISTRICT NAMEPLATES — the city gets street names, billboarded in the chrome ─────
test("(w) every district gets a persistent billboarded nameplate", () => {
  const H = runScene(model);
  const plates = H.byClass("nameplate");
  assert.equal(plates.length, model.components.length, "one nameplate per district at the default fit");
  // each carries a district index and a non-empty upright label
  for (const p of plates) {
    assert.ok(p.attributes["data-idx"] != null, "a nameplate is anchored to a district index");
    assert.ok((p.textContent || "").length > 0, "a nameplate carries readable text");
  }
  // a slashed label collapses to its last path segment (services/api → API)
  assert.ok(plates.some((p) => (p.textContent || "").indexOf("API") >= 0), "a long/slashed label shows its last segment");
  // nameplates ride the CHROME layer (gChrome, the last layer), so no tower can occlude them
  const gChrome = H.svg.children[H.svg.children.length - 1];
  const inChrome = (el: StubEl) => { let n: StubEl = el; while (n) { if (n.parentNode === gChrome) return true; n = n.parentNode; } return false; };
  assert.ok(plates.every(inChrome), "every nameplate lives under the chrome layer (never occluded)");
});

test("(w2) colliding nameplates are greedily culled, keeping the BIGGER district", () => {
  // FORCED overlap: with the quiet nameplate sizing, integer hex lots keep plates apart by
  // construction (pitch ≫ max plate width) — so this fixture uses a pathological fractional
  // lot to shove two max-length nameplates onto colliding positions and exercise the cull
  // deterministically. The greedy cull keeps the larger district's plate; the smaller loses
  // its nameplate (it regains the name on hover, via the tooltip).
  const cull: SceneModel = JSON.parse(JSON.stringify(model));
  const big = JSON.parse(JSON.stringify(model.components[0]));
  big.label = "alpha-district-one-long"; big.lot = { x: 0, y: 0 }; big.mass = { files: 20, symbols: 100 }; big.links = [];
  const small = JSON.parse(JSON.stringify(model.components[1]));
  small.label = "beta-district-two-long"; small.lot = { x: 0.4, y: 0 }; small.mass = { files: 2, symbols: 5 }; small.links = [];
  cull.components = [big, small];
  const H = runScene(cull);
  const plates = H.byClass("nameplate");
  assert.ok(plates.length < cull.components.length, "at least one colliding nameplate was culled (" + plates.length + ")");
  assert.ok(plates.some((p) => p.attributes["data-idx"] === "0"), "the BIGGER district (idx 0) keeps its nameplate");
  assert.ok(!plates.some((p) => p.attributes["data-idx"] === "1"), "the smaller, overlapping district lost its nameplate");
});

test("(w3) a nameplate is a quiet map label — narrower than the plate it names", () => {
  // the audit's follow-up: ROUTING's nameplate was WIDER than its plate. Pin the invariant:
  // for every placed nameplate, the halo rect is narrower than its district plate's
  // projected x-extent (the plate-top hexagon spans 2·plateSize at a rest facing).
  const H = runScene(model);
  const plates = H.byClass("nameplate");
  assert.ok(plates.length >= 1, "there are nameplates to measure");
  const slabs = H.byClass("slab");
  for (const p of plates) {
    const idx = p.attributes["data-idx"];
    const slab = slabs.find((s) => s.attributes["data-idx"] === idx)!;
    // the plate top is the polygon filled with the board colour
    const topFace = (slab.children || []).find((c: StubEl) => c.tagName === "polygon" && c.attributes.fill === "#141d27")!;
    const xs = topFace.attributes.points.split(" ").map((pt: string) => +pt.split(",")[0]);
    const plateExtent = Math.max(...xs) - Math.min(...xs);
    const rect = (p.children || []).find((c: StubEl) => c.tagName === "rect")!;
    assert.ok(+rect.attributes.width < plateExtent,
      "nameplate '" + p.textContent + "' (" + rect.attributes.width + ") is narrower than its plate (" + plateExtent.toFixed(1) + ")");
  }
});

// ── (x) LINKS ARE ON DEMAND — no always-on hairball; wiring follows hover/pin ────────────
test("(x) hovering a district draws its link lines; leaving removes them", () => {
  const H = runScene(model);
  assert.equal(H.byClass("link-line").length, 0, "no links are drawn at rest (the hairball is gone)");
  const ledger = H.byClass("slab").find((s) => s.attributes["data-idx"] === "0");
  H.fire(H.svg, "mousemove", H.ev({ target: ledger, clientX: 120, clientY: 120 }));
  const lit = H.byClass("link-line");
  assert.ok(lit.length >= 1, "hovering a district lights its outgoing + incoming links (" + lit.length + ")");
  assert.ok(H.byClass("link-out").length >= 1, "an outgoing (imports) line is drawn");
  assert.ok(H.byClass("link-in").length >= 1, "an incoming (imported-by) line is drawn");
  assert.ok(H.byClass("link-emph").length >= 1, "linked districts' rims are emphasised");
  H.fire(H.svg, "mouseleave", H.ev({}));
  assert.equal(H.byClass("link-line").length, 0, "leaving clears the wiring");
});

test("(x2) pinning a district keeps its links wired while the pointer roams", () => {
  const H = runScene(model);
  const slab = H.byClass("slab").find((s) => s.attributes["data-idx"] === "0");
  H.fire(H.svg, "pointerdown", H.ev({ target: slab, clientX: 200, clientY: 200 }));
  H.fireWin("pointerup", H.ev({ target: slab, clientX: 201, clientY: 200 }));   // a click → pin
  assert.equal(H.cardOn(), true, "the district pinned");
  assert.ok(H.byClass("link-line").length >= 1, "a pinned district keeps its links drawn (no hover needed)");
});

// ── (y) BLAST RADIUS — review scenes auto-ring importers of a changed district ───────────
test("(y) a review scene rings the blast radius of change; a plain scene has none", () => {
  const H = runScene(diffModel);
  const rings = H.byClass("blast-ring");
  assert.ok(rings.length >= 1, "the blast radius is ringed without any interaction");
  // services/api imports the CHANGED Ledger (".") → it must wear a blast ring
  const apiIdx = diffModel.components.findIndex((c) => c.dir === "services/api");
  assert.ok(rings.some((r) => r.attributes["data-idx"] === String(apiIdx)),
    "the importer of a changed district gets a blast ring");
  const P = runScene(model);
  assert.equal(P.byClass("blast-ring").length, 0, "a plain (non-review) scene has zero blast rings");
});

test("(y2) blast FLOOD GUARD — a dense import graph trades per-district rings for one chip", () => {
  // a hub-shaped graph: every other district imports the changed Ledger → the blast set is
  // 3 of 4 districts (75% > the ~40% threshold). Rings everywhere would be noise, not
  // signal — the guard stands the rings down and the masthead chip carries the count.
  const dense: SceneModel = JSON.parse(JSON.stringify(diffModel));
  dense.components[1].links = ["."];   // services/audit → Ledger
  dense.components[3].links = ["."];   // services/legacy → Ledger (api already imports ".")
  const denseDoc = renderScene(dense, "2026-07-11T09:00:00.000Z");
  assert.ok(denseDoc.includes("blast: 3 districts"), "the masthead chip sums the flooded blast set");
  assert.ok(denseDoc.includes("imports a changed district:"), "the chip's title names the blast districts");
  const H = runScene(dense);
  assert.equal(H.byClass("blast-ring").length, 0, "no per-district rings when the set floods");
  // the on-demand link display survives the guard: hovering the changed district still
  // wires every importer (dashed incoming lines)
  const ledger = H.byClass("slab").find((s) => s.attributes["data-idx"] === "0");
  H.fire(H.svg, "mousemove", H.ev({ target: ledger, clientX: 100, clientY: 100 }));
  assert.ok(H.byClass("link-in").length >= 3, "hover still shows who imports the changed district");
  // and the FOCUSED case (1 of 4 districts, the common PR) keeps its rings and shows no chip
  assert.ok(runScene(diffModel).byClass("blast-ring").length >= 1, "a focused blast set still rings");
  assert.equal(diffDoc.includes('class="intent blast-chip"'), false, "no flood chip on a focused review");
  assert.equal(doc.includes('class="intent blast-chip"'), false, "…and never on a plain scene");
});

// ── (z) HONESTY CUES — heat glow gone, claimed-dark keyline present, completeness chip ───
test("(z) the ambient heat underglow is gone — heat is a number, not a wash", () => {
  assert.equal(doc.includes("url(#heat)"), false, "no element references a heat gradient");
  assert.equal(doc.includes("radialGradient"), false, "the heat radialGradient def was removed");
  const H = runScene(model);
  assert.ok(!H.all().some((e) => e.tagName === "ellipse"), "no heat ellipse is drawn beneath any plate");
  // heat still surfaces as a number: the card reports it
  const slab = H.byClass("slab").find((s) => s.attributes["data-idx"] === "0");
  H.fire(H.svg, "pointerdown", H.ev({ target: slab, clientX: 200, clientY: 200 }));
  H.fireWin("pointerup", H.ev({ target: slab, clientX: 201, clientY: 200 }));
  assert.ok(H.registry["card"].textContent.includes("heat"), "heat is a labelled datum on the card");
});

test("(z2) the claimed keyline HUGS its tower's own top face; unclaimed dark has none", () => {
  const H = runScene(model);
  const keys = H.byClass("claim-key");
  // one keyline per claimed, non-added tower across the city (7 + 3 + 4 = 14)
  const claimedTowers = model.components.reduce((n, c) => n + c.pieces.filter((p) => p.claimed).length, 0);
  assert.equal(keys.length, claimedTowers, "every claimed tower carries a keyline (" + keys.length + ")");
  const pairs = (s: string) => (s || "").split(" ");
  for (const k of keys) {
    // a KEYLINE, not a badge: an open polyline along the top face's two front edges, quiet
    assert.equal(k.tagName, "polyline", "the keyline is an open polyline (front edges), not a closed badge");
    assert.equal(k.attributes.stroke, "#e6a83c", "the keyline is amber (the blueprint reads on the structure)");
    assert.equal(k.attributes["stroke-width"], "0.8", "0.8px — a keyline, never louder than the tower");
    assert.equal(k.attributes["stroke-opacity"], "0.5", "half opacity — a cue, not a shout");
    // it rides INSIDE the tower's own group, so it dims with `receded` and occludes with the world
    const tower = k.parentNode;
    assert.ok(tower && (tower.attributes.class || "").split(/\s+/).indexOf("tower") >= 0,
      "the keyline lives inside its tower's group");
    // GEOMETRY: every keyline vertex is EXACTLY a vertex of a polygon in the same tower
    // group (the top face) — same rotated world coords, same projected z through the same
    // proj(), so the keyline can never float free of or outscale the tower it marks.
    const kPairs = pairs(k.attributes.points);
    assert.equal(kPairs.length, 3, "two front edges share three top-face vertices");
    const polys = (tower.children || []).filter((c: StubEl) => c.tagName === "polygon");
    const hugs = polys.some((p: StubEl) => {
      const tp = pairs(p.attributes.points);
      return kPairs.every((kp: string) => tp.indexOf(kp) >= 0);
    });
    assert.ok(hugs, "keyline vertices ⊆ the tower's own top-face projected coords (exact match)");
  }
  // services/api is a DARK district; its claimed towers still keep the keyline
  const apiClaimed = H.byClass("tower").filter((t) => t.attributes["data-idx"] === "1" && t.attributes["data-claimed"] === "1");
  assert.ok(apiClaimed.length >= 1, "the dark district has claimed towers");
  const hasKey = (tw: StubEl) => (tw.children || []).some((c: StubEl) => (c.attributes && c.attributes.class) === "claim-key");
  assert.ok(apiClaimed.every(hasKey), "a claimed-but-dark tower is visibly distinct from unclaimed dark");
  // an unclaimed tower has NO keyline
  const unclaimed = H.byClass("tower").filter((t) => t.attributes["data-claimed"] === "0");
  assert.ok(unclaimed.length >= 1 && unclaimed.every((t) => !hasKey(t)), "unclaimed towers carry no keyline");
});

// ── (aa) COMPLETENESS — the outside-the-map chip only when the diff touched unowned files ─
test("(aa) the outside-the-map chip appears only when outside counts are non-zero", () => {
  assert.ok(diffDoc.includes("3 changes outside the map"), "the review sums the outside changes into a chip");
  assert.equal(doc.includes("outside the map"), false, "a plain scene never shows the completeness chip");
  // a review whose diff touched NOTHING outside the graph shows no chip
  const clean: SceneModel = JSON.parse(JSON.stringify(diffModel));
  clean.diff!.outside = { added: 0, removed: 0, changed: 0 };
  const cleanDoc = renderScene(clean, "2026-07-11T09:00:00.000Z");
  assert.equal(cleanDoc.includes("outside the map"), false, "zero outside counts → no chip");
});

// ── (bb) HONESTY — a never-verified project reads as a STATE, not a finished look ─────────
test("(bb) model.verify === null surfaces a 'never verified' call-to-action chip", () => {
  const dark: SceneModel = JSON.parse(JSON.stringify(model));
  dark.verify = null;
  const darkDoc = renderScene(dark, "2026-07-11T09:00:00.000Z");
  assert.ok(darkDoc.includes("never verified"), "the masthead explains why the city is dark");
  assert.ok(darkDoc.includes("coherence verify"), "…and names the command to run");
  assert.equal(doc.includes("never verified"), false, "a verified project shows no CTA chip");
});
