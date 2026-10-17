import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  ONE_HANDED_PRESETS,
  cloneBindings,
  findConflict,
  keyLabel,
  listConflicts,
  normalizeBindings,
  rebind,
} from '../src/core/input.js';

test('default bindings cover every action and have no conflicts', () => {
  const b = cloneBindings(DEFAULT_BINDINGS);
  for (const a of ACTIONS) assert.ok(b[a][0], a);
  assert.deepEqual(listConflicts(b), []);
});

test('required default keys: W/Up push, Shift/S brake, Space/J ollie, A/D steer', () => {
  assert.deepEqual(DEFAULT_BINDINGS.forward, ['KeyW', 'ArrowUp']);
  assert.ok(DEFAULT_BINDINGS.brake.includes('ShiftLeft'));
  assert.ok(DEFAULT_BINDINGS.back.includes('KeyS'));
  assert.deepEqual(DEFAULT_BINDINGS.ollie, ['Space', 'KeyJ']);
  assert.ok(DEFAULT_BINDINGS.left.includes('KeyA') && DEFAULT_BINDINGS.right.includes('KeyD'));
});

test('rebinding to a free key works', () => {
  const r = rebind(cloneBindings(DEFAULT_BINDINGS), 'ollie', 1, 'KeyL');
  assert.ok(r.ok);
  assert.equal(r.bindings.ollie[1], 'KeyL');
});

test('rebinding to a key used by another action is refused and reports the conflict', () => {
  const b = cloneBindings(DEFAULT_BINDINGS);
  const r = rebind(b, 'ollie', 0, 'KeyW');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conflict');
  assert.equal(r.conflict.action, 'forward');
  assert.deepEqual(r.bindings, b, 'unchanged');
});

test('rebinding with swap exchanges the two keys', () => {
  const r = rebind(cloneBindings(DEFAULT_BINDINGS), 'ollie', 0, 'KeyW', { swap: true });
  assert.ok(r.ok);
  assert.equal(r.bindings.ollie[0], 'KeyW');
  assert.equal(r.bindings.forward[0], 'Space');
  assert.deepEqual(listConflicts(r.bindings), []);
});

test('reserved keys (Tab, Enter) cannot be bound; Escape stays on pause', () => {
  const b = cloneBindings(DEFAULT_BINDINGS);
  assert.equal(rebind(b, 'ollie', 0, 'Tab').reason, 'reserved');
  assert.equal(rebind(b, 'ollie', 0, 'Escape').reason, 'locked');
  assert.equal(rebind(b, 'pause', 0, 'KeyQ').reason, 'locked');
  assert.ok(rebind(b, 'pause', 1, 'KeyQ').ok);
});

test('findConflict finds the owning action', () => {
  const b = cloneBindings(DEFAULT_BINDINGS);
  assert.deepEqual(findConflict(b, 'KeyA'), { action: 'left', slot: 0 });
  assert.equal(findConflict(b, 'KeyZ'), null);
});

test('one-handed presets reach every action and are conflict-free', () => {
  for (const [side, preset] of Object.entries(ONE_HANDED_PRESETS)) {
    const b = cloneBindings(preset);
    for (const a of ACTIONS) assert.ok(b[a][0], `${side}:${a}`);
    assert.deepEqual(listConflicts(b), [], side);
  }
});

test('normalizeBindings repairs bad saved data', () => {
  assert.deepEqual(normalizeBindings(null), cloneBindings(DEFAULT_BINDINGS));
  const dup = cloneBindings(DEFAULT_BINDINGS);
  dup.ollie = ['KeyW', null];
  assert.deepEqual(normalizeBindings(dup), cloneBindings(DEFAULT_BINDINGS));
  const custom = cloneBindings(DEFAULT_BINDINGS);
  custom.camera = ['KeyV', null];
  assert.equal(normalizeBindings(custom).camera[0], 'KeyV');
});

test('key labels are human readable', () => {
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(keyLabel('ArrowLeft'), '← Left');
  assert.equal(keyLabel(null), '—');
});
