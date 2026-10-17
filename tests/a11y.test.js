// Accessibility and touch: pure helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnouncementQueue, presentationFor } from '../src/ui/a11y.js';
import { MIN_TOUCH, TOUCH_BUTTONS, classifySwipe, layoutFor, swipeAction } from '../src/ui/touch.js';
import { CUES, captionFor } from '../src/core/audio.js';
import { defaultSettings, normalizeSave, defaultSave } from '../src/core/save.js';
import { computeSteps } from '../src/core/loop.js';

test('settings map to body classes and CSS variables', () => {
  const s = defaultSettings();
  assert.deepEqual(presentationFor(s).classes, []);
  s.a11y.reducedMotion = true;
  s.a11y.highContrast = true;
  s.a11y.colorblind = true;
  s.a11y.textScale = 1.5;
  s.a11y.touchScale = 1.25;
  s.a11y.oneHanded = 'left';
  const p = presentationFor(s);
  assert.deepEqual(p.classes.sort(), ['cb-safe', 'high-contrast', 'one-handed-left', 'reduced-motion']);
  assert.equal(p.vars['--text-scale'], '1.5');
  assert.equal(p.vars['--touch-scale'], '1.25');
});

test('reduced motion defaults on when the OS asks for it', () => {
  assert.equal(defaultSettings({ prefersReducedMotion: true }).a11y.reducedMotion, true);
  assert.equal(defaultSettings().a11y.reducedMotion, false);
});

test('announcement queue throttles and merges rapid tricks, assertive first', () => {
  const q = createAnnouncementQueue({ minGap: 700, mergeWindow: 600 });
  q.push('Kickflip, 200 points', { category: 'trick', now: 0 });
  assert.equal(q.flush(0).text, 'Kickflip, 200 points');
  q.push('Ollie, 50 points', { category: 'trick', now: 100 });
  q.push('FS 180, 300 points', { category: 'trick', now: 200 });
  assert.equal(q.size, 1, 'second trick replaced the first within the merge window');
  assert.equal(q.flush(300), null, 'too soon after the last message');
  q.push('Level complete', { priority: 'assertive', category: 'level', now: 400 });
  assert.equal(q.flush(400).text, 'Level complete', 'assertive messages are not delayed');
  assert.equal(q.flush(1200).text, 'FS 180, 300 points');
  assert.equal(q.flush(2000), null);
});

test('announcement queue never grows without bound', () => {
  const q = createAnnouncementQueue({ maxQueue: 4 });
  for (let i = 0; i < 50; i++) q.push(`msg ${i}`, { now: i * 1000 });
  assert.ok(q.size <= 4);
});

test('touch buttons are at least 44x44 px in every layout and size', () => {
  for (const layout of ['standard', 'left', 'right'])
    for (const scale of [1, 1.25, 1.5]) {
      const items = layoutFor(layout, scale);
      assert.equal(items.length, TOUCH_BUTTONS.length, `${layout} has every control`);
      for (const it of items) assert.ok(it.size >= MIN_TOUCH, `${layout}@${scale} ${it.id} ${it.size}`);
    }
  // Enlarging makes buttons bigger.
  const n = layoutFor('standard', 1).find((b) => b.id === 'ollie').size;
  const l = layoutFor('standard', 1.5).find((b) => b.id === 'ollie').size;
  assert.ok(l > n);
});

test('one-handed touch layouts put every control on one side', () => {
  for (const side of ['left', 'right']) {
    const zones = new Set(layoutFor(side, 1).map((b) => b.zone));
    assert.deepEqual([...zones], [side]);
  }
  const std = new Set(layoutFor('standard', 1).map((b) => b.zone));
  assert.equal(std.size, 2);
});

test('touch controls cover steer, push, brake, ollie and the trick modifier', () => {
  const actions = TOUCH_BUTTONS.map((b) => b.action).sort();
  assert.deepEqual(actions, ['back', 'forward', 'left', 'ollie', 'right', 'trick']);
  for (const b of TOUCH_BUTTONS) assert.ok(b.label.length > 3, 'every button has an accessible label');
});

test('swipe classification', () => {
  assert.equal(classifySwipe({ dx: 2, dy: -80, dt: 200 }), 'up');
  assert.equal(classifySwipe({ dx: 0, dy: 60, dt: 200 }), 'down');
  assert.equal(classifySwipe({ dx: -70, dy: 10, dt: 200 }), 'left');
  assert.equal(classifySwipe({ dx: 70, dy: -5, dt: 200 }), 'right');
  assert.equal(classifySwipe({ dx: 5, dy: -10, dt: 200 }), null, 'too short (a tap)');
  assert.equal(classifySwipe({ dx: 0, dy: -80, dt: 2000 }), null, 'too slow');
  assert.equal(classifySwipe({ dx: 60, dy: -60, dt: 200 }), null, 'ambiguous diagonal');
});

test('swipe up ollies on the ground; in the air swipes flip and spin', () => {
  assert.deepEqual(swipeAction('up', false), { pulse: 'ollie' });
  assert.equal(swipeAction('left', false), null);
  assert.deepEqual(swipeAction('up', true), { pulse: 'forward' });
  assert.deepEqual(swipeAction('down', true), { pulse: 'back' });
  assert.equal(swipeAction('left', true).hold, 'left');
});

test('every audio cue that carries gameplay information has a caption', () => {
  for (const k of ['ollie', 'land', 'bail', 'grind', 'pickup', 'quest', 'level', 'fail', 'checkpoint', 'timer', 'combo']) assert.ok(captionFor(k), k);
  assert.equal(captionFor('ui'), null, 'pure UI clicks need no caption');
  assert.ok(Object.keys(CUES).length >= 12);
});

test('new accessibility settings are normalized from saves', () => {
  const s = defaultSave(1);
  s.settings.a11y.touchControls = 'sometimes';
  s.settings.a11y.touchScale = 3;
  s.settings.a11y.oneHanded = 'both';
  const n = normalizeSave(s, 1);
  assert.equal(n.settings.a11y.touchControls, 'auto');
  assert.equal(n.settings.a11y.touchScale, 1);
  assert.equal(n.settings.a11y.oneHanded, 'off');
  assert.equal(n.settings.a11y.announceTricks, true);
});

test('slow game speed halves simulated time per real second', () => {
  let acc = 0;
  let ticks = 0;
  for (let i = 0; i < 60; i++) {
    const r = computeSteps(acc, 1 / 60, 1 / 60, 5, 0.5);
    acc = r.accumulator;
    ticks += r.steps;
  }
  assert.equal(ticks, 30);
});
