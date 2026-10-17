// Shop and garage: categories, buy / equip, live 3D preview of the actual rider
// model with the chosen parts, stat comparison, part colors and patterns.
//
// Accessibility: categories are tabs; every item is a native button with its
// price in text; colors are named buttons (aria-pressed) plus a labelled color
// input; patterns are named buttons, so nothing depends on color alone.

import * as THREE from 'three';
import { buildVehicleMesh, describeMesh, disposeObject } from '../rider/rider.js';
import {
  VEHICLE_SLOTS,
  buildLook,
  canBuy,
  categoryById,
  colorKey,
  computeStats,
  isEquipped,
  isOwned,
  itemById,
  itemsIn,
  slotOf,
  statDelta,
} from '../game/customize.js';
import { esc } from './menu.js';

const STAT_INFO = [
  { key: 'topSpeed', label: 'Top speed', unit: 'km/h', scale: 3.6, max: 15 * 3.6 },
  { key: 'turnRate', label: 'Turning', unit: '', scale: 1, max: 4.5 },
  { key: 'grip', label: 'Grip', unit: '', scale: 1, max: 16 },
  { key: 'jump', label: 'Ollie', unit: 'm/s', scale: 1, max: 9 },
  { key: 'trickBonus', label: 'Trick bonus', unit: '×', scale: 1, max: 2 },
];

// ---------------------------------------------------------------------------
// 3D preview (one renderer, reused every time the shop opens)
// ---------------------------------------------------------------------------
let preview = null;
function getPreview() {
  if (preview) return preview;
  const canvas = document.createElement('canvas');
  canvas.id = 'shop-preview';
  canvas.className = 'shop-preview';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D preview of your rider and board');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.04, 40), new THREE.MeshLambertMaterial({ color: '#3a4250' }));
  floor.position.y = -0.02;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
  const pivot = new THREE.Group();
  scene.add(pivot);
  let mesh = null;
  let angle = 0.6;
  let lookKey = '';
  preview = {
    canvas,
    renderer,
    setLook(look) {
      const key = JSON.stringify(look);
      if (key === lookKey) return;
      lookKey = key;
      if (mesh) {
        pivot.remove(mesh);
        disposeObject(mesh);
      }
      mesh = buildVehicleMesh(look);
      pivot.add(mesh);
    },
    rotate(d) {
      angle += d;
    },
    setAngle(a) {
      angle = a;
    },
    render(dt, { reducedMotion = false } = {}) {
      if (!canvas.isConnected) return;
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 300;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      if (!reducedMotion) angle += dt * 0.5;
      pivot.rotation.y = angle;
      camera.position.set(0, 1.25, 3.6);
      camera.lookAt(0, 0.72, 0);
      renderer.render(scene, camera);
    },
    describe() {
      return mesh ? describeMesh(mesh) : null;
    },
    /** Small fingerprint of the rendered pixels (tests compare before/after). */
    pixelHash() {
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let hsh = 2166136261;
      for (let i = 0; i < px.length; i += 16) hsh = Math.imul(hsh ^ px[i] ^ (px[i + 1] << 8) ^ (px[i + 2] << 16), 16777619);
      return (hsh >>> 0).toString(16);
    },
  };
  return preview;
}

export function shopPreview() {
  return preview;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
function fmtDelta(k, v) {
  const info = STAT_INFO.find((s) => s.key === k);
  const val = v * (info ? info.scale : 1);
  const sign = val > 0 ? '+' : '';
  const label = info ? info.label : k;
  return `${label} ${sign}${Math.abs(val) < 0.1 ? val.toFixed(2) : val.toFixed(1)}`;
}

function itemCard(item, ctx) {
  const { profile, catalog, vehicles } = ctx;
  const owned = isOwned(profile, item.id);
  const equipped = isEquipped(profile, catalog, item.id);
  const delta = statDelta(vehicles, catalog, profile, item.id);
  const effect = delta && Object.keys(delta).length ? Object.entries(delta).map(([k, v]) => fmtDelta(k, v)).join(', ') : item.stats ? 'Stock part' : item.description || 'Cosmetic';
  const buy = canBuy(profile, item);
  let action;
  if (equipped) action = `<button class="btn" disabled aria-label="${esc(item.name)} is equipped"><span aria-hidden="true">✔</span> Equipped</button>`;
  else if (owned) action = `<button class="btn primary" data-equip="${item.id}" aria-label="Equip ${esc(item.name)}">Equip</button>`;
  else if (buy.ok) action = `<button class="btn primary" data-buy="${item.id}" aria-label="Buy ${esc(item.name)} for ${item.price} Bolts"><span aria-hidden="true">⚡</span> Buy ${item.price}</button>`;
  else
    action = `<button class="btn" data-buy="${item.id}" aria-disabled="true" aria-label="${esc(item.name)} costs ${item.price} Bolts. You need ${buy.short} more."><span aria-hidden="true">🔒</span> ${item.price} <span class="small">(need ${buy.short} more)</span></button>`;
  return `<li class="shop-item${equipped ? ' equipped' : ''}" data-item="${item.id}">
    <div class="row"><strong>${esc(item.name)}</strong><span class="spacer"></span>
      ${owned ? `<span class="chip good">${equipped ? '<span aria-hidden="true">✔</span> Equipped' : 'Owned'}</span>` : `<span class="bolts"><span aria-hidden="true">⚡</span> ${item.price}<span class="sr-only"> Bolts</span></span>`}</div>
    <p class="muted small">${esc(effect)}</p>
    <div class="row">${action}<button class="btn small-btn" data-try="${item.id}" aria-label="Preview ${esc(item.name)}">Preview</button></div>
  </li>`;
}

function statsHtml(ctx, tryId) {
  const { profile, catalog, vehicles } = ctx;
  const vehicle = profile.equipped.vehicle;
  const cur = computeStats(vehicles, catalog, profile, vehicle);
  const delta = tryId ? statDelta(vehicles, catalog, profile, tryId) || {} : {};
  return `<h3>${esc(vehicles[vehicle].name)} stats</h3><dl class="statlist">${STAT_INFO.map((s) => {
    const v = cur[s.key] * s.scale;
    const d = (delta[s.key] || 0) * s.scale;
    const pct = Math.max(4, Math.min(100, (v / s.max) * 100));
    const dTxt = d ? ` <span class="${d > 0 ? 'delta-up' : 'delta-down'}">(${d > 0 ? '▲ +' : '▼ '}${d.toFixed(2)})</span>` : '';
    return `<div class="stat"><dt>${s.label}</dt><dd><span class="progress"><span style="width:${pct}%"></span></span> ${v.toFixed(s.key === 'topSpeed' ? 0 : 2)}${s.unit ? ' ' + s.unit : ''}${dTxt}</dd></div>`;
  }).join('')}</dl>`;
}

function customizeHtml(ctx, slotKey) {
  const { profile, catalog, colorblindOnly } = ctx;
  const vehicle = profile.equipped.vehicle;
  const slots = Object.keys(VEHICLE_SLOTS[vehicle]).map((s) => ({ key: colorKey(vehicle, s), label: `${s[0].toUpperCase() + s.slice(1)}` }));
  for (const c of ['helmet', 'pads', 'trail']) slots.push({ key: c, label: c[0].toUpperCase() + c.slice(1) });
  const active = slots.find((s) => s.key === slotKey) || slots[0];
  const look = buildLook(profile, catalog);
  const curColor =
    active.key.includes('.') ? look.parts[active.key.split('.')[1]].color : active.key === 'helmet' ? look.helmet.color : active.key === 'pads' ? look.pads.color : look.trail.color;
  const curPattern = active.key.includes('.') ? look.parts[active.key.split('.')[1]].pattern : 'solid';
  const colors = colorblindOnly ? catalog.colors.filter((c) => catalog.colorblindSafe.includes(c.hex)) : catalog.colors;
  return `<h3 id="cust-h">Colors &amp; patterns</h3>
    <label for="cust-slot">Part</label>
    <select id="cust-slot">${slots.map((s) => `<option value="${s.key}" ${s.key === active.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
    <div class="swatches" role="group" aria-label="Color for ${esc(active.label)}">
      ${colors
        .map(
          (c) =>
            `<button class="swatch" data-color="${c.hex}" aria-pressed="${c.hex.toLowerCase() === String(curColor).toLowerCase()}" title="${esc(c.name)}"><span class="sw" style="background:${c.hex}" aria-hidden="true"></span><span class="sw-name">${esc(c.name)}</span></button>`,
        )
        .join('')}
    </div>
    <div class="row"><label for="cust-color">Custom color</label><input type="color" id="cust-color" value="${esc(curColor)}" /></div>
    ${
      active.key.includes('.')
        ? `<div class="patterns" role="group" aria-label="Pattern for ${esc(active.label)}">${catalog.patterns
            .map((p) => `<button class="btn pattern pat-${p.id}" data-pattern="${p.id}" aria-pressed="${p.id === curPattern}"><span class="pat-icon" aria-hidden="true"></span>${esc(p.name)}</button>`)
            .join('')}</div>`
        : ''
    }
    <p class="muted small">Every color has a name and patterns let you tell parts apart without relying on color.</p>`;
}

/**
 * Show the shop. ctx: { profile, catalog, vehicles, reducedMotion, colorblindOnly }.
 * actions: { back, buy(id), equip(id), setColor(key, {color|pattern}), announce(text) }
 */
export function showShop(sm, ctxIn, actions, state = {}) {
  const st = { category: state.category || 'vehicle', tryId: state.tryId || null, slotKey: state.slotKey || null };
  let ctx = ctxIn;
  const pv = getPreview();

  const render = (focusSel = null) => {
    const { profile, catalog } = ctx;
    const vehicle = profile.equipped.vehicle;
    const cats = catalog.categories.filter((c) => !c.vehicle || c.vehicle === vehicle);
    if (!cats.some((c) => c.id === st.category)) st.category = 'vehicle';
    const cat = categoryById(catalog, st.category);
    const items = itemsIn(catalog, st.category);
    const html = `
      <p class="row"><span class="chip"><span aria-hidden="true">⚡</span> <span class="bolts" id="shop-bolts">${profile.bolts}</span>&nbsp;Bolts</span>
        <span class="chip">Riding: ${esc(ctx.vehicles[vehicle].name)}</span></p>
      <div class="shop-layout">
        <div class="shop-main">
          <div role="tablist" aria-label="Shop categories" class="tabs row shop-cats">
            ${cats
              .map(
                (c) =>
                  `<button role="tab" class="btn tab" id="stab-${c.id}" aria-controls="shop-panel" aria-selected="${c.id === st.category}" tabindex="${c.id === st.category ? 0 : -1}" data-cat="${c.id}">${esc(c.label)}</button>`,
              )
              .join('')}
          </div>
          <div role="tabpanel" id="shop-panel" aria-labelledby="stab-${cat.id}">
            <p class="muted small">${esc(cat.effect ? `Affects: ${cat.effect}` : '')}</p>
            <ul class="shop-items" role="list">${items.map((i) => itemCard(i, ctx)).join('')}</ul>
          </div>
        </div>
        <aside class="shop-side" aria-label="Preview and customization">
          <div id="preview-slot"></div>
          <div class="row"><button class="btn small-btn" id="rot-l" aria-label="Rotate preview left">◀</button>
            <p id="preview-desc" class="small" aria-live="polite"></p>
            <button class="btn small-btn" id="rot-r" aria-label="Rotate preview right">▶</button></div>
          <div id="shop-stats">${statsHtml(ctx, st.tryId)}</div>
          <div id="shop-custom">${customizeHtml(ctx, st.slotKey)}</div>
        </aside>
      </div>`;
    const el = sm.show({ id: 'shop', title: 'Shop &amp; garage', onBack: actions.back, label: 'main menu', html, focus: focusSel || `#stab-${st.category}` });
    el.querySelector('#preview-slot').appendChild(pv.canvas);
    updatePreview();
    wire(el);
    return el;
  };

  function updatePreview() {
    const { profile, catalog } = ctx;
    let look = buildLook(profile, catalog);
    let what = 'Your setup';
    if (st.tryId) {
      const item = itemById(catalog, st.tryId);
      const s = slotOf(catalog, item);
      const ov = {};
      if (s.slot === 'vehicle') ov.vehicle = item.vehicle;
      else if (s.vehicle) ov.parts = { [s.slot]: item.id };
      else ov[s.slot] = item.id;
      if (s.vehicle && s.vehicle !== profile.equipped.vehicle) ov.vehicle = s.vehicle;
      look = buildLook(profile, catalog, ov);
      what = `Previewing ${item.name}`;
    }
    pv.setLook(look);
    const d = document.getElementById('preview-desc');
    if (d) d.textContent = what;
  }

  function wire(el) {
    const tabs = [...el.querySelectorAll('[role="tab"]')];
    for (const b of tabs) {
      b.addEventListener('click', () => {
        st.category = b.dataset.cat;
        st.tryId = null;
        render(`#stab-${st.category}`);
      });
      b.addEventListener('keydown', (e) => {
        const i = tabs.indexOf(b);
        let j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') j = (i + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = tabs.length - 1;
        if (j >= 0) {
          e.preventDefault();
          st.category = tabs[j].dataset.cat;
          st.tryId = null;
          render(`#stab-${st.category}`);
        }
      });
    }
    for (const li of el.querySelectorAll('.shop-item')) {
      const id = li.dataset.item;
      const tryOn = () => {
        if (st.tryId === id) return;
        st.tryId = id;
        updatePreview();
        el.querySelector('#shop-stats').innerHTML = statsHtml(ctx, id);
      };
      li.addEventListener('mouseenter', tryOn);
      li.addEventListener('focusin', tryOn);
    }
    for (const b of el.querySelectorAll('[data-try]')) b.addEventListener('click', () => actions.announce(document.getElementById('preview-desc').textContent));
    for (const b of el.querySelectorAll('[data-buy]'))
      b.addEventListener('click', () => {
        const item = itemById(ctx.catalog, b.dataset.buy);
        if (b.getAttribute('aria-disabled') === 'true') {
          actions.announce(`Not enough Bolts for ${item.name}. You need ${item.price - ctx.profile.bolts} more.`);
          return;
        }
        ctx = actions.buy(item.id) || ctx;
        st.tryId = null;
        render(`[data-item="${item.id}"] [data-equip], [data-item="${item.id}"] button`);
      });
    for (const b of el.querySelectorAll('[data-equip]'))
      b.addEventListener('click', () => {
        const id = b.dataset.equip;
        ctx = actions.equip(id) || ctx;
        st.tryId = null;
        render(`[data-item="${id}"] [data-try]`);
      });
    el.querySelector('#rot-l').addEventListener('click', () => pv.rotate(-0.5));
    el.querySelector('#rot-r').addEventListener('click', () => pv.rotate(0.5));
    wireCustom(el);
  }

  function wireCustom(el) {
    const slotKey = () => el.querySelector('#cust-slot').value;
    const apply = (change, focusSel) => {
      ctx = actions.setColor(slotKey(), change) || ctx;
      st.slotKey = slotKey();
      st.tryId = null;
      el.querySelector('#shop-custom').innerHTML = customizeHtml(ctx, st.slotKey);
      wireCustom(el);
      updatePreview();
      const f = focusSel && el.querySelector(focusSel);
      if (f) f.focus();
    };
    for (const b of el.querySelectorAll('[data-color]')) b.addEventListener('click', () => apply({ color: b.dataset.color }, `[data-color="${b.dataset.color}"]`));
    for (const b of el.querySelectorAll('[data-pattern]')) b.addEventListener('click', () => apply({ pattern: b.dataset.pattern }, `[data-pattern="${b.dataset.pattern}"]`));
    const ci = el.querySelector('#cust-color');
    ci.addEventListener('change', () => apply({ color: ci.value }, '#cust-color'));
    const sel = el.querySelector('#cust-slot');
    sel.onchange = () => {
      st.slotKey = sel.value;
      el.querySelector('#shop-custom').innerHTML = customizeHtml(ctx, st.slotKey);
      wireCustom(el);
      el.querySelector('#cust-slot').focus();
    };
  }

  render();
  return {
    get state() {
      return { ...st };
    },
    renderPreview(dt) {
      pv.render(dt, { reducedMotion: ctx.reducedMotion });
    },
  };
}
