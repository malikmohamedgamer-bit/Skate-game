// Soak test (Milestone 9): minutes of simulated play driven by seeded random key
// presses in headless Chromium. Checks that there are no console or page errors,
// no NaN positions, the rider never leaves the map bounds, the game keeps
// responding (pause/resume, respawn, camera), and neither the JS heap nor the
// GPU resources held by the renderer grow.
//
// Run: npm run test:soak   (SOAK_SECONDS and SOAK_SEED override the defaults)
// Results are also written to reports/soak-*.json.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { openGame } from './helpers.js';

const SIM_SECONDS = Number(process.env.SOAK_SECONDS || 300);
const SEED = Number(process.env.SOAK_SEED || 9001);
const CHUNK = 0.25; // simulated seconds between input changes; the frame is rendered after each chunk
const MAPS = ['training', 'neighborhood', 'skatepark', 'plaza', 'downtown'];
const HEAP_GROWTH_LIMIT = 8 * 1024 * 1024;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random player: decides which keys are held for the next chunk. */
function createPlayer(seed) {
  const r = mulberry32(seed);
  const pick = (opts) => {
    let x = r();
    for (const [v, p] of opts) {
      if ((x -= p) < 0) return v;
    }
    return opts[opts.length - 1][0];
  };
  return (snap) => {
    const keys = new Set();
    const air = snap.state === 'air';
    if (!air) {
      if (r() < 0.65) keys.add('KeyW');
      const steer = pick([[null, 0.4], ['KeyA', 0.3], ['KeyD', 0.3]]);
      if (steer) keys.add(steer);
      if (r() < 0.06) keys.add('ShiftLeft');
      if (r() < 0.25) keys.add('Space');
    } else {
      // In the air the arrows flip and spin; K holds grabs / shove-its.
      const flip = pick([[null, 0.5], ['ArrowUp', 0.25], ['ArrowDown', 0.25]]);
      if (flip) keys.add(flip);
      const spin = pick([[null, 0.4], ['ArrowLeft', 0.3], ['ArrowRight', 0.3]]);
      if (spin) keys.add(spin);
      if (r() < 0.3) keys.add('KeyK');
      if (r() < 0.15) keys.add('Space'); // ollie out of a grind
    }
    return {
      keys,
      respawn: r() < 0.004,
      camera: r() < 0.01,
      pause: r() < 0.004,
    };
  };
}

async function heapUsed(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize;
}

async function step(page, seconds) {
  return page.evaluate((s) => {
    const g = window.__game;
    g.advance(s);
    const st = g.state();
    return {
      screen: st.screen,
      mapId: st.mapId,
      state: st.rider && st.rider.state,
      pos: st.rider && st.rider.pos,
      vel: st.rider && st.rider.vel,
      safetyResets: st.rider ? st.rider.safetyResets : 0,
      bounds: st.bounds,
      stats: st.stats,
      errors: st.errors.length,
    };
  }, seconds);
}

async function startMap(page, mapId) {
  await page.evaluate((id) => {
    window.__game.startFreeRoam(id);
    window.__game.setManual(true);
  }, mapId);
}

/** Start `mapId` with the default camera, stand still for 2 s, then measure heap and GPU resources. */
async function measureOn(page, cdp, mapId) {
  await page.evaluate(() => window.__game.changeSetting('camera.mode', 'follow'));
  await startMap(page, mapId);
  await step(page, 2);
  return { heap: await heapUsed(cdp), gpu: await page.evaluate(() => window.__game.gpuAudit()) };
}

/** The renderer holds exactly the geometries and textures the current scene uses (nothing leaked). */
function expectNoGpuLeak(gpu, what) {
  expect(gpu.geometries, `${what}: renderer geometries == scene geometries`).toBe(gpu.sceneGeometries);
  expect(gpu.textures, `${what}: renderer textures == scene textures`).toBe(gpu.sceneTextures);
}

/**
 * Drive the game with random input for `seconds` of simulated time on the current map.
 * Every chunk is checked; returns per-map totals.
 */
async function soak(page, play, seconds, log) {
  const held = new Set();
  let snap = await step(page, 0);
  const totals = { mapId: snap.mapId, chunks: 0, pauses: 0, respawns: 0, cameraChanges: 0, maxOutside: 0 };
  const chunks = Math.round(seconds / CHUNK);
  for (let i = 0; i < chunks; i++) {
    const d = play(snap);
    for (const k of [...held]) {
      if (!d.keys.has(k)) {
        await page.keyboard.up(k);
        held.delete(k);
      }
    }
    for (const k of d.keys) {
      if (!held.has(k)) {
        await page.keyboard.down(k);
        held.add(k);
      }
    }
    if (d.respawn) {
      await page.keyboard.press('KeyR');
      totals.respawns++;
    }
    if (d.camera) {
      await page.keyboard.press('KeyC');
      totals.cameraChanges++;
    }
    if (d.pause) {
      // Pause and resume with the keyboard; resuming resets held keys, so release ours too.
      await page.keyboard.press('Escape');
      expect((await step(page, 0)).screen, 'Escape pauses').toBe('pause');
      await page.keyboard.press('Escape');
      for (const k of held) await page.keyboard.up(k);
      held.clear();
      totals.pauses++;
    }
    snap = await step(page, CHUNK);
    totals.chunks++;
    const where = `${snap.mapId} t=${((i + 1) * CHUNK).toFixed(2)}s`;
    expect(snap.screen, `${where}: still playing`).toBe('play');
    for (const v of [snap.pos.x, snap.pos.y, snap.pos.z, snap.vel.x, snap.vel.y, snap.vel.z]) expect(Number.isFinite(v), `${where}: finite position/velocity`).toBe(true);
    const b = snap.bounds;
    const outside = Math.max(b.minX - snap.pos.x, snap.pos.x - b.maxX, b.minZ - snap.pos.z, snap.pos.z - b.maxZ, 0);
    totals.maxOutside = Math.max(totals.maxOutside, outside);
    expect(outside, `${where}: rider inside the map bounds (${JSON.stringify(snap.pos)})`).toBeLessThanOrEqual(0.01);
    expect(snap.stats.outOfBounds, `${where}: no tick outside the bounds`).toBe(0);
    expect(snap.errors, `${where}: no errors caught by the game`).toBe(0);
  }
  for (const k of held) await page.keyboard.up(k);
  Object.assign(totals, {
    simSeconds: chunks * CHUNK,
    ticks: snap.stats.ticks,
    distance: Math.round(snap.stats.distance),
    maxSpeed: +snap.stats.maxSpeed.toFixed(2),
    tricks: snap.stats.tricks,
    bails: snap.stats.bails,
    airTime: +snap.stats.airTime.toFixed(1),
    grindTime: +snap.stats.grindTime.toFixed(1),
    outOfBoundsTicks: snap.stats.outOfBounds,
    safetyResets: snap.safetyResets,
  });
  log.push(totals);
  return totals;
}

function collectWarnings(page) {
  const warnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  return warnings;
}

function writeReport(name, report) {
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(`reports/soak-${name}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n[soak:${name}]\n` + JSON.stringify(report, null, 2));
}

test(`soak: ${SIM_SECONDS}s of random play across every map`, async ({ page }) => {
  const errors = await openGame(page);
  const warnings = collectWarnings(page);
  const cdp = await page.context().newCDPSession(page);
  const play = createPlayer(SEED);
  const t0 = Date.now();

  // Baseline: the training map freshly started.
  const { heap: heapStart, gpu: gpuStart } = await measureOn(page, cdp, 'training');

  const log = [];
  for (const mapId of MAPS) {
    await startMap(page, mapId);
    await soak(page, play, SIM_SECONDS / MAPS.length, log);
    const gpu = await page.evaluate(() => window.__game.gpuAudit());
    log[log.length - 1].gpu = gpu;
    expectNoGpuLeak(gpu, `after ${mapId}`);
  }

  // Back to the same map as the baseline: everything from the other maps must be released.
  const { heap: heapEnd, gpu: gpuEnd } = await measureOn(page, cdp, 'training');

  const report = {
    seed: SEED,
    simSeconds: log.reduce((a, m) => a + m.simSeconds, 0),
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    heapStartMB: +(heapStart / 1048576).toFixed(2),
    heapEndMB: +(heapEnd / 1048576).toFixed(2),
    heapGrowthMB: +((heapEnd - heapStart) / 1048576).toFixed(2),
    gpuStart,
    gpuEnd,
    errors,
    warnings: [...new Set(warnings)],
    maps: log,
  };
  writeReport('maps', report);

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  expect(report.simSeconds).toBeGreaterThanOrEqual(SIM_SECONDS);
  expectNoGpuLeak(gpuStart, 'baseline');
  expectNoGpuLeak(gpuEnd, 'back on the first map');
  expect(gpuEnd.geometries, 'same map, same GPU geometry count').toBe(gpuStart.geometries);
  expect(gpuEnd.textures, 'same map, same GPU texture count').toBe(gpuStart.textures);
  expect(heapEnd - heapStart, 'JS heap growth').toBeLessThan(HEAP_GROWTH_LIMIT);
  // The random player really played: it moved and landed tricks on every map.
  for (const m of log) {
    expect(m.distance, `${m.mapId} distance`).toBeGreaterThan(m.simSeconds);
    if (m.simSeconds >= 30) expect(m.tricks, `${m.mapId} tricks`).toBeGreaterThan(0);
  }
});

test(`soak: ${SIM_SECONDS}s of random play in one session (skatepark)`, async ({ page }) => {
  const errors = await openGame(page);
  const warnings = collectWarnings(page);
  const cdp = await page.context().newCDPSession(page);
  const play = createPlayer(SEED + 1);
  const t0 = Date.now();
  await startMap(page, 'skatepark');

  // One long session, sampled every minute. The first minute is warm-up (JIT, shader compile).
  const log = [];
  const samples = [];
  const minutes = Math.max(2, Math.round(SIM_SECONDS / 60));
  for (let m = 0; m < minutes; m++) {
    await soak(page, play, SIM_SECONDS / minutes, log);
    samples.push({ heap: await heapUsed(cdp), gpu: await page.evaluate(() => window.__game.gpuAudit()) });
  }
  const last = log[log.length - 1];
  const report = {
    seed: SEED + 1,
    simSeconds: log.reduce((a, m) => a + m.simSeconds, 0),
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    heapMB: samples.map((s) => +(s.heap / 1048576).toFixed(2)),
    gpu: samples.map((s) => s.gpu),
    errors,
    warnings: [...new Set(warnings)],
    session: last,
  };
  writeReport('session', report);

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  const warm = samples[0];
  const end = samples[samples.length - 1];
  expect(end.heap - warm.heap, 'JS heap growth after warm-up').toBeLessThan(HEAP_GROWTH_LIMIT / 2);
  for (const [i, smp] of samples.entries()) expectNoGpuLeak(smp.gpu, `minute ${i + 1}`);
  expect(end.gpu.geometries, 'no geometry growth during play').toBe(warm.gpu.geometries);
  expect(end.gpu.textures, 'no texture growth during play').toBe(warm.gpu.textures);
  expect(last.distance).toBeGreaterThan(last.simSeconds);
  if (last.simSeconds >= 30) expect(last.tricks).toBeGreaterThan(0);
});

test('soak: 42 session restarts keep live object counts flat (no JS-side leak)', async ({ page }) => {
  const errors = await openGame(page);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(async () => {
    window.__THREE = await import('three');
  });
  const kinds = {
    Object3D: 'window.__THREE.Object3D.prototype',
    BufferGeometry: 'window.__THREE.BufferGeometry.prototype',
    Material: 'window.__THREE.Material.prototype',
    Texture: 'window.__THREE.Texture.prototype',
    Array: 'Array.prototype',
    Map: 'Map.prototype',
    HTMLElement: 'HTMLElement.prototype',
  };
  // Live instances per prototype, after GC (DevTools "queryObjects").
  async function census() {
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
    const out = {};
    for (const [k, expr] of Object.entries(kinds)) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
      const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
      const { result: n } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
      await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
      out[k] = n.value;
    }
    out.heapMB = +((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(2);
    return out;
  }
  const restarts = (n) =>
    page.evaluate((count) => {
      for (let k = 0; k < count; k++) {
        window.__game.startFreeRoam(['training', 'skatepark', 'plaza'][k % 3]);
        window.__game.setManual(true);
        window.__game.advance(0.5);
      }
    }, n);
  // Batches are multiples of 3 so every census is taken on the same map (plaza).
  await restarts(9); // warm-up
  const a = await census();
  await restarts(21);
  const b = await census();
  await restarts(21);
  const c = await census();
  writeReport('objects', { afterWarmup: a, after30: b, after51: c });
  for (const k of Object.keys(kinds)) {
    // A few objects of slack for lazily created caches; a leak would add some per session.
    expect(c[k] - a[k], `${k} instances after 42 more sessions`).toBeLessThanOrEqual(5);
  }
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

const REALTIME_SECONDS = Number(process.env.SOAK_REALTIME_SECONDS || 60);

test(`soak: ${REALTIME_SECONDS}s of real-time play (requestAnimationFrame loop, not manual stepping)`, async ({ page }) => {
  const errors = await openGame(page);
  const warnings = collectWarnings(page);
  const play = createPlayer(SEED + 2);
  await page.evaluate(() => {
    window.__frames = 0;
    const count = () => {
      window.__frames++;
      requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
    window.__game.startFreeRoam('plaza');
  });
  const read = () =>
    page.evaluate(() => {
      const st = window.__game.state();
      return { screen: st.screen, state: st.rider.state, pos: st.rider.pos, ticks: st.ticks, stats: st.stats, errors: st.errors.length };
    });
  const held = new Set();
  const t0 = Date.now();
  const start = await read();
  let snap = start;
  while (Date.now() - t0 < REALTIME_SECONDS * 1000) {
    const d = play(snap);
    for (const k of [...held]) {
      if (!d.keys.has(k)) {
        await page.keyboard.up(k);
        held.delete(k);
      }
    }
    for (const k of d.keys) {
      if (!held.has(k)) {
        await page.keyboard.down(k);
        held.add(k);
      }
    }
    await page.waitForTimeout(250);
    snap = await read();
    expect(snap.screen).toBe('play');
    for (const v of [snap.pos.x, snap.pos.y, snap.pos.z]) expect(Number.isFinite(v)).toBe(true);
    expect(snap.stats.outOfBounds).toBe(0);
    expect(snap.errors).toBe(0);
  }
  for (const k of held) await page.keyboard.up(k);
  const wall = (Date.now() - t0) / 1000;
  const frames = await page.evaluate(() => window.__frames);
  const report = {
    seed: SEED + 2,
    wallSeconds: +wall.toFixed(1),
    simTicks: snap.ticks - start.ticks,
    simSeconds: +((snap.ticks - start.ticks) / 60).toFixed(1),
    framesRendered: frames,
    fps: +(frames / wall).toFixed(1),
    note: 'Software WebGL (SwiftShader) in headless Chromium; fps says nothing about real GPUs.',
    errors,
    warnings: [...new Set(warnings)],
    stats: snap.stats,
  };
  writeReport('realtime', report);
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  // The fixed-step loop keeps simulating while frames are slow (up to its catch-up limit).
  expect(report.simTicks).toBeGreaterThan(0);
  expect(snap.stats.distance).toBeGreaterThan(10);
});
