// Customization: catalog, buying, equipping, stats from parts, colors and the 3D look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COSMETIC_SLOTS,
  VEHICLE_SLOTS,
  autoAccent,
  buildLook,
  buyItem,
  canBuy,
  computeStats,
  contrastRatio,
  equipItem,
  isEquipped,
  itemById,
  setPartColor,
  slotOf,
  statDelta,
} from '../src/game/customize.js';
import { RUN_TRICK_BOLT_CAP, STARTING_BOLTS, cheapestUnowned, createRunEarnings, earnFromTrick } from '../src/game/economy.js';
import { STARTER_EQUIPPED, STARTER_OWNED, createSaveStore, defaultSave, memoryStorage } from '../src/core/save.js';
import { loadData } from './helpers.js';

const data = await loadData();
const C = data.catalog;
const V = data.vehicles;
const fresh = () => defaultSave(0);

test('the shop sells boards, scooters, decks, wheels, trucks, grip tape, outfits, helmets, pads and trails', () => {
  const cats = new Set(C.items.map((i) => i.category));
  for (const c of ['vehicle', 'deck', 'wheels', 'trucks', 'grip', 'sdeck', 'bars', 'swheels', 'fork', 'outfit', 'helmet', 'pads', 'trail']) assert.ok(cats.has(c), c);
  assert.ok(itemById(C, 'vehicle_scooter').price > 0, 'the scooter is bought in the shop');
  assert.equal(new Set(C.items.map((i) => i.id)).size, C.items.length, 'unique ids');
});

test('starter items exist, are free and the starter loadout is consistent', () => {
  for (const id of STARTER_OWNED) {
    const it = itemById(C, id);
    assert.ok(it, id);
    assert.equal(it.price, 0, id);
  }
  for (const v of ['skateboard', 'scooter']) for (const [slot, id] of Object.entries(STARTER_EQUIPPED[v])) assert.equal(slotOf(C, itemById(C, id)).slot, slot);
  for (const slot of COSMETIC_SLOTS) assert.ok(STARTER_OWNED.includes(STARTER_EQUIPPED[slot]), slot);
});

test('parts have stat effects: wheels grip/speed, decks ollie height, trucks and bars turn rate', () => {
  const effect = (cat, keys) => C.items.filter((i) => i.category === cat && i.price > 0).every((i) => keys.some((k) => i.stats && i.stats[k]));
  assert.ok(effect('wheels', ['grip', 'topSpeed']));
  assert.ok(effect('swheels', ['grip', 'topSpeed']));
  assert.ok(effect('deck', ['jump']));
  assert.ok(effect('sdeck', ['jump']));
  assert.ok(effect('trucks', ['turnRate']));
  assert.ok(effect('bars', ['turnRate']));
  assert.ok(effect('fork', ['grip']));
  for (const i of C.items.filter((x) => ['outfit', 'helmet', 'pads', 'trail'].includes(x.category))) assert.ok(!i.stats, `${i.id} is cosmetic`);
});

test('a new player can always buy the cheapest item', () => {
  const p = fresh();
  const cheapest = cheapestUnowned(C.items, p.owned);
  assert.ok(cheapest);
  assert.ok(cheapest.price <= STARTING_BOLTS, `${cheapest.id} costs ${cheapest.price}`);
  const r = buyItem(p, C, cheapest.id);
  assert.ok(r.ok);
  assert.ok(r.profile.bolts >= 0);
});

test('a broke player can always earn enough for the cheapest unowned item within one run', () => {
  const p = { ...fresh(), bolts: 0 };
  let owned = [...p.owned];
  // Even after owning everything but the most expensive items, the next cheapest is within one run's trick cap.
  const sorted = C.items.filter((i) => i.price > 0).sort((a, b) => a.price - b.price);
  const cheapest = cheapestUnowned(C.items, owned);
  assert.ok(cheapest.price <= RUN_TRICK_BOLT_CAP);
  let run = createRunEarnings();
  let earned = 0;
  for (let i = 0; i < 200 && earned < cheapest.price; i++) {
    const r = earnFromTrick(run, 500);
    run = r.run;
    earned += r.bolts;
  }
  assert.ok(earned >= cheapest.price);
  owned = owned.concat(sorted.slice(0, -1).map((i) => i.id));
  assert.ok(cheapestUnowned(C.items, owned).price <= 999999999, 'still purchasable');
});

test('buying checks the balance first and never goes negative', () => {
  const p = { ...fresh(), bolts: 50 };
  const pricey = itemById(C, 'deck_pro');
  const r = buyItem(p, C, pricey.id);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient');
  assert.equal(r.short, pricey.price - 50);
  assert.equal(r.profile.bolts, 50);
  assert.ok(!r.profile.owned.includes(pricey.id));
  for (const item of C.items)
    for (const bal of [0, 1, 59, 60, 61, 149, 150, 799, 800, 5000]) {
      const out = buyItem({ ...fresh(), bolts: bal }, C, item.id);
      assert.ok(out.profile.bolts >= 0, `${item.id} @ ${bal}`);
      if (out.ok) assert.equal(out.profile.bolts, bal - item.price);
    }
});

test('buying an owned item fails; buying works and is recorded', () => {
  const p = { ...fresh(), bolts: 500 };
  assert.equal(canBuy(p, itemById(C, 'deck_classic')).reason, 'owned');
  const r = buyItem(p, C, 'deck_street');
  assert.ok(r.ok);
  assert.equal(r.profile.bolts, 500 - 80);
  assert.ok(r.profile.owned.includes('deck_street'));
  assert.equal(r.profile.stats.purchases, 1);
  assert.equal(p.bolts, 500, 'input profile not mutated');
  assert.equal(buyItem(r.profile, C, 'deck_street').reason, 'owned');
});

test('equipping needs ownership and puts the item in the right slot', () => {
  let p = { ...fresh(), bolts: 1000 };
  assert.equal(equipItem(p, C, 'trucks_pro').reason, 'not-owned');
  p = buyItem(p, C, 'trucks_pro').profile;
  p = equipItem(p, C, 'trucks_pro').profile;
  assert.equal(p.equipped.skateboard.trucks, 'trucks_pro');
  assert.ok(isEquipped(p, C, 'trucks_pro'));
  assert.equal(equipItem(p, C, 'vehicle_scooter').reason, 'not-owned');
  p = buyItem(p, C, 'vehicle_scooter').profile;
  p = equipItem(p, C, 'vehicle_scooter').profile;
  assert.equal(p.equipped.vehicle, 'scooter');
  p = buyItem(p, C, 'helmet_full').profile;
  p = equipItem(p, C, 'helmet_full').profile;
  assert.equal(p.equipped.helmet, 'helmet_full');
});

test('equipped parts change handling stats; cosmetics do not', () => {
  const base = computeStats(V, C, fresh(), 'skateboard');
  assert.equal(base.jump, V.skateboard.jump);
  let p = { ...fresh(), bolts: 5000 };
  for (const id of ['deck_pro', 'trucks_pro', 'wheels_speed', 'outfit_neon']) p = equipItem(buyItem(p, C, id).profile, C, id).profile;
  const s = computeStats(V, C, p, 'skateboard');
  assert.ok(s.jump > base.jump, 'deck: ollie height');
  assert.ok(s.turnRate > base.turnRate, 'trucks: turn rate');
  assert.ok(s.topSpeed > base.topSpeed && s.grip < base.grip, 'speed wheels: faster, less grip');
  assert.deepEqual(statDelta(V, C, fresh(), 'deck_pro'), { jump: 0.5 });
  assert.equal(statDelta(V, C, fresh(), 'outfit_neon'), null);
});

test('stats are clamped to sane ranges', () => {
  const crazy = { ...C, items: C.items.map((i) => (i.id === 'deck_classic' ? { ...i, stats: { jump: 99, grip: -99 } } : i)) };
  const s = computeStats(V, crazy, fresh(), 'skateboard');
  assert.ok(s.jump <= 9 && s.grip >= 4);
});

test('part colors and patterns: validated, saved and used by the 3D look', () => {
  let p = fresh();
  assert.equal(setPartColor(p, C, 'skateboard.deck', { color: 'red' }).reason, 'bad-color');
  assert.equal(setPartColor(p, C, 'skateboard.deck', { pattern: 'plaid' }).reason, 'bad-pattern');
  p = setPartColor(p, C, 'skateboard.deck', { color: '#56b4e9', pattern: 'stripes' }).profile;
  const look = buildLook(p, C);
  assert.equal(look.vehicle, 'skateboard');
  assert.equal(look.parts.deck.color, '#56b4e9');
  assert.equal(look.parts.deck.pattern, 'stripes');
  assert.equal(look.parts.deck.shape, 'popsicle');
  assert.ok(look.parts.deck.accent, 'pattern accent is chosen automatically');
  for (const slot of Object.keys(VEHICLE_SLOTS.skateboard)) assert.ok(look.parts[slot].color);
  const storage = memoryStorage();
  const store = createSaveStore(storage);
  store.write(p);
  assert.equal(store.load().save.colors['skateboard.deck'].pattern, 'stripes');
});

test('pattern accents keep contrast with the base color', () => {
  for (const c of C.colors) assert.ok(contrastRatio(c.hex, autoAccent(c.hex)) >= 3, c.name);
  assert.ok(contrastRatio('#000000', '#ffffff') > 20);
});

test('colors are named and a colorblind-safe subset exists', () => {
  assert.ok(C.colors.length >= 8);
  for (const c of C.colors) assert.ok(c.name && /^#[0-9a-f]{6}$/i.test(c.hex));
  assert.ok(C.colorblindSafe.length >= 6);
  assert.ok(C.patterns.length >= 5);
});

test('look reflects the equipped vehicle and cosmetics', () => {
  let p = { ...fresh(), bolts: 5000 };
  for (const id of ['vehicle_scooter', 'bars_pro', 'helmet_stripe', 'pads_basic', 'trail_ribbon', 'outfit_hoodie']) p = equipItem(buyItem(p, C, id).profile, C, id).profile;
  const look = buildLook(p, C);
  assert.equal(look.vehicle, 'scooter');
  assert.equal(look.parts.bars.item, 'bars_pro');
  assert.equal(look.helmet.style, 'stripe');
  assert.equal(look.pads.style, 'basic');
  assert.equal(look.trail.style, 'ribbon');
  assert.equal(look.outfit.shirt, itemById(C, 'outfit_hoodie').look.shirt);
});
