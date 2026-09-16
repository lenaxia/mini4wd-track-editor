/* UI — DOM wiring: palette, toolbar, dialogs, toast, stats. Subscribes to
 * the store for tool/mode/stats sync. Gets canvas dims injected (no import
 * of render/input — keeps the module graph acyclic). */

import {
  state, subscribe, setTool, setMode, undo, clearAll, loadSprites, rotate, bumpLevel, zoomAt, fitView, addPieces, applySolution,
} from './store.js';
import { PIECES, PALETTE } from './pieces.js';
import { serializeForSave, parseTrack, encodeShare } from './track.js';
import { imageFor } from './assets.js';
import { publishedTrack, publishTrack, unpublishTrack, bindPublished, spritesFromRow } from './storage.js';
import { validateTrack } from './validate.js';
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

/* ---------- store-driven sync ---------- */

let lastStatsText = '';
let lastMode = null;

function updateStats() {
  let len = 0;
  for (const p of state.sprites) len += PIECES[p.name].l;
  const pub = publishedTrack();
  const txt = `${pub ? pub.name + ' \u00B7 ' : ''}${len.toFixed(2)} m \u00B7 ${state.sprites.length} pcs`;
  if (txt === lastStatsText) return; /* avoid DOM writes from the render loop */
  lastStatsText = txt;
  $('stats').textContent = txt;
}

function syncToolUi() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === state.tool));
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.piece === state.tool));
  $('mode3').classList.toggle('active', state.mode === 3);
  $('mode5').classList.toggle('active', state.mode === 5);
  $('modeR').classList.toggle('active', state.mode === 'rucdoc');
  const label = state.mode === 'rucdoc' ? 'Rudoc' : `${state.mode}L`;
  $('modeCycle').textContent = `${label} \u25B8`;
}

function onStoreChange() {
  if (state.mode !== lastMode) {
    lastMode = state.mode;
    buildPalette();
  } else {
    syncToolUi();
  }
  updateStats();
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

  refreshPublishUi = function () {
    const pub = publishedTrack();
    $('btnPublishBar').textContent = pub ? '💾' : '📤';
    $('btnPublishBar').title = pub ? `Save “${pub.name}” (published)` : 'Publish track';
    lastStatsText = '';   /* force the stats line to re-render with the name */
    updateStats();
  };

  function renderPubStatus() {
    const { ok, errors, warnings } = validateTrack(state.sprites);
    const box = $('pubStatus');
    const rows = [];
    for (const e of errors) rows.push(`<div style="color:#e05263">✖ ${e}</div>`);
    for (const w of warnings) rows.push(`<div style="color:#d9a441">⚠ ${w}</div>`);
    if (ok && !warnings.length) rows.push('<div style="color:#4ade80">✓ track is complete and consistent</div>');
    box.innerHTML = rows.join('');
    /* violations lock the whole save action: no name, no confirm */
    $('pubOk').disabled = !ok;
    $('pubName').disabled = !ok;
    /* dangling ends have a tool for exactly that */
    $('pubTipComplete').style.display = errors.some((e) => /Dangling/.test(e)) ? 'block' : 'none';
    return ok;
  }

  $('btnPublishBar').addEventListener('click', () => {
    const pub = publishedTrack();
    $('pubTitle').textContent = pub ? `Save “${pub.name}”` : 'Publish track';
    $('pubOk').textContent = pub ? 'Save' : 'Publish';
    $('pubName').value = pub ? pub.name : '';
    renderPubStatus();
    closeDialog($('menuDialog'));
    openDialog($('publishDialog'));
    $('pubName').focus();
  });
  $('pubClose').addEventListener('click', () => closeDialog($('publishDialog')));
  $('pubCancel').addEventListener('click', () => closeDialog($('publishDialog')));
  $('pubTipComplete').addEventListener('click', () => {
    closeDialog($('publishDialog'));
    setTool('Complete');
    toast('Select the two open ends — Complete fills the gap');
  });
  $('pubOk').addEventListener('click', async () => {
    if (!renderPubStatus()) return;   /* re-validate at the moment of saving */
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
        row.addEventListener('click', () => loadLibraryTrack(it.id));
        list.appendChild(row);
      }
    } catch { list.textContent = 'Server unreachable.'; }
  });
  $('libClose').addEventListener('click', () => closeDialog($('libraryDialog')));

  async function loadLibraryTrack(id) {
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
      refreshPublishUi();
      toast(`Loaded “${row.name}” — ${sprites.length} pcs · edits auto-save`);
    } catch { toast('Server unreachable'); }
  }

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

  refreshPublishUi();   /* restored binding shows Save + stats name on boot */

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
