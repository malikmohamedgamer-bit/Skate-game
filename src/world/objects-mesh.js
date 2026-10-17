// Three.js meshes for the primitives produced by objects.js. Visuals always match
// the collision shapes because both are built from the same primitive data.

import * as THREE from 'three';
import { groundAt } from '../physics/collide.js';
import { toWorld } from '../physics/math.js';

/** Palettes: default, high contrast, and colorblind-safe (Okabe-Ito based). */
export const PALETTES = {
  default: {
    ramp: '#c79a62',
    rampSide: '#9c7442',
    metal: '#d9dee5',
    coping: '#e7ebf0',
    concrete: '#b9b4ab',
    concreteDark: '#8d8a84',
    wood: '#8a5a33',
    barrier: '#e8862a',
    wall: '#a7a29a',
    curbEdge: '#e8d54a',
    foliage: '#4f8f3a',
    trunk: '#6b4a2d',
    building: '#c7b9a5',
    window: '#6d8fb3',
    car: '#c43c3c',
    pickup: '#ffb000',
    checkpoint: '#56b4e9',
    edges: null,
  },
  highContrast: {
    ramp: '#f2f2f2',
    rampSide: '#bdbdbd',
    metal: '#ffff00',
    coping: '#ffff00',
    concrete: '#9a9a9a',
    concreteDark: '#6a6a6a',
    wood: '#ffffff',
    barrier: '#ff4d4d',
    wall: '#ff4d4d',
    curbEdge: '#ffff00',
    foliage: '#00c060',
    trunk: '#ffffff',
    building: '#5a5a5a',
    window: '#00ffff',
    car: '#ff4d4d',
    pickup: '#00ffff',
    checkpoint: '#ff00ff',
    edges: '#000000',
  },
  colorblind: {
    ramp: '#56b4e9',
    rampSide: '#3b8bbf',
    metal: '#f0e442',
    coping: '#f0e442',
    concrete: '#b9b4ab',
    concreteDark: '#8d8a84',
    wood: '#cc79a7',
    barrier: '#d55e00',
    wall: '#a7a29a',
    curbEdge: '#f0e442',
    foliage: '#009e73',
    trunk: '#6b4a2d',
    building: '#c7b9a5',
    window: '#0072b2',
    car: '#d55e00',
    pickup: '#e69f00',
    checkpoint: '#0072b2',
    edges: null,
  },
};

export function choosePalette({ highContrast = false, colorblind = false } = {}) {
  if (highContrast) return PALETTES.highContrast;
  if (colorblind) return PALETTES.colorblind;
  return PALETTES.default;
}

export function createMaterialCache() {
  const cache = new Map();
  return {
    get(color, opts = {}) {
      const key = color + JSON.stringify(opts);
      if (!cache.has(key)) cache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
      return cache.get(key);
    },
    dispose() {
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
}

function mesh(geo, mat, shadows = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

function placeLocal(obj, p, lx, y, lz) {
  const w = toWorld(lx, lz, p.cx, p.cz, p.rot);
  obj.position.set(w.x, y, w.z);
  obj.rotation.y = p.rot;
  return obj;
}

function addEdges(group, obj, color) {
  if (!color) return;
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(obj.geometry, 25), new THREE.LineBasicMaterial({ color }));
  e.position.copy(obj.position);
  e.rotation.copy(obj.rotation);
  group.add(e);
}

function boxMesh(p, pal, mats) {
  const g = new THREE.Group();
  const w = p.hw * 2;
  const d = p.hd * 2;
  const h = p.height;
  const y0 = p.baseY;
  const kind = p.kind;
  const custom = p.color;
  if (kind === 'bench') {
    const seat = mesh(new THREE.BoxGeometry(w, 0.08, d), mats.get(custom || pal.wood));
    placeLocal(seat, p, 0, y0 + h - 0.04, 0);
    g.add(seat);
    for (const s of [-1, 1]) {
      const leg = mesh(new THREE.BoxGeometry(w * 0.8, h - 0.08, 0.08), mats.get(pal.concreteDark));
      placeLocal(leg, p, 0, y0 + (h - 0.08) / 2, s * (p.hd - 0.25));
      g.add(leg);
    }
    if (p.def.grind) {
      const edge = mesh(new THREE.BoxGeometry(0.06, 0.03, d), mats.get(pal.metal));
      placeLocal(edge, p, 0, y0 + h + 0.005, 0);
      g.add(edge);
    }
    addEdges(g, seat, pal.edges);
    return g;
  }
  if (kind === 'tree') {
    const trunk = mesh(new THREE.CylinderGeometry(0.18, 0.24, h, 8), mats.get(pal.trunk));
    placeLocal(trunk, p, 0, y0 + h / 2, 0);
    const crown = mesh(new THREE.IcosahedronGeometry(Math.max(1.2, w * 2.2), 0), mats.get(pal.foliage, { flatShading: true }));
    placeLocal(crown, p, 0, y0 + h + 0.8, 0);
    g.add(trunk, crown);
    return g;
  }
  if (kind === 'lamp') {
    const pole = mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 8), mats.get(pal.concreteDark));
    placeLocal(pole, p, 0, y0 + h / 2, 0);
    const head = mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), mats.get('#fff4c2', { emissive: '#665a20' }));
    placeLocal(head, p, 0, y0 + h, 0);
    g.add(pole, head);
    return g;
  }
  if (kind === 'car') {
    const body = mesh(new THREE.BoxGeometry(w, h * 0.55, d), mats.get(custom || pal.car));
    placeLocal(body, p, 0, y0 + h * 0.275 + 0.15, 0);
    const cabin = mesh(new THREE.BoxGeometry(w * 0.9, h * 0.4, d * 0.5), mats.get(pal.window));
    placeLocal(cabin, p, 0, y0 + h * 0.55 + 0.15 + h * 0.2, -d * 0.05);
    g.add(body, cabin);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const wheel = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), mats.get('#222222'));
        wheel.rotation.z = Math.PI / 2;
        const wp = toWorld(sx * (p.hw - 0.05), sz * (p.hd - 0.6), p.cx, p.cz, p.rot);
        const holder = new THREE.Group();
        holder.position.set(wp.x, y0 + 0.3, wp.z);
        holder.rotation.y = p.rot;
        holder.add(wheel);
        g.add(holder);
      }
    addEdges(g, body, pal.edges);
    return g;
  }
  const colors = {
    barrier: pal.barrier,
    wall: pal.wall,
    curb: pal.concrete,
    ledge: pal.concrete,
    platform: pal.concrete,
    planter: pal.concreteDark,
    building: pal.building,
    block: pal.concrete,
    table: pal.wood,
    box: pal.concrete,
  };
  const main = mesh(new THREE.BoxGeometry(w, h, d), mats.get(custom || colors[kind] || pal.concrete));
  placeLocal(main, p, 0, y0 + h / 2, 0);
  g.add(main);
  addEdges(g, main, pal.edges);
  if (kind === 'barrier') {
    const stripe = mesh(new THREE.BoxGeometry(w + 0.01, h * 0.18, d + 0.01), mats.get('#ffffff'), false);
    placeLocal(stripe, p, 0, y0 + h * 0.7, 0);
    g.add(stripe);
  } else if (kind === 'curb') {
    // Painted edge so the step is visible (also a cue in high contrast).
    for (const [lx, lz, ww, dd] of [
      [0, -p.hd, w, 0.12],
      [0, p.hd, w, 0.12],
      [-p.hw, 0, 0.12, d],
      [p.hw, 0, 0.12, d],
    ]) {
      const e = mesh(new THREE.BoxGeometry(ww + 0.01, 0.02, dd + 0.01), mats.get(pal.curbEdge), false);
      placeLocal(e, p, lx, y0 + h + 0.002, lz);
      g.add(e);
    }
  } else if (kind === 'planter') {
    const soil = mesh(new THREE.BoxGeometry(w * 0.9, 0.05, d * 0.9), mats.get(pal.foliage), false);
    placeLocal(soil, p, 0, y0 + h + 0.01, 0);
    g.add(soil);
    const bush = mesh(new THREE.IcosahedronGeometry(Math.min(w, d) * 0.35, 0), mats.get(pal.foliage, { flatShading: true }));
    placeLocal(bush, p, 0, y0 + h + Math.min(w, d) * 0.3, 0);
    g.add(bush);
  } else if (kind === 'building') {
    const rows = Math.max(1, Math.floor(h / 3));
    for (let r = 0; r < rows; r++) {
      for (const s of [-1, 1]) {
        const win = mesh(new THREE.BoxGeometry(w * 0.8, 1.1, 0.04), mats.get(pal.window), false);
        placeLocal(win, p, 0, y0 + 1.6 + r * 3, s * (p.hd + 0.02));
        g.add(win);
      }
    }
  } else if (kind === 'ledge' && p.def.grind) {
    const edge = mesh(new THREE.BoxGeometry(p.hd >= p.hw ? 0.06 : w, 0.03, p.hd >= p.hw ? d : 0.06), mats.get(pal.metal), false);
    placeLocal(edge, p, 0, y0 + h + 0.005, 0);
    g.add(edge);
  }
  return g;
}

function profileGeometry(points, width) {
  // points: [[s, y], ...] closed profile in the (local z, y) plane; extruded along local x.
  const shape = new THREE.Shape(points.map(([s, y]) => new THREE.Vector2(s, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

function kickerMesh(p, pal, mats) {
  const g = new THREE.Group();
  const d = p.hd * 2;
  const geo = profileGeometry(
    [
      [0, 0],
      [d, p.height],
      [d, 0],
    ],
    p.hw * 2,
  );
  geo.translate(0, 0, -p.hd);
  const m = mesh(geo, [mats.get(p.color || pal.rampSide), mats.get(p.color || pal.ramp)]);
  placeLocal(m, p, 0, p.baseY, 0);
  g.add(m);
  addEdges(g, m, pal.edges);
  const plate = mesh(new THREE.BoxGeometry(p.hw * 2, 0.01, 0.25), mats.get(pal.metal), false);
  placeLocal(plate, p, 0, p.baseY + 0.005, -p.hd + 0.12);
  g.add(plate);
  return g;
}

function quarterMesh(p, pal, mats) {
  const g = new THREE.Group();
  const pts = [[0, 0]];
  const n = 18;
  for (let i = 1; i <= n; i++) {
    const s = (p.transition * i) / n;
    pts.push([s, p.radius - Math.sqrt(Math.max(0, p.radius * p.radius - s * s))]);
  }
  const depth = p.hd * 2;
  pts.push([depth, p.height], [depth, 0]);
  const geo = profileGeometry(pts, p.hw * 2);
  geo.translate(0, 0, -p.hd);
  const m = mesh(geo, [mats.get(p.color || pal.rampSide), mats.get(p.color || pal.ramp)]);
  placeLocal(m, p, 0, p.baseY, 0);
  g.add(m);
  addEdges(g, m, pal.edges);
  const coping = mesh(new THREE.CylinderGeometry(0.04, 0.04, p.hw * 2, 8), mats.get(pal.coping));
  coping.rotation.z = Math.PI / 2;
  const holder = new THREE.Group();
  placeLocal(holder, p, 0, p.baseY + p.height, -p.hd + p.transition);
  holder.add(coping);
  g.add(holder);
  return g;
}

function bowlMesh(p, pal, mats) {
  const g = new THREE.Group();
  const res = 0.25;
  const nx = Math.ceil((p.hw * 2) / res);
  const nz = Math.ceil((p.hd * 2) / res);
  const geo = new THREE.PlaneGeometry(p.hw * 2, p.hd * 2, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, p.heightAtLocal(pos.getX(i), pos.getZ(i)) - p.baseY);
  geo.computeVertexNormals();
  const m = mesh(geo, mats.get(p.color || pal.concrete), false);
  placeLocal(m, p, 0, p.baseY, 0);
  g.add(m);
  // Coping along the straight edges of the rim.
  const ih = p.inner;
  for (const [lx, lz, len, alongX] of [
    [0, p.hd, ih.hw * 2, true],
    [0, -p.hd, ih.hw * 2, true],
    [p.hw, 0, ih.hd * 2, false],
    [-p.hw, 0, ih.hd * 2, false],
  ]) {
    const c = mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 8), mats.get(pal.coping), false);
    if (alongX) c.rotation.z = Math.PI / 2;
    else c.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    placeLocal(holder, p, lx, p.baseY + 0.02, lz);
    holder.add(c);
    g.add(holder);
  }
  return g;
}

function stairsMesh(p, pal, mats) {
  const g = new THREE.Group();
  const w = p.hw * 2;
  if (p.topDepth > 0) {
    const land = mesh(new THREE.BoxGeometry(w, p.height, p.topDepth), mats.get(pal.concrete));
    placeLocal(land, p, 0, p.baseY + p.height / 2, -p.hd + p.topDepth / 2);
    g.add(land);
  }
  for (let i = 0; i < p.steps - 1; i++) {
    const h = p.height - (i + 1) * p.rise;
    const z0 = -p.hd + p.topDepth + i * p.run;
    const step = mesh(new THREE.BoxGeometry(w, h, p.run), mats.get(i % 2 ? pal.concrete : pal.concreteDark));
    placeLocal(step, p, 0, p.baseY + h / 2, z0 + p.run / 2);
    g.add(step);
    addEdges(g, step, pal.edges);
    const nose = mesh(new THREE.BoxGeometry(w, 0.015, 0.05), mats.get(pal.curbEdge), false);
    placeLocal(nose, p, 0, p.baseY + h + 0.008, z0 + 0.025);
    g.add(nose);
  }
  return g;
}

function railMesh(r, pal, mats, world) {
  const g = new THREE.Group();
  if (!r.visible) return g;
  const len = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y, r.b.z - r.a.z);
  const bar = mesh(new THREE.CylinderGeometry(r.radius, r.radius, len, 10), mats.get(r.color || pal.metal));
  bar.position.set((r.a.x + r.b.x) / 2, (r.a.y + r.b.y) / 2, (r.a.z + r.b.z) / 2);
  bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(r.dir.x, r.dir.y, r.dir.z));
  g.add(bar);
  const posts = Math.max(2, Math.ceil(len / 2.5) + 1);
  for (let i = 0; i < posts; i++) {
    const t = (i / (posts - 1)) * 0.94 + 0.03;
    const x = r.a.x + (r.b.x - r.a.x) * t;
    const z = r.a.z + (r.b.z - r.a.z) * t;
    const top = r.a.y + (r.b.y - r.a.y) * t;
    const gy = groundAt(world, x, z, top - 0.1).h;
    const h = top - gy;
    if (h < 0.05) continue;
    const post = mesh(new THREE.BoxGeometry(0.05, h, 0.05), mats.get(pal.concreteDark));
    post.position.set(x, gy + h / 2 - r.radius, z);
    g.add(post);
  }
  return g;
}

/** Build a group with meshes for every primitive in the world. */
export function buildObjectMeshes(world, { palette = PALETTES.default, shadows = true } = {}) {
  const mats = createMaterialCache();
  const root = new THREE.Group();
  root.name = 'objects';
  for (const p of world.prims) {
    let g;
    if (p.type === 'rail') g = railMesh(p, palette, mats, world);
    else if (p.type === 'box') g = boxMesh(p, palette, mats);
    else if (p.type === 'kicker') g = kickerMesh(p, palette, mats);
    else if (p.type === 'quarter') g = quarterMesh(p, palette, mats);
    else if (p.type === 'bowl') g = bowlMesh(p, palette, mats);
    else if (p.type === 'stairs') g = stairsMesh(p, palette, mats);
    else continue;
    g.name = p.id;
    if (!shadows) g.traverse((o) => (o.castShadow = false));
    root.add(g);
  }
  root.userData.dispose = () => {
    root.traverse((o) => o.geometry && o.geometry.dispose());
    mats.dispose();
  };
  return root;
}

/** Bolt-shaped pickups. Returns { group, update(dt, reducedMotion), setTaken(id, taken) }. */
export function buildPickupMeshes(pickups, { palette = PALETTES.default } = {}) {
  const group = new THREE.Group();
  group.name = 'pickups';
  const shape = new THREE.Shape();
  const pts = [
    [0.05, 0.42],
    [-0.2, 0.0],
    [-0.02, 0.0],
    [-0.1, -0.42],
    [0.2, 0.06],
    [0.02, 0.06],
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  geo.center();
  const mat = new THREE.MeshLambertMaterial({ color: palette.pickup, emissive: palette.pickup, emissiveIntensity: 0.35 });
  const ringGeo = new THREE.TorusGeometry(0.42, 0.03, 6, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: palette.pickup, transparent: true, opacity: 0.55 });
  const byId = new Map();
  for (const p of pickups) {
    const holder = new THREE.Group();
    holder.position.set(p.x, p.y, p.z);
    const bolt = new THREE.Mesh(geo, mat);
    bolt.castShadow = true;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    holder.add(bolt, ring);
    holder.userData = { baseY: p.y, phase: (p.x * 0.37 + p.z * 0.11) % (Math.PI * 2) };
    group.add(holder);
    byId.set(p.id, holder);
  }
  let t = 0;
  return {
    group,
    update(dt, reducedMotion) {
      t += dt;
      for (const h of byId.values()) {
        if (!h.visible) continue;
        h.rotation.y = t * 1.6 + h.userData.phase;
        h.position.y = h.userData.baseY + (reducedMotion ? 0 : Math.sin(t * 2 + h.userData.phase) * 0.08);
      }
    },
    setTaken(id, taken) {
      const h = byId.get(id);
      if (h) h.visible = !taken;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}

/** Checkpoint rings for time trials. Returns { group, setActive(index) }. */
export function buildCheckpointMeshes(world, checkpoints, { palette = PALETTES.default } = {}) {
  const group = new THREE.Group();
  group.name = 'checkpoints';
  const items = [];
  const ringGeo = new THREE.TorusGeometry(1, 0.08, 8, 40);
  const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 12, 8, 1, true);
  checkpoints.forEach((cp, i) => {
    const g = new THREE.Group();
    const y = groundAt(world, cp.x, cp.z, Infinity).h;
    g.position.set(cp.x, y, cp.z);
    const mat = new THREE.MeshBasicMaterial({ color: palette.checkpoint, transparent: true, opacity: 0.85 });
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.scale.setScalar(cp.radius);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    const beamMat = new THREE.MeshBasicMaterial({ color: palette.checkpoint, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 6;
    // A numbered tick on the beam: i + 1 small rings stacked, so order is not shown by color alone.
    for (let k = 0; k <= i; k++) {
      const tick = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 6, 16), mat);
      tick.rotation.x = Math.PI / 2;
      tick.position.y = 2.5 + k * 0.6;
      g.add(tick);
    }
    g.add(ring, beam);
    group.add(g);
    items.push({ g, mat, beamMat });
  });
  return {
    group,
    setActive(index) {
      items.forEach((it, i) => {
        it.g.visible = i >= index;
        const active = i === index;
        it.mat.opacity = active ? 0.95 : 0.35;
        it.beamMat.opacity = active ? 0.45 : 0.12;
      });
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  };
}
