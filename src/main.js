/*
 * Mini4WD Track Editor — mobile-friendly fork (proof of concept)
 *
 * Piece geometry, snapping algorithm and the track serialization format are
 * derived from the "Mini4WD Online Track Editor" client code:
 *
 *   MIT License
 *   Copyright (c) 2016 Michele Ferri, support@pimentoso.com
 *   https://mini4wd-track-editor.pimentoso.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 *
 * Track pieces are trademarks/copyright of Tamiya inc.; piece artwork in
 * assets/ is the original editor's sprite set (Tamiya designs). Procedural
 * vector drawing (src/art.js) is retained only as a fallback while sprites load.
 *
 * Everything else (touch UI, camera, rendering, storage) is new code for this
 * fork. Module entry point — wiring only; see src/ for the layers:
 *   pieces.js   catalog data        geometry.js pure geometry/snap/camera math
 *   track.js    track codec         art.js      procedural sprite fallback
 *   assets.js   sprite preloading   storage.js  localStorage autosave
 *   store.js    model + actions     render.js   canvas view
 *   input.js    gesture machine     ui.js       DOM shell
 */

import { state, setMode, setTool, fitView } from './store.js';
import { PALETTE, TOOLS } from './pieces.js';
import { parseTrack, decodeShare, serialize } from './track.js';
import { preloadImages } from './assets.js';
import { restore, unpublishTrack } from './storage.js';
import * as render from './render.js';
import * as input from './input.js';
import * as ui from './ui.js';

/* Test/e2e hook: read-only-ish access to the model. */
window.__m4wd = {
  state,
  serialize: () => serialize(state.sprites),
};

let paletteTimer = null;

function boot() {
  new ResizeObserver(render.resize).observe(document.getElementById('stage'));
  render.resize();
  input.attach(render.canvas, render.dims);
  ui.init(render.dims);

  preloadImages(() => {
    render.scheduleDraw();
    clearTimeout(paletteTimer);
    paletteTimer = setTimeout(ui.buildPalette, 120); /* repaint chips with sprites */
  });

  /* 1. shared link, 2. autosave, 3. fresh start */
  const m = location.hash.match(/[#&]t=([A-Za-z0-9\-_]+)/);
  if (m) {
    try {
      state.sprites = parseTrack(decodeShare(m[1]));
      /* a shared link opens as a LOCAL copy: never silently overwrite the
       * browser's published row with someone else's track (own links too —
       * reopen your track from the library instead). Empty payloads fall
       * through to autosave-restore WITHOUT unbinding. */
      if (state.sprites.length) {
        unpublishTrack();
        ui.refreshPublishUi();
        ui.toast(`Loaded shared track (${state.sprites.length} pieces)`);
      }
    } catch (_) { ui.toast('Could not read shared link'); }
  }
  if (!state.sprites.length) restore(state);

  setMode(state.mode);
  setTool(TOOLS.includes(state.tool) || PALETTE[state.mode].includes(state.tool) ? state.tool : 'Pan');
  const { w, h } = render.dims();
  if (state.sprites.length) fitView(w, h);
  else state.view = { x: w / 2, y: h / 2, scale: 0.62 };
  render.scheduleDraw();
}

boot();
