// Customization: catalog lookups, buying, equipping, part colors, and the stats
// and 3D look that equipped parts produce. Pure functions: profile in, new profile out.

import { canAfford, spend } from './economy.js';

export const VEHICLE_SLOTS = {
  skateboard: { deck: 'deck', trucks: 'trucks', wheels: 'wheels', grip: 'grip' },
  scooter: { deck: 'sdeck', bars: 'bars', wheels: 'swheels', fork: 'fork' },
};
export const COSMETIC_SLOTS = ['outfit', 'helmet', 'pads', 'trail'];
export const STAT_KEYS = ['jump', 'topSpeed', 'turnRate', 'grip', 'trickBonus', 'weight'];
const HEX = /^#[0-9a-f]{6}$/i;

export function itemById(catalog, id) {
  return catalog.items.find((i) => i.id === id) || null;
}
export function categoryById(catalog, id) {
  return catalog.categories.find((c) => c.id === id) || null;
}
export function itemsIn(catalog, categoryId) {
  return catalog.items.filter((i) => i.category === categoryId);
}
export function isOwned(profile, id) {
  return profile.owned.includes(id);
}

/** Where an item goes when equipped: { vehicle?, slot }. */
export function slotOf(catalog, item) {
  const cat = categoryById(catalog, item.category);
  if (!cat) return null;
  if (cat.id === 'vehicle') return { slot: 'vehicle' };
  if (cat.vehicle) return { vehicle: cat.vehicle, slot: cat.slot };
  return { slot: cat.slot };
}

export function isEquipped(profile, catalog, id) {
  const item = itemById(catalog, id);
  if (!item) return false;
  const s = slotOf(catalog, item);
  if (s.slot === 'vehicle') return profile.equipped.vehicle === item.vehicle;
  if (s.vehicle) return profile.equipped[s.vehicle][s.slot] === id;
  return profile.equipped[s.slot] === id;
}

/** Can the player buy this item right now? { ok, reason, short } */
export function canBuy(profile, item) {
  if (!item) return { ok: false, reason: 'unknown' };
  if (isOwned(profile, item.id)) return { ok: false, reason: 'owned' };
  if (!canAfford(profile.bolts, item.price)) return { ok: false, reason: 'insufficient', short: item.price - profile.bolts };
  return { ok: true, reason: null };
}

const clone = (p) => ({ ...p, owned: [...p.owned], equipped: JSON.parse(JSON.stringify(p.equipped)), colors: { ...p.colors }, stats: { ...p.stats } });

/** Buy an item (checks the balance first). Returns { ok, profile, reason }. */
export function buyItem(profile, catalog, id) {
  const item = itemById(catalog, id);
  const check = canBuy(profile, item);
  if (!check.ok) return { ok: false, profile, reason: check.reason, short: check.short };
  const pay = spend(profile.bolts, item.price);
  if (!pay.ok) return { ok: false, profile, reason: pay.reason };
  const next = clone(profile);
  next.bolts = pay.balance;
  next.owned.push(id);
  next.stats.purchases = (next.stats.purchases || 0) + 1;
  return { ok: true, profile: next, reason: null, item };
}

/** Equip an owned item. Returns { ok, profile, reason }. */
export function equipItem(profile, catalog, id) {
  const item = itemById(catalog, id);
  if (!item) return { ok: false, profile, reason: 'unknown' };
  if (!isOwned(profile, id)) return { ok: false, profile, reason: 'not-owned' };
  const s = slotOf(catalog, item);
  const next = clone(profile);
  if (s.slot === 'vehicle') next.equipped.vehicle = item.vehicle;
  else if (s.vehicle) next.equipped[s.vehicle][s.slot] = id;
  else next.equipped[s.slot] = id;
  return { ok: true, profile: next, reason: null };
}

/** Equipped part ids for a vehicle (skateboard: deck/trucks/wheels/grip; scooter: deck/bars/wheels/fork). */
export function equippedParts(profile, vehicle) {
  return Object.values(profile.equipped[vehicle] || {});
}

/**
 * Vehicle handling = base stats (vehicles.json) + equipped part modifiers.
 * Results are clamped to sane ranges so no combination breaks the physics.
 */
export function computeStats(vehicles, catalog, profile, vehicle = profile.equipped.vehicle) {
  const base = vehicles[vehicle];
  const s = { ...base };
  for (const id of equippedParts(profile, vehicle)) {
    const item = itemById(catalog, id);
    if (!item || !item.stats) continue;
    for (const k of STAT_KEYS) if (Number.isFinite(item.stats[k])) s[k] += item.stats[k];
  }
  s.jump = clamp(s.jump, 3.5, 9);
  s.topSpeed = clamp(s.topSpeed, 6, 15);
  s.turnRate = clamp(s.turnRate, 1.2, 4.5);
  s.grip = clamp(s.grip, 4, 16);
  s.trickBonus = clamp(s.trickBonus, 0.5, 2);
  s.weight = clamp(s.weight, 0.6, 2);
  return s;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Stat changes an item would make if equipped (for "try on" previews). */
export function statDelta(vehicles, catalog, profile, id) {
  const item = itemById(catalog, id);
  const s = item ? slotOf(catalog, item) : null;
  if (!s || !s.vehicle) return null;
  const tryProfile = equipItem({ ...profile, owned: [...profile.owned, id] }, catalog, id).profile;
  const before = computeStats(vehicles, catalog, profile, s.vehicle);
  const after = computeStats(vehicles, catalog, tryProfile, s.vehicle);
  const d = {};
  for (const k of STAT_KEYS) if (Math.abs(after[k] - before[k]) > 1e-9) d[k] = after[k] - before[k];
  return d;
}

export function colorKey(vehicle, slot) {
  return vehicle ? `${vehicle}.${slot}` : slot;
}

/** Set a part's color/pattern. Validates the hex and pattern id. Returns { ok, profile, reason }. */
export function setPartColor(profile, catalog, key, { color, pattern, accent } = {}) {
  const cur = profile.colors[key] || {};
  const nextColor = color ?? cur.color;
  const nextPattern = pattern ?? cur.pattern ?? 'solid';
  if (nextColor !== undefined && !HEX.test(nextColor)) return { ok: false, profile, reason: 'bad-color' };
  if (!catalog.patterns.some((p) => p.id === nextPattern)) return { ok: false, profile, reason: 'bad-pattern' };
  if (accent !== undefined && !HEX.test(accent)) return { ok: false, profile, reason: 'bad-color' };
  const next = clone(profile);
  next.colors[key] = { color: nextColor, pattern: nextPattern, ...(accent || cur.accent ? { accent: accent || cur.accent } : {}) };
  return { ok: true, profile: next, reason: null };
}

/** WCAG relative luminance contrast between two hex colors. */
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** A pattern accent that contrasts with the base color (white or black). */
export function autoAccent(hex) {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#111111') ? '#ffffff' : '#111111';
}

/** Build the look object consumed by src/rider/rider.js from the profile. */
export function buildLook(profile, catalog, overrides = {}) {
  const eq = { ...profile.equipped, ...(overrides.equipped || {}) };
  const vehicle = overrides.vehicle || eq.vehicle || 'skateboard';
  const slots = VEHICLE_SLOTS[vehicle];
  const parts = {};
  for (const slot of Object.keys(slots)) {
    const id = (overrides.parts && overrides.parts[slot]) || profile.equipped[vehicle][slot];
    const item = itemById(catalog, id) || {};
    const c = profile.colors[colorKey(vehicle, slot)] || {};
    const color = c.color || item.defaultColor || '#888888';
    parts[slot] = {
      item: id,
      color,
      pattern: c.pattern || 'solid',
      accent: c.accent || autoAccent(color),
      ...(item.model || {}),
    };
  }
  const outfitItem = itemById(catalog, overrides.outfit || eq.outfit) || {};
  const helmetItem = itemById(catalog, overrides.helmet || eq.helmet) || {};
  const padsItem = itemById(catalog, overrides.pads || eq.pads) || {};
  const trailItem = itemById(catalog, overrides.trail || eq.trail) || {};
  return {
    vehicle,
    parts,
    outfit: { ...(outfitItem.look || {}) },
    helmet: { style: helmetItem.look?.style || 'none', color: profile.colors.helmet?.color || helmetItem.defaultColor || '#ffb000' },
    pads: { style: padsItem.look?.style || 'none', color: profile.colors.pads?.color || padsItem.defaultColor || '#222222' },
    trail: { style: trailItem.look?.style || 'none', color: profile.colors.trail?.color || trailItem.defaultColor || '#ffb000' },
  };
}
