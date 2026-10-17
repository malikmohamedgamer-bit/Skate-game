// Trick points, combos and multipliers. Pure functions: every function returns a
// new state object and never mutates its input.
//
// Rules (documented in README "Scoring"):
//   * Each clean trick (air trick or grind) adds 1 to the combo count.
//   * Points awarded = base points x combo multiplier.
//   * Multiplier = 1 + COMBO_STEP x (combo - 1), capped at COMBO_MULTIPLIER_CAP.
//   * A bail resets the combo (count and multiplier) to zero.
//   * Rolling on the ground for COMBO_WINDOW seconds without a new trick ends ("banks")
//     the combo. Time in the air or on a rail does not count down the window.

export const COMBO_STEP = 0.5;
export const COMBO_MULTIPLIER_CAP = 5;
export const COMBO_WINDOW = 3.0;

export function createScore() {
  return { score: 0, combo: 0, comboPoints: 0, comboTimer: 0, bestCombo: 0, bestComboPoints: 0, tricks: 0, bails: 0 };
}

export function comboMultiplier(count) {
  if (!Number.isFinite(count) || count <= 1) return 1;
  return Math.min(COMBO_MULTIPLIER_CAP, 1 + COMBO_STEP * (count - 1));
}

/** Score a clean trick. Returns { state, awarded, multiplier, combo }. */
export function awardTrick(state, basePoints) {
  const base = Number.isFinite(basePoints) && basePoints > 0 ? Math.round(basePoints) : 0;
  const combo = state.combo + 1;
  const multiplier = comboMultiplier(combo);
  const awarded = Math.round(base * multiplier);
  const comboPoints = state.comboPoints + awarded;
  return {
    state: {
      ...state,
      score: state.score + awarded,
      combo,
      comboPoints,
      comboTimer: COMBO_WINDOW,
      bestCombo: Math.max(state.bestCombo, combo),
      bestComboPoints: Math.max(state.bestComboPoints, comboPoints),
      tricks: state.tricks + 1,
    },
    awarded,
    multiplier,
    combo,
  };
}

/** A bail resets the combo. Points already scored stay. */
export function applyBail(state) {
  return { ...state, combo: 0, comboPoints: 0, comboTimer: 0, bails: state.bails + 1 };
}

/**
 * Advance the combo window. `inTrick` (airborne or grinding) pauses the countdown.
 * Returns { state, ended } where ended is { count, points } when a combo banks.
 */
export function tickCombo(state, dt, inTrick = false) {
  if (state.combo === 0 || inTrick) return { state, ended: null };
  const t = state.comboTimer - dt;
  if (t > 0) return { state: { ...state, comboTimer: t }, ended: null };
  return {
    state: { ...state, combo: 0, comboPoints: 0, comboTimer: 0 },
    ended: { count: state.combo, points: state.comboPoints },
  };
}
