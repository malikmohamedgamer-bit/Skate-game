# Verification

What was tested, how, and what happened. **Pass** means the check ran and
passed, with its output recorded here or in [CHANGELOG.md](CHANGELOG.md).
**Fail** means it ran and failed. **Unverified** means it could not be run in
this environment, so the feature is implemented but nobody has checked it.

## Environment

- Linux container (no display, no GPU, no audio device, no touch hardware).
- Node.js 22.22.0, Playwright 1.56.1, headless Chromium 141.0.7390.37 with
  **software WebGL** (SwiftShader).
- No Firefox, Safari/WebKit, real phone, gamepad, screen reader or speakers
  were available.

## Final run (milestone 9, on the committed code)

| Command | Result |
|---|---|
| `npm run lint` (ESLint 9, `eslint.config.js`) | Pass: no errors, no warnings |
| `npm test` (unit tests, Node test runner) | Pass: 208 tests, 208 pass, 0 fail (about 5 s) |
| `npm run check:maps` (reachability, every map) | Pass: 5/5 maps (`reports/reachability.txt`) |
| `npm run test:e2e` (Playwright, headless Chromium) | Pass: 49 passed, 0 failed (3.0 min) |
| `npm run test:soak` (5 min random play ×2, 42 restarts, 60 s real-time) | Pass: 4 passed, 0 failed (8.3 min) |
| Clean install → `npm install` → dev server → play | Pass: the files being committed (`git ls-files`) were copied into an empty directory; `npm install` reported 0 vulnerabilities; the dev server ran on port 5302; Free roam → Training Lot from the menu, rode with W, no console errors |

The soak test numbers are in `reports/soak-maps.json`, `reports/soak-session.json`,
`reports/soak-objects.json` and `reports/soak-realtime.json`. The reachability
report is in `reports/reachability.txt`.

## Features

### Setup and technology

| Feature | How tested | Result | Notes |
|---|---|---|---|
| `npm install && npm run dev` | The committed files were copied into an empty directory, then `npm install`, the dev server, and a Playwright boot-and-ride check against it (see the final run table). | Pass | The dev server is plain Node with no dependencies. |
| Vanilla JS ES modules, no build step | Every e2e test loads the raw `src/` files through `scripts/serve.js`. | Pass | |
| Three.js pinned | r170 vendored in `vendor/three/` and loaded through the import map. A browser check while starting all five maps logged 46 requests, 0 to any host other than localhost. | Pass | So no CDN is needed. Running fully offline was not tested separately. |
| Custom physics, no engine | Unit tests `body` (11) and `physics` (18). | Pass | |
| Fixed-timestep loop, game speed | `loop.test.js` (5); `a11y.test.js` (slow speed = 30 ticks per second); e2e "real-time loop advances". | Pass | Below 12 fps the loop's catch-up limit (5 ticks per frame) slows the game rather than spiralling. The real-time soak ran at 7.7 fps under software WebGL, so simulation ran at about 0.6× real time (36 simulated seconds in 60 s). |
| localStorage save, schema version, migration | `save.test.js` (10): v1 and v2 fixtures, round trip, corrupt JSON with backup, field-by-field repair, future version, throwing storage, camera modes. e2e `save.spec.js` boots the real game on the v1 fixture: `saveStatus: migrated`, 420 Bolts, board kept, written back as schema 3, next load is `current`. | Pass | |

### Rider, physics and tricks

| Feature | How tested | Result | Notes |
|---|---|---|---|
| Skateboard and scooter with data-driven handling | `body.test.js`, `customize.test.js` (stats from `vehicles.json` plus parts, clamped); e2e "buy the scooter, switch vehicles, and ride it". | Pass | |
| Push (W/↑), steer (A/D), brake (Shift/S), ollie (Space/J) | e2e `core.spec.js`, `tricks.spec.js` and `journey.spec.js` with real key presses; `input.test.js` (bindings). | Pass | |
| Air spins and flips with rotation tracking | `tricks.test.js` (18): commit to the next 180 or 360, residuals, FS 180 to fakie, FS 360 kickflip; e2e kickflip, FS 180, swipe flip. | Pass | |
| Landing tolerance, bails | Unit: late flip bails, heading and roll limits, late grab, forgiving ×2. e2e: "late flip bails and the HUD says Bail with a reason". | Pass | |
| 30+ named tricks from data | `tricks.test.js` › "at least 30 distinct named tricks per vehicle": 1,014 names per vehicle. | Pass | `tricks.json` hand-names **26 base tricks for the skateboard and 21 for the scooter** (grinds included). The rest are combinations built from that data, for example "FS 360 Varial Kickflip Indy", each with data-driven points. Not every combination is physically reachable in one jump; tests land a sample. |
| Grinds | `grind.test.js` (9): snap window, speed scaling, balance bail, ollie exit, rail end; e2e "grind the training rail". | Pass | |
| Ramps launch consistently with speed | `physics.test.js`: kicker apex matches the ballistic prediction within 6 cm for 6–11 m/s and rises with speed; crest launches. | Pass | |
| Quarter and half pipes, bowls | Unit vert tests; e2e "quarter pipe: vert air and back down without bailing"; the reachability checker launches all 24 ramps. | Pass | |
| Benches, stairs and curbs only at the right angle | `physics.test.js`: stairs rideable along their axis and blocked at 60°; curbs climbable head-on and blocked at a glancing angle; grindable bench edges. | Pass | |
| Map bounds | Unit: bounds hold at 15 m/s in 8 directions. Bot: 0 out-of-bounds ticks on all 16 levels. Soak: 0 out-of-bounds ticks and 0 safety resets in 10 min of simulated random play plus 60 s real time. | Pass | |
| Follow camera with wall raycast and smoothing setting | `camera.test.js` (8): smoothing 0 = snap, wall pulls the camera in; e2e: the camera follows the rider. | Pass | |
| First-person and top-down camera modes | `camera.test.js`: first-person eye at head height, no lag; e2e `core.spec.js` › "camera: C cycles …" shows the first-person body hidden and the top-down camera high; screenshots. | Pass | First person was missing until milestone 9 (BUGS.md #23). |

### Scoring and economy

| Feature | How tested | Result | Notes |
|---|---|---|---|
| Pure scoring, documented combo cap ×5 | `scoring.test.js` (7): the multiplier steps, the cap at ×5, a bail resets the combo, the window pauses in the air; e2e "combo: consecutive clean tricks multiply; a bail resets the combo". | Pass | The rules are in the README under Scoring and in the `scoring.js` header. |
| Score changes when a trick lands | e2e `score.spec.js`, `journey.spec.js`. | Pass | |
| Bolts never negative, earn caps | `economy.test.js` (10): per-run caps for tricks and grinding, each pickup paid once per run, spending never below 0, invalid amounts ignored; `customize.test.js`: every item at many balances never goes negative. | Pass | |
| Currency increases | e2e: a trick raises Bolts (the journey test subtracts quest rewards); pickups +10; level rewards. | Pass | |
| Shop: buy with enough, balance drops, refused without enough | e2e `shop.spec.js` and `journey.spec.js` (150 → 70 for the Street Deck; Pro Model refused with "Not enough Bolts"). | Pass | |

### Customization

| Feature | How tested | Result | Notes |
|---|---|---|---|
| Parts with stat effects | `customize.test.js`; e2e: equipping a deck changes in-game `jump` by +0.25. | Pass | |
| Colours and patterns | e2e: Sky Blue + Stripes change the preview model and pixels; pattern sheet screenshot. | Pass | |
| 3D preview updates | e2e: equip and recolour change the preview's model description and pixel fingerprint. | Pass | |
| Cheapest item always buyable | `customize.test.js` › "a new player can always buy the cheapest item" (60 ≤ 150), and a broke player can earn it in one run. | Pass | |
| Cosmetic outfits and helmets | `customize.test.js` (no stat change); shop preview screenshots. | Pass | |

### Quests

| Feature | How tested | Result | Notes |
|---|---|---|---|
| ≥ 25 quests: daily, story, challenge | `quests.test.js` (14): 32 quests (12 story, 8 daily, 12 challenge), valid data, all goal kinds. | Pass | |
| Pure quest logic | Unit tests run in Node with no DOM. | Pass | |
| Complete a quest from play | e2e: reaching 15 km/h completes "Roll Out" (`quests.spec.js`, `journey.spec.js`). | Pass | |
| Reward granted once | Unit (`claimRewards`); e2e: more speed, a new session and a reload grant nothing again. | Pass | |
| Dailies rotate by date | Unit plus e2e with an overridden clock. | Pass | No real midnight rollover was waited for. |

### Levels and maps

| Feature | How tested | Result | Notes |
|---|---|---|---|
| ≥ 12 levels across maps, 5 objective types, stars | `levels.test.js` (12): 16 levels, all 5 types, star order, validation messages. | Pass | |
| Every level is completable | `level-feasibility.test.js`: a bot earns ≥ 1 star on all 16 levels through the real simulation, and on the 3 time trials with the scooter too. | Pass | The bot proves feasibility, not difficulty or fun. Thresholds were tuned from bot runs, not by human playtesters. |
| Data-only additions | Levels, quests, tricks, items and maps are JSON and validated by tests; the README explains how to add them. | Pass | |
| Pause, retry and quit in every level | e2e `levels.spec.js` › "pause, retry and quit work in every level" (all 16). | Pass | |
| ≥ 4 JSON maps (neighbourhood, skatepark with bowls and rails, plaza with stairs and benches, hilly downtown) | `maps.test.js` (10): required features per map; e2e: each map loads from the menu and is rideable; screenshots. | Pass | Plus the training lot. |
| Reachability script on every map | `npm run check:maps`: 5/5 maps, 100% of rideable ground reached, and every spawn, ramp, rail, pickup and checkpoint confirmed. `reach.test.js` proves it catches broken maps. | Pass | |

### Accessibility and touch

| Feature | How tested | Result | Notes |
|---|---|---|---|
| Reduced motion | e2e: FOV stays at 62 at speed, CSS animations off; unit: on by default when the OS asks for it. | Pass | |
| High contrast, colourblind palette | e2e: body classes and the 3D scene palette change; screenshots; unit: pattern accents keep a contrast ratio of at least 3:1. | Pass | Not reviewed by colourblind users or with a CVD simulator. |
| Text scale | e2e: 150% gives a 24 px root text size. | Pass | |
| Keyboard navigation, visible focus | e2e: Tab and Shift+Tab, focus outline of at least 3 px, Enter, Space, Escape, focus trap, shop and quest tabs by arrow keys. | Pass | |
| Remapping with conflict detection | e2e: remap Ollie, conflict found and swapped, reserved keys refused; `input.test.js`. | Pass | |
| One-handed mode | e2e: keyboard presets and one-handed touch layouts. | Pass | |
| Game speed, forgiving landings | e2e and unit. | Pass | |
| ARIA live announcements | e2e reads `#sr-polite` and `#sr-assertive`: tricks, Bolts, quests, results; unit tests throttling. | Pass (content) | **Unverified with a real screen reader** (NVDA, JAWS, VoiceOver, TalkBack). |
| Captions | e2e: captions appear for cues, and a bail is captioned "[crash]", not "[clean landing]". | Pass | |
| Sound | Unit: every information-carrying cue has a caption. | Unverified | Headless Chromium has no audio output, so nobody heard the synthesized sounds. |
| ≥ 44 px touch targets | Unit (every layout and scale) and e2e bounding boxes on an emulated 844×390 phone. | Pass | |
| Nothing by colour alone | Bails show "✖ Bail" plus a reason, stars as text, "Equipped" and "Owned" labels; asserted in e2e. | Pass | |
| Touch controls, swipe-up ollie | e2e `touch.spec.js` (7): real `touchscreen.tap`, held buttons, swipes. | Pass (emulated) | **Unverified on real phones and tablets.** Chromium's touch emulation is not iOS Safari or Android Chrome. Each finger gets its own pointer ID, but fingers are tested one at a time; simultaneous two-thumb input was not tested. |
| Landscape by default, rotate prompt | e2e: portrait shows the prompt and pauses. | Pass (emulated) | Real device rotation was not tested. |
| No scroll, zoom or back gesture | e2e: no scroll after swipes; `touch-action: none`, `overscroll-behavior: none`, `user-scalable=no`. | Partial | The page-level guards are verified. iOS Safari's edge-swipe "back" cannot be fully blocked by a web page, and it was not tested on a device. |
| Gamepad | e2e `gamepad.spec.js` with a scripted `navigator.getGamepads()` pad: RT push, stick steer, A ollie, stick-up kickflip, LT brake, Start pause. | Pass (emulated) | **Unverified with a physical controller.** |

### Robustness (soak test)

| Check | How tested | Result | Notes |
|---|---|---|---|
| Console errors over long play | `soak.spec.js`: four runs: 5 min across all maps (seed 9001), 5 min in one session (seed 9002), 42 restarts, and 60 s real time (seed 9003). Result: 0 console errors, 0 page errors, 0 errors caught by the game, 0 console warnings. | Pass | |
| Memory growth | JS heap after forced GC (CDP `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage`). One session: 6.18, 6.38, 6.29, 6.43 and 6.41 MB at minutes 1–5. Map rotation: 4.98 MB on a fresh training map, 6.34 MB back on training after all five maps (+1.36 MB; the limit is 8 MB). 42 restarts: Object3D, geometry, material, texture, Map and DOM element counts were identical before and after, and the heap went 6.00 → 6.25 → 6.32 MB. | Pass | Flat within a session and across restarts after warm-up. The +1.36 MB over the first map rotation includes warm-up (compiled code, caches, quest state) and is not fully explained, but the census found no leaked objects. |
| Rider leaving bounds | Every 0.25 s of simulated time: position within the map box, finite numbers, the session's out-of-bounds tick counter at 0, no safety resets. | Pass: 0 out-of-bounds ticks, 0 safety resets, 0 m outside the box at any check | |
| GPU resource leak | Found by the soak test and fixed: every session leaked its ground texture (BUGS.md #22). Now `gpuAudit()` shows the renderer holding exactly what the scene uses after every map. | Pass | |

### Code quality

| Check | How tested | Result | Notes |
|---|---|---|---|
| ESLint, bug-indicating warnings fixed | `npm run lint` with no warnings. A one-off stricter pass (`no-shadow`, `no-loop-func`, `array-callback-return`, `consistent-return` and more) gave 18 warnings. On review, none were bugs: deliberate `page.evaluate` parameter names, closures that intentionally read the latest shop state, and `!!x` style coercions. | Pass | |
| BUGS.md | 23 entries; each is marked Fixed only with a test or check named as proof. | Pass | |

## What could not be verified here

These need real hardware or people, and none were available:

1. **Real GPUs and frame rate.** Everything ran on software WebGL. Performance on real laptops and phones is unknown. The real-time soak reached 7.7 fps on SwiftShader at 1280×720 with shadows, which says nothing about real hardware.
2. **Real touch devices.** iOS Safari and Android Chrome were not tested, including gestures, safe areas, rotation, and iOS edge-swipe back.
3. **Other browsers.** Only Chromium was installed. Firefox and Safari were not tested.
4. **Screen readers.** The live-region text is verified, but not how NVDA, JAWS, VoiceOver or TalkBack read it.
5. **Audio output.** Cues and captions fire, but nobody heard the sounds.
6. **Physical gamepads.** Only a scripted Gamepad API object was used.
7. **Game feel and difficulty.** Tuning was done with simulations, a scripted bot and screenshots. No human has played it, so the scoring balance, level difficulty and fun are unproven.
8. **Very long sessions.** The soak test covers 10 minutes of simulated play plus 42 restarts. Hours of play were not tested.
