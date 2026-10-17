# Bolt Skate

A 3D skateboarding and scootering game for the browser, in the spirit of
Touchgrind Skate and Skate. Push, carve, ollie, spin, flip and grind across five
maps, play 16 levels for stars, complete quests, earn **Bolts** and spend them on
parts and outfits in the shop.

- Vanilla JavaScript ES modules. **No build step.**
- [Three.js r170](https://threejs.org/) vendored at `vendor/three/` (pinned, loaded through an import map, so the game works offline).
- A small custom physics layer (`src/physics/`). No physics engine.
- Progress is saved to `localStorage` with a schema version and migrations.

See [VERIFICATION.md](VERIFICATION.md) for what was tested and how,
[BUGS.md](BUGS.md) for every bug found and its proof of fix, and
[CHANGELOG.md](CHANGELOG.md) for the milestone history.

## Quick start

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Then open <http://localhost:5173/>. `npm install` only fetches the dev tools
(ESLint and Playwright). The game itself has no runtime dependencies, and the
dev server (`scripts/serve.js`) is plain Node with no packages.

Any static file server works too, for example `python3 -m http.server`. Opening
`index.html` straight from disk (`file://`) does **not** work, because browsers
block ES module imports there.

To use a different port, run `npm run dev -- 8080` or `PORT=8080 npm run dev`.

## Controls

All keys can be remapped in **Settings → Controls**. Conflicts are detected and
can be swapped. A one-handed keyboard preset is also available there.

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Push / accelerate | W or ↑ | RT | PUSH button |
| Steer | A / D or ← / → | Left stick or D-pad | ◀ ▶ buttons, or swipe-steer (optional) |
| Brake | Shift (S or ↓ also slows you) | LT or B | BRAKE button |
| Ollie | Space or J | A | OLLIE button, or swipe up on the right half |
| Trick modifier (grabs, shove-its, tailwhips) | K or E | X | TRICK button (hold) |
| Pause | Esc or P | Start | ❚❚ Pause button |
| Change camera (follow / close / first person / top-down) | C | Y | Settings |
| Respawn | R | Back / Select | Pause → Retry restarts the run |

**In the air:**
- **Spins (180, 360, …):** hold left or right. When you let go, the spin finishes to the next 180.
- **Flips:** tap forward or back. That's a kickflip or heelflip on the board, and a front flip or backflip on the scooter.
- **Shove-it / tailwhip:** hold the trick button and tap left or right.
- **Grabs:** hold the trick button, optionally with forward or back for other grabs. Let go before you land.

On touch, swipe in the air to flip or spin.

**Grinds:** ollie and come down onto a rail, ledge, bench edge or handrail. Steer
against the balance meter, and ollie to pop off.

**Landing:** finish your rotation before you touch down, and land roughly straight.
Under-rotating, landing sideways or holding a grab too long is a **bail**, and the
reason is shown in text. Hitting a wall above 9 m/s is also a bail. **Forgiving
landings** (Settings) doubles every tolerance.

On ramps and quarter pipes you launch at a speed consistent with how fast you hit
them. Off vert you come straight back down the ramp with an automatic 180. Curbs
and stairs can only be ridden at a sensible angle: about 55° from straight on for
curbs and 40° for stairs. A glancing hit deflects you instead.

On touch devices the game wants landscape and shows a rotate prompt in portrait.
The page never scrolls, zooms or triggers the back gesture during play.

## How the game works

### Vehicles

The **skateboard** pushes in strides and coasts. The **scooter** kicks with a
cooldown, turns tighter and gets a trick bonus. Base handling lives in
`src/data/vehicles.json`, and shop parts modify it (decks, trucks, wheels,
bearings, scooter decks, bars and wheels). The stats in the shop show exactly
what each part changes.

### Tricks

There are more than 30 named tricks per vehicle, all defined in `src/data/tricks.json`
(spins, flips, shove-its, grabs, flip combinations, rail and ledge grinds, and
scooter tailwhips, flips and whip combinations). A trick's name and base points come from that data.

### Scoring

The scoring logic lives in `src/game/scoring.js` and is pure and unit-tested.

- Each clean trick (air trick or grind) adds 1 to the **combo**.
- Points awarded = base points × **multiplier**.
- Multiplier = 1 + 0.5 × (combo − 1), **capped at ×5** (reached at a 9-trick combo).
- A **bail** resets the combo to zero.
- The combo is banked after **3 seconds** on the ground without a new trick. Time in the air or on a rail does not count down.

### Bolts (currency)

The economy logic lives in `src/game/economy.js` and is pure and unit-tested.

| Source | Amount | Cap |
|---|---|---|
| Starting balance | 150 | — |
| Tricks | 1 per 40 points (after combo) | 300 per run |
| Grinding | 2 per second on a rail | 120 per run |
| Pickups (floating bolts on the maps) | 10 each | each pickup once per run |
| Quests | the quest's reward | once per quest (dailies once per day) |
| Finishing a level | 25, plus 40 / 60 / 100 for the 1st / 2nd / 3rd star the first time you earn it | stars pay once |

The balance can never go negative. Every purchase checks the balance first, and
saved balances are sanitised. The cheapest shop item always costs no more than
the starting balance.

### Shop and garage

There are 48 items in 13 categories, defined in `src/data/catalog.json`:

- vehicle parts with stat effects;
- outfits, helmets and pads (cosmetic);
- speed trails;
- the scooter itself.

Any owned part can be recoloured from 12 named colours and 7 patterns. A
colourblind-safe set is marked. A live 3D preview shows the rider and updates on
hover, on equip and on every colour change.

### Quests

There are 32 quests in `src/data/quests.json`:

- **12 story** quests, done in order;
- **12 challenges**, which can be done at any time;
- **8 dailies**, of which 3 are picked each day from the local date.

Progress comes from gameplay events, and each reward is granted exactly once.
Open the **Quests** screen for the log. A tracker in the HUD shows your active
quests, and it can be hidden in Settings.

### Levels

There are 16 levels in `src/data/levels.json`, four per map, using 5 objective types:

- **score**: reach a score;
- **tricks**: land N clean tricks;
- **pickups**: collect N bolts;
- **timeTrial**: ride through checkpoints in order (lower time is better);
- **grindDistance**: grind N metres.

Each level awards 0–3 stars and has a time limit. Every level can be paused,
retried or quit. Later levels unlock from stars on earlier ones, and maps unlock
from total stars (0 / 0 / 3 / 7 / 12).

### Maps

The maps live in `src/world/maps/`:

| Map | Highlights |
|---|---|
| `training` | Flat lot with one of everything; good for learning. |
| `neighborhood` (Maple Street) | Street with curbs, porch stairs, flat bars, road kickers, cars and a cul-de-sac. |
| `skatepark` (Concrete Jungle) | Two bowls with exit banks, a half pipe, a quarter pipe, a funbox, kickers, rails, ledges and a stair set. |
| `plaza` (Town Plaza) | Stair sets with handrails, benches, planters and ledges. |
| `downtown` (Downtown Hills) | Hilly terrain with terraces, a long bomb hill and crest launches. |

### Camera

The camera has four modes: third-person follow, close (over the shoulder),
**first person** (eye level, with the rider's body hidden) and **top-down**.
Press C to cycle through them, or pick one in Settings. The follow cameras
ray-cast against walls so they never end up inside geometry. Smoothing is
adjustable in Settings, and 0 turns it off. Camera shake can be switched off.

### Accessibility

All of these are in **Settings**, and every one is saved:

- **Motion:** reduced motion (no FOV kick, shake or CSS animation; it defaults on when the OS asks for it).
- **Visuals:**
  - high-contrast palette;
  - colourblind-safe palette for obstacles and the HUD;
  - text size from 80% to 200%.
- **Game speed and help:**
  - game speed of 100%, 75% or 50%;
  - forgiving landings;
  - auto-push.
- **Keyboard:**
  - full keyboard navigation of every menu, with a visible focus ring;
  - remappable keys with conflict detection;
  - a one-handed keyboard preset (left or right).
- **Touch:**
  - touch buttons of at least 44×44 px, which can be enlarged to 125% or 150%;
  - one-handed touch layouts.
- **Screen readers and sound:**
  - screen-reader announcements through ARIA live regions (tricks, Bolts, quests, level results, timer warnings), throttled so they don't flood;
  - captions for every sound that carries information.
- **Not colour alone:** information is never shown by colour only. Bails show "✖ Bail" with a reason, stars are shown as text, and shop items say "Equipped" or "Owned".

## Project layout

```
index.html              entry page (import map, HUD and screen containers)
src/main.js             boot, screens, game loop wiring, test hook (window.__game)
src/core/               loop, input, audio, save, camera, data loading
src/physics/            body (rider motion), collide (world queries), math
src/world/              map loading/validation, objects -> collision primitives, meshes, scene, reachability
src/world/maps/*.json   the maps (+ index.json manifest)
src/rider/              rider/vehicle model, air tricks, grinds
src/game/               session (simulation), scoring, economy, quests, levels, customize, progression
src/ui/                 menus, HUD, shop, quest log, touch controls, accessibility, styles.css
src/data/*.json         physics, vehicles, tricks, levels, quests, catalog
tests/*.test.js         unit tests (Node test runner)
e2e/*.spec.js           Playwright browser tests (soak test in e2e/soak.spec.js)
scripts/                dev server, reachability checker
reports/                latest reachability and soak test reports
vendor/three/           pinned Three.js build
```

The simulation (`src/game/session.js` and everything it uses) has no DOM or
Three.js dependency, so the unit tests and the level bot run it directly in
Node.

## Adding a map

1. Create `src/world/maps/<id>.json`. The `training.json` map is the smallest example:

   ```json
   {
     "id": "mymap",
     "name": "My Map",
     "order": 5,
     "description": "Shown in the free-roam list.",
     "theme": { "sky": "#9fd3ff", "ground": "#8a8f96", "fog": "#cfe6ff", "accent": "#ffb000" },
     "bounds": { "minX": -40, "maxX": 40, "minZ": -40, "maxZ": 40 },
     "terrain": { "type": "flat" },
     "spawns": [{ "id": "main", "x": 0, "z": -30, "rot": 0 }],
     "objects": [
       { "id": "kicker1", "type": "kicker", "x": 0, "z": -10, "rot": 0, "w": 2.6, "d": 2.4, "h": 0.9 },
       { "id": "rail1", "type": "rail", "x1": -8, "z1": -24, "x2": -8, "z2": -8, "h": 0.5 }
     ],
     "pickups": [{ "id": "mm-p1", "x": 0, "z": 0, "y": 1.0 }],
     "checkpoints": [{ "id": "mm-cp1", "x": 0, "z": 20, "radius": 5 }],
     "unlock": { "stars": 0 }
   }
   ```

   Positions are in metres, `rot` is in degrees, and local +Z is "forward". The
   object types and their fields are documented at the top of
   `src/world/objects.js`:

   - box kinds (`bench`, `barrier`, `wall`, `curb`, `ledge`, `platform`, `planter`, `building`, `car`, `block`, `tree`, `lamp`, `table`). Add `"grind": true` for a grindable top edge.
   - `kicker`, `quarter`, `halfpipe`, `bowl`, `stairs` (with grindable handrails), `rail`, `room`, `funbox`.

   Terrain can be `flat` or `hills`. Hills take a list of `hill` and `plateau`
   features; see `downtown.json`. A pickup that can only be reached off a ramp
   can say `"via": "<ramp id>"`.
2. Add the id to `src/world/maps/index.json`.
3. Run the checks:

   ```sh
   npm run check:maps -- mymap   # reachability: every surface, spawn, ramp, rail, pickup and checkpoint
   npm test                      # map validation, object building, physics
   ```

   The reachability checker floods the rideable area from every spawn, including
   ollie-ups. It launches every ramp in the real physics, grinds every rail and
   confirms every pickup and checkpoint can be reached. It exits non-zero and
   names the problem if anything is unreachable. Reports are written to
   `reports/reachability.txt` (and `.json` with `--json reports/reachability.json`).
4. To check it visually, run `npm run dev` and open it from **Free roam**.

## Adding a level

Levels are data only. Add an entry to `src/data/levels.json`:

```json
{
  "id": "m1",
  "name": "My Level",
  "map": "mymap",
  "spawn": "main",
  "description": "Shown on the level card.",
  "objective": { "type": "score", "stars": [2000, 6000, 12000] },
  "timeLimit": 90,
  "pickups": "none",
  "unlock": { "totalStars": 3 }
}
```

- `objective.type` is one of `score`, `tricks`, `pickups`, `timeTrial` or `grindDistance`.
- `stars` holds the 1/2/3-star targets, getting harder. For `timeTrial` they are times in seconds, so they get smaller.
- `timeTrial` also needs `"checkpoints": ["<checkpoint id>", ...]` from the map.
- `pickups` is `"none"`, `"all"` or a list of pickup ids.
- `unlock` is `{}` (always open), `{ "totalStars": N }`, or `{ "level": "<id>", "levelStars": N }`.

Then run `npm test`:

- `tests/levels.test.js` validates every level, and reports unknown maps, spawns, checkpoints and impossible star targets.
- `tests/level-feasibility.test.js` plays every level with a bot through the real simulation and requires at least one star. Add a route for the new level to `tests/level-plans.js`. It is a list of `goto`, `trick`, `grind` and `line` steps; see the existing plans.

## Adding quests, tricks or shop items

These are also data only:

- `src/data/quests.json` takes goal kinds `cleanTricks`, `speed`, `grindSeconds`, `combo`, `pickups`, `finishLevel`, `buyItem`, `visitMap`, `runScore` and `airTime`.
- `src/data/tricks.json` holds names and points.
- `src/data/catalog.json` holds items, colours and patterns.

The unit tests validate each file (`validateQuests`, the trick-name coverage
tests, and the catalog tests in `customize.test.js`).

## Running the tests

| Command | What it runs |
|---|---|
| `npm test` | Unit tests for all pure logic: physics, tricks, grinds, scoring, economy, quests, levels, customization, save migration, input, camera, loop, accessibility helpers, maps and reachability, and the level-feasibility bot (Node test runner, ~5 s). |
| `npm run test:e2e` | Playwright browser tests in headless Chromium: load, start a level, push, ollie, tricks, score, Bolts, shop buy/equip/preview, quests, levels, maps, accessibility, touch, save migration, gamepad, camera modes (~3 min). |
| `npm run test:soak` | The soak test: 5 minutes of simulated play with seeded random inputs across every map, plus 5 minutes in one session and 42 session restarts. It checks console errors, NaN, out-of-bounds, JS heap growth and GPU resource leaks (~8 min). `SOAK_SECONDS` and `SOAK_SEED` override the defaults. Reports go to `reports/soak-*.json`. |
| `npm run check:maps` | The reachability checker on every map. |
| `npm run lint` | ESLint. |
| `npm run verify` | Lint, unit tests, map checks and e2e, in that order. |

Playwright uses Chromium with software WebGL (SwiftShader). If Playwright's
browser is not installed yet, run `npx playwright install chromium`.

`window.__game` is a small test hook used by the e2e tests. It provides
deterministic manual stepping, state snapshots, rider placement and a GPU
resource audit. It doesn't change gameplay.

## Save data

Progress is saved under the `localStorage` key `boltskate.save`, at schema
version 3. Older saves (v1, v2) are migrated on load, and bad or missing fields
are repaired one field at a time. A corrupt save, or one from a newer version,
is copied to `boltskate.save.backup` before a fresh or best-effort save is used.
If storage is unavailable (private mode, quota), the game keeps playing with an
in-memory save. To start over, clear the site's storage in the browser (or run
`localStorage.removeItem('boltskate.save')` in the console).
