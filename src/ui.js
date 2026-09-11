/* UI — DOM wiring: palette, toolbar, dialogs, toast, stats. Subscribes to
 * the store for tool/mode/stats sync. Gets canvas dims injected (no import
 * of render/input — keeps the module graph acyclic). */

import {
  state, subscribe, setTool, setMode, undo, clearAll, loadSprites, rotate, zoomAt, fitView,
} from './store.js';
import { PIECES, PALETTE } from './pieces.js';
import { serializeForSave, parseTrack, encodeShare } from './track.js';
import { imageFor } from './assets.js';
import { drawPieceArt } from './art.js';

const $ = (id) => document.getElementById(id);
let ioMode = 'import'; /* or 'share' */
let getDims = () => ({ w: 800, h: 600, dpr: 1 });

export function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
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

/* ---------- store-driven sync ---------- */

let lastStatsText = '';
let lastMode = null;

function updateStats() {
  let len = 0;
  for (const p of state.sprites) len += PIECES[p.name].l;
  const txt = `${len.toFixed(2)} m \u00B7 ${state.sprites.length} pcs`;
  if (txt === lastStatsText) return; /* avoid DOM writes from the render loop */
  lastStatsText = txt;
  $('stats').textContent = txt;
}

function syncToolUi() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === state.tool));
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.piece === state.tool));
  $('mode3').classList.toggle('active', state.mode === 3);
  $('mode5').classList.toggle('active', state.mode === 5);
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

/* ---------- init ---------- */

export function init(dimsGetter) {
  getDims = dimsGetter;

  subscribe(onStoreChange);

  $('btnMenu').addEventListener('click', () => openDialog($('menuDialog')));
  $('btnCloseMenu').addEventListener('click', () => closeDialog($('menuDialog')));

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

  $('btnHelp').addEventListener('click', () => { closeDialog($('menuDialog')); openDialog($('helpDialog')); });
  $('helpClose').addEventListener('click', () => closeDialog($('helpDialog')));

  document.querySelectorAll('[data-tool]').forEach((b) => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  $('btnRotL').addEventListener('click', () => { if (!rotate(-45)) toast(`${state.angle}\u00B0`); });
  $('btnRotR').addEventListener('click', () => { if (!rotate(45)) toast(`${state.angle}\u00B0`); });
  $('btnUndo').addEventListener('click', () => { if (!undo()) toast('Nothing to undo'); });
  $('btnClear').addEventListener('click', () => {
    if (!state.sprites.length) return;
    if (confirm('Delete all pieces?')) clearAll();
  });
  $('btnZoomIn').addEventListener('click', () => zoomAt(getDims().w / 2, getDims().h / 2, 1.25));
  $('btnZoomOut').addEventListener('click', () => zoomAt(getDims().w / 2, getDims().h / 2, 0.8));
  $('btnFit').addEventListener('click', () => fitView(getDims().w, getDims().h));
  $('mode3').addEventListener('click', () => setMode(3));
  $('mode5').addEventListener('click', () => setMode(5));

  window.addEventListener('beforeunload', (e) => {
    if (state.sprites.length) { e.preventDefault(); e.returnValue = ''; }
  });

  buildPalette();
}
