// Shared helpers for unit tests: load the real game data from disk.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../src/core/data.js';
import { emptyFrame } from '../src/core/input.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

export function readJson(path) {
  return JSON.parse(readFileSync(SRC + path, 'utf8'));
}

export async function loadData() {
  return loadGameData(async (p) => readJson(p));
}

/** Build an input frame for session.step(). */
export function frame(over = {}) {
  const f = emptyFrame();
  const { pressed, ...rest } = over;
  Object.assign(f, rest);
  if (pressed) Object.assign(f.pressed, pressed);
  if (rest.left || rest.right) f.steer = (rest.right ? 1 : 0) - (rest.left ? 1 : 0);
  return f;
}

/** Run a session for `seconds` with a constant (or per-tick function) input. */
export function run(session, seconds, input = {}, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  const events = [];
  for (let i = 0; i < n; i++) {
    const f = typeof input === 'function' ? input(i, session) : frame(input);
    session.step(dt, f);
    events.push(...session.drainEvents());
  }
  return events;
}
