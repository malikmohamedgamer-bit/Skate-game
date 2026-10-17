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

## Milestone 3 — Scoring and currency

Added
- `src/game/scoring.js` (pure): combo count, multiplier `1 + 0.5 × (combo − 1)` capped at **×5** (`COMBO_MULTIPLIER_CAP`), bail resets the combo, combo banks after 3 s on the ground (paused while airborne/grinding).
- `src/game/economy.js` (pure): Bolts. 1 Bolt per 40 trick points (cap 300/run), 2 Bolts per grind second (cap 120/run), 10 per pickup (once per run), level base 25 + first-time star bonuses (40/60/100). `spend()` checks the balance first and can never go negative; balances are sanitized to integers in [0, 999,999,999]. Starting balance 150.
- `src/core/save.js`: schema v3 with step migrations v1 → v2 → v3, field-by-field normalization of hand-edited saves, corrupt/future saves backed up under `boltskate.save.backup`, storage failures never crash (in-memory fallback).
- `src/game/progression.js`: applies session events to the run and profile (score, Bolts, stats, combo end).
- `src/main.js`: restructured around a screen router; profile load/save (every 2 s when dirty, on pause, quit, tab hide); HUD score/combo/Bolts; camera cycle (C) and respawn (R) keys.
- Test fixtures `tests/fixtures/save-v1.json`, `save-v2.json`.

Verified
- `npm test` → 109 tests, 109 pass (scoring 7, economy 10, save 9, progression 6 new).
- Save migration: the v1 fixture loads as schema 3 with coins → Bolts (420), known boards → item ids, equipped board, audio settings and best scores kept.
- `npx playwright test` → 12 passed, including: kickflip raises score and Bolts and the HUD shows both; two ollies give combo 2 / ×1.5 and a bail resets it; Bolts survive a page reload (`saveStatus: current`).
- Screenshot: HUD shows score, "Combo 2 · x1.5", "✔ Clean Kickflip +399 · x1.5", Bolts.
- Bug found and fixed: BUGS.md #8 (grind Bolt float accumulation).
- `npx eslint .` → clean.

## Milestone 4 — Maps and objects

Added
- Four themed JSON maps (plus the training lot): `neighborhood` (Maple Street: road, curbed sidewalks with driveway gaps, houses, porch stairs with handrails, parked cars, kickers, cul-de-sac mini ramp), `skatepark` (two bowls, half pipe, quarter pipe, funbox, kickers, rails incl. a one-way rail, ledges, manual pad, stair set with bank), `plaza` (raised terrace with stairs and a bank, fountain ledge, benches, planters, statue, terrace with 3-stair set, long rail), `downtown` (7 m hill from uptown, terrace crest, jump bump, kickers, quarter pipe, loading-dock stairs). Each has bounds, terrain, spawns, objects, pickups and checkpoints. Maps are listed in `src/world/maps/index.json`.
- Pickups: bolt meshes (bob disabled under reduced motion), collected by passing within 0.8 m of the rider's center, 10 Bolts each, once per run; `pickupFilter` for level-specific sets; high pickups name the ramp they are reached from (`via`).
- Convex-crest launches (`crestLaunch`): riders leave the ground over hill tops when v²κ > g.
- `src/world/reach.js` + `scripts/check-reachability.js` (`npm run check:maps`): grid flood fill with the physics step/angle/ollie rules, then real simulation of a launch from every ramp, a grind on every rail and a launch through every `via` pickup. Report saved to `reports/reachability.txt` / `.json`.
- Title screen lists every map for free roam; visited maps are saved.

Verified
- `npm run check:maps` → 5/5 maps pass: 100% of rideable ground reached on every map; spawns 17/17, ramps launched 24/24, rails grinded 45/45, pickups 67/67, checkpoints 15/15 (full output in `reports/reachability.txt`).
- The checker itself is tested against broken maps (`tests/reach.test.js`): a 3.5 m rail, a spawn sealed in a doorless room, a walled-in kicker, a 6 m pickup and walled stairs are all reported as failures.
- `npm test` → 134 tests, 134 pass.
- `npx playwright test` → 18 passed (each map loads from the menu, renders, is rideable with W, stays in bounds; a pickup adds 10 Bolts and the HUD updates).
- Screenshots of all four maps checked (overview + spawn view).
- Bugs found and fixed: BUGS.md #9, #10.
- `npx eslint .` → clean.

## Milestone 5 — Levels

Added
- `src/data/levels.json`: 16 levels (4 per themed map) using all five objective types: score, trick count, collect pickups, time trial through checkpoints, grind distance. Each has 1–3 star thresholds, a time limit, a spawn, a pickup set and unlock rules (`totalStars`, `level` + `levelStars`). Adding a level is data-only.
- `src/game/levels.js` (pure): validation with readable errors, star rating (time trials: lower is better), level run state machine (ends at the time limit or at 3 stars; checkpoints in order), objective text, unlock state with human-readable reasons, map unlocking by total stars (skatepark 3, plaza 7, downtown 12), result recording (best stars/score/time), next level.
- Menus (`src/ui/menu.js`): main menu, level select grouped by map (lock icon + written reason), free roam with locked maps, pause (resume / retry / settings / controls / quit), results (stars as icons + "n of 3 stars" text, value, Bolts from the run and the level reward, next/retry/levels/menu), how-to-play with the live key bindings. Dialog roles, focus trap, Escape = back.
- Level HUD: objective, progress toward the next star, countdown (rounded up), next-checkpoint distance; checkpoint rings with numbered ticks and beams.
- Level rewards: 25 Bolts base + first-time star bonuses; progress saved.
- Skatepark bowls got exit banks (BUGS.md #11). Vert landings judged on player rotation only (#12, #13).
- `tests/bot.js` + `tests/level-plans.js`: a scripted bot that plays each level through the real simulation with normal inputs.

Verified
- `npm test` → 165 tests, 165 pass, including `tests/levels.test.js` (12) and `tests/level-feasibility.test.js` (19): **every level earns ≥ 1 star by bot play**, the three time trials also on the scooter.
- `npx playwright test` → 23 passed. New: play a level from the menu (objective HUD, Escape pause, Retry resets time, Quit to menu); a locked level explains why and does not start; completing First Push shows stars, the level reward, saves progress and "Next: Bolt Run" starts it; failing a time trial shows 0 stars + Retry; **pause/retry/quit checked in all 16 levels**.
- `npm run check:maps` → 5/5 maps pass after the bowl banks.
- Screenshots: level select (locks + reasons), level HUD, time-trial checkpoints, results.
- Bugs found and fixed: BUGS.md #11–#14.
- `npx eslint .` → clean.
