// Turns gameplay events from a session into score, Bolts, stats, quest and level
// progress on the player's profile (the save). Deterministic and DOM-free so it is
// unit tested. Functions mutate the `run` and `profile` objects passed in and
// return a list of notifications for the HUD, audio and screen reader.

import { applyBail, awardTrick, createScore, tickCombo } from './scoring.js';
import { addBolts, createRunEarnings, earnFromGrind, earnFromPickup, earnFromTrick } from './economy.js';
import { applyQuestEvent, claimRewards, syncQuestsWithProfile } from './quests.js';

export function createRun({ mode = 'free', mapId = null, levelId = null } = {}) {
  return {
    mode,
    mapId,
    levelId,
    score: createScore(),
    earnings: createRunEarnings(),
    time: 0,
    pickups: [],
    grindSeconds: 0,
    grindDistance: 0,
    grindBoltsPending: 0,
    maxSpeed: 0,
    reportedKmh: 0,
    tricks: [],
  };
}

/**
 * Feed one quest event (see quests.js eventAmount) to the profile's quests.
 * Completed quests are rewarded immediately (once). Returns notifications
 * { type: 'questComplete', id, title, reward } and { type: 'bolts' }.
 */
export function questEvent(profile, questDefs, qe) {
  if (!questDefs || !questDefs.length) return [];
  const r = applyQuestEvent(profile.quests, questDefs, qe);
  profile.quests = r.state;
  if (!r.completed.length) return [];
  // A finished story quest unlocks the next one: catch it up with world facts
  // (maps already visited, stars already earned).
  for (let guard = 0; guard < questDefs.length; guard++) {
    const synced = syncQuestsWithProfile(profile.quests, questDefs, profile);
    profile.quests = synced.state;
    if (!synced.completed.length) break;
  }
  const claim = claimRewards(profile.quests, questDefs);
  profile.quests = claim.state;
  const out = [];
  let total = 0;
  for (const id of claim.claimed) {
    const q = questDefs.find((x) => x.id === id);
    total += q.reward;
    out.push({ type: 'questComplete', id, title: q.title, reward: q.reward, questType: q.type });
  }
  const gained = creditBolts(profile, total);
  if (gained > 0) out.push({ type: 'bolts', amount: gained, source: 'quest' });
  return out;
}

/** Credit Bolts to the profile and record lifetime earnings. */
export function creditBolts(profile, amount) {
  const before = profile.bolts;
  profile.bolts = addBolts(profile.bolts, amount);
  const gained = profile.bolts - before;
  profile.stats.boltsEarned += gained;
  return gained;
}

/**
 * Apply one session event. Returns notifications:
 *   { type: 'score', name, base, awarded, multiplier, combo, grind }
 *   { type: 'bolts', amount, source }
 *   { type: 'bail', reason }
 *   { type: 'pickup', id, bolts }
 */
export function applyEvent(run, profile, e, ctx = null) {
  const out = [];
  const quests = ctx && ctx.questDefs;
  const q = (qe) => {
    if (quests) out.push(...questEvent(profile, quests, { vehicle: ctx.vehicle, map: run.mapId, ...qe }));
  };
  switch (e.type) {
    case 'trickLanded': {
      const r = awardTrick(run.score, e.points);
      run.score = r.state;
      run.tricks.push({ name: e.name, awarded: r.awarded, grind: !!e.grind });
      if (run.tricks.length > 50) run.tricks.shift();
      out.push({ type: 'score', name: e.name, base: e.points, awarded: r.awarded, multiplier: r.multiplier, combo: r.combo, grind: !!e.grind });
      profile.stats.tricks += 1;
      profile.stats.bestCombo = Math.max(profile.stats.bestCombo, r.combo);
      const t = earnFromTrick(run.earnings, r.awarded);
      run.earnings = t.run;
      let bolts = t.bolts;
      if (e.grind) {
        // Grind-time Bolts were accumulated while on the rail; pay them out with the grind.
        bolts += run.grindBoltsPending;
        run.grindBoltsPending = 0;
      }
      const gained = creditBolts(profile, bolts);
      if (gained > 0) out.push({ type: 'bolts', amount: gained, source: e.grind ? 'grind' : 'trick' });
      q({ type: 'trick', name: e.name, grind: !!e.grind, spin: !!(e.trick && e.trick.spin), airTime: e.airTime || 0 });
      q({ type: 'combo', count: r.combo });
      q({ type: 'runScore', score: run.score.score });
      break;
    }
    case 'grindTick': {
      run.grindSeconds += e.dt;
      run.grindDistance += (e.speed || 0) * e.dt;
      profile.stats.grindSeconds += e.dt;
      const g = earnFromGrind(run.earnings, e.dt);
      run.earnings = g.run;
      run.grindBoltsPending += g.bolts;
      q({ type: 'grind', seconds: e.dt });
      break;
    }
    case 'bail': {
      run.score = applyBail(run.score);
      profile.stats.bails += 1;
      // Grind-time Bolts already earned are kept even if you fall off.
      if (run.grindBoltsPending > 0) {
        const gained = creditBolts(profile, run.grindBoltsPending);
        run.grindBoltsPending = 0;
        if (gained > 0) out.push({ type: 'bolts', amount: gained, source: 'grind' });
      }
      out.push({ type: 'bail', reason: e.reason });
      break;
    }
    case 'pickup': {
      const p = earnFromPickup(run.earnings, e.id, e.value);
      run.earnings = p.run;
      if (p.bolts > 0) {
        run.pickups.push(e.id);
        profile.stats.pickups += 1;
        const gained = creditBolts(profile, p.bolts);
        out.push({ type: 'pickup', id: e.id, bolts: gained });
        out.push({ type: 'bolts', amount: gained, source: 'pickup' });
        q({ type: 'pickup' });
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Advance run time and the combo window. Returns notifications ({ type: 'comboEnd' }). */
export function tickRun(run, profile, dt, { inTrick = false, speed = 0, distance = 0, ctx = null } = {}) {
  run.time += dt;
  if (speed > run.maxSpeed) run.maxSpeed = speed;
  profile.stats.playSeconds += dt;
  profile.stats.distance += distance;
  const out = [];
  // Report speed to quests when it rises by at least 0.5 km/h (avoids per-tick work).
  const kmh = run.maxSpeed * 3.6;
  if (ctx && ctx.questDefs && kmh >= run.reportedKmh + 0.5) {
    run.reportedKmh = kmh;
    out.push(...questEvent(profile, ctx.questDefs, { type: 'speed', kmh, map: run.mapId, vehicle: ctx.vehicle }));
  }
  const r = tickCombo(run.score, dt, inTrick);
  run.score = r.state;
  if (r.ended && r.ended.count > 1) out.push({ type: 'comboEnd', count: r.ended.count, points: r.ended.points });
  return out;
}

/** At the end of a run: record best score. */
export function finishRun(run, profile) {
  profile.stats.bestScore = Math.max(profile.stats.bestScore, run.score.score);
  if (run.grindBoltsPending > 0) {
    creditBolts(profile, run.grindBoltsPending);
    run.grindBoltsPending = 0;
  }
}
