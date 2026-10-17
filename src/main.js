// Boot, game loop and screen routing.
import * as THREE from 'three';
import { fetchJsonReader, loadGameData } from './core/data.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { createCameraRig } from './core/camera.js';
import { createSaveStore } from './core/save.js';
import { createSession } from './game/session.js';
import { applyEvent, createRun, creditBolts, finishRun, questEvent, tickRun } from './game/progression.js';
import { dayKey, refreshDaily, syncQuestsWithProfile } from './game/quests.js';
import { comboMultiplier } from './game/scoring.js';
import { levelReward, runTotal } from './game/economy.js';
import {
  createLevelRun,
  levelPickupIds,
  levelUnlockState,
  nextLevel,
  objectiveText,
  recordLevelResult,
  updateLevelRun,
} from './game/levels.js';
import { buildMapScene } from './world/scene.js';
import { buildCheckpointMeshes, buildObjectMeshes, buildPickupMeshes, choosePalette } from './world/objects-mesh.js';
import { createRiderModel, patternCanvas } from './rider/rider.js';
import { createHud } from './ui/hud.js';
import { createScreenManager, esc, showFreeRoam, showHelp, showLevelSelect, showMainMenu, showPause, showResults } from './ui/menu.js';
import { showQuestLog, trackerItems } from './ui/quests-ui.js';
import { shopPreview, showShop } from './ui/shop.js';
import { buildLook, buyItem, computeStats, equipItem, itemById, setPartColor } from './game/customize.js';
import { speedOf } from './physics/body.js';
import { lenXZ, yawOf } from './physics/math.js';

const $ = (sel) => document.querySelector(sel);

const app = {
  data: null,
  store: null,
  profile: null,
  screen: 'boot',
  session: null,
  run: null,
  level: null,
  levelRun: null,
  sceneInfo: null,
  rider: null,
  hud: null,
  dirty: false,
  saveTimer: 0,
  errors: [],
  lastResult: null,
  questLog: [],
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  const canvas = $('#game-canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    showBootError('Your browser could not start WebGL, which Bolt Skate needs for 3D graphics.', err);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.renderer = renderer;
  app.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
  app.cameraRig = createCameraRig(app.camera);

  try {
    app.data = await loadGameData(fetchJsonReader());
  } catch (err) {
    showBootError('Game data failed to load. Please reload the page.', err);
    return;
  }
  app.levelsById = Object.fromEntries(app.data.levels.map((l) => [l.id, l]));

  app.store = createSaveStore();
  const loaded = app.store.load();
  app.profile = loaded.save;
  app.saveStatus = loaded.status;
  refreshQuestsForToday();
  app.profile.quests = syncQuestsWithProfile(app.profile.quests, app.data.quests, app.profile).state;

  app.input = createInput({ target: window, bindings: app.profile.bindings || undefined });
  app.input.attachMouse(canvas);
  app.input.onAction((a) => {
    if (a === 'pause') onPauseKey();
  });

  app.screens = createScreenManager($('#screens'));
  app.hud = createHud($('#hud'));
  app.hud.onPause(() => pause());
  app.hud.setBolts(app.profile.bolts);

  app.loop = createLoop({ step: tick, render });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (app.screen === 'play') pause();
      flushSave();
    }
  });
  window.addEventListener('pagehide', flushSave);
  resize();
  $('#boot').hidden = true;
  go('menu');
  app.loop.start();
}

function showBootError(msg, err) {
  console.error(err);
  const el = $('#boot');
  el.hidden = false;
  el.classList.add('error');
  el.textContent = msg;
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  app.renderer.setSize(w, h, false);
  app.camera.aspect = w / Math.max(1, h);
  app.camera.updateProjectionMatrix();
}

/** Screen reader announcement (polite live region). */
function announce(text) {
  const el = $('#sr-polite');
  el.textContent = '';
  // A separate task so repeated identical messages are re-announced.
  setTimeout(() => (el.textContent = text), 30);
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------
function markDirty() {
  app.dirty = true;
}
function flushSave() {
  if (!app.store || !app.profile || !app.dirty) return;
  if (app.store.write(app.profile)) app.dirty = false;
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------
/** Pick today's daily quests (device clock); resets them when the day changes. */
function refreshQuestsForToday() {
  const today = dayKey(app.now ? app.now() : new Date());
  if (app.profile.quests.daily.day !== today) {
    app.profile.quests = refreshDaily(app.profile.quests, app.data.quests, today, app.data.questsPerDay);
    markDirty();
  }
  return today;
}

function questCtx() {
  return { questDefs: app.data.quests, vehicle: app.session ? app.session.vehicle : app.profile.equipped.vehicle };
}

/** Send a non-gameplay quest event (map visit, level finish, purchase). */
function sendQuestEvent(qe) {
  for (const n of questEvent(app.profile, app.data.quests, { vehicle: questCtx().vehicle, ...qe })) notify(n);
  markDirty();
}

function updateTracker() {
  app.hud.setTracker(app.profile.settings.a11y.questTracker === false ? null : trackerItems(app.profile, app.data, 3));
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------
function shopCtx() {
  const a11y = app.profile.settings.a11y;
  return { profile: app.profile, catalog: app.data.catalog, vehicles: app.data.vehicles, reducedMotion: a11y.reducedMotion, colorblindOnly: a11y.colorblind };
}

function shopActions(back) {
  return {
    back,
    announce,
    buy(id) {
      const r = buyItem(app.profile, app.data.catalog, id);
      const item = itemById(app.data.catalog, id);
      if (!r.ok) {
        announce(r.reason === 'insufficient' ? `Not enough Bolts for ${item.name}. You need ${r.short} more.` : `${item.name} is already yours.`);
        return shopCtx();
      }
      app.profile = r.profile;
      markDirty();
      flushSave();
      sendQuestEvent({ type: 'itemBought', itemId: id, category: item.category, price: item.price });
      announce(`Bought ${item.name} for ${item.price} Bolts. You have ${app.profile.bolts} Bolts left.`);
      return shopCtx();
    },
    equip(id) {
      const r = equipItem(app.profile, app.data.catalog, id);
      if (r.ok) {
        app.profile = r.profile;
        markDirty();
        flushSave();
        announce(`Equipped ${itemById(app.data.catalog, id).name}.`);
      }
      return shopCtx();
    },
    setColor(key, change) {
      const r = setPartColor(app.profile, app.data.catalog, key, change);
      if (r.ok) {
        app.profile = r.profile;
        markDirty();
        const c = app.data.catalog.colors.find((x) => x.hex.toLowerCase() === String(change.color || '').toLowerCase());
        announce(change.pattern ? `Pattern: ${change.pattern}` : `Color: ${c ? c.name : change.color}`);
      }
      return shopCtx();
    },
  };
}

// ---------------------------------------------------------------------------
// Screen routing
// ---------------------------------------------------------------------------
function setScreen(name) {
  app.screen = name;
  if (name !== 'menu') app.menuScreen = null;
  app.input.setEnabled(name === 'play');
  app.hud.show(name === 'play' || name === 'pause');
  if (app.loop) app.loop.setPaused(name !== 'play');
}

const ctx = () => ({ profile: app.profile, data: app.data });

function go(name) {
  if (name !== 'pause-settings' && name !== 'pause-help') endSession();
  setScreen('menu');
  const back = () => go('menu');
  switch (name) {
    case 'menu':
      showMainMenu(app.screens, ctx(), { go });
      break;
    case 'levels':
      showLevelSelect(app.screens, ctx(), { back, startLevel, announce });
      break;
    case 'free':
      showFreeRoam(app.screens, ctx(), { back, startFree: (mapId) => startSession({ mapId }), announce });
      break;
    case 'help':
      showHelp(app.screens, { bindings: app.input.bindings }, { back });
      break;
    case 'quests':
      showQuestLog(app.screens, { profile: app.profile, data: app.data, day: refreshQuestsForToday() }, { back });
      break;
    case 'shop':
      app.shopView = showShop(app.screens, shopCtx(), shopActions(back));
      break;
    default:
      // Quests, shop and settings screens are added in later milestones.
      app.screens.show({ id: name, title: esc(name[0].toUpperCase() + name.slice(1)), onBack: back, narrow: true, html: '<p>Coming soon.</p>' });
  }
  app.menuScreen = name;
}

function onPauseKey() {
  if (app.screen === 'play') pause();
  else if (app.screen === 'pause') {
    // In a pause sub-screen (settings, controls) Escape goes back to the pause menu.
    if (app.screens.current && app.screens.current.id !== 'screen-pause') app.screens.back();
    else resume();
  } else if (app.screen === 'menu' || app.screen === 'results') app.screens.back();
}

function pause() {
  if (app.screen !== 'play') return;
  setScreen('pause');
  flushSave();
  showPause(app.screens, { level: app.level }, {
    resume,
    retry: () => (app.level ? startLevel(app.level.id) : startSession(app.lastStart)),
    settings: () => app.screens.show({ id: 'pause-settings', title: 'Settings', narrow: true, onBack: pauseMenu, html: '<p>Coming soon.</p>' }),
    help: () => showHelp(app.screens, { bindings: app.input.bindings }, { back: pauseMenu }),
    quit: () => go('menu'),
  });
}
function pauseMenu() {
  setScreen('play');
  pause();
}

function resume() {
  if (app.screen !== 'pause') return;
  app.screens.close();
  app.input.reset();
  setScreen('play');
}

// ---------------------------------------------------------------------------
// Sessions and levels
// ---------------------------------------------------------------------------
function startLevel(levelId) {
  const level = app.levelsById[levelId];
  if (!level) return;
  const st = levelUnlockState(level, app.data.maps, app.profile.levels, app.levelsById);
  if (!st.unlocked) {
    announce(st.reason);
    return;
  }
  startSession({ mapId: level.map, levelId, spawnId: level.spawn || null });
}

function startSession({ mapId, levelId = null, spawnId = null }) {
  endSession();
  app.lastStart = { mapId, levelId, spawnId };
  const level = levelId ? app.levelsById[levelId] : null;
  const vehicle = app.profile.equipped.vehicle || 'skateboard';
  const a11y = app.profile.settings.a11y;
  const map = app.data.maps[mapId];
  const stats = computeStats(app.data.vehicles, app.data.catalog, app.profile, vehicle);
  const pickupIds = level ? new Set(levelPickupIds(level, map)) : null;
  const session = createSession({
    data: app.data,
    mapId,
    vehicle,
    stats,
    spawnId,
    settings: { forgivingLandings: a11y.forgivingLandings, autoPush: a11y.autoPush },
    pickupFilter: pickupIds ? (p) => pickupIds.has(p.id) : null,
  });
  app.session = session;
  app.level = level;
  app.levelRun = level ? createLevelRun(level) : null;
  app.run = createRun({ mode: level ? 'level' : 'free', mapId, levelId });
  const palette = choosePalette({ highContrast: a11y.highContrast, colorblind: a11y.colorblind });
  const shadows = app.profile.settings.graphics.shadows;
  app.sceneInfo = buildMapScene(session.map, session.world, {
    highContrast: a11y.highContrast,
    shadows,
    objectMeshes: buildObjectMeshes(session.world, { palette, shadows }),
  });
  app.pickupMeshes = buildPickupMeshes(session.pickups, { palette });
  app.sceneInfo.scene.add(app.pickupMeshes.group);
  app.checkpointMeshes = null;
  if (level && level.objective.type === 'timeTrial') {
    const cps = level.objective.checkpoints.map((id) => map.checkpoints.find((c) => c.id === id));
    app.checkpointMeshes = buildCheckpointMeshes(session.world, cps, { palette });
    app.checkpointMeshes.setActive(0);
    app.sceneInfo.scene.add(app.checkpointMeshes.group);
  }
  app.rider = createRiderModel(buildLook(app.profile, app.data.catalog));
  app.sceneInfo.scene.add(app.rider.group, app.rider.trail);
  if (!app.profile.visitedMaps.includes(mapId)) {
    app.profile.visitedMaps.push(mapId);
    markDirty();
  }
  refreshQuestsForToday();
  app.cameraRig.mode = app.profile.settings.camera.mode;
  app.cameraRig.snap();
  app.loop.setTimeScale(a11y.gameSpeed);
  app.screens.close();
  app.hud.setScore(0, 0, 1);
  app.hud.setBolts(app.profile.bolts);
  app.hud.setObjective(null);
  app.input.reset();
  setScreen('play');
  sendQuestEvent({ type: 'mapVisited', mapId });
  updateTracker();
  if (level) {
    app.hud.toast(`${level.name}: go!`, 2);
    announce(`${level.name}. ${objectiveText(level, app.levelRun).title}. ${level.timeLimit} seconds.`);
  } else {
    announce(`Free roam: ${map.name}.`);
  }
}

function endSession() {
  if (app.run && app.profile) {
    finishRun(app.run, app.profile);
    markDirty();
    flushSave();
  }
  if (app.sceneInfo) app.sceneInfo.dispose();
  if (app.rider) app.rider.dispose();
  if (app.pickupMeshes) app.pickupMeshes.dispose();
  if (app.checkpointMeshes) app.checkpointMeshes.dispose();
  app.pickupMeshes = null;
  app.checkpointMeshes = null;
  app.sceneInfo = null;
  app.rider = null;
  app.session = null;
  app.run = null;
  app.level = null;
  app.levelRun = null;
}

function finishLevel() {
  const level = app.level;
  const lr = app.levelRun;
  const rec = recordLevelResult(app.profile.levels, level, { stars: lr.stars, score: app.run.score.score, value: lr.value });
  app.profile.levels = rec.levels;
  const bolts = lr.stars > 0 ? creditBolts(app.profile, levelReward(rec.prevStars, lr.stars)) : 0;
  const result = {
    stars: lr.stars,
    value: lr.value,
    score: app.run.score.score,
    improved: rec.improved,
    boltsRun: runTotal(app.run.earnings),
    boltsLevel: bolts,
  };
  app.lastResult = { levelId: level.id, ...result, status: lr.status };
  if (lr.stars > 0) sendQuestEvent({ type: 'levelFinished', levelId: level.id, stars: lr.stars });
  markDirty();
  endSession();
  setScreen('results');
  const next = nextLevel(app.data.levels, level.id);
  const nextUnlocked = next ? levelUnlockState(next, app.data.maps, app.profile.levels, app.levelsById).unlocked : false;
  showResults(app.screens, { level, result, next, nextUnlocked }, {
    next: () => startLevel(next.id),
    retry: () => startLevel(level.id),
    levels: () => go('levels'),
    menu: () => go('menu'),
  });
  announce(
    `${lr.status === 'complete' ? 'Level complete' : 'Level failed'}: ${level.name}. ${lr.stars} of 3 stars.` +
      (bolts ? ` Plus ${bolts} Bolts.` : ''),
  );
}

// ---------------------------------------------------------------------------
// Simulation tick (fixed 60 Hz)
// ---------------------------------------------------------------------------
let landedThisFrame = false;
function tick(dt) {
  const s = app.session;
  if (!s || app.screen !== 'play') return;
  const input = app.input.sample();
  if (app.input.consume('respawn')) s.respawn();
  if (app.input.consume('camera')) cycleCamera();
  const before = { ...s.body.pos };
  s.step(dt, input);
  for (const e of s.drainEvents()) handleGameEvent(e);
  const inTrick = s.body.state === 'air' || s.body.state === 'grind';
  const dist = Math.hypot(s.body.pos.x - before.x, s.body.pos.z - before.z);
  for (const n of tickRun(app.run, app.profile, dt, { inTrick, speed: speedOf(s.body), distance: dist, ctx: questCtx() })) notify(n);
  if (app.levelRun) {
    const r = updateLevelRun(
      app.levelRun,
      app.level,
      s.map,
      {
        score: app.run.score.score,
        tricks: app.run.score.tricks,
        pickups: app.run.pickups.length,
        grindDistance: app.run.grindDistance,
        pos: s.body.pos,
      },
      dt,
    );
    app.levelRun = r.run;
    for (const e of r.events) {
      if (e.type === 'checkpoint') {
        if (app.checkpointMeshes) app.checkpointMeshes.setActive(e.index);
        app.hud.toast(`Checkpoint ${e.index} of ${e.total}: ${e.time.toFixed(1)} s`, 1.5);
        announce(`Checkpoint ${e.index} of ${e.total}`);
      } else if (e.type === 'levelComplete' || e.type === 'levelFailed') {
        finishLevel();
        return;
      }
    }
  }
}

function handleGameEvent(e) {
  if (e.type === 'land') landedThisFrame = true;
  if (e.type === 'pickup' && app.pickupMeshes) app.pickupMeshes.setTaken(e.id, true);
  const notes = applyEvent(app.run, app.profile, e, questCtx());
  for (const n of notes) notify(n);
  if (notes.length) markDirty();
}

function notify(n) {
  const sc = app.run.score;
  if (n.type === 'score') {
    const mult = n.multiplier > 1 ? ` · x${n.multiplier.toFixed(1)}` : '';
    app.hud.showResult('clean', n.name, `+${n.awarded.toLocaleString('en-US')}${mult}`);
    app.hud.setScore(sc.score, sc.combo, comboMultiplier(sc.combo));
  } else if (n.type === 'bail') {
    app.hud.showResult('bail', 'Bail', n.reason);
    app.hud.setScore(sc.score, 0, 1);
  } else if (n.type === 'bolts') {
    app.hud.setBolts(app.profile.bolts);
    app.trackerDirty = true;
  } else if (n.type === 'pickup') {
    app.hud.toast(`+${n.bolts} Bolts pickup`, 1.2);
  } else if (n.type === 'questComplete') {
    app.hud.toast(`Quest complete: ${n.title} · +${n.reward} Bolts`, 3);
    announce(`Quest complete: ${n.title}. Plus ${n.reward} Bolts.`);
    app.questLog.push({ id: n.id, title: n.title, reward: n.reward });
    updateTracker();
  } else if (n.type === 'comboEnd') {
    app.hud.setScore(sc.score, 0, 1);
    app.hud.toast(`Combo x${n.count} banked: ${n.points.toLocaleString('en-US')}`);
  }
}

function cycleCamera() {
  const modes = ['follow', 'close', 'top'];
  const next = modes[(modes.indexOf(app.cameraRig.mode) + 1) % modes.length];
  app.cameraRig.mode = next;
  app.profile.settings.camera.mode = next;
  markDirty();
  app.hud.toast(`Camera: ${next}`, 1.2);
}

/** Countdown display: rounds up, so a 90 s limit shows 1:30 until a full second has passed. */
function formatTime(s) {
  const t = Math.max(0, Math.ceil(s - 1e-6));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function updateObjectiveHud() {
  if (!app.level || !app.levelRun) {
    app.hud.setObjective(null);
    return;
  }
  const t = objectiveText(app.level, app.levelRun);
  let extra = '';
  if (app.level.objective.type === 'timeTrial') {
    const id = app.level.objective.checkpoints[app.levelRun.checkpointIndex];
    const cp = app.session.map.checkpoints.find((c) => c.id === id);
    if (cp) extra = ` · next ${Math.max(0, Math.round(Math.hypot(cp.x - app.session.body.pos.x, cp.z - app.session.body.pos.z) - cp.radius))} m`;
  }
  const low = t.remaining <= 10;
  app.hud.setObjective(
    `<div class="obj-title">${esc(app.level.name)} · ${esc(t.title)}</div>` +
      `<div class="obj-progress">${esc(t.progress)}${esc(extra)}</div>` +
      `<div class="obj-time${low ? ' low' : ''}"><span aria-hidden="true">⏱</span> ${formatTime(t.remaining)}${low ? ' left!' : ''}</div>`,
  );
}

// ---------------------------------------------------------------------------
// Render (once per animation frame)
// ---------------------------------------------------------------------------
function render(_alpha, frameSeconds) {
  const fdt = Math.min(frameSeconds || 1 / 60, 0.1);
  app.input.pollGamepads();
  app.saveTimer += fdt;
  if (app.saveTimer > 2) {
    app.saveTimer = 0;
    flushSave();
  }
  const s = app.session;
  if (!s || !app.sceneInfo) {
    app.renderer.setClearColor('#11151c');
    app.renderer.clear();
    if (app.screen === 'menu' && app.menuScreen === 'shop' && app.shopView) app.shopView.renderPreview(fdt);
    return;
  }
  const b = s.body;
  const speed = speedOf(b);
  app.rider.update(
    {
      pos: b.pos,
      yaw: b.yaw,
      airYaw: b.airYaw,
      normal: b.normal,
      state: b.state,
      stance: b.stance,
      speed,
      steer: s.lastInput ? s.lastInput.steer : 0,
      pushing: b.pushTimer > 0,
      landed: landedThisFrame,
      trick: s.air ? { pitchDeg: s.air.pitchDeg, boardYawDeg: s.air.boardYawDeg, grab: s.air.grab } : null,
      grind: s.grind ? { boardYaw: s.grind.boardYaw } : null,
    },
    fdt,
  );
  landedThisFrame = false;
  const travelYaw = s.grind ? s.grind.travelYaw : lenXZ(b.vel) > 1 ? yawOf(b.vel) : b.yaw;
  const cam = app.profile.settings.camera;
  app.cameraRig.update(fdt, s.world, { pos: b.pos, travelYaw, speed }, {
    smoothing: cam.smoothing,
    shake: cam.shake,
    reducedMotion: app.profile.settings.a11y.reducedMotion,
  });
  if (app.debugCam) {
    app.camera.position.set(app.debugCam.eye.x, app.debugCam.eye.y, app.debugCam.eye.z);
    app.camera.lookAt(app.debugCam.look.x, app.debugCam.look.y, app.debugCam.look.z);
  }
  app.sceneInfo.follow(b.pos);
  app.pickupMeshes.update(fdt, app.profile.settings.a11y.reducedMotion);
  app.hud.setSpeed(speed);
  app.hud.setLiveTrick(s.currentTrickText());
  app.hud.setBalance(s.grind ? s.grind.balance : null);
  updateObjectiveHud();
  app.trackerTimer = (app.trackerTimer || 0) + fdt;
  if (app.trackerTimer > 0.5) {
    app.trackerTimer = 0;
    updateTracker();
  }
  app.hud.update(fdt);
  app.renderer.render(app.sceneInfo.scene, app.camera);
}

// ---------------------------------------------------------------------------
// Test / debug hook used by the Playwright suite.
// ---------------------------------------------------------------------------
window.__game = {
  get ready() {
    return !!app.data && app.screen !== 'boot';
  },
  state() {
    const s = app.session;
    const b = s?.body;
    const sc = app.run?.score;
    return {
      screen: app.screen,
      menuScreen: app.menuScreen,
      ticks: app.loop?.ticks ?? 0,
      bolts: app.profile?.bolts ?? 0,
      saveStatus: app.saveStatus,
      score: sc ? { score: sc.score, combo: sc.combo, multiplier: comboMultiplier(sc.combo), tricks: sc.tricks } : null,
      rider: b
        ? { pos: { ...b.pos }, vel: { ...b.vel }, speed: speedOf(b), yaw: b.yaw, state: b.state, grounded: b.grounded, stance: b.stance }
        : null,
      lastTrick: s?.lastTrick || null,
      air: s?.air ? { pitchDeg: s.air.pitchDeg, yawDeg: s.air.yawDeg, boardYawDeg: s.air.boardYawDeg, grab: s.air.grab, airTime: s.air.airTime } : null,
      grind: s?.grind ? { name: s.grind.name, balance: s.grind.balance, time: s.grind.time } : null,
      liveTrick: s ? s.currentTrickText() : null,
      trickText: app.hud?.trickText || '',
      camera: app.cameraRig?.state,
      stats: s ? { ...s.stats2 } : null,
      pickups: s ? s.pickups.map((p) => ({ id: p.id, taken: p.taken, x: p.x, y: p.y, z: p.z })) : [],
      mapId: s ? s.map.id : null,
      level: app.levelRun ? { ...app.levelRun } : null,
      lastResult: app.lastResult,
      errors: app.errors.slice(),
    };
  },
  profile() {
    return JSON.parse(JSON.stringify(app.profile));
  },
  questsCompleted() {
    return app.questLog.slice();
  },
  /** Shop preview: the actual 3D model's parts/colors and a pixel fingerprint. */
  shopPreview(angle = null) {
    const pv = shopPreview();
    if (!pv) return null;
    if (angle !== null) pv.setAngle(angle);
    pv.render(0, { reducedMotion: true });
    return { model: pv.describe(), hash: pv.pixelHash() };
  },
  /** Debug: show every pattern texture (screenshot check of the pattern generator). */
  showPatterns() {
    const wrap = document.createElement('div');
    wrap.id = 'pattern-debug';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99;background:#222;display:flex;flex-wrap:wrap;gap:12px;padding:12px';
    for (const p of app.data.catalog.patterns) {
      const c = patternCanvas(p.id, '#d94a38', '#ffffff');
      const fig = document.createElement('figure');
      fig.style.cssText = 'margin:0;color:#fff;font:14px sans-serif';
      if (c) {
        const img = document.createElement('img');
        img.src = c.toDataURL();
        img.width = 128;
        fig.appendChild(img);
      }
      fig.appendChild(document.createTextNode(' ' + p.name));
      wrap.appendChild(fig);
    }
    document.body.appendChild(wrap);
  },
  riderLook() {
    return app.rider ? app.rider.describe() : null;
  },
  sessionStats() {
    return app.session ? { ...app.session.stats } : null;
  },
  /** Debug: override the clock (daily quest tests). Pass null to restore. */
  setNow(ms) {
    app.now = ms === null ? null : () => new Date(ms);
    refreshQuestsForToday();
  },
  startFreeRoam(mapId = 'training', spawnId = null) {
    startSession({ mapId, spawnId });
  },
  startLevel(id) {
    startLevel(id);
  },
  setManual(m) {
    app.loop.setManual(m);
  },
  advance(seconds, renderEvery = 0) {
    const n = app.loop.advance(seconds, { renderEvery });
    render(0, 1 / 60);
    return n;
  },
  /** Debug: place the rider (used by e2e tests to set up obstacle runs). */
  place({ x, z, yaw = 0, speed = 0 }) {
    app.session.respawn({ x, z, yaw });
    app.session.body.vel = { x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed };
    app.cameraRig.snap();
  },
  flushSave() {
    app.dirty = true;
    flushSave();
  },
  /** Debug: pin the camera (screenshots). Pass null to release. */
  debugCamera(cam) {
    app.debugCam = cam;
  },
};

window.addEventListener('error', (e) => app.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => app.errors.push(String(e.reason)));

boot();
