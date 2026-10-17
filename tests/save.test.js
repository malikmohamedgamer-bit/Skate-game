// Save/load, schema version and migration (including a real v1 save fixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKUP_KEY,
  SAVE_KEY,
  SCHEMA_VERSION,
  createSaveStore,
  defaultSave,
  detectVersion,
  memoryStorage,
  migrate,
  normalizeSave,
} from '../src/core/save.js';
import { STARTING_BOLTS } from '../src/game/economy.js';
import { CAMERA_MODES } from '../src/core/camera.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('the current schema version is 3 and new saves use it', () => {
  assert.equal(SCHEMA_VERSION, 3);
  const d = defaultSave(1000);
  assert.equal(d.schemaVersion, 3);
  assert.equal(d.bolts, STARTING_BOLTS);
});

test('version detection', () => {
  assert.equal(detectVersion(JSON.parse(fixture('save-v1.json'))), 1);
  assert.equal(detectVersion(JSON.parse(fixture('save-v2.json'))), 2);
  assert.equal(detectVersion(defaultSave()), 3);
  assert.equal(detectVersion('nope'), 0);
});

test('a schema v1 save loads in the current version with its progress kept', () => {
  const storage = memoryStorage();
  storage.setItem(SAVE_KEY, fixture('save-v1.json'));
  const { save, status, from } = createSaveStore(storage, { now: () => 5000 }).load();
  assert.equal(from, 1);
  assert.equal(status, 'migrated');
  assert.equal(save.schemaVersion, SCHEMA_VERSION);
  assert.equal(save.bolts, 420, 'coins became Bolts');
  assert.ok(save.owned.includes('deck_pro'), 'known v1 boards mapped to item ids');
  assert.ok(!save.owned.includes('rocket'), 'unknown v1 board dropped');
  assert.equal(save.equipped.skateboard.deck, 'deck_pro', 'equipped board carried over');
  assert.equal(save.settings.audio.volume, 0.4);
  assert.equal(save.settings.audio.muted, true);
  assert.equal(save.levels['park-1'].bestScore, 5200);
  assert.equal(save.levels['park-1'].bestStars, 0);
  // Fields that did not exist in v1 come from defaults.
  assert.equal(save.settings.a11y.forgivingLandings, false);
  assert.deepEqual(save.quests.progress, {});
});

test('a v2 save migrates quests, levels and owned items', () => {
  const { save, status } = migrate(JSON.parse(fixture('save-v2.json')), 1);
  assert.equal(status, 'migrated');
  assert.equal(save.bolts, 975);
  assert.equal(save.equipped.skateboard.deck, 'deck_street');
  assert.equal(save.levels['street-1'].bestStars, 2);
  assert.deepEqual(save.quests.progress['story-first-push'], { progress: 1, completed: true, rewarded: true, day: undefined });
  assert.equal(save.quests.progress['c-grind-30'].completed, false);
});

test('round trip: write then load gives the same data', () => {
  const storage = memoryStorage();
  const store = createSaveStore(storage, { now: () => 42 });
  const s = defaultSave(42);
  s.bolts = 777;
  s.owned.push('deck_street');
  s.levels.x = { bestStars: 2, bestScore: 999, bestTime: 30.5, completed: true };
  assert.ok(store.write(s));
  const r = store.load();
  assert.equal(r.status, 'current');
  assert.deepEqual(r.save, normalizeSave(s, 42));
});

test('corrupt JSON falls back to a new save and keeps a backup', () => {
  const storage = memoryStorage();
  storage.setItem(SAVE_KEY, '{not json');
  const r = createSaveStore(storage).load();
  assert.equal(r.status, 'corrupt');
  assert.equal(r.save.bolts, STARTING_BOLTS);
  assert.equal(storage.getItem(BACKUP_KEY), '{not json');
});

test('hand-edited bad values are repaired field by field', () => {
  const bad = defaultSave(1);
  bad.bolts = -500;
  bad.owned = ['deck_street', 42, null];
  bad.equipped.skateboard.deck = 'deck_not_owned';
  bad.settings.a11y.textScale = 99;
  bad.settings.a11y.gameSpeed = 0.1;
  bad.settings.camera.mode = 'drone';
  bad.colors = { 'skateboard.deck': { color: 'red' }, 'skateboard.grip': { color: '#112233', pattern: 'dots' } };
  const s = normalizeSave(bad, 1);
  assert.equal(s.bolts, 0);
  assert.ok(s.owned.includes('deck_street'));
  assert.ok(!s.owned.includes(42));
  assert.equal(s.equipped.skateboard.deck, 'deck_classic');
  assert.equal(s.settings.a11y.textScale, 2);
  assert.equal(s.settings.a11y.gameSpeed, 1);
  assert.equal(s.settings.camera.mode, 'follow');
  assert.equal(s.colors['skateboard.deck'], undefined);
  assert.equal(s.colors['skateboard.grip'].pattern, 'dots');
});

test('a save from a newer version still loads (best effort) and is backed up', () => {
  const storage = memoryStorage();
  const future = { ...defaultSave(1), schemaVersion: 9, bolts: 55, hoverboards: true };
  storage.setItem(SAVE_KEY, JSON.stringify(future));
  const r = createSaveStore(storage).load();
  assert.equal(r.status, 'future');
  assert.equal(r.save.bolts, 55);
  assert.ok(storage.getItem(BACKUP_KEY).includes('hoverboards'));
});

test('storage that throws (private mode / quota) never crashes the game', () => {
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
    removeItem() {},
  };
  const store = createSaveStore(broken);
  assert.equal(store.load().status, 'new');
  assert.equal(store.write(defaultSave()), false);
  assert.ok(store.lastWriteError);
});

test('every camera mode survives a save round trip; unknown modes fall back to follow', () => {
  for (const mode of CAMERA_MODES) {
    const d = defaultSave(1);
    d.settings.camera.mode = mode;
    assert.equal(normalizeSave(d, 1).settings.camera.mode, mode);
  }
  const d = defaultSave(1);
  d.settings.camera.mode = 'drone';
  assert.equal(normalizeSave(d, 1).settings.camera.mode, 'follow');
});
