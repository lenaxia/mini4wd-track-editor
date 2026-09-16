/* UI — DOM wiring: palette, toolbar, dialogs, toast, stats. Subscribes to
 * the store for tool/mode/stats sync. Gets canvas dims injected (no import
 * of render/input — keeps the module graph acyclic). */

import {
  state, subscribe, setTool, setMode, undo, clearAll, loadSprites, rotate, bumpLevel, zoomAt, fitView, addPieces, applySolution,
} from './store.js';
import { PIECES, PALETTE } from './pieces.js';
import { serializeForSave, parseTrack, encodeShare } from './track.js';
import { imageFor } from './assets.js';
import { publishedTrack, publishTrack, unpublishTrack, bindPublished, spritesFromRow,
         forkTrack, fetchHistory, restoreRevision, isMine, mineIds } from './storage.js';
import {
  GALLERY_SORTS, GALLERY_LANES, galleryQuery, formatFootprint, formatLength, completeBadge, lengthToCm, cmToLength,
  isStarred, addStarred, removeStarred, thumbFit, trackFacets,
} from './gallery.js';
import { validateTrack } from './validate.js';
import { tipBtn, initTooltips } from './tooltip.js';
import { icon } from './icons.js';
import { drawPieceArt } from './art.js';
import { closeLoop, closeLoopStepping, solverSetFor, endPieceIssue } from './solver.js';

const $ = (id) => document.getElementById(id);
let ioMode = 'import'; /* or 'share' */
let getDims = () => ({ w: 800, h: 600, dpr: 1 });

/* Toast. opts: { duration (ms, default 2200; 9000 with an action),
 * actionLabel, onAction } — with an action the toast carries a tappable
 * button and outlives the default fade. */
export function toast(msg, opts = {}) {
  const el = $('toast');
  el.textContent = msg;
  if (el._click) { el.removeEventListener('click', el._click); el._click = null; }
  clearTimeout(el._t);
  if (opts.actionLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = opts.actionLabel;
    el.append(btn);
    el._click = (ev) => {
      if (ev.target !== btn) return;
      el.classList.remove('show');
      clearTimeout(el._t);
      opts.onAction();
    };
    el.addEventListener('click', el._click);
  }
  el._t = setTimeout(() => el.classList.remove('show'), opts.duration ?? (opts.actionLabel ? 9000 : 2200));
  el.classList.add('show');
}

function openDialog(dlg) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); }
function closeDialog(dlg) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

/* ---------- palette ---------- */

export function buildPalette() {
  const pal = $('palette');
  pal.innerHTML = '';
  const dpr = getDims().dpr;
  for (const name of PALETTE[state.mode]) {
    const def = PIECES[name];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.piece = name;
    chip.setAttribute('role', 'radio');

    const cv = document.createElement('canvas');
    const cw = 64, ch = 44;
    cv.width = cw * dpr; cv.height = ch * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(cw / 2, ch / 2);
    const s = Math.min((cw - 6) / def.w, (ch - 6) / def.h);
    g.scale(s, s);
    const img = imageFor(name, 0);
    if (img && img.complete && img.naturalWidth) {
      g.drawImage(img, -def.w / 2, -def.h / 2, def.w, def.h);
    } else {
      drawPieceArt(g, name, 0); /* fallback until sprites load */
    }

    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = def.label;

    chip.append(cv, label);
    chip.addEventListener('click', () => setTool(name));
    pal.appendChild(chip);
  }
  syncToolUi();
}

let refreshPublishUi = () => {};
let updatePublishBadge = () => {};

/* ---------- store-driven sync ---------- */

let lastStatsText = '';
let lastMode = null;

function updateStats() {
  const f = trackFacets(state.sprites);
  const pub = publishedTrack();
  const txt = `${pub ? pub.name + ' \u00B7 ' : ''}${(f.length_cm / 100).toFixed(2)} m \u00B7 ${f.pieces} pcs`;
  if (txt === lastStatsText && $('stats').title) return; /* avoid DOM writes from the render loop */
  lastStatsText = txt;
  /* name rides in its own span: phones hide it (numbers stay, the name
   * lives behind the tap popup — owner rule); desktop shows the line */
  $('stats').title = 'Track details';
  $('stats').textContent = '';
  const name = document.createElement('span');
  name.className = 'stats-name';
  name.textContent = pub ? `${pub.name} \u00B7 ` : '';
  const nums = document.createElement('span');
  nums.textContent = `${(f.length_cm / 100).toFixed(2)} m \u00B7 ${f.pieces} pcs`;
  $('stats').append(name, nums);
}

function syncToolUi() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === state.tool));
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.piece === state.tool));
  $('mode3').classList.toggle('active', state.mode === 3);
  $('mode5').classList.toggle('active', state.mode === 5);
  $('modeR').classList.toggle('active', state.mode === 'rucdoc');
  /* phones collapse the group to this one button — it IS the selector
   * there, so it always carries the active accent like the visible
   * segment does on desktop (hidden on desktop, the class is inert) */
  $('modeCycle').classList.add('active');
  const label = state.mode === 'rucdoc' ? 'Rudoc' : `${state.mode}L`;
  $('modeCycle').textContent = `${label} \u25B8`;
}

let badgeTimer = null;
function onStoreChange() {
  if (state.mode !== lastMode) {
    lastMode = state.mode;
    buildPalette();
  } else {
    syncToolUi();
  }
  updateStats();
  clearTimeout(badgeTimer);   /* live validity badge (published only) */
  badgeTimer = setTimeout(updatePublishBadge, 600);
}

/* ---------- import / share ---------- */

function importText(text) {
  const sprites = parseTrack(text);
  if (!sprites.length) return toast('No valid pieces found');
  loadSprites(sprites);
  fitView(getDims().w, getDims().h);
  closeDialog($('ioDialog'));
  toast(`Imported ${sprites.length} pieces`);
}

/* ---------- close the loop (solver) ---------- */

/* Complete-track explainer: shown once per session, the first time the tool
 * is armed. Returns true when it just opened (the triggering tap is spent). */
let completeIntroShown = false;
export function completeToolIntro() {
  if (completeIntroShown) return false;
  completeIntroShown = true;
  openDialog($('completeDialog'));
  return true;
}

/* Fill the gap between exactly two selected pieces with the shortest run of
 * family straights / 45-deg corners that clears every placed piece
 * (75 mm level differences bridge over). Shared by the menu button, L and
 * the Complete tool. Returns true when the loop was closed. */
export function closeLoopAction() {
  const sel = [...state.selection];
  if (sel.length !== 2) { toast('Select exactly two pieces (Move tool), then Close loop'); return false; }
  const set = solverSetFor(sel[0], sel[1]);
  if (!set) { toast('Pick two ends of the same lane count — e.g. both 3-lane'); return false; }
  for (const p of sel) {
    const issue = endPieceIssue(state.sprites, p);
    if (issue === 'kind') { toast(`${PIECES[p.name].label} isn\u2019t supported as an end yet — use a straight, corner, wave or lane changer`); return false; }
    if (issue === 'multi-open') { toast('Pick end pieces with exactly one free end (this one has both ends free)'); return false; }
    if (issue === 'no-open') { toast('That piece has no free end'); return false; }
  }
  const res = closeLoop(state.sprites, sel[0], sel[1], { set });
  if (!res.ok) {
    if (res.reason === 'no-open') { toast('One end has no free connection point'); return false; }
    if (res.reason === 'level') {
      const [z0, z1] = res.levels || [];
      toast(`Ends are at different levels${Number.isFinite(z0) ? ` (${z0} vs ${z1} mm)` : ''} — link them with a slope first`);
      return false;
    }
    if (res.reason === 'no-path') { offerStepBack(sel, res, set); return false; }
    toast('Could not close the loop from these ends');
    return false;
  }
  addPieces(res.pieces);
  closeDialog($('menuDialog'));
  toast(res.flex
    ? `Loop closed \u00B7 ${res.pieces.length} pcs \u00B7 ${res.length.toFixed(2)} m \u00B7 ${res.gap.toFixed(1)} cm bend (ends off-grid)`
    : `Loop closed \u00B7 ${res.pieces.length} pcs \u00B7 ${res.length.toFixed(2)} m`);
  return true;
}

/* A failed closure explains itself in a toast, with a tappable offer to
 * remove pieces (the named blocker first, then stepping the end chains
 * back) until it closes. One undo restores everything. */
function offerStepBack(sel, res, set) {
  const why = {
    blocked: 'the closing pieces fit but track is in the way',
    facing: `the ends face ${res.miss.dh.toFixed(0)}\u00B0 apart`,
    'off-grid': `the ends are ${res.miss.d.toFixed(1)} cm out of line for any piece run`,
    limit: 'the search gave up',
  }[res.why] || 'no run fits';
  toast(`Couldn\u2019t close — ${why}. Would you like to automatically remove pieces until a workable solution is found?`, {
    actionLabel: 'Yes',
    onAction: () => {
      if (!state.sprites.includes(sel[0]) || !state.sprites.includes(sel[1])) {
        toast('Selection changed — reselect the two ends and retry');
        return;
      }
      const step = closeLoopStepping(state.sprites, sel[0], sel[1], { set });
      if (!step.ok) { toast('No closable point, even stepping back'); return; }
      applySolution(step.removed, step.closed.pieces);
      closeDialog($('menuDialog'));
      toast(`Stepped back ${step.removed.length} pc${step.removed.length === 1 ? '' : 's'} \u00B7 closed with ${step.closed.pieces.length} pcs \u00B7 ${step.closed.length.toFixed(2)} m`);
    },
  });
}

/* ---------- init ---------- */

export function init(dimsGetter) {
  getDims = dimsGetter;

  subscribe(onStoreChange);
  initTooltips();   /* one delegated listener: any [data-tip] element, anywhere */

  $('btnMenu').addEventListener('click', () => openDialog($('menuDialog')));
  $('btnCloseMenu').addEventListener('click', () => closeDialog($('menuDialog')));

  /* Esc closes any open dialog (native showModal also cancels; this covers
   * the attribute-fallback path and makes the behavior guaranteed) */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('dialog[open]');
    if (open) closeDialog(open);
  });

  $('btnShare').addEventListener('click', () => {
    ioMode = 'share';
    $('ioTitle').textContent = 'Share link';
    $('ioHint').innerHTML = 'This link encodes the whole track \u2014 no server needed. Send it to anyone; it opens in this editor.';
    $('ioText').value = `${location.origin}${location.pathname}#t=${encodeShare(state.sprites)}`;
    $('ioAction').textContent = 'Shorten (copy again)';
    closeDialog($('menuDialog'));
    openDialog($('ioDialog'));
  });

  $('btnExport').addEventListener('click', () => {
    const blob = new Blob([serializeForSave(state.sprites)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mini4wd-track.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Track file downloaded');
  });

  $('fileImport').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((t) => importText(t));
    e.target.value = '';
  });

  $('btnImportText').addEventListener('click', () => {
    ioMode = 'import';
    $('ioTitle').textContent = 'Import';
    $('ioHint').innerHTML = 'Paste an original-site track string (<code>Name;x;y;angle;color#Name;\u2026</code>) or the full text of a <code>/load/CODE.js</code> response.';
    $('ioText').value = '';
    $('ioAction').textContent = 'Import';
    closeDialog($('menuDialog'));
    openDialog($('ioDialog'));
  });

  $('ioAction').addEventListener('click', () => {
    if (ioMode === 'import') importText($('ioText').value);
    else { navigator.clipboard?.writeText($('ioText').value); toast('Copied to clipboard'); }
  });
  $('ioCopy').addEventListener('click', () => {
    navigator.clipboard?.writeText($('ioText').value);
    toast('Copied to clipboard');
  });
  $('ioClose').addEventListener('click', () => closeDialog($('ioDialog')));

  $('btnLoop').addEventListener('click', () => { closeDialog($('menuDialog')); closeLoopAction(); });

  /* ---------- publish / save / library (unpublished = local only) ---------- */

  /* hydrate static icons (data-icon spans carry the MDI name) */
  document.querySelectorAll('[data-icon]').forEach((el) => {
    const size = el.closest('.tool, .icon-btn, #zoomControls') ? 20 : 18;
    el.innerHTML = icon(el.dataset.icon, size);
  });

  refreshPublishUi = function () {
    updatePublishBadge();
    updateSharedNote();
    lastStatsText = '';   /* force the stats line to re-render with the name */
    updateStats();
  };

  /* Shared-track note (worklog 0017): editing a published track this
   * browser never saved offers the plain-language out — keep editing it
   * for everyone, or take your own copy. Hidden once a save lands here
   * (the id enters the Mine list) or the track is unpublished. */
  function updateSharedNote() {
    const pub = publishedTrack();
    const shared = !!(pub && !isMine(pub.id));
    const note = $('sharedNote');
    if (note) note.hidden = !shared;
  }
  /* the debounced save of a shared track lands in storage.js — it tells
   * us here so the note hides immediately, not at the next refresh */
  globalThis.addEventListener('m4wd:saved', updateSharedNote);

  /* Copy the current canvas as your own track; the binding moves to the
   * copy and autosave mirrors there from now on — the shared original
   * keeps its last saved version. */
  $('btnOwnCopy').addEventListener('click', async () => {
    const pub = publishedTrack();
    if (!pub) return;
    const btn = $('btnOwnCopy');
    btn.disabled = true;
    const r = await forkTrack(pub, state);
    btn.disabled = false;
    if (!r) { toast('Server unreachable — copy not saved'); return; }
    if (!r.ok) { toast('Copy not saved — the original is gone from the server'); return; }
    updateSharedNote();
    refreshPublishUi();
    toast(`This is your copy now — “${r.row.name}” — edits save here`);
  });

  /* Published: the button is a live validity badge, not an action —
   * autosave persists; tap reports the verdict. Unpublished: 📤 opens
   * the publish dialog. The stats-bar name renames (dialog, rename mode). */
  updatePublishBadge = function () {
    const pub = publishedTrack();
    const btn = $('btnPublishBar');
    if (!pub) {
      btn.innerHTML = icon('cloud-upload', 20);
      btn.title = 'Publish track';
      btn.classList.remove('pub-ok', 'pub-bad');
      return;
    }
    const { ok, errors } = validateTrack(state.sprites);
    btn.innerHTML = icon('content-save-check', 20);
    btn.title = ok ? `“${pub.name}” — complete and saved`
                   : `“${pub.name}” — ${errors.length} issue(s); autosaves as Work-in-Progress`;
    btn.classList.toggle('pub-ok', ok);
    btn.classList.toggle('pub-bad', !ok);
  };

  function renderPubStatus() {
    const { ok, errors, warnings } = validateTrack(state.sprites);
    const box = $('pubStatus');
    const rows = [];
    for (const e of errors) rows.push(`<div style="color:#e05263">✖ ${e}</div>`);
    for (const w of warnings) rows.push(`<div style="color:#d9a441">⚠ ${w}</div>`);
    if (ok && !warnings.length) rows.push('<div style="color:#4ade80">✓ track is complete and consistent</div>');
    /* completeness is a facet, not a gate (owner model): incomplete
     * tracks publish as Work-in-Progress — warn, never lock. Rename mode
     * states the CURRENT state instead of a pending publish. */
    if (!ok) {
      const bound = !!publishedTrack();
      rows.push(bound
        ? `<div style="color:#d9a441">▸ saved as Work-in-Progress (${errors.length} issue${errors.length === 1 ? '' : 's'})</div>`
        : `<div style="color:#d9a441">▸ will publish as Work-in-Progress (${errors.length} issue${errors.length === 1 ? '' : 's'})</div>`);
    }
    box.innerHTML = rows.join('');
    /* dangling ends have a tool for exactly that */
    $('pubTipComplete').style.display = errors.some((e) => /Dangling/.test(e)) ? 'block' : 'none';
    return ok;
  }

  $('btnPublishBar').addEventListener('click', () => {
    const pub = publishedTrack();
    if (pub) {
      /* status tap: verdict toast, no dialog (autosave already persists) */
      const { ok, errors } = validateTrack(state.sprites);
      toast(ok ? `“${pub.name}” — complete and saved`
               : `“${pub.name}” — WIP: ${errors[0] ?? ''}`);
      return;
    }
    $('pubTitle').textContent = 'Publish track';
    $('pubOk').textContent = 'Publish';
    $('pubName').value = '';
    renderPubStatus();
    closeDialog($('menuDialog'));
    openDialog($('publishDialog'));
    $('pubName').focus();
  });
  $('pubClose').addEventListener('click', () => closeDialog($('publishDialog')));
  $('pubCancel').addEventListener('click', () => closeDialog($('publishDialog')));
  $('pubTipComplete').addEventListener('click', () => {
    closeDialog($('publishDialog'));
    setTool('Complete');       /* arm (this path has no data-tool binding) */
    completeToolIntro();       /* then the once-per-session intro, if due */
  });
  $('pubOk').addEventListener('click', async () => {
    renderPubStatus();                /* refresh the status at save time */
    const name = $('pubName').value.trim() || 'Untitled';
    const wasPublished = !!publishedTrack();
    $('pubOk').disabled = true;
    const row = await publishTrack(name, state);
    $('pubOk').disabled = false;
    if (!row) { toast('Server unreachable — track stays local'); return; }
    closeDialog($('publishDialog'));
    refreshPublishUi();
    toast(wasPublished ? `Saved “${row.name}”`
                       : `Published “${row.name}” — edits now auto-save`);
  });

  $('btnLibrary').addEventListener('click', async () => {
    closeDialog($('menuDialog'));
    const list = $('libList');
    list.textContent = 'Loading…';
    openDialog($('libraryDialog'));
    try {
      const res = await fetch('/api/tracks?sort=-updated_at&limit=50');
      const page = await res.json();
      list.textContent = '';
      if (!page.items.length) { list.textContent = 'No published tracks yet.'; return; }
      for (const it of page.items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'lib-row';
        row.dataset.id = it.id;
        const when = new Date(it.updated_at).toLocaleString();
        row.textContent = `${it.name} · ${it.piece_count} pcs · ${(it.length_cm / 100).toFixed(2)} m · ${when}`;
        row.addEventListener('click', () => loadPublishedTrack(it.id));
        list.appendChild(row);
      }
    } catch { list.textContent = 'Server unreachable.'; }
  });
  $('libClose').addEventListener('click', () => closeDialog($('libraryDialog')));

  /* Shared by the library and the gallery: fetch a published row, confirm
   * the replace when the canvas holds work, adopt the publication binding
   * (edits auto-save from there) and fit the view. */
  async function loadPublishedTrack(id) {
    try {
      const res = await fetch(`/api/tracks/${id}`);
      if (!res.ok) { toast('Track not found on server'); return; }
      const row = await res.json();
      const sprites = spritesFromRow(row);
      if (!sprites.length) { toast('Track has no pieces'); return; }
      if (state.sprites.length && !confirm(`Load “${row.name}”? The canvas will be replaced.`)) return;
      bindPublished(row);   /* the loaded track keeps auto-saving */
      loadSprites(sprites); /* emits -> autosave snapshots it */
      fitView(getDims().w, getDims().h);
      closeDialog($('libraryDialog'));
      closeDialog($('galleryDialog'));
      refreshPublishUi();
      toast(`Loaded “${row.name}” — ${sprites.length} pcs · edits auto-save`);
    } catch { toast('Server unreachable'); }
  }

  /* ---------- gallery (ALL published tracks, not just this browser's) ---------- */

  const GAL_PAGE = 25;
  /* complete-only is the owner's default view; the drawer's filter
   * state mirrors galFilterDefaults (Reset restores them) */
  const galFilterDefaults = () => ({
    minLength: 0, maxLength: 0, lanes: [...GALLERY_LANES],
    maxW: null, maxH: null, maxStraights: null, maxSlopes: null, maxCorners: null,
  });
  /* loading: one galLoad in flight at a time (double-tap on Load more
   * must not fetch the page twice). gen: bumped by every sort/filter/open
   * so a superseded page is dropped instead of appended into the new
   * view. A dropped page leaves `loading` alone — the newer call owns it. */
  const gal = { sort: '-updated_at', complete: true, mine: false, unit: 'm', filter: galFilterDefaults(), items: [], total: 0, gen: 0, loading: false };

  function galFilterCount() {
    const f = gal.filter, d = galFilterDefaults();
    let n = 0;
    if (f.minLength > 0 || f.maxLength > 0) n += 1;
    if (f.lanes.length !== d.lanes.length) n += 1;
    for (const k of ['maxW', 'maxH', 'maxStraights', 'maxSlopes', 'maxCorners'])
      if (f[k] != null) n += 1;
    return n;
  }

  function galRenderControls() {
    const sel = $('galSort');
    sel.innerHTML = '';
    for (const s of GALLERY_SORTS) {
      const opt = document.createElement('option');
      opt.value = s.value;
      opt.textContent = s.label;
      opt.selected = gal.sort === s.value;
      sel.appendChild(opt);
    }
    $('galComplete').setAttribute('aria-pressed', String(gal.complete));
    $('galMine').setAttribute('aria-pressed', String(gal.mine));
    const n = galFilterCount();
    $('galFilterCount').hidden = n === 0;
    $('galFilterCount').textContent = n;
  }

  /* sync the drawer's controls from gal.filter (unit keeps the cm
   * values readable: inputs display converted, state stores cm).
   * Lanes checkboxes are built ONCE (init) — rebuilding them on every
   * refetch destroys the control mid-interaction (e2e: 'not stable') */
  function galRenderDrawer() {
    const f = gal.filter;
    $('galMinLen').value = f.minLength;
    $('galMaxLen').value = f.maxLength || 200;
    galLenOut();
    document.querySelectorAll('#galLanes input[type="checkbox"]').forEach((cb, i) => {
      cb.checked = f.lanes.includes(GALLERY_LANES[i]);
    });
    $('galUnitM').setAttribute('aria-pressed', String(gal.unit === 'm'));
    $('galUnitFt').setAttribute('aria-pressed', String(gal.unit === 'ft'));
    const fromCm = (cm) => (cm == null ? '' : String(cmToLength(cm, gal.unit)));
    document.querySelectorAll('.gal-dim-unit').forEach((n) => { n.textContent = gal.unit; });
    $('galMaxW').value = fromCm(f.maxW);
    $('galMaxH').value = fromCm(f.maxH);
    $('galMaxStraights').value = f.maxStraights ?? '';
    $('galMaxSlopes').value = f.maxSlopes ?? '';
    $('galMaxCorners').value = f.maxCorners ?? '';
  }

  function galBuildLanes() {
    const lanes = $('galLanes');
    for (const n of GALLERY_LANES) {
      const lab = document.createElement('label');
      lab.className = 'gal-lane';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', () => {
        gal.filter.lanes = GALLERY_LANES.filter((x) => (x === n ? cb.checked : gal.filter.lanes.includes(x)));
        openGallery();
      });
      lab.append(cb, `${n} lanes`);
      lanes.appendChild(lab);
    }
  }

  /* the slider scale is metres (0..200); the readout follows the unit */
  function galLenOut() {
    const f = gal.filter;
    const fmt = (m) => (gal.unit === 'ft' ? `${Math.round(cmToLength(m * 100, 'ft'))} ft` : `${m} m`);
    let txt = 'any';
    if (f.minLength > 0 && f.maxLength > 0 && f.maxLength < 200) txt = `${fmt(f.minLength)}\u2013${fmt(f.maxLength)}`;
    else if (f.minLength > 0) txt = `${fmt(f.minLength)}+`;
    else if (f.maxLength > 0 && f.maxLength < 200) txt = `\u2264 ${fmt(f.maxLength)}`;
    $('galMinLenOut').textContent = txt;
    /* highlight between the thumbs */
    const a = (f.minLength / 200) * 100, b = ((f.maxLength || 200) / 200) * 100;
    $('galRangeFill').style.left = `${a}%`;
    $('galRangeFill').style.width = `${b - a}%`;
  }

  function galOpenPanel(open) {
    $('galDrawer').classList.toggle('open', open);
    $('galFilters').setAttribute('aria-expanded', String(open));
  }

  async function galLoad() {
    if (gal.loading) return;
    /* lanes=[] cannot be expressed server-side (omitting the param
     * means ALL lanes — the inverse of the empty selection) — render
     * the empty state locally instead of a misleading fetch */
    if (gal.filter.lanes.length === 0) {
      gal.items = [];
      gal.total = 0;
      galRenderList();
      $('galMeta').textContent = '';
      return;
    }
    gal.loading = true;
    const gen = gal.gen;
    const list = $('galList');
    if (!gal.items.length) list.textContent = 'Loading…';
    try {
      const res = await fetch(`/api/tracks?${galleryQuery({
        sort: gal.sort, complete: gal.complete, filter: gal.filter,
        limit: GAL_PAGE, offset: gal.items.length,
      })}`);
      const page = await res.json();
      if (gen !== gal.gen) return;   /* a newer sort/filter/open owns the list now */
      gal.items.push(...page.items);
      gal.total = page.total;
      galRenderList();
    } catch {
      if (gen !== gal.gen) return;
      list.textContent = 'Server unreachable.';
      $('galMeta').textContent = '';
    } finally {
      if (gen === gal.gen) gal.loading = false;
    }
  }

  /* ---------- card previews (lazy per-row track fetch) ----------
   * List rows carry no track body (metadata only by design), so each
   * card pulls its row once, parses it and draws a thumbnail. Results
   * (including negatives — 404s and empty parses) are cached for the
   * session; an in-flight id is shared by every canvas waiting on it,
   * and at most 4 fetches run at a time. Canvases that left the DOM
   * (sort switch) are skipped at draw time. */
  const galThumbCache = new Map();     /* id -> sprites | null (negative) */
  const galThumbPending = new Map();   /* id -> canvas[] waiting on the fetch */
  const galThumbQueue = [];
  let galThumbActive = 0;
  const GAL_THUMB_MAX = 4;
  const GAL_THUMB_W = 400, GAL_THUMB_H = 300;

  function galThumb(cv, id) {
    if (galThumbCache.has(id)) {              /* negatives (null) skip the draw AND the refetch */
      const cached = galThumbCache.get(id);
      if (cached) galDrawThumb(cv, cached);
      return;
    }
    const waiters = galThumbPending.get(id);
    if (waiters) { waiters.push(cv); return; }   /* join the in-flight fetch */
    galThumbPending.set(id, [cv]);
    galThumbQueue.push(id);
    /* microtask: rows are queued before their container appends them —
     * pump once the render loop has connected the canvases */
    queueMicrotask(galThumbPump);
  }

  function galThumbPump() {
    while (galThumbActive < GAL_THUMB_MAX && galThumbQueue.length) {
      const id = galThumbQueue.shift();
      const waiters = (galThumbPending.get(id) || []).filter((cv) => cv.isConnected);
      if (!waiters.length) { galThumbPending.delete(id); continue; }   /* nobody left to draw */
      galThumbActive += 1;
      fetch(`/api/tracks/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((row) => {
          const sprites = row ? spritesFromRow(row) : [];
          galThumbCache.set(id, sprites.length ? sprites : null);   /* negatives cache too */
          /* the live pending entry: canvases that joined while the fetch
           * was in flight must draw too (sort/load-more re-renders) */
          for (const cv of galThumbPending.get(id) || []) if (cv.isConnected) galDrawThumb(cv, sprites);
        })
        .catch(() => {})
        .finally(() => { galThumbActive -= 1; galThumbPending.delete(id); galThumbPump(); });
    }
  }

  function galDrawThumb(cv, sprites) {
    const g = cv.getContext('2d');
    g.setTransform(cv.width / GAL_THUMB_W, 0, 0, cv.height / GAL_THUMB_H, 0, 0);
    g.clearRect(0, 0, GAL_THUMB_W, GAL_THUMB_H);
    const t = thumbFit(sprites, GAL_THUMB_W, GAL_THUMB_H);
    if (!t) return;
    g.translate(t.cx, t.cy);
    g.scale(t.scale, t.scale);
    for (const p of sprites) {
      const def = PIECES[p.name];
      if (!def) continue;
      g.save();
      g.translate(p.x, p.y);
      g.rotate((p.a || 0) * Math.PI / 180);
      const img = imageFor(p.name, p.c || 0);
      if (img && img.complete && img.naturalWidth) g.drawImage(img, -def.w / 2, -def.h / 2, def.w, def.h);
      else drawPieceArt(g, p.name, p.c || 0);   /* boot race / missing sprite; drawn once, no later repaint */
      g.restore();
    }
  }

  function galRowEl(it) {
    const row = document.createElement('div');
    row.className = 'gal-row';
    row.dataset.id = it.id;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gal-main';
    const thumb = document.createElement('canvas');
    thumb.className = 'gal-thumb';
    const dpr = getDims().dpr;
    thumb.width = GAL_THUMB_W * dpr;
    thumb.height = GAL_THUMB_H * dpr;
    const top = document.createElement('span');
    top.className = 'gal-top';
    const name = document.createElement('span');
    name.className = 'gal-name';
    name.textContent = it.name;
    const badge = completeBadge(it);
    const mark = document.createElement('span');
    mark.className = `gal-badge ${badge.cls}`;
    mark.textContent = badge.text;
    mark.title = badge.title;
    top.append(name, mark);
    /* ?? 0: rows written before a facet column existed read undefined —
     * a long-running store must not render 'undefined slp' */
    const facets = document.createElement('span');
    facets.className = 'gal-facets';
    facets.textContent = `${it.piece_count} pcs · ${formatLength(it.length_cm, gal.unit)} · ${it.lanes} lanes`
      + ` · ${formatFootprint(it.bbox_w_cm, it.bbox_h_cm, gal.unit)}`
      + ` · ${it.straights ?? 0} straights · ${it.slopes ?? 0} slopes · ${it.corners ?? 0} corners`;
    const sub = document.createElement('span');
    sub.className = 'gal-sub';
    sub.textContent = `★ ${it.stars ?? 0} · ${galDate(it.updated_at)}`;
    card.append(thumb, top, facets, sub);
    if (it.parent_name) {
      const based = document.createElement('span');
      based.className = 'gal-based';
      based.textContent = `based on “${it.parent_name}”`;
      card.append(based);
    }
    card.addEventListener('click', () => loadPublishedTrack(it.id));
    galThumb(thumb, it.id);

    /* the star lives INSIDE the card, over the thumbnail's corner */
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'gal-star';
    const starred = isStarred(localStorage, it.id);
    star.classList.toggle('starred', starred);
    star.textContent = starred ? '★' : '☆';
    star.title = starred ? 'Starred on this device — tap to unstar' : 'Star this track';
    star.addEventListener('click', (e) => { e.stopPropagation(); galStar(it, star, sub); });

    /* Kebab menu (worklog 0021): Copy + History live behind ⋮ on the
     * card's thumbnail, beside the star. The card is a <button>, so the
     * kebab is a sibling overlay like the star — never nested. */
    const kebab = document.createElement('button');
    kebab.type = 'button';
    kebab.className = 'gal-kebab';
    kebab.title = 'Track actions';
    kebab.setAttribute('aria-label', `Actions for “${it.name}”`);
    kebab.setAttribute('aria-expanded', 'false');
    kebab.innerHTML = icon('dots-vertical', 20);
    const menu = document.createElement('span');
    menu.className = 'gal-menu';
    menu.hidden = true;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.title = `Make your own copy of “${it.name}” — the original is not changed`;
    copy.textContent = 'Save my own copy';
    copy.addEventListener('click', (e) => { e.stopPropagation(); closeGalMenus(); galCopy(it, copy); });
    const his = document.createElement('button');
    his.type = 'button';
    his.title = 'Old versions of this track — restore one';
    his.textContent = 'History';
    his.addEventListener('click', (e) => { e.stopPropagation(); closeGalMenus(); openHistory(it); });
    menu.append(copy, his);
    kebab.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closeGalMenus();
      menu.hidden = !open;
      kebab.setAttribute('aria-expanded', String(!menu.hidden));
    });

    row.append(card, star, kebab, menu);
    return row;
  }

  /* one open kebab menu at a time; any tap outside (or a scroll of the
   * list) closes it. Registered once at init. */
  function closeGalMenus() {
    document.querySelectorAll('.gal-menu:not([hidden])').forEach((m) => {
      m.hidden = true;
      const k = m.parentElement?.querySelector('.gal-kebab');
      if (k) k.setAttribute('aria-expanded', 'false');
    });
  }
  document.addEventListener('click', closeGalMenus);
  $('galList').addEventListener('scroll', closeGalMenus, { passive: true });

  function galRenderList() {
    const list = $('galList');
    list.textContent = '';
    /* Mine is a local filter (worklog 0017): it narrows the rows this
     * browser saved/edited — "Load more" keeps fetching to surface more. */
    const mine = mineIds();
    const shown = gal.mine ? gal.items.filter((it) => mine.includes(it.id)) : gal.items;
    if (!shown.length) {
      $('galMeta').textContent = '';
      const empty = document.createElement('p');
      empty.className = 'gal-empty';
      empty.textContent = gal.filter.lanes.length === 0 ? 'No lanes selected — tick at least one in Filters.'
        : gal.mine
          ? (gal.items.length ? 'No saved tracks in this view yet — Load more may find older ones.' : 'No tracks saved on this device yet.')
          : gal.complete ? 'No complete tracks published yet.' : 'No tracks published yet.';
      list.appendChild(empty);
      return;
    }
    for (const it of shown) list.appendChild(galRowEl(it));
    if (gal.items.length < gal.total) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'gal-more';
      more.textContent = `Load more · ${gal.total - gal.items.length} remaining`;
      more.addEventListener('click', galLoad);
      list.appendChild(more);
    }
    $('galMeta').textContent = gal.mine
      ? `${shown.length} of yours · ${gal.items.length} of ${gal.total} loaded`
      : `${gal.items.length} of ${gal.total} track${gal.total === 1 ? '' : 's'}`;
  }

  /* One star per browser per track, reversible: the localStorage set
   * gates the request (POST stars, DELETE takes it back) — the server
   * counter itself is public (no auth — accepted). */
  async function galStar(it, btn, sub) {
    if (btn.disabled) return;
    const un = isStarred(localStorage, it.id);
    btn.disabled = true;
    try {
      const res = await fetch(`/api/tracks/${it.id}/star`, { method: un ? 'DELETE' : 'POST' });
      if (!res.ok) throw new Error();
      const { stars } = await res.json();
      it.stars = stars;
      if (un) removeStarred(localStorage, it.id);
      else addStarred(localStorage, it.id);
      btn.classList.toggle('starred', !un);
      btn.textContent = un ? '☆' : '★';
      btn.title = un ? 'Star this track' : 'Starred on this device — tap to unstar';
      sub.textContent = `★ ${stars} · ${galDate(it.updated_at)}`;
    } catch { toast('Server unreachable'); }
    btn.disabled = false;
  }

  function galDate(t) { return new Date(t).toLocaleDateString(); }

  function openGallery(sort) {
    if (sort) gal.sort = sort;
    gal.gen += 1;            /* invalidate any in-flight page */
    gal.loading = false;     /* …and free the lock it may hold */
    closeDialog($('menuDialog'));
    gal.items = [];
    gal.total = 0;
    galRenderControls();
    galRenderDrawer();
    galLoad();
    openDialog($('galleryDialog'));
  }

  galBuildLanes();
  /* (?) affordances on the filter fields (reusable tooltip system) —
   * AFTER the title text; the controls sit BELOW the title row */
  /* title row ("Footprint max (?)") with the controls BELOW it */
  const titleTip = (field, text) => {
    const title = document.createElement('span');
    title.className = 'gal-field-title';
    const label = field.firstChild;           /* the title text node */
    title.append(label.textContent.trim() + ' ', tipBtn(text));
    field.replaceChild(title, label);
  };
  const minLenTitle = (field, text) => {
    /* the markup ships the title span with the live output inside —
     * the (?) rides in front of it */
    field.querySelector('.gal-field-title').prepend(tipBtn(text));
  };
  minLenTitle($('galMinLenField'), 'Show tracks in this length range — drag either end.');
  $('galLanes').querySelector('legend').append(tipBtn('Which lane widths to show — 2-lane rucdoc, 3-lane Japan Cup, 5-lane WIDE.'));
  titleTip($('galFootField'), 'Tracks must fit within this maximum footprint (width \u00D7 height) — a track laid the other way round still fits.');
  titleTip($('galAtMostField'), 'Upper limits on piece counts. Hairpins and rainbows count as 4 corners.');

  /* the brand IS a gallery shortcut (owner round); fresh opens and
   * dialog-close reset the panel — filter changes keep it open (the
   * owner adjusts several filters in a row) */
  const openGalleryFresh = () => { galOpenPanel(false); openGallery(); };
  $('brand').addEventListener('click', openGalleryFresh);
  $('btnGallery').addEventListener('click', openGalleryFresh);
  /* toolbar globe beside Publish — the gallery was hard to find (owner) */
  $('btnGalleryBar').addEventListener('click', openGalleryFresh);
  $('galClose').addEventListener('click', () => { galOpenPanel(false); closeDialog($('galleryDialog')); });
  $('galleryDialog').addEventListener('close', () => galOpenPanel(false));   /* Esc/backdrop path */
  $('galSort').addEventListener('change', (e) => openGallery(e.target.value));
  $('galComplete').addEventListener('click', () => { gal.complete = !gal.complete; openGallery(); });
  /* Mine re-filters what's already loaded — no refetch (a page that
   * holds none of yours says so and offers Load more) */
  $('galMine').addEventListener('click', () => {
    gal.mine = !gal.mine;
    galRenderControls();
    galRenderList();
  });

  /* Copy = your own version (worklog 0020): a new track forked from the
   * row as-is. The original is never modified. */
  async function galCopy(it, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const r = await forkTrack(it);
    btn.disabled = false;
    if (!r) { toast('Server unreachable — copy not saved'); return; }
    if (!r.ok) {
      toast(r.status === 404 ? 'That track is gone from the server — reopen the gallery' : 'Copy not saved');
      return;
    }
    toast(`Saved your own copy of “${it.name}” — Mine shows it`);
  }

  /* History dialog: list this track's old versions, Restore re-publishes
   * one as the newest version (the current one is archived first). */
  async function openHistory(it) {
    const items = await fetchHistory(it.id);
    const box = $('hisList');
    box.textContent = '';
    if (!items) {
      const p = document.createElement('p');
      p.className = 'gal-empty';
      p.textContent = 'Server unreachable.';
      box.appendChild(p);
    } else if (!items.length) {
      const p = document.createElement('p');
      p.className = 'gal-empty';
      p.textContent = 'No old versions yet — one is kept every time someone saves.';
      box.appendChild(p);
    } else {
      for (const h of items) {
        const row = document.createElement('div');
        row.className = 'his-row';
        const label = document.createElement('span');
        label.textContent = `${galDate(h.created_at)} · “${h.name}”`;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Restore';
        b.addEventListener('click', async () => {
          b.disabled = true;
          const r = await restoreRevision(it.id, h.seq);
          b.disabled = false;
          if (!r) { toast('Server unreachable — nothing restored'); return; }
          if (!r.ok) {
            toast(r.status === 404 ? 'That version is no longer available — reopen History' : 'Restore failed');
            return;
          }
          const fresh = r.row;   /* refetched full row — data is present on every driver */
          closeDialog($('historyDialog'));
          /* the restored track may be open on this canvas — show the
           * restored version immediately (its next save would otherwise
           * stomp the restore) */
          const pub = publishedTrack();
          if (pub && pub.id === it.id) {
            const sprites = spritesFromRow(fresh);
            if (sprites.length) {
              loadSprites(sprites);
              fitView(getDims().w, getDims().h);
              refreshPublishUi();
            }
          }
          toast(`Restored “${fresh.name}” — the version that was current is now in History`);
        });
        row.append(label, b);
        box.appendChild(row);
      }
    }
    $('hisHint').textContent = `Old versions of “${it.name}” — anyone can restore one.`;
    openDialog($('historyDialog'));
  }
  $('hisClose').addEventListener('click', () => closeDialog($('historyDialog')));

  /* the Filters button TOGGLES the panel (owner round 2) */
  $('galFilters').addEventListener('click', () => galOpenPanel(!$('galDrawer').classList.contains('open')));
  $('galDone').addEventListener('click', () => galOpenPanel(false));
  /* unit switch: re-render cards and drawer conversions — data is
   * already in gal.items, no refetch */
  $('galUnitM').addEventListener('click', () => { gal.unit = 'm'; galRenderDrawer(); galRenderList(); });
  $('galUnitFt').addEventListener('click', () => { gal.unit = 'ft'; galRenderDrawer(); galRenderList(); });
  /* two thumbs: each pushes the other past itself; values snap so
   * min <= max always holds */
  const galRangeInput = (which) => (e) => {
    const v = +e.target.value;
    if (which === 'min') {
      gal.filter.minLength = v;
      if (v > (gal.filter.maxLength || 200)) gal.filter.maxLength = v;
    } else {
      gal.filter.maxLength = v;
      if (v < gal.filter.minLength) gal.filter.minLength = v;
    }
    if (gal.filter.maxLength >= 200) gal.filter.maxLength = 0;   /* 0 = any cap */
    $('galMinLen').value = gal.filter.minLength;
    $('galMaxLen').value = gal.filter.maxLength || 200;
    galLenOut();
  };
  $('galMinLen').addEventListener('input', galRangeInput('min'));
  $('galMaxLen').addEventListener('input', galRangeInput('max'));
  $('galMinLen').addEventListener('change', () => openGallery());
  $('galMaxLen').addEventListener('change', () => openGallery());
  /* footprint + count caps: inputs are in the chosen unit (state is cm);
   * empty = any. Fires on blur/Enter, not per keystroke. */
  const galCap = (inputId, key, toCm) => {
    $(inputId).addEventListener('change', (e) => {
      const v = e.target.value;
      gal.filter[key] = v === '' ? null
        : (toCm ? lengthToCm(Math.max(0, +v), gal.unit) : Math.max(0, Math.round(+v)));
      openGallery();
    });
  };
  galCap('galMaxW', 'maxW', true);
  galCap('galMaxH', 'maxH', true);
  galCap('galMaxStraights', 'maxStraights', false);
  galCap('galMaxSlopes', 'maxSlopes', false);
  galCap('galMaxCorners', 'maxCorners', false);

  $('galReset').addEventListener('click', () => {
    gal.filter = galFilterDefaults();
    galRenderDrawer();
    openGallery();
  });

  $('btnNewTrack').addEventListener('click', () => {
    closeDialog($('menuDialog'));
    if (!confirm('Start a new track? The canvas clears; the published track stays on the server.')) return;
    unpublishTrack();
    clearAll();
    refreshPublishUi();
    toast('New track — local until you publish');
  });

  $('btnHelp').addEventListener('click', () => { closeDialog($('menuDialog')); openDialog($('helpDialog')); });
  $('helpClose').addEventListener('click', () => closeDialog($('helpDialog')));

  document.querySelectorAll('[data-tool]').forEach((b) => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  $('btnComplete').addEventListener('click', () => completeToolIntro()); /* once per session, on first arm */
  $('completeOk').addEventListener('click', () => closeDialog($('completeDialog')));
  $('completeClose').addEventListener('click', () => closeDialog($('completeDialog')));
  $('btnRotL').addEventListener('click', () => { if (!rotate(-45)) toast(`${state.angle}\u00B0`); });
  $('btnRotR').addEventListener('click', () => { if (!rotate(45)) toast(`${state.angle}\u00B0`); });
  $('btnUndo').addEventListener('click', () => { if (!undo()) toast('Nothing to undo'); });
  $('btnLvlUp').addEventListener('click', () => toast(levelToast(bumpLevel(1))));
  $('btnLvlDown').addEventListener('click', () => toast(levelToast(bumpLevel(-1))));
  $('btnDeleteAll').addEventListener('click', () => {
    if (!state.sprites.length) return;
    closeDialog($('menuDialog'));
    if (confirm('Delete all pieces?')) clearAll();
  });
  $('btnZoomIn').addEventListener('click', () => zoomAt(getDims().w / 2, getDims().h / 2, 1.25));
  $('btnZoomOut').addEventListener('click', () => zoomAt(getDims().w / 2, getDims().h / 2, 0.8));
  $('btnFit').addEventListener('click', () => fitView(getDims().w, getDims().h));
  $('mode3').addEventListener('click', () => setMode(3));
  $('mode5').addEventListener('click', () => setMode(5));
  $('modeR').addEventListener('click', () => setMode('rucdoc'));
  $('modeCycle').addEventListener('click', () => {
    const order = [3, 5, 'rucdoc'];
    setMode(order[(order.indexOf(state.mode) + 1) % order.length]);
  });

  /* ---------- track metadata popup (stats-bar tap) ----------
   * Owner model: phones keep the numbers and hide the name — the name
   * and everything the server knows (created/updated/stars/validity)
   * live one tap away. Local facets render immediately; the published
   * row's server fields fill in when the fetch lands. */
  function statRow(label, value, cls, tip) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    const l = document.createElement('span');
    l.className = 'stat-label';
    l.textContent = label;
    if (tip) l.append(tipBtn(tip));   /* (?) affordance — the value stays clean */
    const v = document.createElement('span');
    v.className = `stat-value${cls ? ' ' + cls : ''}`;
    v.textContent = value;
    row.append(l, v);
    return row;
  }

  const statsDate = (t) => (t ? new Date(t).toLocaleString() : '—');

  async function renderStatsPopup() {
    const f = trackFacets(state.sprites);
    const pub = publishedTrack();
    const rows = $('statsRows');
    rows.textContent = '';
    $('statsTitle').textContent = pub ? pub.name : 'Track';
    rows.append(
      statRow('Length', `${(f.length_cm / 100).toFixed(2)} m`),
      statRow('Pieces', String(f.pieces)),
      statRow('Straights', String(f.straights), null, 'Waves count as straights — a wave is a straight piece with a bump.'),
      statRow('Slopes', String(f.slopes), null, 'Slopes change elevation and are NOT interchangeable with straight pieces — they count separately.'),
      statRow('Corners', String(f.corners), null, 'A 180° piece (rainbow, burning changer) counts as 4 — four 45° corners\u2019 worth.'),
      statRow('Lanes', String(f.lanes || '—'), null, 'The widest piece used — 3-lane (Japan Cup), 5-lane (WIDE) or the 1–3-lane rucdoc system.'),
    );
    $('statsRename').style.display = pub ? '' : 'none';
    if (!pub) {
      const note = document.createElement('p');
      note.className = 'stat-note';
      note.textContent = 'Not published — this track lives on this device only.';
      rows.append(note);
      return;
    }
    const created = statRow('Published', '…');
    const updated = statRow('Last modified', '…');
    const stars = statRow('Stars', '…');
    const valid = statRow('Validity', '…');
    rows.append(created, updated, stars, valid);
    try {
      const res = await fetch(`/api/tracks/${pub.id}`);
      if (!res.ok) throw new Error();
      const row = await res.json();
      created.lastElementChild.textContent = statsDate(row.created_at);
      updated.lastElementChild.textContent = statsDate(row.updated_at);
      stars.lastElementChild.textContent = `\u2605 ${row.stars}`;
      const badge = completeBadge(row);
      valid.lastElementChild.textContent = badge.text === '\u2713' ? '✓ complete' : `${badge.text} — work in progress`;
      valid.lastElementChild.className = `stat-value ${badge.cls}`;
    } catch {
      created.lastElementChild.textContent = 'server unreachable';
      updated.lastElementChild.textContent = '—';
      stars.lastElementChild.textContent = '—';
      valid.lastElementChild.textContent = '—';
    }
  }

  $('stats').addEventListener('click', () => {
    closeDialog($('menuDialog'));
    renderStatsPopup();
    openDialog($('statsDialog'));
  });
  $('statsClose').addEventListener('click', () => closeDialog($('statsDialog')));
  $('statsOk').addEventListener('click', () => closeDialog($('statsDialog')));
  $('statsRename').addEventListener('click', () => {
    const pub = publishedTrack();
    if (!pub) return;
    closeDialog($('statsDialog'));
    $('pubTitle').textContent = `Rename “${pub.name}”`;
    $('pubOk').textContent = 'Save name';
    $('pubName').value = pub.name;
    renderPubStatus();
    openDialog($('publishDialog'));
    $('pubName').focus();
  });

  refreshPublishUi();   /* restored binding shows the badge + stats name on boot */

  window.addEventListener('beforeunload', (e) => {
    if (state.sprites.length) { e.preventDefault(); e.returnValue = ''; }
  });

  buildPalette();
}

/* Elevation feedback for the level buttons / PageUp-PageDown. */
function levelToast(which) {
  const mm = which === 'selection' ? [...state.selection].map((p) => p.z || 0) : [state.zArm];
  const uniq = [...new Set(mm)];
  const v = uniq.length === 1 ? String(uniq[0]) : Math.min(...uniq) + '..' + Math.max(...uniq);
  return 'level ' + v + ' mm';
}

export { refreshPublishUi };
