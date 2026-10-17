// Boot, game loop and screen routing.
import * as THREE from 'three';
import { fetchJsonReader, loadGameData } from './core/data.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { createCameraRig } from './core/camera.js';
import { createSession } from './game/session.js';
import { buildMapScene } from './world/scene.js';
import { createRiderModel } from './rider/rider.js';
import { speedOf } from './physics/body.js';
import { lenXZ, yawOf } from './physics/math.js';

const $ = (sel) => document.querySelector(sel);

const app = {
  data: null,
  screen: 'boot',
  session: null,
  sceneInfo: null,
  rider: null,
  settings: { camera: { smoothing: 0.6, mode: 'follow' }, a11y: { reducedMotion: false } },
  errors: [],
};

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

  app.input = createInput({ target: window });
  app.input.attachMouse(canvas);
  app.input.onAction((a) => {
    if (a === 'pause') togglePause();
  });

  app.loop = createLoop({ step: tick, render });
  window.addEventListener('resize', resize);
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

function showTitle() {
  app.screen = 'menu';
  app.input.setEnabled(false);
  $('#screens').innerHTML = `
    <div class="screen" role="dialog" aria-modal="true" aria-labelledby="title-h">
      <div class="panel narrow">
        <h1 id="title-h" class="title"><span class="bolt-mark" aria-hidden="true">⚡</span> Bolt Skate</h1>
        <p class="subtitle">Skate and scoot through the streets.</p>
        <ul class="menu-list">
          <li><button class="btn primary" id="btn-start"><span class="icon" aria-hidden="true">▶</span>Free roam</button></li>
        </ul>
      </div>
    </div>`;
  $('#btn-start').addEventListener('click', () => startSession('training'));
  $('#btn-start').focus();
}

function startSession(mapId) {
  disposeSession();
  const session = createSession({ data: app.data, mapId, vehicle: 'skateboard' });
  app.session = session;
  app.sceneInfo = buildMapScene(session.map, session.world, {});
  app.rider = createRiderModel({ vehicle: 'skateboard' });
  app.sceneInfo.scene.add(app.rider.group, app.rider.trail);
  app.cameraRig.snap();
  $('#screens').innerHTML = '';
  $('#hud').hidden = false;
  $('#hud').innerHTML = `<div class="box bl speed" id="hud-speed">0 km/h</div>`;
  app.screen = 'play';
  app.input.setEnabled(true);
  app.loop.setPaused(false);
  $('#game-canvas').focus?.();
}

function disposeSession() {
  if (app.sceneInfo) app.sceneInfo.dispose();
  if (app.rider) app.rider.dispose();
  app.sceneInfo = null;
  app.rider = null;
  app.session = null;
}

function togglePause() {
  if (app.screen === 'play') {
    app.screen = 'pause';
    app.loop.setPaused(true);
    app.input.setEnabled(false);
    $('#screens').innerHTML = `
      <div class="screen" role="dialog" aria-modal="true" aria-labelledby="pause-h">
        <div class="panel narrow"><h2 id="pause-h">Paused</h2>
          <ul class="menu-list"><li><button class="btn primary" id="btn-resume">Resume</button></li>
          <li><button class="btn" id="btn-quit">Quit to menu</button></li></ul></div></div>`;
    $('#btn-resume').addEventListener('click', togglePause);
    $('#btn-quit').addEventListener('click', () => {
      disposeSession();
      $('#hud').hidden = true;
      showTitle();
    });
    $('#btn-resume').focus();
  } else if (app.screen === 'pause') {
    $('#screens').innerHTML = '';
    app.screen = 'play';
    app.input.setEnabled(true);
    app.loop.setPaused(false);
  }
}

let lastLanded = false;
function tick(dt) {
  const s = app.session;
  if (!s || app.screen !== 'play') return;
  const input = app.input.sample();
  s.step(dt, input);
  for (const e of s.drainEvents()) {
    if (e.type === 'land') lastLanded = true;
  }
}

function render(_alpha, frameSeconds) {
  app.input.pollGamepads();
  const s = app.session;
  if (s && app.sceneInfo) {
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
        landed: lastLanded,
        trick: null,
      },
      Math.min(frameSeconds || 1 / 60, 0.1),
    );
    lastLanded = false;
    const travelYaw = lenXZ(b.vel) > 1 ? yawOf(b.vel) : b.yaw;
    app.cameraRig.update(Math.min(frameSeconds || 1 / 60, 0.1), s.world, { pos: b.pos, travelYaw, speed }, {
      smoothing: app.settings.camera.smoothing,
      reducedMotion: app.settings.a11y.reducedMotion,
    });
    app.sceneInfo.follow(b.pos);
    const hs = $('#hud-speed');
    if (hs) hs.textContent = `${Math.round(speed * 3.6)} km/h`;
    app.renderer.render(app.sceneInfo.scene, app.camera);
  } else {
    app.renderer.setClearColor('#11151c');
    app.renderer.clear();
  }
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
    return {
      screen: app.screen,
      ticks: app.loop?.ticks ?? 0,
      rider: b
        ? { pos: { ...b.pos }, vel: { ...b.vel }, speed: speedOf(b), yaw: b.yaw, state: b.state, grounded: b.grounded }
        : null,
      camera: app.cameraRig?.state,
      errors: app.errors.slice(),
    };
  },
  startFreeRoam(mapId = 'training') {
    startSession(mapId);
  },
  setManual(m) {
    app.loop.setManual(m);
  },
  advance(seconds, renderEvery = 0) {
    const n = app.loop.advance(seconds, { renderEvery });
    render(0, 1 / 60);
    return n;
  },
};

window.addEventListener('error', (e) => app.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => app.errors.push(String(e.reason)));

boot();
