// Boot, game loop and screen routing.
import * as THREE from 'three';
import { fetchJsonReader, loadGameData } from './core/data.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { createCameraRig } from './core/camera.js';
import { createSaveStore } from './core/save.js';
import { createSession } from './game/session.js';
import { applyEvent, createRun, finishRun, tickRun } from './game/progression.js';
import { comboMultiplier } from './game/scoring.js';
import { buildMapScene } from './world/scene.js';
import { buildObjectMeshes, choosePalette } from './world/objects-mesh.js';
import { createRiderModel } from './rider/rider.js';
import { createHud } from './ui/hud.js';
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
  sceneInfo: null,
  rider: null,
  hud: null,
  dirty: false,
  saveTimer: 0,
  errors: [],
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

  app.store = createSaveStore();
  const loaded = app.store.load();
  app.profile = loaded.save;
  app.saveStatus = loaded.status;

  app.input = createInput({ target: window, bindings: app.profile.bindings || undefined });
  app.input.attachMouse(canvas);
  app.input.onAction((a) => {
    if (a === 'pause') onPauseKey();
  });

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
  showTitle();
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
// Screens
// ---------------------------------------------------------------------------
function setScreen(name) {
  app.screen = name;
  app.input.setEnabled(name === 'play');
  app.hud.show(name === 'play' || name === 'pause');
  if (app.loop) app.loop.setPaused(name !== 'play');
}

function showTitle() {
  endSession();
  setScreen('menu');
  $('#screens').innerHTML = `
    <div class="screen" role="dialog" aria-modal="true" aria-labelledby="title-h">
      <div class="panel narrow">
        <h1 id="title-h" class="title"><span class="bolt-mark" aria-hidden="true">⚡</span> Bolt Skate</h1>
        <p class="subtitle">Skate and scoot through the streets.</p>
        <p><span aria-hidden="true">⚡</span> <span class="bolts" id="menu-bolts">${app.profile.bolts}</span> Bolts</p>
        <ul class="menu-list">
          <li><button class="btn primary" id="btn-start"><span class="icon" aria-hidden="true">▶</span>Free roam</button></li>
        </ul>
      </div>
    </div>`;
  $('#btn-start').addEventListener('click', () => startSession({ mapId: 'training' }));
  $('#btn-start').focus();
}

function onPauseKey() {
  if (app.screen === 'play') pause();
  else if (app.screen === 'pause') resume();
}

function pause() {
  if (app.screen !== 'play') return;
  setScreen('pause');
  flushSave();
  $('#screens').innerHTML = `
    <div class="screen" role="dialog" aria-modal="true" aria-labelledby="pause-h">
      <div class="panel narrow"><h2 id="pause-h">Paused</h2>
        <ul class="menu-list">
          <li><button class="btn primary" id="btn-resume">Resume</button></li>
          <li><button class="btn" id="btn-retry">Restart run</button></li>
          <li><button class="btn" id="btn-quit">Quit to menu</button></li>
        </ul></div></div>`;
  $('#btn-resume').addEventListener('click', resume);
  $('#btn-retry').addEventListener('click', () => startSession(app.lastStart));
  $('#btn-quit').addEventListener('click', showTitle);
  $('#btn-resume').focus();
}

function resume() {
  if (app.screen !== 'pause') return;
  $('#screens').innerHTML = '';
  app.input.reset();
  setScreen('play');
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
function startSession({ mapId, levelId = null, spawnId = null }) {
  endSession();
  app.lastStart = { mapId, levelId, spawnId };
  const vehicle = app.profile.equipped.vehicle || 'skateboard';
  const a11y = app.profile.settings.a11y;
  const session = createSession({
    data: app.data,
    mapId,
    vehicle,
    spawnId,
    settings: { forgivingLandings: a11y.forgivingLandings, autoPush: a11y.autoPush },
  });
  app.session = session;
  app.run = createRun({ mode: levelId ? 'level' : 'free', mapId, levelId });
  const palette = choosePalette({ highContrast: a11y.highContrast, colorblind: a11y.colorblind });
  app.sceneInfo = buildMapScene(session.map, session.world, {
    highContrast: a11y.highContrast,
    shadows: app.profile.settings.graphics.shadows,
    objectMeshes: buildObjectMeshes(session.world, { palette, shadows: app.profile.settings.graphics.shadows }),
  });
  app.rider = createRiderModel({ vehicle });
  app.sceneInfo.scene.add(app.rider.group, app.rider.trail);
  app.cameraRig.mode = app.profile.settings.camera.mode;
  app.cameraRig.snap();
  app.loop.setTimeScale(a11y.gameSpeed);
  $('#screens').innerHTML = '';
  app.hud.setScore(0, 0, 1);
  app.hud.setBolts(app.profile.bolts);
  app.input.reset();
  setScreen('play');
}

function endSession() {
  if (app.run && app.profile) {
    finishRun(app.run, app.profile);
    markDirty();
    flushSave();
  }
  if (app.sceneInfo) app.sceneInfo.dispose();
  if (app.rider) app.rider.dispose();
  app.sceneInfo = null;
  app.rider = null;
  app.session = null;
  app.run = null;
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
  for (const n of tickRun(app.run, app.profile, dt, { inTrick, speed: speedOf(s.body), distance: dist })) notify(n);
}

function handleGameEvent(e) {
  if (e.type === 'land') landedThisFrame = true;
  const notes = applyEvent(app.run, app.profile, e);
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
  app.sceneInfo.follow(b.pos);
  app.hud.setSpeed(speed);
  app.hud.setLiveTrick(s.currentTrickText());
  app.hud.setBalance(s.grind ? s.grind.balance : null);
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
      ticks: app.loop?.ticks ?? 0,
      bolts: app.profile?.bolts ?? 0,
      saveStatus: app.saveStatus,
      score: sc ? { score: sc.score, combo: sc.combo, multiplier: comboMultiplier(sc.combo) } : null,
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
      errors: app.errors.slice(),
    };
  },
  profile() {
    return JSON.parse(JSON.stringify(app.profile));
  },
  startFreeRoam(mapId = 'training', spawnId = null) {
    startSession({ mapId, spawnId });
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
};

window.addEventListener('error', (e) => app.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => app.errors.push(String(e.reason)));

boot();
