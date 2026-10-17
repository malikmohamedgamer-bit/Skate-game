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
