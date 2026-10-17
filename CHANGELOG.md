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

## Milestone 2 — Physics and tricks

Added
- `src/world/objects.js`: map objects expand into collision primitives: boxes (bench, barrier, wall, curb, ledge, platform, planter, building, car, tree, lamp), kicker, quarter pipe (vert lip), half pipe, bowl (carves the terrain), stairs with grindable handrails, rails (direction + length, optional one-way), rooms with doors, funbox with side rail. Grindable benches/ledges add a hidden ledge rail.
- `src/physics/collide.js`: oriented-footprint solids with face-based push-out and restitution; angle-limited edges for curbs (55°) and stairs (40°); wall slams (> 9 m/s) bail; rails act as thin fences; camera raycast over everything.
- `src/physics/body.js`: ramp launches from lips and kinks, vert air with automatic 180 back onto the ramp, rolling backwards switches to fakie, glancing wall hits deflect the heading.
- `src/rider/tricks.js` + `src/data/tricks.json`: yaw/pitch/board rotation tracking with commit-to-next-multiple, grabs, landing evaluation (spin/flip/board residuals, heading, surface tilt, late grab) with a forgiving multiplier, data-driven names and points (≥ 30 names per vehicle).
- `src/rider/grind.js`: snap window, slope gravity, speed-scaled grind points, balance meter, exits by rail end or ollie, grind names by entry angle (rail vs ledge tables).
- `src/game/session.js`: tricks, grinds, bails, live trick text.
- `src/world/objects-mesh.js`: meshes for every primitive (default, high-contrast and colorblind palettes); `src/ui/hud.js` trick/bail text with icons and words, balance meter.
- Training map now has a kicker, rail, quarter pipe, grindable bench, curb slab, stairs + platform with handrails, barrier and funbox.

Verified
- `npm test` → 77 tests, 77 pass. Highlights: kicker apex heights match the ballistic prediction within 6 cm for 6–11 m/s and grow monotonically (ramp launches consistent with speed); stairs rideable along the axis and blocked at 60°; curb climbable head-on, blocked at a glancing angle; slams bail; bounds hold at 15 m/s in 8 directions; ≥ 30 trick names per vehicle; grind entry window, speed scaling, ollie exit, balance bail.
- `npx playwright test` → 9 passed (Ollie scored via Space; Kickflip via Space + W with live HUD text; FS 180 via D landing fakie; late flip bails with "✖ Bail · under-rotated flip"; rail grind with balance meter; quarter pipe vert air).
- Screenshots checked: obstacles render, board mid-kickflip, grind HUD with balance meter.
- Bugs found and fixed this milestone: BUGS.md #3–#7.
- `npx eslint .` → clean.
