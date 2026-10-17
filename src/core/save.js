// Save/load with a schema version number and step-by-step migration.
//
// Schema history:
//   v1  { version: 1, coins, boards: [boardName], board, options: { volume, muted }, best: { levelId: score } }
//   v2  { schemaVersion: 2, bolts, owned: [itemId], equippedBoard, settings: { audio: {...} },
//         levels: { id: { bestScore, stars } }, quests: { id: { progress, done } } }
//   v3  current, see defaultSave(). Per-vehicle equipped parts, part colors, quest
//       state with daily/story tracking, accessibility settings, stats.
// Older saves are migrated v1 -> v2 -> v3. Unknown/corrupt data falls back to
// defaults field by field; a corrupt raw save is kept under BACKUP_KEY.

import { STARTING_BOLTS, sanitizeBalance } from '../game/economy.js';

export const SCHEMA_VERSION = 3;
export const SAVE_KEY = 'boltskate.save';
export const BACKUP_KEY = 'boltskate.save.backup';

export const STARTER_OWNED = Object.freeze([
  'vehicle_skateboard',
  'deck_classic',
  'trucks_basic',
  'wheels_basic',
  'grip_black',
  'sdeck_basic',
  'bars_basic',
  'swheels_basic',
  'fork_basic',
  'outfit_default',
  'helmet_none',
  'pads_none',
  'trail_none',
]);

export const STARTER_EQUIPPED = Object.freeze({
  vehicle: 'skateboard',
  skateboard: { deck: 'deck_classic', trucks: 'trucks_basic', wheels: 'wheels_basic', grip: 'grip_black' },
  scooter: { deck: 'sdeck_basic', bars: 'bars_basic', wheels: 'swheels_basic', fork: 'fork_basic' },
  outfit: 'outfit_default',
  helmet: 'helmet_none',
  pads: 'pads_none',
  trail: 'trail_none',
});

export function defaultSettings({ prefersReducedMotion = false } = {}) {
  return {
    audio: { muted: false, volume: 0.8 },
    camera: { mode: 'follow', smoothing: 0.6, shake: true },
    a11y: {
      reducedMotion: !!prefersReducedMotion,
      highContrast: false,
      colorblind: false,
      textScale: 1,
      captions: true,
      announce: true,
      gameSpeed: 1,
      forgivingLandings: false,
      autoPush: false,
      oneHanded: 'off', // 'off' | 'left' | 'right'
      touchLayout: 'standard', // 'standard' | 'left' | 'right' (one-handed clusters)
      touchScale: 1, // 1 | 1.25 | 1.5
      swipeSteer: false,
      touchControls: 'auto', // 'auto' | 'on' | 'off'
      announceTricks: true,
      questTracker: true,
    },
    graphics: { shadows: true },
  };
}

export function defaultSave(now = Date.now(), opts = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    bolts: STARTING_BOLTS,
    owned: [...STARTER_OWNED],
    equipped: structuredCloneSafe(STARTER_EQUIPPED),
    colors: {},
    quests: { progress: {}, daily: { day: null, ids: [] } },
    levels: {},
    visitedMaps: [],
    stats: { tricks: 0, bails: 0, grindSeconds: 0, distance: 0, bestCombo: 0, bestScore: 0, pickups: 0, playSeconds: 0, boltsEarned: 0, purchases: 0 },
    settings: defaultSettings(opts),
    bindings: null,
  };
}

function structuredCloneSafe(o) {
  return JSON.parse(JSON.stringify(o));
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------
const V1_BOARD_IDS = { basic: 'deck_classic', street: 'deck_street', pro: 'deck_pro', cruiser: 'deck_cruiser', longboard: 'deck_longboard' };

export function migrate1to2(v1) {
  const owned = ['vehicle_skateboard'];
  for (const b of Array.isArray(v1.boards) ? v1.boards : []) if (V1_BOARD_IDS[b]) owned.push(V1_BOARD_IDS[b]);
  const levels = {};
  if (isObj(v1.best)) for (const [id, score] of Object.entries(v1.best)) if (Number.isFinite(score)) levels[id] = { bestScore: score, stars: 0 };
  const opts = isObj(v1.options) ? v1.options : {};
  return {
    schemaVersion: 2,
    bolts: sanitizeBalance(v1.coins),
    owned,
    equippedBoard: V1_BOARD_IDS[v1.board] || 'deck_classic',
    settings: { audio: { volume: Number.isFinite(opts.volume) ? opts.volume : 0.8, muted: !!opts.muted } },
    levels,
    quests: {},
  };
}

export function migrate2to3(v2, now = Date.now()) {
  const d = defaultSave(now);
  const out = { ...d };
  out.bolts = sanitizeBalance(v2.bolts);
  out.owned = [...new Set([...d.owned, ...(Array.isArray(v2.owned) ? v2.owned : [])])];
  out.equipped = structuredCloneSafe(d.equipped);
  if (typeof v2.equippedBoard === 'string' && out.owned.includes(v2.equippedBoard)) out.equipped.skateboard.deck = v2.equippedBoard;
  if (isObj(v2.settings) && isObj(v2.settings.audio)) out.settings.audio = { ...out.settings.audio, ...v2.settings.audio };
  out.levels = {};
  if (isObj(v2.levels))
    for (const [id, l] of Object.entries(v2.levels)) {
      if (!isObj(l)) continue;
      out.levels[id] = { bestStars: clampInt(l.stars, 0, 3), bestScore: Math.max(0, Number(l.bestScore) || 0), bestTime: null, completed: (l.stars || 0) > 0 };
    }
  out.quests = { progress: {}, daily: { day: null, ids: [] } };
  if (isObj(v2.quests))
    for (const [id, q] of Object.entries(v2.quests)) {
      if (!isObj(q)) continue;
      out.quests.progress[id] = { progress: Math.max(0, Number(q.progress) || 0), completed: !!q.done, rewarded: !!q.done };
    }
  out.schemaVersion = 3;
  return out;
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

/** Detect a raw object's schema version. */
export function detectVersion(raw) {
  if (!isObj(raw)) return 0;
  if (Number.isInteger(raw.schemaVersion)) return raw.schemaVersion;
  if (Number.isInteger(raw.version)) return raw.version;
  if ('coins' in raw || 'boards' in raw) return 1;
  return 0;
}

/**
 * Migrate any raw save to the current schema and normalize every field.
 * Returns { save, from, status } where status is 'new' | 'current' | 'migrated' | 'future' | 'corrupt'.
 */
export function migrate(raw, now = Date.now()) {
  const from = detectVersion(raw);
  if (from === 0) return { save: defaultSave(now), from, status: raw == null ? 'new' : 'corrupt' };
  let data = raw;
  let status = 'current';
  if (from > SCHEMA_VERSION) status = 'future';
  else if (from < SCHEMA_VERSION) {
    status = 'migrated';
    if (detectVersion(data) === 1) data = migrate1to2(data);
    if (detectVersion(data) === 2) data = migrate2to3(data, now);
  }
  return { save: normalizeSave(data, now), from, status };
}

/** Fill missing or invalid fields from defaults (defensive against hand-edited saves). */
export function normalizeSave(s, now = Date.now()) {
  const d = defaultSave(now);
  if (!isObj(s)) return d;
  const out = { ...d };
  out.createdAt = Number.isFinite(s.createdAt) ? s.createdAt : now;
  out.updatedAt = Number.isFinite(s.updatedAt) ? s.updatedAt : now;
  out.bolts = sanitizeBalance(s.bolts ?? d.bolts);
  out.owned = [...new Set([...d.owned, ...(Array.isArray(s.owned) ? s.owned.filter((x) => typeof x === 'string') : [])])];
  out.equipped = structuredCloneSafe(d.equipped);
  if (isObj(s.equipped)) {
    const e = s.equipped;
    if (e.vehicle === 'scooter' && out.owned.includes('vehicle_scooter')) out.equipped.vehicle = 'scooter';
    for (const v of ['skateboard', 'scooter'])
      if (isObj(e[v])) for (const slot of Object.keys(out.equipped[v])) if (typeof e[v][slot] === 'string' && out.owned.includes(e[v][slot])) out.equipped[v][slot] = e[v][slot];
    for (const slot of ['outfit', 'helmet', 'pads', 'trail']) if (typeof e[slot] === 'string' && out.owned.includes(e[slot])) out.equipped[slot] = e[slot];
  }
  out.colors = {};
  if (isObj(s.colors))
    for (const [k, c] of Object.entries(s.colors))
      if (isObj(c) && /^#[0-9a-f]{6}$/i.test(c.color || '')) out.colors[k] = { color: c.color, pattern: typeof c.pattern === 'string' ? c.pattern : 'solid', accent: /^#[0-9a-f]{6}$/i.test(c.accent || '') ? c.accent : undefined };
  out.quests = { progress: {}, daily: { day: null, ids: [] } };
  if (isObj(s.quests)) {
    if (isObj(s.quests.progress))
      for (const [id, q] of Object.entries(s.quests.progress))
        if (isObj(q))
          out.quests.progress[id] = {
            progress: Math.max(0, Number(q.progress) || 0),
            completed: !!q.completed,
            rewarded: !!q.rewarded,
            day: typeof q.day === 'string' ? q.day : undefined,
            ...(Array.isArray(q.seen) ? { seen: q.seen.filter((x) => typeof x === 'string') } : {}),
          };
    if (isObj(s.quests.daily)) out.quests.daily = { day: typeof s.quests.daily.day === 'string' ? s.quests.daily.day : null, ids: Array.isArray(s.quests.daily.ids) ? s.quests.daily.ids.filter((x) => typeof x === 'string') : [] };
  }
  out.levels = {};
  if (isObj(s.levels))
    for (const [id, l] of Object.entries(s.levels))
      if (isObj(l)) out.levels[id] = { bestStars: clampInt(l.bestStars, 0, 3), bestScore: Math.max(0, Number(l.bestScore) || 0), bestTime: Number.isFinite(l.bestTime) ? l.bestTime : null, completed: !!l.completed };
  out.visitedMaps = Array.isArray(s.visitedMaps) ? [...new Set(s.visitedMaps.filter((x) => typeof x === 'string'))] : [];
  out.stats = { ...d.stats };
  if (isObj(s.stats)) for (const k of Object.keys(d.stats)) if (Number.isFinite(s.stats[k]) && s.stats[k] >= 0) out.stats[k] = s.stats[k];
  out.settings = mergeSettings(d.settings, s.settings);
  out.bindings = isObj(s.bindings) ? s.bindings : null;
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

function mergeSettings(def, s) {
  const out = structuredCloneSafe(def);
  if (!isObj(s)) return out;
  for (const group of Object.keys(def)) {
    if (!isObj(s[group])) continue;
    for (const [k, v] of Object.entries(def[group])) {
      const sv = s[group][k];
      if (typeof sv === typeof v) out[group][k] = sv;
    }
  }
  const a = out.a11y;
  a.textScale = Math.min(2, Math.max(0.8, a.textScale));
  a.touchScale = [1, 1.25, 1.5].includes(a.touchScale) ? a.touchScale : 1;
  a.gameSpeed = [1, 0.75, 0.5].includes(a.gameSpeed) ? a.gameSpeed : 1;
  if (!['off', 'left', 'right'].includes(a.oneHanded)) a.oneHanded = 'off';
  if (!['standard', 'left', 'right'].includes(a.touchLayout)) a.touchLayout = 'standard';
  if (!['auto', 'on', 'off'].includes(a.touchControls)) a.touchControls = 'auto';
  out.audio.volume = Math.min(1, Math.max(0, out.audio.volume));
  out.camera.smoothing = Math.min(1, Math.max(0, out.camera.smoothing));
  if (!['follow', 'close', 'top'].includes(out.camera.mode)) out.camera.mode = 'follow';
  return out;
}

/** localStorage when available, otherwise an in-memory stand-in (private mode, tests). */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

export function safeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    const probe = '__boltskate_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryStorage();
  }
}

export function createSaveStore(storage = safeLocalStorage(), { key = SAVE_KEY, now = () => Date.now() } = {}) {
  let lastWriteError = null;
  return {
    /** Load and migrate. Never throws. */
    load() {
      let text = null;
      try {
        text = storage.getItem(key);
      } catch {
        text = null;
      }
      if (text == null) return { save: defaultSave(now()), status: 'new', from: 0 };
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        try {
          storage.setItem(BACKUP_KEY, text);
        } catch {
          /* ignore */
        }
        return { save: defaultSave(now()), status: 'corrupt', from: 0 };
      }
      const r = migrate(raw, now());
      if (r.status === 'corrupt' || r.status === 'future') {
        try {
          storage.setItem(BACKUP_KEY, text);
        } catch {
          /* ignore */
        }
      }
      return r;
    },
    /** Write the save. Returns true on success. */
    write(save) {
      try {
        const s = { ...save, schemaVersion: SCHEMA_VERSION, updatedAt: now() };
        storage.setItem(key, JSON.stringify(s));
        lastWriteError = null;
        return true;
      } catch (err) {
        lastWriteError = err;
        return false;
      }
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    get lastWriteError() {
      return lastWriteError;
    },
  };
}
