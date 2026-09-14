import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  state, place, undo, pushHistory, snapshot, pushSnapshot,
  setTool, setMode, rotate, bumpLevel, deleteSelected, removePiece, cycleColor,
  clearAll, loadSprites, subscribe, addPieces, applySolution,
} from '../../src/store.js';
import { vertexOf } from '../../src/geometry.js';
import { parseTrack } from '../../src/track.js';

function reset() {
  state.mode = 3;
  state.tool = 'Pan';
  state.angle = 0;
  state.zArm = 0;
  state.sprites = [];
  state.selection.clear();
  state.history = [];
  state.view = { x: 0, y: 0, scale: 0.62 };
}

beforeEach(reset);

test('place floors coordinates, snaps, and selects the new piece', () => {
  state.sprites.push({ name: 'Str1', x: 100, y: 100, a: 0, c: 0 }); /* v2 = 127,100 */
  const piece = place('Str1', 150.7, 103.2, 0);
  assert.deepEqual({ x: piece.x, y: piece.y }, { x: 154, y: 100 }); /* snapped */
  assert.equal(state.sprites.length, 2);
  assert.equal(state.selection.size, 1);
  assert.ok(state.selection.has(piece));
});

test('undo restores the previous snapshot and clears selection', () => {
  pushHistory();
  state.sprites.push({ name: 'Str1', x: 10, y: 10, a: 0, c: 0, z: 0 });
  state.selection.add(state.sprites[0]);
  assert.equal(undo(), true);
  assert.equal(state.sprites.length, 0);
  assert.equal(state.selection.size, 0);
  assert.equal(undo(), false); /* nothing left */
});

test('history is capped at 80 snapshots', () => {
  for (let i = 0; i < 85; i++) pushSnapshot('[]');
  assert.equal(state.history.length, 80);
});

test('rotate spins the selection around its centroid', () => {
  const a = { name: 'Str1', x: 0, y: 0, a: 0, c: 0, z: 0 };
  const b = { name: 'Str1', x: 100, y: 0, a: 0, c: 0, z: 0 };
  state.sprites.push(a, b);
  state.selection.add(a);
  state.selection.add(b);
  assert.equal(rotate(90), true);
  assert.ok(Math.abs(a.x - 50) < 1e-9 && Math.abs(a.y + 50) < 1e-9);
  assert.ok(Math.abs(b.x - 50) < 1e-9 && Math.abs(b.y - 50) < 1e-9);
  assert.equal(a.a, 90);
  assert.equal(b.a, 90);
  assert.equal(state.history.length, 1);
});

test('rotate spins a single off-center piece around its visual center', () => {
  /* Cor1's visual center is (-5, -3.5) local, not the origin — rotating
   * in place must keep the center fixed and move the origin instead. */
  const p = { name: 'Cor1', x: 100, y: 100, a: 0, c: 0 };
  state.sprites.push(p);
  state.selection.add(p);
  const before = { x: p.x - 5, y: p.y - 3.5 }; /* centerOf at a=0 */
  assert.equal(rotate(90), true);
  const after = {
    x: p.x + (-5 * Math.cos(Math.PI / 2) - -3.5 * Math.sin(Math.PI / 2)),
    y: p.y + (-5 * Math.sin(Math.PI / 2) + -3.5 * Math.cos(Math.PI / 2)),
  };
  assert.ok(Math.abs(after.x - before.x) < 1e-9, `x center moved: ${after.x} vs ${before.x}`);
  assert.ok(Math.abs(after.y - before.y) < 1e-9, `y center moved: ${after.y} vs ${before.y}`);
  assert.equal(p.a, 90);
  assert.notEqual(p.x, 100); /* the origin itself moved */
});

test('rotate with no selection only changes the armed angle', () => {
  assert.equal(rotate(45), false);
  assert.equal(state.angle, 45);
  assert.equal(state.history.length, 0);
  rotate(-90);
  assert.equal(state.angle, 315);
});

test('deleteSelected removes selection and snapshots history', () => {
  const a = { name: 'Str1', x: 0, y: 0, a: 0, c: 0, z: 0 };
  const b = { name: 'Str1', x: 100, y: 0, a: 0, c: 0, z: 0 };
  state.sprites.push(a, b);
  state.selection.add(a);
  deleteSelected();
  assert.deepEqual(state.sprites, [b]);
  assert.equal(state.history.length, 1);
  undo();
  assert.equal(state.sprites.length, 2);
});

test('removePiece and cycleColor mutate through history', () => {
  const a = { name: 'Cor1', x: 0, y: 0, a: 0, c: 0, z: 0 };
  state.sprites.push(a);
  cycleColor(a);
  assert.equal(a.c, 1);
  removePiece(a);
  assert.equal(state.sprites.length, 0);
  assert.equal(state.history.length, 2);
});

test('clearAll is a no-op on an empty track', () => {
  clearAll();
  assert.equal(state.history.length, 0);
});

test('loadSprites replaces the track and pushes history', () => {
  state.sprites.push({ name: 'Str1', x: 1, y: 1, a: 0, c: 0, z: 0 });
  const imported = parseTrack('Str2;100.000;100.000;0;0#Str1;154.000;100.000;0;0#');
  loadSprites(imported);
  assert.equal(state.sprites.length, 2);
  assert.equal(state.history.length, 1);
  undo();
  assert.equal(state.sprites.length, 1);
});

test('setMode keeps tool-tools and re-arms pieces from the other mode', () => {
  setTool('Move');
  setMode(5);
  assert.equal(state.tool, 'Move');
  setTool('Str1');           /* 3-lane piece */
  setMode(5);                /* Str1 not in 5-lane palette -> re-arm first */
  assert.equal(state.tool, 'Str3');
});

test('subscribers are notified on discrete changes', () => {
  let calls = 0;
  const off = subscribe(() => calls++);
  setTool('Move');
  assert.equal(calls, 1);
  off();
  setTool('Pan');
  assert.equal(calls, 1);
});

test('snapshot returns a serialized deep copy', () => {
  state.sprites.push({ name: 'Str1', x: 5, y: 6, a: 0, c: 0, z: 0 });
  const snap = snapshot();
  state.sprites[0].x = 999;
  assert.equal(snap, '[{"name":"Str1","x":5,"y":6,"a":0,"c":0,"z":0}]');
});

test('place carries the armed elevation; snapping adopts the neighbor level', () => {
  const slope = place('Bri1', 200, 200, 0, 0);
  assert.equal(slope.z, 0);
  /* chain a straight near the slope top: v2 world = (227,200), level 75 */
  const top = place('Str1', 250, 203, 0, 0); /* v0=(223,203): 5cm from joint */
  assert.equal(top.z, 75); /* adopted, not the armed 0 */
  state.zArm = 40;
  const free = place('Str1', 500, 500, 0); /* no snap: armed z applies */
  assert.equal(free.z, 40);
});

test('rotate pivots about a single external joint (connection survives)', () => {
  const a = place('Str1', 100, 100, 0, 0);
  const b = place('Str1', 154, 100, 0, 0); /* chained to a */
  state.selection.clear(); state.selection.add(b);
  rotate(45);
  const j = vertexOf(a, 1), v = vertexOf(b, 0);
  assert.ok(Math.hypot(j.x - v.x, j.y - v.y) < 1e-9); /* joint still exact */
  assert.equal(b.a, 45);
  assert.equal(state.history.length, 1);
});

test('rotate falls back to centroid with no external joint', () => {
  const p = place('Str1', 100, 100, 0, 0);
  state.selection.clear(); state.selection.add(p);
  const before = vertexOf(p, 0);
  rotate(90);
  /* single centered piece around its own center: position unchanged */
  assert.equal(p.x, 100);
  assert.equal(p.a, 90);
});

test('bumpLevel steps armed and selection by 10mm with clamping', () => {
  assert.equal(bumpLevel(3), 'armed');
  assert.equal(state.zArm, 30);
  assert.equal(bumpLevel(-1), 'armed');
  assert.equal(state.zArm, 20);
  state.zArm = 290; bumpLevel(5);
  assert.equal(state.zArm, 300); /* clamped */
  const p = place('Str1', 100, 100, 0, 0); /* explicit z=0 (not the armed 300) */
  state.selection.clear(); state.selection.add(p);
  assert.equal(bumpLevel(-2), 'selection');
  assert.equal(p.z, 0); /* stepped to -20, renormalized: lowest piece = floor */
  assert.equal(state.history.length, 1);
});

test('refreshFlags marks overlap alpha, clearance warnings, bad joints', () => {
  const S = (name, x, y, z) => ({ name, x, y, a: 0, c: 0, z });
  state.sprites.push(S('Str1', 100, 100, 0));
  const low = S('Str1', 110, 100, 40);   /* overlaps ground, dz=40 < 75 */
  const apart = S('Str1', 400, 100, 75); /* no overlap */
  const ground2 = S('Str1', 100, 300, 0);
  const ok = S('Str1', 110, 300, 75);    /* overlaps ground2 only, dz=75 clears */
  state.sprites.push(low, apart, ground2, ok);
  setTool('Move'); /* any emit() action runs refreshFlags */
  assert.equal(low._over, true);
  assert.equal(low._warn, true);
  assert.equal(ok._over, true);
  assert.equal(ok._warn, false);
  assert.equal(apart._over, false);
  /* kinked joint: rotate a chained piece about the joint */
  const a = place('Str1', 100, 500, 0, 0);
  const b = place('Str1', 154, 500, 0, 0);
  state.selection.clear(); state.selection.add(b);
  rotate(45);
  assert.equal(b._bad, true); /* pivot leaves a tangent kink — flagged */
});

test('chained adjacency is not plan overlap (no false _over on slope chains)', () => {
  const S = (name, x, y, z) => ({ name, x, y, a: 0, c: 0, z });
  const slope = S('Bri1', 100, 100, 0);
  const chainedTop = S('Str1', 154, 100, 75); /* exact chain: edge-touching only */
  state.sprites.push(slope, chainedTop);
  setTool('Move'); /* emit -> refreshFlags */
  assert.equal(chainedTop._over, false); /* joints/adjacency are not overlap */
  assert.equal(slope._over, false);
  /* a real different-level overlap still flags */
  const above = S('Str1', 190, 90, 150); /* overlaps the raised straight's body */
  state.sprites.push(above);
  setTool('Pan');
  assert.equal(above._over, true);
  assert.equal(above._warn, false); /* dz=75 clears */
});

test('setMode supports the rucdoc drawer (re-arm semantics)', () => {
  setTool('Str1'); /* a 3-lane piece armed */
  setMode('rucdoc');
  assert.equal(state.mode, 'rucdoc');
  assert.equal(state.tool, 'R1S250'); /* re-armed from the drawer's head */
  setTool('R1C45I150');
  setMode(3); /* tool not in 3-lane palette -> re-arm */
  assert.equal(state.tool, 'Str1');
  setTool('Pan'); /* tool-tools survive mode switches */
  setMode('rucdoc');
  assert.equal(state.tool, 'Pan');
});

test('addPieces bulk-inserts solver output, selects it, and is undoable', () => {
  state.sprites.push({ name: 'Str1', x: 100, y: 100, a: 0, c: 0, z: 0 });
  const run = [
    { name: 'Str1', x: 154, y: 100, a: 0, c: 0, z: 0 },
    { name: 'Str1', x: 208, y: 100, a: 0, c: 0, z: 0 },
  ];
  addPieces(run);
  assert.equal(state.sprites.length, 3);
  assert.equal(state.selection.size, 2);
  assert.ok(state.selection.has(run[0]) && state.selection.has(run[1]));
  assert.equal(run[0]._bad, false); /* flags refreshed by emit */
  assert.equal(undo(), true);
  assert.equal(state.sprites.length, 1);
  assert.equal(state.selection.size, 0);
  assert.deepEqual(addPieces([]), undefined); /* no-op guard */
});

test('applySolution removes and inserts in one undoable step', () => {
  const a = { name: 'Str1', x: 100, y: 100, a: 0, c: 0, z: 0 };
  const b = { name: 'Str1', x: 154, y: 100, a: 0, c: 0, z: 0 };
  const doomed = { name: 'Str1', x: 208, y: 100, a: 0, c: 0, z: 0 };
  const run = [{ name: 'Lan1', x: 262, y: 100, a: 0, c: 0, z: 0 }];
  state.sprites.push(a, b, doomed);
  applySolution([doomed], run);
  assert.equal(state.sprites.length, 3); /* a, b, run */
  assert.ok(state.sprites.includes(run[0]));
  assert.ok(!state.sprites.includes(doomed));
  assert.equal(state.selection.size, 1);
  assert.equal(undo(), true);
  assert.equal(state.sprites.length, 3); /* fully restored (JSON clones) */
  assert.equal(state.sprites[2].x, 208); /* doomed is back */
  assert.ok(!state.sprites.some((p) => p.name === 'Lan1'));
});

test('rotate with a piece armed moves only the armed angle (ghost), not the selection', () => {
  const a = { name: 'Str1', x: 0, y: 0, a: 0, c: 0, z: 0 };
  state.sprites.push(a);
  state.selection.add(a);
  setTool('Str1'); /* re-armed for the next placement — selection still held */
  const rotated = rotate(45);
  assert.equal(rotated, false); /* selection did NOT spin */
  assert.equal(a.a, 0);
  assert.equal(state.angle, 45);
  setTool('Move');
  assert.equal(rotate(45), true); /* under Move the selection rotates */
  assert.equal(a.a, 45);
});

test('negative floors renormalize to 0 mm on emit (lowest piece = floor)', () => {
  const low = { name: 'Str1', x: 100, y: 100, a: 0, c: 0, z: -75 };
  const top = { name: 'Str1', x: 154, y: 100, a: 0, c: 0, z: 0 };
  state.sprites.push(low, top);
  setTool('Pan'); /* emit -> normalize */
  assert.equal(low.z, 0);
  assert.equal(top.z, 75);
  /* already-floored tracks are untouched (no surprise shifts) */
  const ok = { name: 'Str1', x: 300, y: 300, a: 0, c: 0, z: 0 };
  state.sprites.push(ok);
  setTool('Pan');
  assert.equal(ok.z, 0);
  assert.deepEqual(state.sprites.map((p) => p.z), [0, 75, 0]);
});

test('refreshFlags caches open-vert disjunction links on state', () => {
  state.sprites.push(
    { name: 'Str1', x: 100, y: 100, a: 0, c: 0, z: 0 },
    { name: 'Str1', x: 187, y: 100, a: 180, c: 0, z: 0 }, /* 33 cm gap, facing */
  );
  setTool('Pan'); /* emit -> refreshFlags */
  assert.equal(state.links.length, 1);
  assert.ok(Math.abs(state.links[0].d - 33) < 1e-9);
});
