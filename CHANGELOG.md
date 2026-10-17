# Changelog

Each milestone lists what changed and exactly how it was verified.

## Milestone 1 — Core rider and camera

Added
- Project scaffolding: `package.json` (pinned dev deps: ESLint 9.39.5, Playwright 1.56.1), zero-dependency static dev server `scripts/serve.js` (`npm run dev`), ESLint flat config, Playwright config.
- Three.js r170 (`three@0.170.0`) vendored at `vendor/three/three.module.min.js`, loaded through an import map. No bundler, no build step.
- `src/core/loop.js`: fixed 60 Hz timestep with accumulator, max-substep clamp, time scale (for the slow game speed option), manual stepping for tests.
- `src/core/input.js`: keyboard (by physical `event.code`), mouse, gamepad polling, a virtual channel for touch, remappable bindings with conflict detection, swap, reserved/locked keys and one-handed presets.
- `src/physics/body.js`: push-and-coast (skateboard) and kick-with-cooldown (scooter) pushing, speed-dependent steering, hold-to-brake, rolling friction, side grip, slope gravity, ollie with speed/stat-based height, airborne integration, landing, bail state.
- `src/physics/collide.js`: ground queries, solid push-out, rails as thin fences, bounds clamp, camera raycast (objects are added in milestone 2).
- `src/world/terrain.js`, `src/world/map.js`: terrain height functions and JSON map validation. `src/world/maps/training.json` flat test lot.
- `src/rider/rider.js`: primitive-built skateboard, scooter and rider, with crouch/push/lean/grab/bail poses, wheel spin and speed trail.
- `src/core/camera.js`: smooth third-person follow, smoothing setting (0 = off), raycast wall avoidance, close and top-down modes, FOV kick disabled under reduced motion.
- `src/main.js`: boot, title screen, free roam, pause/resume, `window.__game` test hook.

Verified
- `npm test` → 32 tests, 32 pass (loop, body, input, camera).
- `npx playwright test` → 3 passed: rider accelerates with real `KeyW` presses and the camera follows; `KeyD` steers; `Shift` brakes to a stop; the real-time rAF loop advances; Escape pauses (tick count frozen) and Resume continues.
- Manual screenshot check in headless Chromium: ground, fence, rider and shadow render; title screen shows a visible focus ring.
- `npx eslint .` → clean.
