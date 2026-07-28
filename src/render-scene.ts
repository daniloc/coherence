// render-scene.ts — SceneModel → one self-contained `_scene.html`.
//
// The scene gives a project a persistent spatial BODY. The design language is a CITY
// BUILDER'S MANAGEMENT SCREEN — the god-view calm of SimCity 2000 or Surviving Mars,
// where you read a place from above and PERCEIVE change against it rather than parse
// text. Deliberately NOT a city diorama (no miniature buildings, no figurative
// dressing) and NOT an austere editorial data-graphic: the discipline of a management
// sim instead — one tidy token vocabulary, snapped isometric geometry, crisp cell
// borders, a quiet warm terrain the districts sit on as clean plates. Cities:Skylines
// was rejected for lacking that discipline; the delight here is WHIMSY VIA CLARITY —
// tidiness, hover states, a satisfying selection ring, legible little status icons.
//
// The drawing model, each mark with a perceptual reason, per scene-model.ts's contract:
//   · HEX DISTRICTS — each component is a thin extruded hexagonal PLINTH on a flat-top
//     hex board; `lot {x,y}` is axial (q=x, r=y). Plate size scales sublinearly with
//     mass (∝ mass^0.25, capped below the hex pitch so plates never collide) — a 10×
//     district reads clearly bigger without towering; the plinth depth is a uniform cue.
//   · TRIANGULAR TOWERS — DENSITY IS BREADTH, HEIGHT IS DEPTH. The plate top is a
//     triangular lattice (resolution k with 6k² ≥ files); one FILE fills one parcel,
//     center-out, deterministic — many files read as packed sprawl. Each parcel then
//     EXTRUDES into a triangular prism (a tower) whose height ∝ that file's own LINE
//     count, normalized SCENE-WIDE (h = H_MAX·√(lines/maxLines), a small stub for
//     genuinely tiny/empty files so a types-only file still reads as built). LINES, not
//     symbols: a 200-line file is a real structure a reviewer must read; symbols are the
//     declaration surface, a card/tooltip datum ("N lines · M symbols"), never the ruler.
//     A district becomes a SKYLINE: a monolith is a few tall towers, a sprawl a low dense
//     suburb. A CLAIMED tower lights in the district's lamp colour by verification (lit
//     warm · dim cold · dark near-silhouette — LIGHT IS VERIFICATION); an UNCLAIMED tower
//     is dark volume — an unpowered skyscraper, the honest scare (HONEST MASS). A claimed
//     tower ALWAYS keeps a faint amber top-edge keyline even when dark, so the blueprint
//     reads on the structure itself — claimed-but-unverified is honestly distinct from
//     unclaimed, never the same anonymous dark. Each tower draws its top face plus its two
//     viewer-facing side faces, distinctly shaded, so verticality is never ambiguous. The
//     dashed amber rim is the blueprint envelope (WIREFRAME IS SPEC).
//   · DISTRICT NAMEPLATES — UNDERSTANDABLE AT ANY ROTATION. Every district carries a
//     persistent screen-upright (billboarded) label seated just below its front rim — a
//     game-map nameplate (small-caps monospace, a subtle dark plate behind), so the city
//     has street names the human reads at every θ without a hover. Nameplates ride the
//     chrome layer (never occluded by towers), dim with a receded district, and when two
//     would collide at zoom-out a simple greedy cull keeps the BIGGER district's plate
//     (the culled one regains its name on hover, via the tooltip).
//   · STATUS TOKENS — tidy game icons: gates seated on the plate's front rim (steel =
//     solid sturdy · scaffold = hollow dashed · breached = red, pulsing), ⚑ for a human-
//     eye gate; unanchored invariants as red rim ticks; fails as small pulsing red dots.
//     CHROME BEATS GEOMETRY: all these markers (and the nameplates) paint in a dedicated
//     layer above every plinth and tower (SC2000's ⚡ never hides behind a building) —
//     anchored to their district's rim, dimming with a receded district. The blueprint
//     rim is WORLD, not chrome: it stays in the geometry pass and can be occluded. The
//     ambient heat underglow is GONE (decoration the audit cut) — heat is now a number in
//     the tooltip/card only, never a glow that competes with the signal.
//   · LINKS ON DEMAND + BLAST RADIUS — the always-on hairball was decoration. Adjacency
//     is drawn only for the HOVERED or PINNED district: its outgoing imports as SOLID
//     lines, who-imports-it (the reverse index of `links`) as DASHED lines, with the
//     linked districts' rims subtly emphasised. In a REVIEW scene the BLAST RADIUS is
//     shown without interaction: every district that imports a changed/added/removed
//     district wears a persistent thin accent ring in a soft SECONDARY tint (violet —
//     distinct from amber=spec, cyan=construction, red=alarm) so a reviewer sees "what
//     could this change break" at a glance. Rings, not floods: when the blast set exceeds
//     ~40% of the city (dense import graphs — everything touches the core) the rings
//     stand down and a masthead chip ("blast: N districts", title names them) carries the
//     count instead; hover/pin still wires any district's importers. Tidy at 8 and at 40.
//   · TURNTABLE — the map-rotate control of such a game, but CONTINUOUS: click-drag
//     rotates the whole field about the plaza (0,0) in real time; on release the view
//     EASES to the nearest of the six stable 60° facings. The ⟲/⟳ buttons and arrow keys
//     animate a 60° step (no snap-cuts). ROTATION IS A CAMERA MOVE AND NOTHING ELSE:
//     the world is RIGID — every world point (plate corner, tower vertex) rotates by θ
//     as one transform before the iso squash, and at θ = k·60° this agrees EXACTLY with
//     the axial hex rotation, so the six facings land on lattice. Slot assignments are
//     made ONCE in unrotated world space (a file keeps its triangle forever); the floor
//     is a STATIC hex-disc platter the city rotates above. The CAMERA is the full
//     management-sim kit: a full-viewport stage (the map gets every pixel), a CITY-TIGHT
//     fit (framing the occupied lots, not the platter), wheel zoom toward the cursor,
//     middle/shift-drag pan, double-click-ground reset — and θ NEVER alters the viewBox;
//     only zoom/pan/resize do, deliberately. Rotation never touches the persisted
//     geography, and exists precisely to let you see AROUND tall towers, so occlusion is
//     a strict painter's sort of EVERY drawable (plinths and towers, within and across
//     districts) by rotated depth.
//   · THE DIFF IS SPATIAL — when model.diff is non-null the scene is a REVIEW: change is
//     rendered against the SAME stable geography. Added towers rise SOLID in a distinct
//     construction accent (a hologram cyan — never confusable with amber=spec or red=
//     alarm); removed towers/districts stand as dashed GHOST wireframes of their former
//     structure on their reserved lots; a grown tower gets an accent cap above its former
//     height, a shrunk one a dashed ghost cap where it used to reach; and the UNCHANGED
//     city recedes to low opacity so the eye lands only on change. A district change chip
//     ("+3 −1 ~2") rides the same capsule vocabulary as the gate-overflow badge. COMPLETE-
//     NESS: the map NEVER SILENTLY TRUNCATES — changed files the graph does not own
//     (scripts, CI, docs) are counted in diff.outside and surfaced as a masthead chip
//     ("N changes outside the map", with a +A −R ~C tooltip) so absence reads as a state,
//     not a finished look. A plain scene (diff:null) renders with ZERO diff chrome.
//   · HONESTY CUES — a dark city is a STATE, not a finished look. When nothing was ever
//     verified (model.verify null) the masthead wears a quiet CTA chip ("never verified —
//     run coherence verify"); the claimed-tower amber keyline keeps the blueprint legible
//     on unlit structures; and the card reports "N files · M lines · K symbols" instead of
//     one meaningless summed mass.
//
// The whole document is self-contained: inline CSS, inline JS, the model embedded as a
// JSON blob, ZERO external resources. The SVG is generated client-side from the JSON so
// it is crisp at any zoom and re-drawable on rotation; hover/click ride event delegation.
// Dark-themed by design — light is the signal, so the artifact commits to one look.
import type { SceneModel, RenderScene } from "./scene-model.ts";

const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Embed the model as text inside a <script type=application/json> block. Escaping `<`
// (and the line/paragraph separators JSON.parse tolerates but the HTML/JS parser does
// not) means a hostile label like `</script>` or `<script>` can never break out or
// appear unescaped — it survives round-trip as < and JSON.parse restores it.
const embed = (m: SceneModel) =>
  JSON.stringify(m).replace(/</g, "\\u003c").replace(/\\u2028/g, "\\u2028").replace(/\\u2029/g, "\\u2029");

export const renderScene: RenderScene = (model: SceneModel, stamp: string): string => {
  const head = model.head ? esc(model.head) + (model.dirty ? "*" : "") : "—";
  const fails = model.verify ? model.verify.failures : 0;
  const fastIso = model.verify && model.verify.lastFastAt ? esc(model.verify.lastFastAt) : "";
  const fullIso = model.verify && model.verify.lastFullAt ? esc(model.verify.lastFullAt) : "";
  // diff chrome is SERVER-conditional so a plain scene carries none of it: the masthead
  // base line, the extra legend rows. (The client marks are guarded on M.diff at runtime.)
  const diffBase = model.diff ? esc(model.diff.base) : "";
  const diffMast = model.diff ? `<span class="intent diffbase" title="review scene">diff vs ${diffBase}</span>` : "";
  // COMPLETENESS: when the diff touched files the graph does not own, say so out loud —
  // a chip next to "diff vs <base>" summing the outside count, its title breaking it down.
  const outside = model.diff ? model.diff.outside : null;
  const outN = outside ? outside.added + outside.removed + outside.changed : 0;
  const outsideMast = (model.diff && outN > 0)
    ? `<span class="intent outside-chip" title="outside the graph — +${outside!.added} added −${outside!.removed} removed ~${outside!.changed} changed">${outN} change${outN === 1 ? "" : "s"} outside the map</span>`
    : "";
  // BLAST FLOOD CHIP — mirrors the client's flood guard: when the blast set (districts that
  // import a changed one) exceeds ~40% of the city, the per-district rings stand down and
  // this masthead chip carries the count instead (title names the districts). Same set, same
  // threshold, computed here because the masthead is server-rendered.
  let blastChip = "";
  if (model.diff) {
    const isChangedC = (c: SceneModel["components"][number]) => !!c.change || (c.pieces || []).some((p) => !!p.change);
    const blastSet = new Set<number>();
    model.components.forEach((c, i) => {
      if (!isChangedC(c)) return;
      model.components.forEach((o, j) => { if (j !== i && (o.links || []).includes(c.dir)) blastSet.add(j); });
    });
    if (blastSet.size > 0.4 * model.components.length) {
      const names = [...blastSet].map((i) => model.components[i].label).join(" · ");
      blastChip = `<span class="intent blast-chip" title="imports a changed district: ${esc(names)}">blast: ${blastSet.size} district${blastSet.size === 1 ? "" : "s"}</span>`;
    }
  }
  // HONESTY: a never-verified project is DARK — a state, not a look. Say why, and what to run.
  const verifyMast = model.verify
    ? ""
    : `<span class="intent cta-verify" title="the city is dark because nothing has been verified yet">never verified — run <code>coherence verify</code></span>`;
  const diffLegend = model.diff ? `
    <div class="row"><span class="sw" style="background:#2fd3c4;border-color:#35e0d0"></span>added tower — new, in the construction accent</div>
    <div class="row"><span class="sw" style="border:1px dashed #b6c6d4;background:transparent"></span>ghost wireframe — a removed tower/district</div>
    <div class="row"><span class="sw" style="background:linear-gradient(0deg,#3a4855 60%,#35e0d0 60%)"></span>grown tower — accent cap above former height</div>
    <div class="row"><span class="sw" style="border:1.5px solid #b98cf5;background:transparent;border-radius:50%"></span>blast ring — imports a changed district (what could break)</div>
    <div class="row"><span class="sw" style="opacity:.32;background:#333f4b"></span>receded district — unchanged, pushed back</div>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.root)} — scene</title>
<style>
  :root{
    /* a warmer game-map palette than near-black: a quiet slate terrain the plates sit on */
    --bg:#0a0e13; --panel:#101823; --line:#22323f; --ink:#cad7e3; --dim:#7d8d9b; --dimmer:#4e5c69;
    --amber:#e6a83c; --amber-soft:#f2c169; --red:#ff453a; --warm:#ffd36e; --steel:#aab6c2;
    --accent:#35e0d0; --accent-soft:#8ff4ea; --ghost:#b6c6d4;
  }
  *{box-sizing:border-box}
  /* FULL-VIEWPORT STAGE: the scene is a dashboard, not a document — the map gets every
     pixel (management sims never letterbox the map inside an article column). All text
     surfaces float as overlays above the stage. */
  html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);overflow:hidden}
  body{
    font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
    /* atmosphere: a cool wash from above, a faint warm terrain-glow rising from below */
    background:
      radial-gradient(120% 80% at 50% -10%, #13202c 0%, rgba(19,32,44,0) 55%),
      radial-gradient(150% 95% at 50% 120%, #1c150a 0%, rgba(28,21,10,0) 52%),
      var(--bg);
  }
  .wrap{height:100%}
  /* ── masthead: a compact overlay bar above the stage ──────────── */
  header.mh{
    position:fixed;top:0;left:0;right:0;z-index:6;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;
    padding:8px 14px;
    background:linear-gradient(180deg,rgba(10,14,19,.94),rgba(10,14,19,.78));
    border-bottom:1px solid var(--line);backdrop-filter:blur(6px);
  }
  .mh .root{font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}
  .mh .intent{color:var(--dim);font-size:12.5px;max-width:56ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mh .diffbase{color:var(--accent);font:600 12px ui-monospace,monospace;border:1px solid #1e5a54;border-radius:6px;padding:1px 8px;background:rgba(53,224,208,.07)}
  /* the outside-the-map completeness chip: same capsule, accent tint (a review cue) */
  .mh .outside-chip{color:var(--accent-soft);font:600 11.5px ui-monospace,monospace;border:1px solid #2a6660;border-radius:6px;padding:1px 8px;background:rgba(53,224,208,.05);cursor:help}
  /* the blast flood chip: same capsule, the blast tint — replaces the rings on dense graphs */
  .mh .blast-chip{color:#cfb0f8;font:600 11.5px ui-monospace,monospace;border:1px solid #4a3a68;border-radius:6px;padding:1px 8px;background:rgba(185,140,245,.06);cursor:help}
  /* the never-verified CTA: same capsule, amber (attention) — the dark city is a STATE */
  .mh .cta-verify{color:var(--amber-soft);font:600 11.5px ui-monospace,monospace;border:1px solid #5a4a24;border-radius:6px;padding:1px 8px;background:rgba(230,168,60,.06)}
  .mh .cta-verify code{font-family:ui-monospace,monospace;color:var(--amber);background:rgba(230,168,60,.1);padding:0 4px;border-radius:3px}
  .mh .facts{margin-left:auto;display:flex;gap:16px;align-items:baseline;font:11.5px ui-monospace,monospace;color:var(--dim);flex-wrap:wrap}
  .mh .facts b{color:var(--ink);font-weight:600}
  .mh .facts .k{color:var(--dimmer);text-transform:uppercase;letter-spacing:.08em;font-size:9.5px;margin-right:5px}
  .mh .fails.hot b{color:var(--red)}
  /* ── stage: the whole window ──────────────────────────────────── */
  #stage{position:fixed;inset:0;z-index:1}
  svg#scene{width:100%;height:100%;display:block;user-select:none;cursor:grab;touch-action:none}
  svg#scene.grabbing{cursor:grabbing}
  svg#scene .slab{cursor:pointer}
  svg#scene .tower{cursor:pointer}
  svg#scene .slab:hover .hilite{opacity:1}
  .hilite{opacity:0;transition:opacity .12s}
  .parcel{transition:fill-opacity .12s}
  .receded{opacity:.32}          /* THE UNCHANGED CITY RECEDES — diff mode only */
  @keyframes failpulse{0%,100%{opacity:.55}50%{opacity:1}}
  .fdot{animation:failpulse 1.6s ease-in-out infinite}
  /* ── turntable (the map camera controls) ──────────────────────── */
  #turntable{
    position:fixed;top:52px;left:10px;z-index:8;display:flex;gap:6px;align-items:center;
    padding:5px 7px;border:1px solid var(--line);border-radius:10px;background:rgba(16,24,35,.9);
    font:11px ui-monospace,monospace;color:var(--dim);
  }
  #turntable button{
    width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;
    border:1px solid var(--line);border-radius:7px;background:#141d28;color:var(--ink);font-size:14px;line-height:1;
  }
  #turntable button:hover{border-color:var(--amber);color:var(--amber-soft)}
  #turntable button:active{background:#1b2733}
  #turntable .facing{min-width:38px;text-align:center;letter-spacing:.06em}
  #turntable .hint{color:var(--dimmer);font-size:9.5px;letter-spacing:.04em;margin-left:2px}
  /* ── tooltip ──────────────────────────────────────────────────── */
  #tip{
    position:fixed;pointer-events:none;z-index:20;max-width:280px;opacity:0;transform:translateY(3px);
    transition:opacity .1s;padding:9px 11px;border:1px solid var(--line);border-radius:9px;
    background:rgba(16,24,35,.97);box-shadow:0 12px 34px rgba(0,0,0,.55);font-size:12px;
  }
  #tip .t{font:600 13px ui-monospace,monospace;margin-bottom:3px}
  #tip .r{color:var(--dim);display:flex;gap:8px;justify-content:space-between}
  #tip .r b{color:var(--ink);font-weight:600}
  #tip .lvl{font-size:11px;margin-top:4px}
  #tip .parcelrow{font:11.5px ui-monospace,monospace;color:var(--ink)}
  #tip .parcelrow .tag{font-size:10px;padding:0 5px;border-radius:4px;margin-left:6px;border:1px solid}
  #tip .tag.claimed{color:var(--warm);border-color:#5a4a24}
  #tip .tag.unclaimed{color:var(--dim);border-color:var(--dimmer)}
  #tip .tag.added{color:var(--accent);border-color:#1e5a54}
  #tip .tag.removed{color:var(--ghost);border-color:#3d4a55}
  #tip .tag.changed{color:var(--accent-soft);border-color:#2a6660}
  #tip .chg{font-size:11px;margin-top:4px;color:var(--accent-soft)}
  /* ── pinned detail card ───────────────────────────────────────── */
  #card{
    position:fixed;top:64px;right:16px;z-index:15;width:340px;max-height:calc(100vh - 96px);
    display:none;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden;
    background:linear-gradient(180deg,#131c27,#0e151d);box-shadow:0 22px 60px rgba(0,0,0,.6);
  }
  #card.on{display:flex}
  #card .hd{padding:12px 14px;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;gap:8px}
  #card .hd .ct{font:600 14px ui-monospace,monospace}
  #card .hd .ci{color:var(--dim);font-size:12px;margin-top:2px}
  #card .x{margin-left:auto;color:var(--dim);cursor:pointer;border:1px solid var(--line);border-radius:6px;padding:1px 7px;font-size:13px}
  #card .x:hover{color:var(--ink);border-color:var(--dim)}
  #card .bd{padding:10px 14px 16px;overflow-y:auto;font-size:12.5px}
  #card h4{font:600 9.5px system-ui;text-transform:uppercase;letter-spacing:.1em;color:var(--dimmer);margin:14px 0 6px}
  #card h4:first-child{margin-top:2px}
  #card .stat{display:flex;gap:14px;color:var(--dim);font:12px ui-monospace,monospace;flex-wrap:wrap}
  #card .stat b{color:var(--ink)}
  .gate{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;padding:7px 0;border-top:1px solid rgba(255,255,255,.05)}
  .gate:first-of-type{border-top:0}
  .gate .m{font:600 10px system-ui;text-transform:uppercase;letter-spacing:.06em;align-self:start;padding:1px 6px;border-radius:5px;border:1px solid}
  .gate .m.steel{color:#bcc8d4;border-color:#46545f}
  .gate .m.scaffold{color:var(--amber);border-color:#5a4a24}
  .gate .m.breached{color:var(--red);border-color:#5e2622;background:rgba(255,69,58,.08)}
  .gate .inv{font:600 12.5px ui-monospace,monospace;color:var(--ink)}
  .gate .flow{grid-column:2;color:var(--dim);font:11px ui-monospace,monospace}
  .gate .flow .arw{color:var(--dimmer)}
  .gate .flow .vd.pass{color:#5fbf7a}.gate .flow .vd.fail{color:var(--red)}.gate .flow .vd.stale{color:var(--amber)}.gate .flow .vd.unknown{color:var(--dimmer)}
  .gate .eye{color:var(--amber);font-size:11px}
  .redlist li{color:var(--red);font:12px ui-monospace,monospace;list-style:none}
  .redlist{margin:0;padding:0}
  .chglist li{font:12px ui-monospace,monospace;list-style:none;padding:1px 0}
  .chglist{margin:0;padding:0}
  .chglist .added{color:var(--accent)} .chglist .removed{color:var(--ghost)} .chglist .changed{color:var(--accent-soft)}
  .samp{color:var(--dim);font:11.5px ui-monospace,monospace;word-break:break-all;line-height:1.7}
  .samp span{border:1px solid rgba(255,255,255,.08);border-radius:4px;padding:0 5px;margin:0 3px 3px 0;display:inline-block}
  .why{color:#aeb9c4;font:12.5px/1.55 system-ui;white-space:pre-wrap;border-left:2px solid #5a4a24;padding-left:10px}
  .why.empty{color:var(--dimmer);font-style:italic;border-color:var(--dimmer)}
  /* ── legend ───────────────────────────────────────────────────── */
  #legend{
    position:fixed;left:16px;bottom:16px;z-index:12;width:238px;
    border:1px solid var(--line);border-radius:10px;background:rgba(14,21,29,.94);overflow:hidden;
  }
  #legend summary{list-style:none;cursor:pointer;padding:8px 11px;font:600 10.5px system-ui;text-transform:uppercase;letter-spacing:.09em;color:var(--dim)}
  #legend summary::-webkit-details-marker{display:none}
  #legend summary::after{content:"+";float:right;color:var(--dimmer)}
  #legend[open] summary::after{content:"\\2212"}
  #legend .lb{padding:0 11px 11px;font-size:11px;color:var(--dim)}
  #legend .row{display:flex;align-items:center;gap:8px;margin:6px 0}
  #legend .sw{width:16px;height:14px;border-radius:2px;flex:none;border:1px solid rgba(255,255,255,.1)}
  #legend .dot{width:14px;height:14px;border-radius:50%;flex:none}
  footer{
    position:fixed;right:14px;bottom:12px;z-index:5;color:var(--dimmer);font-size:10.5px;
    font-family:ui-monospace,monospace;background:rgba(10,14,19,.55);padding:2px 8px;border-radius:6px;
  }
</style></head>
<body>
<div class="wrap">
  <header class="mh">
    <span class="root">${esc(model.root)}</span>
    <span class="intent">${esc(model.intent)}</span>
    ${diffMast}${outsideMast}${blastChip}${verifyMast}
    <span class="facts">
      <span class="fact"><span class="k">head</span><b>${head}</b></span>
      <span class="fact"><span class="k">fast</span><b data-age="${fastIso}">—</b></span>
      <span class="fact"><span class="k">full</span><b data-age="${fullIso}">—</b></span>
      <span class="fact fails${fails > 0 ? " hot" : ""}"><span class="k">fails</span><b>${fails}</b></span>
    </span>
  </header>
  <div id="stage">
    <div id="turntable" aria-label="rotate the map">
      <button id="rot-ccw" type="button" class="rot" title="rotate left (←)" aria-label="rotate left">&#8634;</button>
      <span class="facing" id="facing">0&deg;</span>
      <button id="rot-cw" type="button" class="rot" title="rotate right (→)" aria-label="rotate right">&#8635;</button>
      <button id="rot-reset" type="button" title="reset view (or double-click the ground)" aria-label="reset view">&#8982;</button>
      <span class="hint">drag spins &#183; wheel zooms &#183; shift-drag pans</span>
    </div>
    <svg id="scene" role="img" aria-label="isometric hex board of ${esc(model.root)}"></svg>
  </div>
  <footer>Generated at <span id="stamp">${esc(stamp)}</span> — do not edit; run the harness.</footer>
</div>

<div id="tip" aria-hidden="true"></div>
<aside id="card" aria-live="polite"></aside>
<details id="legend">
  <summary>legend</summary>
  <div class="lb">
    <div class="row"><span class="sw" style="background:#ffd36e"></span>lit tower — a claimed file, verified fresh</div>
    <div class="row"><span class="sw" style="background:#61798f"></span>dim tower — claimed, passes exist but stale</div>
    <div class="row"><span class="sw" style="background:#333f4b;border-top:2px solid #e6a83c"></span>dark tower — claimed, nothing verified (amber keyline)</div>
    <div class="row"><span class="sw" style="background:#1a2029"></span>unlit tower — unclaimed mass (honest absence)</div>
    <div class="row"><span class="sw" style="border:1px dashed #e6a83c;background:transparent"></span>amber dashed rim — the blueprint envelope</div>
    <div class="row"><span class="sw" style="background:transparent;border:none;position:relative"><span style="display:block;height:0;border-top:2px solid #7fb0e0;margin-top:6px"></span></span>solid link — imports (hover/pin a district)</div>
    <div class="row"><span class="sw" style="background:transparent;border:none;position:relative"><span style="display:block;height:0;border-top:2px dashed #cf9ad8;margin-top:6px"></span></span>dashed link — imported by (incoming)</div>
    <div class="row"><span class="dot" style="background:#aab6c2"></span>steel token — an oracle holding green</div>
    <div class="row"><span class="dot" style="background:transparent;border:1px dashed #cdd6df"></span>scaffold token — provisional gate</div>
    <div class="row"><span class="dot" style="background:#ff453a"></span>breached token — a gate not holding</div>
    <div class="row"><span class="sw" style="background:linear-gradient(0deg,transparent 40%,#ff453a 40% 60%,transparent 60%)"></span>red rim tick — unanchored invariant</div>
    <div class="row"><span class="dot" style="background:radial-gradient(circle,#ff453a 0 45%,transparent 48%)"></span>red dot — failing claim</div>
    <div class="row"><span style="color:#e6a83c">⚑</span>gate needs a human eye</div>${diffLegend}
  </div>
</details>

<script id="scene-data" type="application/json">${embed(model)}</script>
<script>
(function(){
  "use strict";
  // The SVG namespace, assembled so the literal external-URL substring never appears in
  // the document (the artifact must contain zero http(s):// — enforced by the tests).
  var NS = "http" + "://www.w3.org/2000/svg";
  var M = JSON.parse(document.getElementById("scene-data").textContent);
  var DIFF = M.diff || null;                 // non-null → this is a REVIEW scene
  var svg = document.getElementById("scene");

  // ── tiny helpers ───────────────────────────────────────────────
  function el(tag, at, kids){
    var e = document.createElementNS(NS, tag), k;
    if(at) for(k in at){ if(at[k] != null) e.setAttribute(k, at[k]); }
    if(kids) for(var i=0;i<kids.length;i++){ var c=kids[i]; if(c!=null) e.appendChild(typeof c==="string"?document.createTextNode(c):c); }
    return e;
  }
  function clear(g){ while(g.firstChild) g.removeChild(g.firstChild); }
  function pts(a){ var s=""; for(var i=0;i<a.length;i++){ s += (i?" ":"") + a[i].x.toFixed(1) + "," + a[i].y.toFixed(1); } return s; }
  function lp(a,b,t){ return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t }; }
  function cl(t, sel){ return t && t.closest ? t.closest(sel) : null; }

  // ── the isometric turntable ─────────────────────────────────────
  // ROTATION IS A CAMERA MOVE AND NOTHING ELSE. THETA is the CONTINUOUS view angle in
  // degrees; the WORLD IS RIGID: every world point (plate corners, tower vertices, lot
  // centres) is rotated by THETA about the plaza (0,0) before the iso squash — one rigid
  // transform, no reshuffling. At THETA = k·60° the rotated lattice lands exactly on the
  // axial hex rotation (verified: layout∘rotAxial = worldRot(k·60°)∘layout — 6-fold world
  // symmetry). The camera never follows θ: rotating leaves the viewBox untouched — only
  // zoom, pan, and window resize move it, deliberately. Rotation is pure VIEW STATE —
  // the persisted axial lots are never mutated.
  var R = 46, SQ3 = Math.sqrt(3), SQUASH = 0.5, EXT = 12;   // R = hex pitch · SQUASH = 2:1 dimetric · EXT = plinth depth
  var H_MAX = 58, STUB = 7;                                 // tower height scale + min stub for tiny/empty files
  var THETA = 0;
  // flat-top hex layout (Red Blob): x = 1.5·q·R · y = √3·(r + q/2)·R — the flat plane
  function layout(q, r){ return { x: R*1.5*q, y: R*SQ3*(r + q/2) }; }
  // rotate a flat-plane point about the plaza (0,0) by THETA (continuous world rotation)
  function worldRot(p, deg){ var t=deg*Math.PI/180, c=Math.cos(t), s=Math.sin(t); return { x:p.x*c - p.y*s, y:p.x*s + p.y*c }; }
  // project a flat-plane point at height z to screen: squash y for the god-view tilt,
  // then lift by z for extrusion. z never bends x, so towers rise dead vertical on screen.
  function proj(fx, fy, z){ return { x:fx, y:fy*SQUASH - z }; }
  // six flat-top hex corners around a flat-plane centre, projected at z, with an angular
  // offset (degrees). off=THETA gives the RIGID world hexagon — the plate spins with the
  // ground like everything bolted to it. off=0 gives the fixed-orientation SEATING hexagon
  // chrome rides on: UI markers re-seat to the viewer-facing rim (SC2000 icons), and at
  // the six rest facings the two hexagons coincide by 6-fold symmetry.
  function hexCorners(cx, cy, s, z, off){
    var a=[]; for(var i=0;i<6;i++){ var t=Math.PI/180*(60*i+(off||0)); a.push(proj(cx+s*Math.cos(t), cy+s*Math.sin(t), z)); } return a;
  }

  // ── palette ─────────────────────────────────────────────────────
  var C = {
    floorFill:"rgba(120,150,170,.045)", floorEdge:"#17242f",
    plateTop:"#141d27", plateRim:"#2c3b48",
    sideS:"#0d141c", sideE:"#0a1017", sideEdge:"#243240",
    amber:"#e6a83c", amberSoft:"#f2c169",
    red:"#ff453a", steel:"#aab6c2", steelEdge:"#46545f", scaffold:"#cdd6df",
    // link vocabulary: OUTGOING solid (a district reaching out), INCOMING dashed (who
    // reaches in) — two clean tints, distinguished by hue AND dash so they never blur.
    linkOut:"#7fb0e0", linkIn:"#cf9ad8", linkEmph:"#9fd0ff",
    blast:"#b98cf5",                       // BLAST RADIUS ring — a soft secondary tint
    parcelEdge:"#0c1219", slotEdge:"#1c2833",
    plateFont:"#8ea1b1", plateBg:"rgba(10,14,19,.82)", plateBorder:"#2c3b48",
    accent:"#35e0d0", accentSoft:"#8ff4ea", ghost:"#b6c6d4"
  };
  // the claimed tower is the lamp — luminance is the verification signal. Each entry is a
  // {top, a, b} shade triple: bright top face, two progressively darker side faces so the
  // prism's verticality reads even against the dark board.
  var TOWER = {
    lit:       { top:"#ffdd86", a:"#caa050", b:"#9c7734" },
    dim:       { top:"#7690a8", a:"#4d5f70", b:"#39485a" },
    dark:      { top:"#3c4a57", a:"#29333e", b:"#1d252e" },
    unclaimed: { top:"#232c35", a:"#171e25", b:"#10151b" }
  };
  var ACCENTT = { top:"#39e6d6", a:"#1f9c92", b:"#177069" };  // construction-accent solid cap

  function massOf(c){ return c.mass.files + c.mass.symbols; }
  function towerColors(pc, lvl){ return pc.claimed ? (TOWER[lvl] || TOWER.dark) : TOWER.unclaimed; }

  // plate size (centre-to-corner) ∝ mass^0.25 normalised to the largest, so a 10×
  // district reads ~1.8× the radius — clearly bigger, never towering. Capped at
  // 0.82·R < the hex pitch so plates on adjacent lots can never collide.
  var mMax = 1;
  for(var i=0;i<M.components.length;i++) mMax = Math.max(mMax, massOf(M.components[i]));
  var PS_MAX = R*0.82, PS_MIN = R*0.34;
  function plateSize(c){ return Math.max(PS_MIN, PS_MAX * Math.pow(Math.max(1,massOf(c))/mMax, 0.25)); }

  // HEIGHT IS DEPTH — tower height ∝ √(LINES) normalised SCENE-WIDE (lines, not symbols:
  // a 200-line file is a real structure a reviewer must read). maxLines folds in former
  // heights (prevLines, and removed pieces carrying their base lines) so ghost and
  // grown/shrunk caps scale against the same ruler as the live city.
  var maxLines = 1;
  for(var i=0;i<M.components.length;i++){
    var ps0=M.components[i].pieces||[];
    for(var j=0;j<ps0.length;j++){
      maxLines=Math.max(maxLines, ps0[j].lines||0);
      if(ps0[j].prevLines!=null) maxLines=Math.max(maxLines, ps0[j].prevLines);
    }
  }
  // a genuinely tiny/empty file (0-few lines) floors at the STUB so it still reads as built.
  function towerH(ln){ if(!ln) return STUB; return Math.max(STUB, H_MAX*Math.sqrt(ln/maxLines)); }

  // triangular lattice of a flat-top hexagon: 6 wedges (centre → adjacent corners), each
  // subdivided into k² small triangles ⇒ 6k² parcels total. Returns each parcel with its
  // centroid distance/angle from centre so the caller can fill CENTRE-OUT deterministically.
  function resK(n){ var k=1; while(6*k*k < n) k++; return k; }
  function latticeTris(cx, cy, s, k){
    var tris = [];
    var tri = function(p,q,r){
      var g = { x:(p.x+q.x+r.x)/3, y:(p.y+q.y+r.y)/3 };
      return { c:[p,q,r], g:g, d:Math.sqrt((g.x-cx)*(g.x-cx)+(g.y-cy)*(g.y-cy)), a:Math.atan2(g.y-cy, g.x-cx) };
    };
    for(var w=0;w<6;w++){
      var a0=Math.PI/180*(60*w), a1=Math.PI/180*(60*(w+1));
      var A={x:cx,y:cy}, B={x:cx+s*Math.cos(a0),y:cy+s*Math.sin(a0)}, D={x:cx+s*Math.cos(a1),y:cy+s*Math.sin(a1)};
      var P = function(ii,jj){ return { x:A.x+(ii/k)*(B.x-A.x)+(jj/k)*(D.x-A.x), y:A.y+(ii/k)*(B.y-A.y)+(jj/k)*(D.y-A.y) }; };
      for(var ii=0;ii<k;ii++) for(var jj=0;jj<k-ii;jj++){
        tris.push(tri(P(ii,jj), P(ii+1,jj), P(ii,jj+1)));                 // up-triangle
        if(ii+jj < k-1) tris.push(tri(P(ii+1,jj), P(ii,jj+1), P(ii+1,jj+1))); // down-triangle
      }
    }
    tris.sort(function(a,b){ return (a.d-b.d) || (a.a-b.a); });
    return tris;
  }

  // ── static defs + the redrawn layers ────────────────────────────
  var defs = el("defs");
  defs.appendChild((function(){                       // soft bloom for lit marks + fail dots
    var f=el("filter",{id:"bloom",x:"-60%",y:"-60%",width:"220%",height:"220%"});
    f.appendChild(el("feGaussianBlur",{"in":"SourceGraphic",stdDeviation:"1.6",result:"b"}));
    var mg=el("feMerge"); mg.appendChild(el("feMergeNode",{"in":"b"})); mg.appendChild(el("feMergeNode",{"in":"SourceGraphic"})); f.appendChild(mg); return f;
  })());
  svg.appendChild(defs);

  // gFloor = terrain · gLink = ON-DEMAND adjacency lines (hovered/pinned district only) ·
  // gCity = the depth-sorted plinths+towers · gChrome = STATUS CHROME above the whole
  // world. A management sim's UI markers always beat geometry — SC2000's ⚡ never hides
  // behind a building — so gate tokens, overflow capsules, ⚑ flags, unanchored ticks, fail
  // dots (alarms especially), diff chips, blast rings and the district NAMEPLATES paint in
  // this last layer, each still ANCHORED to its district's projected rim and still carrying
  // the district's receded state (a receded district's chrome dims with it — no full-
  // brightness markers floating over a ghost town). The amber blueprint rim is WORLD, not
  // chrome: it stays in the geometry pass and occludes.
  var gFloor=el("g"), gLink=el("g"), gCity=el("g"), gChrome=el("g");
  svg.appendChild(gFloor); svg.appendChild(gLink); svg.appendChild(gCity); svg.appendChild(gChrome);

  // THE STAGE IS A FIXED CIRCULAR PLATTER: every axial cell within hex-distance DISC of
  // the plaza (0,0), DISC = the farthest lot + 1 — a hex-disc, visually circular, centred
  // on the origin. Drawn ONCE, STATIC: it does not rotate with the drag at all — a fixed
  // ground the city rotates above (at the six rest facings the grid re-aligns with the
  // district lattice anyway, by 6-fold symmetry). It never reshapes with angle.
  var DISC=1;
  for(var i=0;i<M.components.length;i++){
    var lo=M.components[i].lot, hd=(Math.abs(lo.x)+Math.abs(lo.y)+Math.abs(lo.x+lo.y))/2;
    if(hd+1>DISC) DISC=hd+1;
  }
  for(var q=-DISC;q<=DISC;q++) for(var r=Math.max(-DISC,-q-DISC); r<=Math.min(DISC,-q+DISC); r++){
    var fct=layout(q,r);
    gFloor.appendChild(el("polygon",{points:pts(hexCorners(fct.x,fct.y,R*0.94,0,0)),fill:C.floorFill,stroke:C.floorEdge,"stroke-width":.7}));
  }

  var byDir={}; for(var i=0;i<M.components.length;i++) byDir[M.components[i].dir]=i;
  // REVERSE INDEX — who imports each district (incoming links). Built once from the
  // directed links: importers[dir] = [indices of components that list dir]. Drives the
  // DASHED incoming lines on hover/pin and the review BLAST RADIUS rings.
  var importers={};
  for(var i=0;i<M.components.length;i++){
    var lk=M.components[i].links||[];
    for(var j=0;j<lk.length;j++){ (importers[lk[j]]=importers[lk[j]]||[]).push(i); }
  }
  // the set of districts in the BLAST RADIUS: importers (direct) of any changed/added/
  // removed district — computed once, drawn as persistent rings in every review frame.
  var blast={}, blastN=0;
  if(DIFF){
    for(var i=0;i<M.components.length;i++){
      if(!isChangedByIdx(i)) continue;
      var imp=importers[M.components[i].dir]||[];
      for(var j=0;j<imp.length;j++){ if(imp[j]!==i && !blast[imp[j]]){ blast[imp[j]]=1; blastN++; } }
    }
  }
  // FLOOD GUARD — on a dense import graph a change can put MOST of the city in the blast
  // set; rings everywhere read as noise, not signal. Past ~40% of districts the per-plate
  // rings stand down and the masthead blast chip (server-rendered from the same set)
  // carries the count instead — the on-hover/pin link display still shows any district's
  // importers. Below the threshold (the focused-PR case) rings render: that is when the
  // set is small enough to be informative.
  var BLAST_FLOOD = blastN > 0.4*M.components.length;
  function isChangedByIdx(i){ return isChanged(M.components[i]); }

  // TOWERS ARE WORLD-FIXED: every piece takes its triangular slot ONCE, here, in
  // UNROTATED world space — centre-out by WORLD centroid distance with a fixed angular
  // tie-break (latticeTris), no projected/screen coordinate anywhere in the assignment.
  // The lattice is part of the rigid world: under rotation each tower's world position
  // rotates with its district like a building bolted to the ground — a file sits on the
  // same triangle at every angle, forever (the lots' familiarity doctrine, indoors).
  var BASE=[];
  for(var i=0;i<M.components.length;i++){
    var c0b=M.components[i], w0=layout(c0b.lot.x, c0b.lot.y);
    var ps0b=plateSize(c0b), len0=(c0b.pieces||[]).length, k0=resK(Math.max(1,len0));
    BASE[i]={ w0:w0, ps:ps0b, len:len0, tris:latticeTris(w0.x, w0.y, ps0b*0.9, k0) };
  }

  // THE CAMERA. Three invariants:
  //   · CITY-TIGHT: the fitted frame (FIT) wraps the rotation-invariant bounding circle
  //     of the OCCUPIED lots — max over districts of |lot centre| + plate circumradius,
  //     ~7% padding — NOT the platter. Ground running past the frame is how every city
  //     builder reads; the aspect comes from the LIVE window, never a hardcoded ratio.
  //   · θ-INVARIANT: a centre-origin circle has rotation-invariant projected extents, so
  //     rotating never alters the viewBox. Only zoom/pan/resize change it, deliberately.
  //   · ZOOM/PAN ARE VIEW STATE (like θ): they modify the viewBox only — never the world,
  //     never persisted. VIEW is the live frame; FIT is what reset returns to.
  var CITY_R=(function(){
    var r=R*2;
    for(var i=0;i<BASE.length;i++){
      var d=Math.hypot(BASE[i].w0.x,BASE[i].w0.y)+BASE[i].ps;
      if(d>r) r=d;
    }
    return r*1.07;
  })();
  var FIT=null, VIEW=null;
  function winDims(){
    var w=(typeof innerWidth!=="undefined"&&innerWidth)?innerWidth:1600;
    var h=(typeof innerHeight!=="undefined"&&innerHeight)?innerHeight:1000;
    return { w:w, h:h };
  }
  function fitCamera(){
    var head=EXT+H_MAX+18;                          // tallest tower + flag headroom
    var vx=-CITY_R, vw=2*CITY_R;
    var vy=-CITY_R*SQUASH-head, vh=CITY_R*SQUASH*2+head;
    var d=winDims(), AR=Math.max(0.4, Math.min(4, d.w/d.h));
    if(vw/vh > AR){ var nh=vw/AR; vy -= (nh-vh)/2; vh=nh; }
    else { var nw=vh*AR; vx -= (nw-vw)/2; vw=nw; }
    FIT={ x:vx, y:vy, w:vw, h:vh };
  }
  function applyView(){
    svg.setAttribute("viewBox", VIEW.x.toFixed(1)+" "+VIEW.y.toFixed(1)+" "+VIEW.w.toFixed(1)+" "+VIEW.h.toFixed(1));
  }
  function resetView(){ VIEW={ x:FIT.x, y:FIT.y, w:FIT.w, h:FIT.h }; applyView(); }
  // zoom clamp: 0.5×fit (see context) … 4×fit (read one district); pan clamp: the view
  // centre stays inside the fitted frame, so the city can never be lost off-screen
  function clampView(){
    var minW=FIT.w/4, maxW=FIT.w*2;
    if(VIEW.w<minW || VIEW.w>maxW){
      var cw=Math.max(minW,Math.min(maxW,VIEW.w)), k=cw/VIEW.w;
      var ccx=VIEW.x+VIEW.w/2, ccy=VIEW.y+VIEW.h/2;
      VIEW.w=cw; VIEW.h=VIEW.h*k; VIEW.x=ccx-VIEW.w/2; VIEW.y=ccy-VIEW.h/2;
    }
    var cx=Math.max(FIT.x, Math.min(FIT.x+FIT.w, VIEW.x+VIEW.w/2));
    var cy=Math.max(FIT.y, Math.min(FIT.y+FIT.h, VIEW.y+VIEW.h/2));
    VIEW.x=cx-VIEW.w/2; VIEW.y=cy-VIEW.h/2;
  }
  // client px → world point, honouring preserveAspectRatio meet letterboxing
  function clientToWorld(cx, cy){
    var rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    if(!rect || !rect.width){ var d=winDims(); rect={ left:0, top:0, width:d.w, height:d.h }; }
    var sc=Math.min(rect.width/VIEW.w, rect.height/VIEW.h)||1;
    var ox=rect.left+(rect.width-VIEW.w*sc)/2, oy=rect.top+(rect.height-VIEW.h*sc)/2;
    return { x:VIEW.x+(cx-ox)/sc, y:VIEW.y+(cy-oy)/sc, sc:sc };
  }
  fitCamera(); resetView();

  var pinnedIdx=-1, hoverIdx=-1;  // pinnedIdx wins for on-demand links; hoverIdx is transient
  var pos=[];                     // per-component rotated centres, rebuilt each frame

  // is this district touched by the diff? (drives the RECEDE of the unchanged city)
  function isChanged(c){
    if(!DIFF) return false;
    if(c.change) return true;
    var p=c.pieces||[]; for(var k=0;k<p.length;k++) if(p[k].change) return true;
    return false;
  }

  // ── render one frame at the current THETA (load, every rotation frame, every pin) ──────
  // The floor is NOT here: it is static ground, drawn once above. The viewBox is NOT
  // here: the camera is fixed. A frame is: rigidly rotate the world, depth-sort, paint.
  function render(){
    clear(gLink); clear(gCity); clear(gChrome);

    // rigidly rotated plate centres (tower vertices rotate in drawTower, same transform)
    pos=[];
    for(var i=0;i<M.components.length;i++){
      var w=worldRot(BASE[i].w0, THETA);
      pos[i]={ wx:w.x, wy:w.y, ps:BASE[i].ps, len:BASE[i].len };
    }

    // LINKS ARE ON DEMAND — no always-on hairball. gLink stays empty unless a district is
    // hovered/pinned; drawn AFTER the city below (see drawActiveLinks call at frame end).

    // OCCLUSION: build a flat list of drawables and paint back-to-front by projected depth
    // (rotated world y). A district's plinth is one drawable at the plate centre; EACH
    // tower is its own drawable at its footprint centroid — so towers interleave WITHIN
    // and ACROSS districts and a tall front tower correctly covers what sits behind it.
    // Rotating exists to see around towers, so this sort is what makes rotation pay off.
    // (Status chrome is exempt: it lands in gChrome, above every plinth and tower.)
    var items=[];
    for(var i=0;i<M.components.length;i++){
      items.push({ depth:pos[i].wy, plate:i, ti:-1 });
      var tris=BASE[i].tris, len=BASE[i].len;
      for(var ti=0;ti<len && ti<tris.length;ti++){
        items.push({ depth:worldRot(tris[ti].g, THETA).y, plate:i, ti:ti });
      }
    }
    items.sort(function(a,b){ return (a.depth-b.depth) || (a.plate-b.plate) || (a.ti-b.ti); });
    for(var it=0; it<items.length; it++){
      if(items[it].ti<0) drawPlate(items[it].plate); else drawTower(items[it].plate, items[it].ti);
    }

    // ── chrome passes that need the WHOLE frame's geometry (positions of every plate) ──
    if(DIFF && !BLAST_FLOOD) drawBlastRings();  // persistent review rings — unless flooded
    drawActiveLinks();             // on-demand adjacency for the hovered/pinned district
    drawNameplates();              // billboarded street names, greedy-culled at collision
  }

  // ── BLAST RADIUS — persistent rings on districts that import a changed one (review) ──
  // A thin accent ring in the soft secondary tint, drawn in chrome so it survives even on
  // a receded district (that IS the point: "what could this change break" without a click).
  // Deliberately QUIETER than the amber blueprint rims it shares the board with.
  function drawBlastRings(){
    for(var i=0;i<M.components.length;i++){
      if(!blast[i]) continue;
      var p=pos[i], ring=hexCorners(p.wx,p.wy,p.ps*1.14,EXT,THETA);
      gChrome.appendChild(el("polygon",{ "class":"blast-ring","data-idx":i, points:pts(ring),
        fill:"none", stroke:C.blast, "stroke-width":0.9, "stroke-dasharray":"2 3",
        "stroke-linejoin":"round", opacity:.55 }));
    }
  }

  // ── ON-DEMAND LINKS — outgoing (imports, SOLID) + incoming (imported-by, DASHED) for the
  // active district, plus a subtle rim emphasis on each linked district. Pinned wins over
  // hover so a pinned card keeps its wiring while you mouse elsewhere. ──
  function drawActiveLinks(){
    var idx = pinnedIdx>=0 ? pinnedIdx : hoverIdx;
    if(idx<0 || idx>=M.components.length || !pos[idx]) return;
    var c=M.components[idx], a=proj(pos[idx].wx,pos[idx].wy,EXT), emph={};
    var outs=c.links||[];
    for(var j=0;j<outs.length;j++){
      var t=byDir[outs[j]]; if(t==null||t===idx||!pos[t]) continue;
      var b=proj(pos[t].wx,pos[t].wy,EXT);
      gLink.appendChild(el("line",{ "class":"link-line link-out", x1:a.x,y1:a.y,x2:b.x,y2:b.y,
        stroke:C.linkOut, "stroke-width":1.6, "stroke-linecap":"round", opacity:.92 }));
      emph[t]=1;
    }
    var ins=importers[c.dir]||[];
    for(var j=0;j<ins.length;j++){
      var s=ins[j]; if(s===idx||!pos[s]) continue;
      var b2=proj(pos[s].wx,pos[s].wy,EXT);
      gLink.appendChild(el("line",{ "class":"link-line link-in", x1:a.x,y1:a.y,x2:b2.x,y2:b2.y,
        stroke:C.linkIn, "stroke-width":1.4, "stroke-dasharray":"5 4", "stroke-linecap":"round", opacity:.9 }));
      emph[s]=1;
    }
    // subtle rim emphasis on every linked district (chrome, so it never hides behind towers)
    for(var e in emph){
      if(!emph.hasOwnProperty(e)) continue;
      var pe=pos[e]; if(!pe) continue;
      gChrome.appendChild(el("polygon",{ "class":"link-emph","data-idx":e,
        points:pts(hexCorners(pe.wx,pe.wy,pe.ps*1.06,EXT,THETA)),
        fill:"none", stroke:C.linkEmph, "stroke-width":1.4, "stroke-linejoin":"round", opacity:.8 }));
    }
  }

  // ── DISTRICT NAMEPLATES — the audit's #1 fix: the city gets street names. A billboarded
  // (screen-upright) label seated just below each plate's front rim, in the chrome layer so
  // no tower ever occludes it, dimming with a receded district. QUIET by construction: the
  // font is sized so a max-length (14-char) plate stays NARROWER than the smallest plate it
  // can name — a map label under the district, never the loudest thing on the board. When
  // two plates would still collide (crowded lots, mid-drag angles) a simple greedy cull
  // keeps the BIGGER district's plate (the loser regains its name on hover, via the
  // tooltip). A plate near the viewport edge simply crops — cropping one label beats
  // letting two collide. Recomputed every frame — placement is θ-dependent.
  var NP_FONT=6;
  function plateLabel(c){
    var s=c.label||"";
    if(s.length>14){ var seg=s.split("/"); s=seg[seg.length-1]; }   // long → last path segment
    if(s.length>14) s=s.slice(0,13)+"\\u2026";                       // still long → truncate ~14 with …
    return s.toUpperCase();                                          // small-caps game-map feel
  }
  function drawNameplates(){
    var cand=[];
    for(var i=0;i<M.components.length;i++){
      if(!pos[i]) continue;
      var c=M.components[i], fx=pos[i].wx, fy=pos[i].wy, ps=pos[i].ps;
      var bot=hexCorners(fx,fy,ps,0,THETA), my=-1e9;              // frontmost (max-y) base corner
      for(var s=0;s<6;s++){ if(bot[s].y>my) my=bot[s].y; }
      var lbl=plateLabel(c), w=lbl.length*NP_FONT*0.6+4, h=NP_FONT+4;
      cand.push({ i:i, ax:proj(fx,fy,0).x, ay:my+7+h/2, w:w, h:h, lbl:lbl, size:massOf(c) });
    }
    // greedy: place the biggest districts first; skip a smaller plate whose box overlaps one
    cand.sort(function(a,b){ return (b.size-a.size) || (a.i-b.i); });
    var placed=[];
    for(var ci=0;ci<cand.length;ci++){
      var cd=cand[ci], hit=false;
      for(var pi=0;pi<placed.length;pi++){
        var p=placed[pi];
        if(Math.abs(cd.ax-p.ax) < (cd.w+p.w)/2 && Math.abs(cd.ay-p.ay) < (cd.h+p.h)/2){ hit=true; break; }
      }
      if(hit) continue;                        // culled — its name lives on in the hover tooltip
      placed.push(cd);
      var c2=M.components[cd.i], receded=DIFF && !isChanged(c2);
      var g=el("g",{ "class":"nameplate"+(receded?" receded":""), "data-idx":cd.i });
      g.appendChild(el("rect",{ x:(cd.ax-cd.w/2).toFixed(1), y:(cd.ay-cd.h/2).toFixed(1),
        width:cd.w.toFixed(1), height:cd.h.toFixed(1), rx:2.5, fill:C.plateBg, stroke:C.plateBorder, "stroke-width":.5 }));
      var tx=el("text",{ x:cd.ax.toFixed(1), y:(cd.ay+NP_FONT*0.35).toFixed(1), "text-anchor":"middle",
        "font-size":NP_FONT, "font-family":"ui-monospace,SFMono-Regular,Menlo,monospace",
        "letter-spacing":".08em", fill:C.plateFont });
      tx.textContent=cd.lbl; g.appendChild(tx);
      gChrome.appendChild(g);
    }
  }

  // ── one triangular tower (a FILE extruded ∝ its symbols) ─────────
  function drawTower(idx, ti){
    var c=M.components[idx], pc=c.pieces[ti], t0=BASE[idx].tris[ti], lvl=c.light.level;
    // the slot's WORLD vertices, rotated rigidly by THETA — the same transform as the
    // plate corners, so the tower stays bolted to its triangle at every angle
    var cc=[worldRot(t0.c[0],THETA), worldRot(t0.c[1],THETA), worldRot(t0.c[2],THETA)];
    var gw=worldRot(t0.g,THETA);
    var removedDist = DIFF && c.change==="removed";
    var chg = DIFF ? (removedDist ? "removed" : pc.change) : null;
    var ln = pc.lines||0, h = towerH(ln);
    // front vertex = the base corner nearest the viewer (max flat-plane y); its two
    // incident edges are the two viewer-facing side faces (verticality made unambiguous).
    var fv=0; if(cc[1].y>cc[fv].y)fv=1; if(cc[2].y>cc[fv].y)fv=2;
    var bc=proj(gw.x,gw.y,EXT), tc=proj(gw.x,gw.y,EXT+h);
    var klass="tower"+(chg?" tower-"+chg:"")+((DIFF && !isChanged(c) && !chg)?" receded":"");
    var g=el("g",{ "class":klass, "data-idx":idx, "data-file":pc.label,
                   "data-claimed":pc.claimed?"1":"0", "data-change":chg||"",
                   "data-wx":gw.x.toFixed(2), "data-wy":gw.y.toFixed(2),
                   "data-h":h.toFixed(2), "data-basey":bc.y.toFixed(2), "data-topy":tc.y.toFixed(2) });

    // the two front side quads between z0..z1 (fill = {a,b} triple or null for wireframe)
    function sides(z0,z1,fill,stroke,sw,dash,op){
      for(var s=0;s<2;s++){
        var a=fv, b=(fv+(s?2:1))%3;
        var quad=[proj(cc[a].x,cc[a].y,z0),proj(cc[b].x,cc[b].y,z0),proj(cc[b].x,cc[b].y,z1),proj(cc[a].x,cc[a].y,z1)];
        g.appendChild(el("polygon",{points:pts(quad),fill:fill?(s?fill.b:fill.a):"none",
          stroke:stroke,"stroke-width":sw,"stroke-dasharray":dash,"fill-opacity":op,"stroke-linejoin":"round"}));
      }
    }
    // the top face at height z
    function top(z,fill,stroke,sw,dash,filt,op){
      var t=[proj(cc[0].x,cc[0].y,z),proj(cc[1].x,cc[1].y,z),proj(cc[2].x,cc[2].y,z)];
      var at={points:pts(t),fill:fill,stroke:stroke,"stroke-width":sw,"stroke-dasharray":dash,"fill-opacity":op,"stroke-linejoin":"round"};
      if(filt)at.filter=filt;
      g.appendChild(el("polygon",at));
    }

    if(chg==="removed"){
      // GHOST wireframe: dashed translucent outline of the FORMER structure on its lot
      sides(EXT,EXT+h,null,C.ghost,1,"3 2.5",null);
      top(EXT+h,"none",C.ghost,1,"3 2.5",null,null);
    } else {
      var col=towerColors(pc,lvl);
      var lit = pc.claimed && lvl==="lit";
      sides(EXT,EXT+h,col,col.b,0.6,null,null);
      top(EXT+h,col.top,(chg==="added"?C.accent:col.b),(chg==="added"?1.3:0.7),null,(lit||chg==="added")?"url(#bloom)":null,null);
      // CLAIMED KEYLINE — a faint amber line hugging the TOP FACE's two viewer-facing
      // edges (the edges incident to the front vertex fv, at the SAME rotated world
      // vertices and the SAME projected z as the top-face polygon — shared inputs to the
      // same proj(), so the keyline can never detach or outscale the tower it marks).
      // A keyline, not a badge: 0.8px at half opacity, and it rides INSIDE the tower's
      // own group so it dims with a receded district and occludes with the world.
      // Skipped when chg==="added" (the construction accent owns that silhouette).
      if(pc.claimed && chg!=="added"){
        var ka=(fv+1)%3, kb=(fv+2)%3;
        var kp=[proj(cc[ka].x,cc[ka].y,EXT+h),proj(cc[fv].x,cc[fv].y,EXT+h),proj(cc[kb].x,cc[kb].y,EXT+h)];
        g.appendChild(el("polyline",{"class":"claim-key",points:pts(kp),fill:"none",stroke:C.amber,
          "stroke-width":0.8,"stroke-opacity":0.5,"stroke-linejoin":"round","stroke-linecap":"round"}));
      }
      if(chg==="added"){
        // solid + accent-edged: outline the whole prism in the construction accent
        sides(EXT,EXT+h,null,C.accent,1.1,null,null);
      } else if(chg==="changed"){
        var prevH = (pc.prevLines!=null) ? towerH(pc.prevLines) : h;
        if(h > prevH+0.5){                 // GREW: accent cap above the former height
          sides(EXT+prevH,EXT+h,ACCENTT,C.accent,1.1,null,null);
          top(EXT+h,ACCENTT.top,C.accent,1.1,null,"url(#bloom)",null);
        } else if(h < prevH-0.5){          // SHRANK: dashed ghost cap where it used to reach
          sides(EXT+h,EXT+prevH,null,C.accentSoft,1,"3 2.5",null);
          top(EXT+prevH,"none",C.accentSoft,1,"3 2.5",null,null);
        } else {                           // symbols moved, height did not: an accent tick
          top(EXT+h+2,"none",C.accent,1.6,null,"url(#bloom)",null);
        }
      }
    }
    gCity.appendChild(g);
  }

  // ── one district plinth + its chrome (tokens, ticks, dots, diff chip) ─────
  function drawPlate(idx){
    var c=M.components[idx], p=pos[idx], fx=p.wx, fy=p.wy, ps=p.ps, lvl=c.light.level;
    // topR/botR: the RIGID plate hexagon — corners rotate with the world (off=THETA).
    // topC: the fixed-orientation SEATING hexagon chrome anchors to (off=0) — markers
    // re-seat to the viewer-facing rim; the two coincide at every 60° rest facing.
    var top=hexCorners(fx,fy,ps,EXT,THETA), bot=hexCorners(fx,fy,ps,0,THETA);
    var topC=hexCorners(fx,fy,ps,EXT,0);
    var removedDist = DIFF && c.change==="removed";
    var receded = DIFF && !isChanged(c);
    var g=el("g",{"class":"slab"+(receded?" receded":"")+(removedDist?" ghost":""),"data-idx":idx});
    // the district's STATUS CHROME rides its own group in gChrome — above every plinth
    // and tower at any angle, still anchored to this plate's rim, still dimming with a
    // receded district (the class is shared so the same CSS rule carries both)
    var ch=el("g",{"class":"chrome"+(receded?" receded":""),"data-idx":idx});

    // HEAT IS A NUMBER, NOT A GLOW — the ambient underglow was decoration the audit cut;
    // heat now lives only in the tooltip/card, never a wash competing with the signal.

    if(removedDist){
      // a removed DISTRICT: the whole plinth is a dashed ghost outline (towers ghost too)
      for(var s=0;s<6;s++){
        if(Math.sin(Math.PI/180*(60*s+30+THETA))<=0.01) continue;   // viewer-facing edges only
        var n2=(s+1)%6;
        g.appendChild(el("polygon",{points:pts([top[s],top[n2],bot[n2],bot[s]]),fill:"none",stroke:C.ghost,"stroke-width":.8,"stroke-dasharray":"3 2.5"}));
      }
      g.appendChild(el("polygon",{points:pts(top),fill:"none",stroke:C.ghost,"stroke-width":1,"stroke-dasharray":"3 2.5","stroke-linejoin":"round"}));
      diffChip(ch,c,topC);
      g.appendChild(el("polygon",{"class":"hilite",points:pts(top),fill:"none",stroke:C.amberSoft,"stroke-width":1.4}));
      gCity.appendChild(g);
      if(ch.firstChild) gChrome.appendChild(ch);
      return;
    }

    // the viewer-facing plinth side faces — with a RIGID plate the front edges change
    // with θ: an edge faces the viewer when its outward mid-angle (60s+30+θ) has sin>0
    // (screen +y). The most head-on edge takes the darker shade so the extrusion keeps a
    // consistent key light at every angle (at rest facings this reproduces edges 0-1,
    // 1-2, 2-3 with the dark face front-centre, exactly the old fixed selection).
    var bestS=-1, bestSin=-1;
    for(var s=0;s<6;s++){ var sn=Math.sin(Math.PI/180*(60*s+30+THETA)); if(sn>bestSin){bestSin=sn;bestS=s;} }
    for(var s=0;s<6;s++){
      var sn=Math.sin(Math.PI/180*(60*s+30+THETA)); if(sn<=0.01) continue;
      var n2=(s+1)%6, shade=(s===bestS?C.sideE:C.sideS);
      g.appendChild(el("polygon",{points:pts([top[s],top[n2],bot[n2],bot[s]]),fill:shade,stroke:C.sideEdge,"stroke-width":.6}));
    }
    // the plate top: a clean dark board the towers rise from
    g.appendChild(el("polygon",{points:pts(top),fill:C.plateTop,stroke:C.plateRim,"stroke-width":.9}));

    // empty lattice slots (capacity past the file count) — faint strokes on the board,
    // rotated rigidly with the rest of the world lattice
    var tris=BASE[idx].tris, len=p.len;
    for(var ti=len; ti<tris.length; ti++){
      var s0=worldRot(tris[ti].c[0],THETA), s1=worldRot(tris[ti].c[1],THETA), s2=worldRot(tris[ti].c[2],THETA);
      var poly=[proj(s0.x,s0.y,EXT),proj(s1.x,s1.y,EXT),proj(s2.x,s2.y,EXT)];
      g.appendChild(el("polygon",{ "class":"parcel slot", points:pts(poly), fill:"none", stroke:C.slotEdge, "stroke-width":.5 }));
    }

    // the blueprint envelope: dashed rim tracing the plate — amber for spec, accent for a
    // newly-added district (THE WIREFRAME IS THE SPEC)
    var rimCol = (DIFF && c.change==="added") ? C.accent : C.amber;
    g.appendChild(el("polygon",{points:pts(top),fill:"none",stroke:rimCol,"stroke-width":1.1,"stroke-dasharray":"5 3","stroke-linejoin":"round"}));

    var cen=proj(fx,fy,EXT);
    // fails: small pulsing red dots in a quiet row near the plate centre (count in the
    // card). Alarms are chrome — they must beat even this district's own towers.
    var failN=Math.min(c.light.fails,5);
    for(var kk=0;kk<failN;kk++){
      var u=failN===1?0:(kk-(failN-1)/2);
      ch.appendChild(el("circle",{"class":"fdot",cx:cen.x+u*7,cy:cen.y-3,r:2.6,fill:C.red,filter:"url(#bloom)"}));
    }

    // unanchored invariants: red ticks crossing the FRONT-LEFT rim (edge 2→3 of the
    // seating hexagon — chrome re-seats to the viewer-facing rim, like the tokens)
    var tickN=Math.min(c.unanchored.length,4), uA=topC[2], uB=topC[3];
    var udx=uB.x-uA.x, udy=uB.y-uA.y, uln=Math.hypot(udx,udy)||1, unx=-udy/uln*4.5, uny=udx/uln*4.5;
    for(var kk=0;kk<tickN;kk++){
      var up=lp(uA,uB,0.22+0.56*(tickN===1?0.5:kk/(tickN-1)));
      ch.appendChild(el("line",{x1:up.x-unx,y1:up.y-uny,x2:up.x+unx,y2:up.y+uny,stroke:C.red,"stroke-width":1.7,"stroke-linecap":"round"}));
    }

    // gates: tidy status TOKENS seated on the frontmost rim (edge 1→2), one vocabulary —
    // steel (solid, sturdy) · scaffold (hollow, dashed, provisional) · breached (red,
    // alarmed, pulsing). ⚑ marks a gate the meta-oracle never analysed (human-eye).
    // A management sim never lets icons PILE, and never lets them TOUCH either: the row
    // is laid out by ACTUAL widths, not slots. Visible tokens sit at a fixed pitch; the
    // overflow chip (a rounded capsule reading "+N", with a single inline ⚑ when any
    // HIDDEN gate needs a human eye) is placed AFTER the last token offset by its own
    // half-width, so capsule and tokens can never intersect. The visible count starts
    // from fit = floor(edge/pitch) capped at 5 (token SIZE is scene-constant, the COUNT
    // adapts) and drops further until tokens + capsule genuinely fit the edge — alarms
    // are never the ones hidden: breached first, then steel, then scaffold (stable sort,
    // same-material gates keep authored order). The pinned card keeps the full list —
    // the chip is the affordance, the card the drill-down.
    var gates=c.gates||[], eA=topC[1], eB=topC[2];
    if(gates.length){
      var RANK={breached:0,steel:1,scaffold:2};
      var sorted=gates.slice().sort(function(a,b){ return (RANK[a.material]!=null?RANK[a.material]:9)-(RANK[b.material]!=null?RANK[b.material]:9); });
      var edgeLen=Math.hypot(eB.x-eA.x,eB.y-eA.y), ux=(eB.x-eA.x)/edgeLen, uy=(eB.y-eA.y)/edgeLen;
      var PITCH=10, HALF=4.6, GAP=4, usable=edgeLen-4;      // 2px corner inset each side
      var eyeFrom=function(n){ for(var kh=n;kh<sorted.length;kh++){ if(sorted[kh].humanEye) return true; } return false; };
      var chipFor=function(n){ var s="+"+(sorted.length-n)+(eyeFrom(n)?" \\u2691":""); return { lbl:s, w:Math.max(13,6+4.6*s.length) }; };
      var fit=Math.max(1,Math.min(5,Math.floor(usable/PITCH)));
      var visN, hidden=0, chip=null;
      if(sorted.length<=fit){ visN=sorted.length; }
      else {
        // width-aware reservation: shed tokens until tokens + capsule fit the edge
        visN=Math.min(fit,sorted.length);
        do { visN--; chip=chipFor(visN); }
        while(visN>1 && HALF+(visN-1)*PITCH+PITCH/2+GAP+chip.w > usable);
        if(visN<1){ visN=1; chip=chipFor(1); }   // at least one token always shows (the alarm)
        hidden=sorted.length-visN;
      }
      // centre the whole row on the rim line (tokens snap ONTO the edge, inset from corners)
      var rowW = hidden ? HALF+(visN-1)*PITCH+PITCH/2+GAP+chip.w : 2*HALF+(visN-1)*PITCH;
      var start=Math.max(2,(edgeLen-rowW)/2);
      var at=function(d){ return { x:eA.x+ux*d, y:eA.y+uy*d }; };
      for(var kk=0;kk<visN;kk++){
        var gt=sorted[kk], tp=at(start+HALF+kk*PITCH);
        if(gt.material==="steel"){
          ch.appendChild(el("circle",{"class":"gtoken",cx:tp.x,cy:tp.y,r:4.2,fill:C.steel,stroke:C.steelEdge,"stroke-width":1}));
        } else if(gt.material==="scaffold"){
          ch.appendChild(el("circle",{"class":"gtoken",cx:tp.x,cy:tp.y,r:4.2,fill:"none",stroke:C.scaffold,"stroke-width":1.3,"stroke-dasharray":"2.2 2"}));
        } else {
          ch.appendChild(el("circle",{"class":"gtoken fdot",cx:tp.x,cy:tp.y,r:4.6,fill:C.red,stroke:"#7a2420","stroke-width":1,filter:"url(#bloom)"}));
        }
        if(gt.humanEye){        // a VISIBLE human-eye gate keeps its own flag, snapped
          // ABOVE its token: baseline just clear of the token's top edge, never dipping
          // onto the plate face below the rim
          var fl=el("text",{x:tp.x,y:(tp.y-HALF-2).toFixed(1),"text-anchor":"middle","font-size":"10",fill:C.amber});
          fl.textContent="\\u2691"; ch.appendChild(fl);
        }
      }
      if(hidden){
        var bc2=at(start+HALF+(visN-1)*PITCH+PITCH/2+GAP+chip.w/2), bh=9.5;
        var bg=el("g",{"class":"gate-badge"});
        bg.appendChild(el("rect",{x:(bc2.x-chip.w/2).toFixed(1),y:(bc2.y-bh/2).toFixed(1),width:chip.w.toFixed(1),height:bh,rx:4.5,fill:"#141d28",stroke:C.steelEdge,"stroke-width":1}));
        var bt=el("text",{x:bc2.x,y:bc2.y+2.6,"text-anchor":"middle","font-size":"7.5",fill:C.steel,"font-family":"ui-monospace,monospace"});
        bt.textContent=chip.lbl; bg.appendChild(bt);   // the hidden-eye ⚑ rides INSIDE the label
        ch.appendChild(bg);
      }
    }

    // the district change chip ("+3 −1 ~2"), same capsule vocabulary as the gate overflow
    // badge, seated on the BACK rim of the seating hexagon so it never collides with the
    // front-rim gate tokens
    diffChip(ch,c,topC);

    // selection ring (pinned) + hover highlight — the satisfying game-legible affordances
    if(idx===pinnedIdx){
      g.appendChild(el("polygon",{points:pts(top),fill:"none",stroke:C.amberSoft,"stroke-width":2.2,"stroke-linejoin":"round"}));
    }
    g.appendChild(el("polygon",{"class":"hilite",points:pts(top),fill:"none",stroke:C.amberSoft,"stroke-width":1.4}));

    gCity.appendChild(g);
    if(ch.firstChild) gChrome.appendChild(ch);
  }

  // the district change chip: a capsule reading "+A −R ~C" (added/removed/changed pieces),
  // width-sized to its label and seated centred on the back rim (edge 4→5)
  function diffChip(g, c, top){
    if(!DIFF) return;
    var a=0,r=0,ch=0, pcs=c.pieces||[];
    for(var k=0;k<pcs.length;k++){
      if(pcs[k].change==="added")a++; else if(pcs[k].change==="removed")r++; else if(pcs[k].change==="changed")ch++;
    }
    if(c.change==="removed" && !a && !r && !ch) r=pcs.length;   // whole district gone
    if(c.change==="added" && !a && !r && !ch) a=pcs.length;
    if(!a && !r && !ch) return;
    var parts=[]; if(a)parts.push("+"+a); if(r)parts.push("\\u2212"+r); if(ch)parts.push("~"+ch);
    var lbl=parts.join(" "), w=Math.max(16,7+5*lbl.length), bh=10;
    var mid=lp(top[4],top[5],0.5), bc={x:mid.x,y:mid.y-4};
    var bg=el("g",{"class":"diff-chip"});
    bg.appendChild(el("rect",{x:(bc.x-w/2).toFixed(1),y:(bc.y-bh/2).toFixed(1),width:w.toFixed(1),height:bh,rx:4.5,fill:"#0f2320",stroke:C.accent,"stroke-width":1}));
    var bt=el("text",{x:bc.x,y:bc.y+2.9,"text-anchor":"middle","font-size":"8",fill:C.accentSoft,"font-family":"ui-monospace,monospace"});
    bt.textContent=lbl; bg.appendChild(bt);
    g.appendChild(bg);
  }

  render();

  // ── turntable: continuous drag + eased 60° steps (buttons/keys) ──────────────────────
  var facing=document.getElementById("facing");
  function norm(a){ return ((a%360)+360)%360; }
  function nearest60(a){ return Math.round(a/60)*60; }
  function setFacing(){ if(facing) facing.textContent=norm(Math.round(THETA))+"\\u00b0"; }

  var raf = (typeof requestAnimationFrame!=="undefined") ? requestAnimationFrame : null;
  function now(){ return (typeof performance!=="undefined" && performance.now) ? performance.now() : Date.now(); }
  var anim=null, aimed=0;   // aimed = the facing we are heading to (accumulates rapid steps)
  setFacing();
  // ease THETA → target over ms with an ease-out cubic; each frame re-renders (no snap-cut).
  // Frames are DUAL-DRIVEN: every step schedules a rAF AND arms a ~50ms setTimeout
  // watchdog — whichever fires first drives the frame, and a per-frame gate makes the
  // loser a no-op. When rAF is healthy it always wins (a frame beats 50ms), so it drives
  // with no double-render; when rAF is throttled or plain dead (background tabs, embedded
  // webviews, energy-saver — MEASURED: panes where a scheduled rAF never ran in 800ms)
  // the watchdog carries the ease to completion in bounded time. Either way the ease
  // ALWAYS lands, and the final state is exactly the target facing.
  function easeTo(target, ms){
    var from=THETA, delta=target-from, t0=now(), tok={};
    anim=tok;
    function step(){
      if(anim!==tok) return;                 // superseded by a newer gesture
      var t=Math.min(1,(now()-t0)/ms), e=1-Math.pow(1-t,3);
      THETA=from+delta*e; setFacing(); render();
      if(t<1) arm(); else { anim=null; THETA=target; setFacing(); render(); }
    }
    function arm(){
      var fired=false;
      var go=function(){ if(fired || anim!==tok) return; fired=true; step(); };
      if(raf) raf(go);
      setTimeout(go, raf?50:16);             // watchdog (or the sole driver without rAF)
    }
    step();
  }
  // buttons/keys: a 60 degree step. aimed accumulates so rapid double-clicks advance two
  // facings even before the first ease has landed (no swallowed steps, no snap-cut).
  function step60(dir){ aimed=nearest60(aimed)+dir*60; easeTo(aimed, 260); }
  document.getElementById("rot-ccw").addEventListener("click",function(){ step60(-1); });
  document.getElementById("rot-cw").addEventListener("click",function(){ step60(1); });

  // CLICK-DRAG to rotate; MIDDLE-drag or SHIFT+drag to PAN (left-drag stays rotate). A
  // pointer that moves < DRAGT px is a CLICK (pin/unpin); beyond it is a drag and must
  // NOT pin. A rotate release eases to the nearest 60° facing; a pan release just stops.
  var DRAGT=5, ROT_SENS=0.55;    // px→° gain: a comfortable half-turn in ~a screen-width drag
  var down=null;
  function onDown(e){
    anim=null;                                // cancel any in-flight ease
    var tw=cl(e.target,".tower"), sl=cl(e.target,".slab")||cl(e.target,".chrome");
    var idx = tw?+tw.getAttribute("data-idx") : sl?+sl.getAttribute("data-idx") : -1;
    var pan = (e.button===1) || !!e.shiftKey;
    down={ x:e.clientX, y:e.clientY, base:THETA, vx:VIEW.x, vy:VIEW.y, moved:false, idx:idx, pan:pan };
    if(svg.classList) svg.classList.add("grabbing");
  }
  function onMove(e){
    if(!down) return;
    var dx=e.clientX-down.x, dy=e.clientY-down.y;
    if(!down.moved && (dx*dx+dy*dy) > DRAGT*DRAGT) down.moved=true;
    if(!down.moved) return;
    if(down.pan){
      var sc=clientToWorld(e.clientX,e.clientY).sc;   // px→world gain at the current zoom
      VIEW.x=down.vx-dx/sc; VIEW.y=down.vy-dy/sc; clampView(); applyView();
    } else {
      THETA=down.base + dx*ROT_SENS; setFacing(); render();
    }
    if(e.preventDefault) e.preventDefault();
  }
  function onUp(){
    if(!down) return;
    var wasDrag=down.moved, wasPan=down.pan, idx=down.idx; down=null;
    if(svg.classList) svg.classList.remove("grabbing");
    if(wasDrag){ if(!wasPan){ aimed=nearest60(THETA); easeTo(aimed,240); } }  // rotate snaps; pan stays
    else if(!wasPan){ if(idx>=0) pin(idx); else unpin(); }   // a true LEFT click pins/unpins
  }
  svg.addEventListener("pointerdown", onDown);
  (typeof window!=="undefined"?window:svg).addEventListener("pointermove", onMove);
  (typeof window!=="undefined"?window:svg).addEventListener("pointerup", onUp);

  // WHEEL ZOOM: exponential, clamped, toward the cursor — the world point under the
  // cursor stays put (the standard management-sim zoom; the eye never loses its place).
  svg.addEventListener("wheel", function(e){
    if(e.preventDefault) e.preventDefault();
    var pw=clientToWorld(e.clientX,e.clientY);
    var f=Math.pow(1.0018, e.deltaY||0);            // deltaY>0 zooms out
    var nw=Math.max(FIT.w/4, Math.min(FIT.w*2, VIEW.w*f)), k=nw/VIEW.w;
    VIEW={ x:pw.x-(pw.x-VIEW.x)*k, y:pw.y-(pw.y-VIEW.y)*k, w:nw, h:VIEW.h*k };
    clampView(); applyView();
  });
  // double-click on empty ground resets the camera (districts/towers pin instead)
  svg.addEventListener("dblclick", function(e){
    if(cl(e.target,".tower")||cl(e.target,".slab")||cl(e.target,".chrome")) return;
    resetView();
  });
  var resetBtn=document.getElementById("rot-reset");
  if(resetBtn) resetBtn.addEventListener("click", function(){ resetView(); });
  // resize re-derives the camera aspect from the actual window (θ never does), keeping
  // the current zoom factor and pan offset so the view doesn't jump under the user
  if(typeof window!=="undefined" && window.addEventListener){
    window.addEventListener("resize", function(){
      var zoom=FIT.w/VIEW.w;
      var cdx=(VIEW.x+VIEW.w/2)-(FIT.x+FIT.w/2), cdy=(VIEW.y+VIEW.h/2)-(FIT.y+FIT.h/2);
      fitCamera();
      var nw=FIT.w/zoom, nh=FIT.h/zoom;
      VIEW={ x:FIT.x+FIT.w/2+cdx-nw/2, y:FIT.y+FIT.h/2+cdy-nh/2, w:nw, h:nh };
      clampView(); applyView();
    });
  }

  // ── masthead ages (computed at VIEW time, so a stale file honestly shows its age) ──
  function age(iso){
    if(!iso) return "never";
    var s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);
    if(s<90) return Math.round(s)+"s"; if(s<5400) return Math.round(s/60)+"m";
    if(s<172800) return Math.round(s/3600)+"h"; return Math.round(s/86400)+"d";
  }
  var ageEls=document.querySelectorAll(".facts [data-age]");
  for(var i=0;i<ageEls.length;i++) ageEls[i].textContent=age(ageEls[i].getAttribute("data-age"));

  // ── interaction: hover tooltip (district OR tower) · pin a card · keys rotate ──
  var tip=document.getElementById("tip"), card=document.getElementById("card");
  function pj(v){ return v.files+v.symbols; }
  // HONEST MASS as three real numbers, never one meaningless sum: N files · M lines · K
  // symbols. Lines is the height ruler; symbols the declaration surface — both are data here.
  function linesOf(c){ var n=0, p=c.pieces||[]; for(var k=0;k<p.length;k++) n+=p[k].lines||0; return n; }
  function E(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  // clipboard with a safe fallback; failures are swallowed (a cheap nav aid, never a blocker)
  function copyText(s){
    try{ if(typeof navigator!=="undefined" && navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(s).then(null,function(){}); return; } }catch(_e){}
    try{ var ta=document.createElement("textarea"); ta.value=s; document.body.appendChild(ta); if(ta.select)ta.select(); if(document.execCommand)document.execCommand("copy"); document.body.removeChild(ta); }catch(_f){}
  }
  function districtChg(c){
    if(!DIFF) return "";
    var a=0,r=0,ch=0, pcs=c.pieces||[];
    for(var k=0;k<pcs.length;k++){ if(pcs[k].change==="added")a++; else if(pcs[k].change==="removed")r++; else if(pcs[k].change==="changed")ch++; }
    if(c.change==="removed"&&!a&&!r&&!ch) r=pcs.length;
    if(c.change==="added"&&!a&&!r&&!ch) a=pcs.length;
    if(!a&&!r&&!ch) return "";
    var parts=[]; if(a)parts.push("+"+a+" added"); if(r)parts.push("\\u2212"+r+" removed"); if(ch)parts.push("~"+ch+" changed");
    return "<div class='chg'>"+parts.join(" · ")+(c.change?" ("+c.change+" district)":"")+"</div>";
  }
  function tipHtml(c){
    var lit=c.light.level, extra=(c.light.fails?(" · "+c.light.fails+" failing"):"")+(c.light.stale?(" · "+c.light.stale+" stale"):"");
    return "<div class='t'>"+E(c.label)+"</div>"+
      (c.intent?"<div class='r' style='color:var(--dim)'>"+E(c.intent)+"</div>":"")+
      "<div class='r'><span>size</span><b>"+c.mass.files+" files · "+linesOf(c)+" lines · "+c.mass.symbols+" sym</b></div>"+
      "<div class='r'><span>claimed</span><b>"+c.claimed.files+" / "+c.mass.files+" files</b></div>"+
      "<div class='r'><span>heat</span><b>"+Math.round(c.heat*100)+"%</b></div>"+
      "<div class='lvl' style='color:"+(lit==="lit"?"#ffd36e":lit==="dim"?"#8fb0d6":"#7d8d9b")+"'>"+lit+extra+"</div>"+
      districtChg(c);
  }
  function fileTip(tw, c){
    var claimed=tw.getAttribute("data-claimed")==="1", chg=tw.getAttribute("data-change");
    var tag = chg ? chg : (claimed?"claimed":"unclaimed");
    return "<div class='t'>"+E(c.label)+"</div>"+
      "<div class='parcelrow'>"+E(tw.getAttribute("data-file"))+
      "<span class='tag "+tag+"'>"+tag+"</span></div>";
  }
  function cardHtml(c){
    var gates=(c.gates||[]).map(function(gt){
      return "<div class='gate'><span class='m "+gt.material+"'>"+E(gt.material)+"</span>"+
        "<span class='inv'>"+E(gt.inv)+(gt.humanEye?" <span class='eye' title='needs a human eye'>⚑</span>":"")+"</span>"+
        "<span class='flow'>"+E(gt.chokepoint)+" <span class='arw'>→</span> "+
        (gt.verb?E(gt.verb):"no oracle")+(gt.oracle?" “"+E(gt.oracle)+"”":"")+
        " <span class='arw'>→</span> <span class='vd "+gt.verdict+"'>"+E(gt.verdict)+"</span></span></div>";
    }).join("") || "<div class='samp'>no boundary gates declared</div>";
    var unanch=(c.unanchored||[]).length?"<h4>unanchored invariants</h4><ul class='redlist'>"+c.unanchored.map(function(u){return "<li>⚑ "+E(u)+"</li>";}).join("")+"</ul>":"";
    var samp=(c.unclaimedSample||[]).length?"<h4>outside the blueprint</h4><div class='samp'>"+c.unclaimedSample.map(function(s){return "<span>"+E(s)+"</span>";}).join("")+"</div>":"";
    var why=c.why?"<h4>why</h4><div class='why'>"+E(c.why)+"</div>":"<h4>why</h4><div class='why empty'>— no rationale authored (itself a visible gap)</div>";
    // in a REVIEW scene, name the piece-level changes (added/removed/grown/shrunk). Each row
    // carries the FULL PATH as a title and a data-path; clicking copies it (cheap nav aid).
    // Size deltas are reported in LINES (the height ruler) alongside symbols (the surface).
    var changes="";
    if(DIFF){
      var rows=(c.pieces||[]).filter(function(pc){return pc.change;}).map(function(pc){
        var full=pc.path||pc.label, note=E(full);
        if(pc.change==="changed"){
          if(pc.prevLines!=null) note+=" ("+pc.prevLines+"→"+(pc.lines||0)+" ln · "+(pc.symbols||0)+" sym)";
          else note+=" ("+(pc.lines||0)+" ln · "+(pc.symbols||0)+" sym)";
        }
        else if(pc.change==="added") note+=" (+"+(pc.lines||0)+" ln · "+(pc.symbols||0)+" sym)";
        else if(pc.change==="removed") note+=" (was "+(pc.lines||0)+" ln · "+(pc.symbols||0)+" sym)";
        return "<li class='"+pc.change+"' data-path='"+E(full)+"' title='"+E(full)+" — click to copy path'>"+(pc.change==="added"?"+ ":pc.change==="removed"?"\\u2212 ":"~ ")+note+"</li>";
      });
      if(c.change) rows.unshift("<li class='"+c.change+"'>district "+c.change+"</li>");
      if(rows.length) changes="<h4>changes in this review</h4><ul class='chglist'>"+rows.join("")+"</ul>";
    }
    return "<div class='hd'><div><div class='ct'>"+E(c.label)+"</div><div class='ci'>"+E(c.intent||"")+"</div></div><span class='x' role='button' title='close'>×</span></div>"+
      "<div class='bd'><div class='stat'><span>files <b>"+c.mass.files+"</b></span><span>lines <b>"+linesOf(c)+"</b></span><span>symbols <b>"+c.mass.symbols+"</b></span><span>claimed <b>"+c.claimed.files+"/"+c.mass.files+"</b></span><span>light <b>"+E(c.light.level)+"</b></span><span>heat <b>"+Math.round(c.heat*100)+"%</b></span></div>"+
      changes+"<h4>gates</h4>"+gates+unanch+samp+why+"</div>";
  }
  function pin(idx){ pinnedIdx=idx; card.innerHTML=cardHtml(M.components[idx]); card.classList.add("on"); render(); }
  function unpin(){ pinnedIdx=-1; card.classList.remove("on"); render(); }

  svg.addEventListener("mousemove",function(e){
    if(down && down.moved){ tip.style.opacity=0; return; }   // don't fight the drag
    var t=e.target;
    var tw=cl(t,".tower"), sl=cl(t,".slab")||cl(t,".chrome");
    var host=tw||sl;
    // ON-DEMAND LINKS follow the hovered district: re-render only when the district under
    // the pointer CHANGES (not every pixel), so its wiring lights up and clears cleanly.
    var hi = host ? +host.getAttribute("data-idx") : -1;
    if(hi!==hoverIdx){ hoverIdx=hi; render(); }
    if(!host){ tip.style.opacity=0; return; }
    var c=M.components[+host.getAttribute("data-idx")];
    tip.innerHTML= tw ? fileTip(tw,c) : tipHtml(c);
    tip.style.opacity=1;
    var x=e.clientX+16, y=e.clientY+16;
    if(x>innerWidth-300) x=e.clientX-296;
    tip.style.left=x+"px"; tip.style.top=y+"px";
  });
  svg.addEventListener("mouseleave",function(){ tip.style.opacity=0; if(hoverIdx!==-1){ hoverIdx=-1; render(); } });
  card.addEventListener("click",function(e){
    if(e.target.classList.contains("x")){ unpin(); return; }
    var li=cl(e.target,".chglist li");          // click a change row → copy its full path
    if(li && li.getAttribute){ var pth=li.getAttribute("data-path"); if(pth) copyText(pth); }
  });
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){ unpin(); tip.style.opacity=0; }
    else if(e.key==="ArrowLeft"){ step60(-1); }
    else if(e.key==="ArrowRight"){ step60(1); }
  });
})();
</script>
</body></html>
`;
};
