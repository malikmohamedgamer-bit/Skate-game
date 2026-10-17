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

## Milestone 6 — Quests

Added
- `src/data/quests.json`: 32 quests — 12 story (ordered chain), 8 daily (3 picked per local day, deterministic by date), 12 challenges (one-time). Goal kinds: clean tricks (with trick-name / spin / vehicle filters), reach speed, grind seconds, combo, pickups, finish a level (level + stars), buy items, visit maps (distinct), run score, airtime.
- `src/game/quests.js` (pure): daily pick and reset by device date, story chain activation, event → progress (count vs. best-value goals), completion, `claimRewards` (each completion rewarded once), catch-up sync with profile facts (never for dailies), quest view, validation.
- Progression routes gameplay events to quests (tricks, combos, run score, grind time, pickups, speed rises ≥ 0.5 km/h); main sends map visits and level finishes. Rewards are credited automatically and announced (toast + screen reader).
- `src/ui/quests-ui.js`: quest log with Story / Daily / Challenges tabs (WAI-ARIA tabs: arrows/Home/End), progress bars with `aria-valuetext`, status icon + word. HUD tracker shows up to 3 active quests.
- Save normalizer keeps quest `seen` lists and days.

Verified
- `npm test` → 179 tests, 179 pass (14 new quest tests: ≥ 25 quests of all types and kinds, valid data, daily rotation/reset by date, ordered story chain, filters, distinct maps, stars, **reward exactly once**, re-earnable dailies, persistence round trip).
- `npx playwright test` → 26 passed. New: reaching 15 km/h with W completes "Roll Out", +30 Bolts exactly once (more speed and a page reload do not re-grant); quest log tabs by keyboard; dailies change when the device date changes.
- Screenshots: quest log, HUD tracker (after layout fix).
- Bugs: BUGS.md #15, #16.
- `npx eslint .` → clean.

## Milestone 7 — Customization and shop

Added
- `src/data/catalog.json`: 13 categories (boards & scooters; skateboard decks, trucks, wheels, grip tape; scooter decks, bars, wheels, forks; outfits, helmets, pads, trails), 48 items (this entry originally said 49; corrected in milestone 9). Parts carry stat modifiers (decks → ollie, trucks/bars → turn rate, wheels → grip and speed, forks → grip, grip tape → trick bonus); outfits, helmets, pads and trails are cosmetic. 12 named colors (with an Okabe-Ito colorblind-safe subset) and 7 named patterns.
- `src/game/customize.js` (pure): buy (balance checked first via `economy.spend`), equip (ownership + slot), stats from base + parts with clamps, stat deltas for previews, validated colors/patterns, contrast-based pattern accents, and the look object for the 3D model.
- `src/ui/shop.js`: category tabs, item cards with price/owned/equipped text, Buy / Equip / Preview, hover/focus "try on", stat bars with ▲/▼ deltas, **live 3D preview of the real rider model** (one reused WebGL canvas, rotate buttons, auto-rotate off under reduced motion), color swatches by name with `aria-pressed`, custom color input, named pattern buttons.
- Equipped gear is saved and applied in game (handling stats + rider look); the scooter is bought in the shop and changes the push style and tricks.
- Rider model: knee/elbow pads; preview starts in the riding pose (BUGS.md #17).

Verified
- `npm test` → 193 tests, 193 pass (14 new: catalog coverage, starter loadout, stat effects, **cheapest item affordable with the starting balance**, a broke player can earn the cheapest item in one run, buy never goes negative across every item and many balances, equip rules, stats/clamps, colors, look).
- `npx playwright test` → 29 passed. New: buying the Street Deck drops Bolts 150 → 70; Pro Model is refused with "Not enough Bolts"; Equip rebuilds the preview (deck color and pixel fingerprint change); color + pattern change the preview; the in-game rider and stats use the deck; everything survives a reload; buying/equipping the scooter switches vehicles; the shop works by keyboard.
- Screenshots: shop with try-on deltas, skateboard (helmet, pads, hoodie) and scooter previews, pattern sheet (BUGS.md #1 verified).
- `npx eslint .` → clean.

## Milestone 8 — Accessibility and touch

Added
- `src/ui/a11y.js`: settings → body classes / CSS variables (reduced motion, high contrast, colorblind-safe, text scale, touch scale); OS `prefers-reduced-motion` is the default for new players; throttled screen reader announcer (merges rapid tricks, assertive results first).
- `src/core/audio.js`: synthesized sound effects (WebAudio, no files), rolling and grind loops, mute and volume, captions for every cue that carries information.
- Settings screen (`src/ui/menu.js`, from the main menu and the pause menu): reduced motion, high contrast, colorblind palette, text size 80–200%, captions, announcements, quest tracker, game speed (100/75/50%), forgiving landings, auto-push, camera view/smoothing (0 = off)/shake, mute/volume, touch controls (auto/on/off), touch layout (two thumbs / one-handed left / right), button size (normal/large/extra large), swipe steering, shadows. All native labelled controls.
- Key remapping for every action: press-a-key capture, conflict detection with Swap / Cancel, reserved keys (Tab/Enter) and locked Escape explained, reset, one-handed keyboard presets (left/right).
- `src/ui/touch.js`: on-screen steer/push/brake/ollie/trick buttons (≥ 44 px, enlargeable), swipe up = ollie, swipes in the air = flips/spins, optional swipe steering, multi-touch, no scroll/zoom/back gesture; rotate prompt in portrait (pauses play).
- High contrast / colorblind palettes rebuild the 3D scene on resume; gamepad menu navigation; compact HUD on short screens.
- Announcements: tricks, bails, Bolts (aggregated), quests, checkpoints, timer warning, level results (assertive).

Verified
- `npm test` → 205 tests, 205 pass (12 new: presentation, reduced-motion default, announcement throttling, touch sizes ≥ 44 px in every layout/scale, one-handed layouts, swipe classification and mapping, captions, settings normalization, slow game speed).
- `npx playwright test` → 44 passed. New `e2e/a11y.spec.js` (8): keyboard-only menus with ≥ 3 px focus outlines, Enter/Space/Escape, focus trap; remap Ollie to L then W with conflict + swap and use the new keys in game; reserved Tab refused; one-handed preset; reduced motion keeps FOV at 62; text 150% = 24 px; slow speed = 30 ticks per second; forgiving landings; high-contrast scene; announcements and captions; every settings control has a name; bail text/caption regression. New `e2e/touch.spec.js` (7, emulated phone): controls only in play, every button ≥ 44×44; real touchscreen tap ollies; hold push/steer/brake; swipe up ollies and flips in the air; enlarge + one-handed layout; portrait rotate prompt pauses; page never scrolls.
- Screenshots: settings, phone touch layouts (two thumbs and one-handed), high contrast, colorblind palette with captions.
- Bugs: BUGS.md #18–#21.
- `npx eslint .` → clean.

## Milestone 9 — Tests and bug fixes

Added
- Soak test `e2e/soak.spec.js` (`npm run test:soak`, config `playwright.soak.config.js`). Four parts, all with seeded random key presses (push, steer, brake, ollie, flips, spins, grabs, respawn, camera changes, pause and resume):
  - 5 minutes of simulated play rotating through all five maps;
  - 5 minutes in one skatepark session, sampled every minute;
  - 42 session restarts with a live-object census;
  - 60 s of real-time play on the requestAnimationFrame loop.

  Every 0.25 s it checks: still playing, finite position and velocity, inside the map box, no out-of-bounds ticks, and no errors. It also measures the JS heap after GC and the GPU resources the renderer holds. Reports go to `reports/soak-*.json`.
- `window.__game.gpuAudit()`: draws the whole scene once with hidden objects shown and no frustum culling, then compares the renderer's live geometries and textures with what the scene references. `renderInfo()`, rider `safetyResets`, map `bounds` and `riderBodyVisible` were also added to the test hook.
- `e2e/journey.spec.js`: the required e2e checklist as one player journey, in order, through the menus with real keys. That is: load, start a level, push, ollie, land a kickflip, score changes, Bolts increase from the trick, buy with enough Bolts, balance drops by the price, equip, preview updates, quest completed, reward granted once (including across a new session and a reload).
- `e2e/save.spec.js`: the schema v1 fixture boots the real game, migrates, and is written back as schema 3.
- `e2e/gamepad.spec.js`: gamepad mapping through a scripted `navigator.getGamepads()` pad.
- First-person camera mode (BUGS.md #23). C cycles follow → close → first person → top-down; the rider's body is hidden in first person.
- `e2e/maps.spec.js` › "switching maps releases GPU resources" (regression test for BUGS.md #22).
- README.md (setup, controls, rules, adding maps, levels and data, tests) and VERIFICATION.md (feature / how tested / result / notes, plus what could not be verified).

Fixed
- BUGS.md #22: every new session leaked GPU textures (ground texture and shadow map not disposed).
- BUGS.md #23: no true first-person camera.
- Corrected the milestone 7 entry: the catalog has 48 items, not 49.

Verified
- `npm run lint` → clean (no errors or warnings). A one-off stricter ESLint pass gave 18 warnings; on review none were bugs (see VERIFICATION.md).
- `npm test` → 208 tests, 208 pass (new: two first-person camera tests and a camera-mode save test).
- `npm run check:maps` → 5/5 maps pass.
- `npm run test:e2e` → 49 passed (new: journey, v1 save migration, gamepad, camera modes, GPU release on map switch).
- `npm run test:soak` → 4 passed in 8.3 min:
  - 300 s across all maps: 0 errors and 0 warnings; 0 out-of-bounds ticks and 0 safety resets; GPU geometries and textures equal to the scene's after every map; heap 4.98 → 6.34 MB.
  - 300 s in one session: heap 6.18–6.43 MB, flat after minute 1; 730 m ridden, 31 tricks, 91 bails.
  - 42 restarts: live object counts identical.
  - 60 s real time: 7.7 fps on SwiftShader, 0 errors.
- The regression test for #22 fails without the fix (expected 2 textures, received 13) and passes with it.
- Clean install: the files to be committed were copied into an empty directory; `npm install` and `npm run dev` worked there, and the game was played from the menu with no console errors.
- A browser check while starting all five maps made 46 requests, none to an external host.
- Screenshots: first-person view (skatepark, plaza) and the clean-install game.
