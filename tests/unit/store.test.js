import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  state, place, undo, pushHistory, snapshot, pushSnapshot,
  setTool, setMode, rotate, deleteSelected, removePiece, cycleColor,
  clearAll, loadSprites, subscribe,
} from '../../src/store.js';
import { parseTrack } from '../../src/track.js';

function reset() {
  state.mode = 3;
  state.tool = 'Pan';
  state.angle = 0;
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
  state.sprites.push({ name: 'Str1', x: 10, y: 10, a: 0, c: 0 });
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
  const a = { name: 'Str1', x: 0, y: 0, a: 0, c: 0 };
  const b = { name: 'Str1', x: 100, y: 0, a: 0, c: 0 };
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
  const a = { name: 'Str1', x: 0, y: 0, a: 0, c: 0 };
  const b = { name: 'Str1', x: 100, y: 0, a: 0, c: 0 };
  state.sprites.push(a, b);
  state.selection.add(a);
  deleteSelected();
  assert.deepEqual(state.sprites, [b]);
  assert.equal(state.history.length, 1);
  undo();
  assert.equal(state.sprites.length, 2);
});

test('removePiece and cycleColor mutate through history', () => {
  const a = { name: 'Cor1', x: 0, y: 0, a: 0, c: 0 };
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
  state.sprites.push({ name: 'Str1', x: 1, y: 1, a: 0, c: 0 });
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
  state.sprites.push({ name: 'Str1', x: 5, y: 6, a: 0, c: 0 });
  const snap = snapshot();
  state.sprites[0].x = 999;
  assert.equal(snap, '[{"name":"Str1","x":5,"y":6,"a":0,"c":0}]');
});
