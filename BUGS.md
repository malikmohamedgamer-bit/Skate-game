# Bug log

Every bug found during development: symptom, cause, fix, and the test or check
that proves the fix. A bug is only marked **Fixed** once that proof has run.

| # | Status | Found by |
|---|--------|----------|
| 1 | Fixed | Code review (M1) |
| 2 | Fixed | Code review (M1) |
| 3 | Fixed | Simulation probe (M2) |
| 4 | Fixed | Simulation probe (M2) |
| 5 | Fixed | Simulation probe (M2) |
| 6 | Fixed | Unit test (M2) |
| 7 | Fixed | Browser check (M2) |
| 8 | Fixed | Unit test (M3) |
| 9 | Fixed | Design review of downtown map (M4) |
| 10 | Fixed | Unit test (M4) |
| 11 | Fixed | Level bot (M5) |
| 12 | Fixed | Level bot (M5) |
| 13 | Fixed | Level bot (M5) |
| 14 | Fixed | E2E test (M5) |
| 15 | Fixed | Code review (M6) |
| 16 | Fixed | Screenshot check (M6) |

## 1. Zigzag deck pattern drew a straight line
- **Symptom:** the "zigzag" part pattern rendered as a flat stripe.
- **Cause:** operator precedence in `g.lineTo(x, y + (x / 16) % 2 === 0 ? y : y + 14)` — the ternary condition was `(y + ...) === 0`, which is always false.
- **Fix:** `g.lineTo(x, (x / 16) % 2 === 0 ? y : y + 14)` in `src/rider/rider.js`.
- **Proof:** see milestone 7 (shop preview screenshot of the zigzag pattern) — verified there.

## 2. Per-frame allocations in the scooter flip pose
- **Symptom:** none visible yet; would cause steady garbage growth during scooter flips.
- **Cause:** `rider.update()` created a `THREE.Group` and a `THREE.Vector3` every frame in the scooter flip branch.
- **Fix:** removed the stray group; reuse a module-level `X_AXIS` vector.
- **Proof:** soak test memory check (milestone 9).

## 3. Riding up stairs at an allowed angle got blocked by the platform edge
- **Symptom:** climbing the training stairs at 30° (limit is 40°) bounced off the platform one step before the top.
- **Cause:** the wall check in `resolveSolids` compared the platform top against the rider's feet height from the *previous* step. Stair treads (0.34 m) are narrower than the rider (0.6 m), so the rider's edge reached the platform while the stale height was two steps down.
- **Fix:** compute the height the rider will stand at this tick (`standY` from `groundAt`) and use it for every solid except the one being stepped onto (which keeps the angle rule). `src/physics/collide.js`.
- **Proof:** `tests/physics.test.js` › "stairs: rideable along the axis (up and down), blocked at a steep side angle" — passes.

## 4. Scraping along a curb or wall bled almost all speed
- **Symptom:** a glancing hit on the curb dropped speed from 6 m/s to 0.3 m/s.
- **Cause:** after the wall reflected the velocity, the board heading still pointed into the wall, so grip steered the rider back into it every tick and wall friction was applied again and again.
- **Fix:** grounded wall hits now deflect the heading along the reflected velocity (`src/physics/body.js`).
- **Proof:** `tests/physics.test.js` › "curb: rideable straight on, blocked at a glancing angle (keeps rolling along it)" asserts > 4 m/s after the hit — passes.

## 5. Funbox rail blocked riding straight over the funbox
- **Symptom:** rolling over the funbox at its center bounced the rider back.
- **Cause:** the optional funbox rail was generated on the center line, so it acted as a fence across the riding line.
- **Fix:** the rail is offset to one side of the deck (`railOffset`, default `w/2 - 0.3`) in `src/world/objects.js`.
- **Proof:** `tests/physics.test.js` › "funbox: roll up one kicker, across the deck and down the other side" — passes.

## 6. Airborne without trick state skipped tricks and grinds
- **Symptom:** a rider who became airborne without an `airborne` event (e.g. recovering from a bail mid-air) could not trick or lock onto rails.
- **Cause:** `session.step` only ran air tricks / grind snapping when `s.air` existed, and only the `airborne` event created it.
- **Fix:** the session starts trick tracking whenever the body is airborne without it (`src/game/session.js`).
- **Proof:** `tests/grind.test.js` › "perpendicular entry is a boardslide", "balance: ...", "downhill handrail ..." (they start the body airborne directly) — pass.

## 7. Live trick name missing while mid-rotation
- **Symptom:** during a kickflip the HUD showed nothing until landing.
- **Cause:** the live text described the *current* rotation (e.g. 147° → rounds to 0 flips).
- **Fix:** the live text describes the committed rotation targets plus any grab being held (`session.currentTrickText`).
- **Proof:** `e2e/tricks.spec.js` › "kickflip: ... live trick name shows while flipping" asserts the HUD contains "Kickflip" mid-air — passes.

## 8. A full second of grinding paid 1 Bolt instead of 2
- **Symptom:** `earnFromGrind` called 60 times with `dt = 1/60` returned 1 Bolt in total.
- **Cause:** floating-point accumulation: the remainder summed to 0.99999…, and `Math.floor` dropped it.
- **Fix:** floor with a small epsilon (`Math.floor(total + 1e-9)`) and clamp the remainder at 0 (`src/game/economy.js`).
- **Proof:** `tests/economy.test.js` › "grinding earns per second, capped per run" and `tests/progression.test.js` › "grind time Bolts are paid when the grind scores" — both pass.

## 9. Riders could never catch air off a smooth hill crest
- **Symptom:** at any speed, rolling over a convex hill top kept the rider glued to the ground.
- **Cause:** the grounded step re-snapped the rider to the surface every tick; the only launch conditions were a big height gap (ledge/lip) or a sharp kink.
- **Fix:** `crestLaunch()` in `src/physics/body.js` launches when v²·κ (curvature estimated from the normal change per tick) exceeds g·nᵧ.
- **Proof:** `tests/maps.test.js` › "crest launch: fast over a convex hill top leaves the ground, slow stays down" and "downtown: bombing the hill builds speed and the bump launches you" (≥ 3 airs, no bail) — pass.

## 10. Skatepark and downtown were missing required object types
- **Symptom:** the skatepark had no barriers and downtown had no stairs, although every map must contain ramps, rails, benches, stairs, barriers and pickups.
- **Cause:** map authoring oversight.
- **Fix:** added jersey barriers and a planter to the skatepark; a loading dock with a 6-step stair set and handrails to downtown.
- **Proof:** `tests/maps.test.js` › 'map "…" has bounds, ground, spawns and ramps, rails, benches, stairs, barriers and pickups' for all four maps; `npm run check:maps` still passes (both new handrails grinded in simulation).

## 11. Bowls were inescapable
- **Symptom:** the level bot (and a player) could drop into a bowl but never get out: every attempt up the near-vertical wall became a vert air back into the bowl.
- **Cause:** bowl walls are vert transitions on every side and there was no lower exit.
- **Fix:** each skatepark bowl has an exit bank (a kicker from the bowl floor up to the coping) in `src/world/maps/skatepark.json`.
- **Proof:** `tests/level-feasibility.test.js` › level s3 "Bowl Hunter" (bot rides into and out of both bowls) and `npm run check:maps` (banks launched) — pass.

## 12. Vert airs taken at an angle bailed as "landed sideways"
- **Symptom:** carving up a quarter pipe or bowl wall diagonally and coming straight back down bailed.
- **Cause:** the automatic vert 180 turned the board to the reverse of the takeoff heading, but a diagonal vert air keeps its sideways velocity, so the landing line is mirrored, not reversed; the heading check then failed.
- **Fix:** on vert landings only the player's own rotation is judged; the board follows the landing line (`ignoreHeading` for vert in `session.handleLanding`; fakie decided by spin parity).
- **Proof:** level bot runs n2 and s3 no longer bail; `tests/physics.test.js` › quarter pipe vert test still passes.

## 13. Slow vert hops on a bowl wall bailed as "landed on a tilt"
- **Symptom:** repeated "landed on a tilt" bails while pushing into a bowl wall.
- **Cause:** with almost no horizontal speed, the tilt check fell back to the board facing, which can be across the wall.
- **Fix:** vert landings measure tilt along the surface fall line and settle the heading down it.
- **Proof:** level bot run s3 has 0 bails; `tests/level-feasibility.test.js` passes.

## 14. Level countdown showed 1:29 at the start of a 90 s level
- **Symptom:** the timer dropped a second immediately.
- **Cause:** remaining time was floored (89.95 s → 1:29).
- **Fix:** countdowns round up (`formatTime` in `src/main.js`).
- **Proof:** `e2e/levels.spec.js` › "play a level from the menu ..." asserts the HUD shows 1:30 — passes.

## 15. Daily "finish any level" quest would auto-complete from history
- **Symptom (caught before release):** catching quests up with the profile would have re-applied every level ever finished, completing the daily "Level Up" quest instantly every day.
- **Cause:** `syncQuestsWithProfile` applied history to all quest types.
- **Fix:** the sync skips daily quests (`src/game/quests.js`).
- **Proof:** `tests/quests.test.js` › "syncing with the profile catches up map/level quests but never dailies" — passes.

## 16. HUD quest tracker overlapped the Pause button
- **Symptom:** in a screenshot the tracker box covered the Pause button.
- **Cause:** the tracker was absolutely positioned at a fixed offset, but the stats box above it is taller when the Pause button wraps.
- **Fix:** the right-hand HUD boxes now stack in a flex column (`.hud-right`).
- **Proof:** screenshot after the fix shows the tracker below the stats box; `e2e/quests.spec.js` checks the tracker text.
