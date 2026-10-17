// Fixed-timestep game loop.
// Simulation always advances in `dt`-sized ticks (default 1/60 s) so physics is
// deterministic and frame-rate independent. `timeScale` (<1 = slow motion) is the
// accessibility "game speed" setting: it slows simulated time relative to real time.

export const DEFAULT_DT = 1 / 60;

/**
 * Pure accumulator math: given leftover time and a new frame duration, how many
 * fixed ticks should run? Excess time beyond `maxSteps` ticks is dropped so a long
 * stall (tab in background) cannot cause a "spiral of death".
 */
export function computeSteps(accumulator, frameSeconds, dt = DEFAULT_DT, maxSteps = 5, timeScale = 1) {
  const safeFrame = Number.isFinite(frameSeconds) && frameSeconds > 0 ? frameSeconds : 0;
  let acc = accumulator + safeFrame * timeScale;
  let steps = Math.floor((acc + 1e-9) / dt);
  if (steps > maxSteps) {
    steps = maxSteps;
    acc = 0;
  } else {
    acc -= steps * dt;
    if (acc < 0) acc = 0;
  }
  return { steps, accumulator: acc, alpha: acc / dt };
}

/**
 * Create a loop. `step(dt)` runs once per fixed tick; `render(alpha, frameSeconds)`
 * runs once per animation frame. In manual mode the rAF loop still renders but does
 * not advance the simulation; tests drive it with `advance()`.
 */
export function createLoop({ step, render, dt = DEFAULT_DT, maxSteps = 5 } = {}) {
  let running = false;
  let manual = false;
  let accumulator = 0;
  let last = 0;
  let rafId = 0;
  let timeScale = 1;
  let paused = false;
  let ticks = 0;

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const frameSeconds = last ? Math.min((now - last) / 1000, 0.25) : 0;
    last = now;
    if (!paused && !manual) {
      const r = computeSteps(accumulator, frameSeconds, dt, maxSteps, timeScale);
      accumulator = r.accumulator;
      for (let i = 0; i < r.steps; i++) {
        step(dt);
        ticks++;
      }
      render(r.alpha, frameSeconds);
    } else {
      render(0, frameSeconds);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    /** Advance the simulation by a fixed number of seconds (scaled by timeScale), synchronously. */
    advance(seconds, { renderEvery = 0 } = {}) {
      const n = Math.round((seconds * timeScale) / dt);
      for (let i = 0; i < n; i++) {
        step(dt);
        ticks++;
        if (renderEvery && i % renderEvery === 0) render(0, dt);
      }
      return n;
    },
    setPaused(p) {
      paused = !!p;
      accumulator = 0;
    },
    get paused() {
      return paused;
    },
    setManual(m) {
      manual = !!m;
      accumulator = 0;
    },
    get manual() {
      return manual;
    },
    setTimeScale(s) {
      timeScale = Number.isFinite(s) && s > 0 ? s : 1;
    },
    get timeScale() {
      return timeScale;
    },
    get ticks() {
      return ticks;
    },
    get running() {
      return running;
    },
    dt,
  };
}
