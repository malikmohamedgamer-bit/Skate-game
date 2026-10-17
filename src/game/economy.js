// Bolts: earning and spending. Pure functions. The balance can never go negative,
// every purchase checks the balance first, and per-run caps stop farming.
//
// Earning (documented in README "Bolts"):
//   tricks   1 Bolt per POINTS_PER_BOLT trick points (after combo), max RUN_TRICK_BOLT_CAP per run
//   grinding GRIND_BOLTS_PER_SECOND per second on a rail, max RUN_GRIND_BOLT_CAP per run
//   pickups  PICKUP_BOLTS each (each pickup once per run)
//   quests   the quest's reward (once per quest; dailies once per day)
//   levels   LEVEL_COMPLETE_BOLTS for finishing + STAR_BOLTS for each star earned for the first time

export const CURRENCY = 'Bolts';
export const STARTING_BOLTS = 150;
export const POINTS_PER_BOLT = 40;
export const RUN_TRICK_BOLT_CAP = 300;
export const GRIND_BOLTS_PER_SECOND = 2;
export const RUN_GRIND_BOLT_CAP = 120;
export const PICKUP_BOLTS = 10;
export const LEVEL_COMPLETE_BOLTS = 25;
export const STAR_BOLTS = Object.freeze([0, 40, 60, 100]);
export const MAX_BOLTS = 999_999_999;

function toAmount(n) {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Normalize any stored balance to a safe integer in [0, MAX_BOLTS]. */
export function sanitizeBalance(b) {
  if (!Number.isFinite(b) || b < 0) return 0;
  return Math.min(MAX_BOLTS, Math.floor(b));
}

/** Add Bolts. Negative or invalid amounts add nothing. */
export function addBolts(balance, amount) {
  return Math.min(MAX_BOLTS, sanitizeBalance(balance) + toAmount(amount));
}

export function canAfford(balance, price) {
  return Number.isFinite(price) && price >= 0 && sanitizeBalance(balance) >= price;
}

/** Spend Bolts. Returns { ok, balance, reason }. Never produces a negative balance. */
export function spend(balance, price) {
  const b = sanitizeBalance(balance);
  if (!Number.isFinite(price) || price < 0 || Math.floor(price) !== price) return { ok: false, balance: b, reason: 'invalid-price' };
  if (b < price) return { ok: false, balance: b, reason: 'insufficient', short: price - b };
  return { ok: true, balance: b - price, reason: null };
}

export function createRunEarnings() {
  return { tricks: 0, trickRemainder: 0, grind: 0, grindRemainder: 0, pickups: 0, pickupIds: [], quests: 0, levels: 0 };
}

export function runTotal(run) {
  return run.tricks + run.grind + run.pickups + run.quests + run.levels;
}

/** Bolts for a scored trick (points already include the combo multiplier). */
export function earnFromTrick(run, points) {
  const room = RUN_TRICK_BOLT_CAP - run.tricks;
  if (room <= 0) return { run, bolts: 0, capped: true };
  const total = run.trickRemainder + toAmount(points);
  let bolts = Math.floor(total / POINTS_PER_BOLT);
  const remainder = total - bolts * POINTS_PER_BOLT;
  const capped = bolts >= room;
  bolts = Math.min(bolts, room);
  return { run: { ...run, tricks: run.tricks + bolts, trickRemainder: capped ? 0 : remainder }, bolts, capped };
}

/** Bolts for time spent grinding (fractions carry over between calls). */
export function earnFromGrind(run, seconds) {
  const room = RUN_GRIND_BOLT_CAP - run.grind;
  if (room <= 0 || !(seconds > 0)) return { run, bolts: 0, capped: room <= 0 };
  const total = run.grindRemainder + seconds * GRIND_BOLTS_PER_SECOND;
  // Epsilon: 60 ticks of 1/60 s sum to 0.99999..., which must still pay a full Bolt.
  const whole = Math.floor(total + 1e-9);
  const capped = whole >= room;
  const bolts = Math.min(whole, room);
  return { run: { ...run, grind: run.grind + bolts, grindRemainder: capped ? 0 : Math.max(0, total - whole) }, bolts, capped };
}

/** Bolts for a pickup; each pickup id pays once per run. */
export function earnFromPickup(run, pickupId, value = PICKUP_BOLTS) {
  if (run.pickupIds.includes(pickupId)) return { run, bolts: 0 };
  const bolts = toAmount(value);
  return { run: { ...run, pickups: run.pickups + bolts, pickupIds: [...run.pickupIds, pickupId] }, bolts };
}

/** Level completion reward: base + bonus for stars earned for the first time. */
export function levelReward(prevBestStars, stars) {
  if (!(stars >= 1)) return 0;
  let bolts = LEVEL_COMPLETE_BOLTS;
  for (let s = Math.max(1, (prevBestStars || 0) + 1); s <= Math.min(3, stars); s++) bolts += STAR_BOLTS[s];
  return bolts;
}

/** Cheapest item the player does not own yet (or null). */
export function cheapestUnowned(items, owned) {
  const own = new Set(owned);
  let best = null;
  for (const it of items) if (!own.has(it.id) && it.price > 0 && (!best || it.price < best.price)) best = it;
  return best;
}
