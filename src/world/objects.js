// Ramps, rails, benches, stairs, rooms and barriers.
//
// Map JSON objects are expanded into collision "primitives" consumed by
// src/physics/collide.js and src/rider/grind.js. This file is pure (no Three.js);
// meshes are built from the same primitives in objects-mesh.js.
//
// Object types (all positions in meters, rot in degrees, local +Z = "forward"):
//   box kinds: bench | barrier | wall | curb | ledge | platform | planter | building | car | block | tree | lamp
//       { type, x, z, rot, w, d, h, [y], [grind: true] }      grind adds a ledge rail along the top
//   kicker   { x, z, rot, w, d, h }                          wedge rising toward +Z, drop at the back
//   quarter  { x, z, rot, w, r, angle=80, deck=1.2 }          curved transition rising toward +Z
//   halfpipe { x, z, rot, w, r, angle=80, deck=1.2, flat=4 } two quarters facing each other
//   bowl     { x, z, rot, w, d, r, angle=75 }                 dug into the ground (carves terrain)
//   stairs   { x, z, rot, w, steps, rise=0.17, run=0.34, top=0, rails="both", railHeight=0.7, maxAngle=40 }
//            descends toward +Z; handrails are grindable
//   rail     { x1, z1, x2, z2, h, [h2], [direction="both"|"forward"] }
//   room     { x, z, rot, w, d, h=3, t=0.3, door: { side: "south", width: 3, offset: 0 } }
//   funbox   { x, z, rot, w, d, h, ramp=2.5, [rail: true] }

import { DEG, toWorld } from '../physics/math.js';

export const BOX_KINDS = ['box', 'bench', 'barrier', 'wall', 'curb', 'ledge', 'platform', 'planter', 'building', 'car', 'block', 'tree', 'lamp', 'table'];
export const OBJECT_TYPES = [...BOX_KINDS, 'kicker', 'quarter', 'halfpipe', 'bowl', 'stairs', 'rail', 'room', 'funbox'];

const UP = Object.freeze({ x: 0, y: 1, z: 0 });

function localNormalToWorld(nx, ny, nz, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: nx * c + nz * s, y: ny, z: -nx * s + nz * c };
}

function computeAabb(p, maxY) {
  const pts = [
    [-p.hw, -p.hd],
    [p.hw, -p.hd],
    [p.hw, p.hd],
    [-p.hw, p.hd],
  ].map(([lx, lz]) => toWorld(lx, lz, p.cx, p.cz, p.rot));
  p.aabb = {
    minX: Math.min(...pts.map((q) => q.x)),
    maxX: Math.max(...pts.map((q) => q.x)),
    minZ: Math.min(...pts.map((q) => q.z)),
    maxZ: Math.max(...pts.map((q) => q.z)),
    maxY,
  };
  return p;
}

function base(def, type, kind, cx, cz, rot, hw, hd, baseY) {
  return {
    id: def.id,
    type,
    kind,
    cx,
    cz,
    rot,
    hw,
    hd,
    baseY,
    solid: true,
    surface: true,
    carve: false,
    rideable: null,
    vert: false,
    color: def.color || null,
    def,
  };
}

function need(def, keys) {
  for (const k of keys) {
    if (typeof def[k] !== 'number' || !Number.isFinite(def[k])) throw new Error(`object "${def.id}" (${def.type}) needs numeric "${k}"`);
  }
}

function makeBox(def, terrain, over = {}) {
  need(def, ['x', 'z', 'w', 'd', 'h']);
  const rot = (def.rot || 0) * DEG;
  const baseY = def.y ?? terrain.heightAt(def.x, def.z);
  const p = base(def, 'box', def.type, def.x, def.z, rot, def.w / 2, def.d / 2, baseY);
  const top = baseY + def.h;
  p.height = def.h;
  p.top = top;
  p.heightAtLocal = () => top;
  p.normalAtLocal = () => UP;
  if (def.type === 'curb') p.rideable = { maxAngle: def.maxAngle ?? 55, stepUp: Math.max(0.22, def.h + 0.05) };
  Object.assign(p, over);
  return computeAabb(p, top);
}

function makeKicker(def, terrain, over = {}) {
  need(def, ['x', 'z', 'w', 'd', 'h']);
  const rot = (def.rot || 0) * DEG;
  const baseY = def.y ?? terrain.heightAt(def.x, def.z);
  const hw = def.w / 2;
  const hd = def.d / 2;
  const p = base(def, 'kicker', 'kicker', def.x, def.z, rot, hw, hd, baseY);
  const slope = def.h / def.d;
  const ang = Math.atan(slope);
  const n = localNormalToWorld(0, Math.cos(ang), -Math.sin(ang), rot);
  p.height = def.h;
  p.angleDeg = ang / DEG;
  p.heightAtLocal = (lx, lz) => baseY + def.h * ((lz + hd) / def.d);
  p.normalAtLocal = () => n;
  p.top = baseY + def.h;
  Object.assign(p, over);
  return computeAabb(p, p.top);
}

function makeQuarter(def, terrain, over = {}) {
  need(def, ['x', 'z', 'w', 'r']);
  const rot = (def.rot || 0) * DEG;
  const baseY = def.y ?? terrain.heightAt(def.x, def.z);
  const r = def.r;
  const angle = Math.min(85, def.angle ?? 80) * DEG;
  const deck = def.deck ?? 1.2;
  const Lt = r * Math.sin(angle);
  const H = r * (1 - Math.cos(angle));
  const hw = def.w / 2;
  const hd = (Lt + deck) / 2;
  const p = base(def, 'quarter', 'quarter', def.x, def.z, rot, hw, hd, baseY);
  p.vert = angle / DEG >= 65;
  p.height = H;
  p.transition = Lt;
  p.radius = r;
  p.angleDeg = angle / DEG;
  p.deck = deck;
  p.heightAtLocal = (lx, lz) => {
    const s = lz + hd;
    if (s <= 0) return baseY;
    if (s >= Lt) return baseY + H;
    return baseY + r - Math.sqrt(r * r - s * s);
  };
  p.normalAtLocal = (lx, lz) => {
    const s = lz + hd;
    if (s <= 0 || s >= Lt) return UP;
    const slope = s / Math.sqrt(Math.max(1e-6, r * r - s * s));
    const l = Math.hypot(1, slope);
    return localNormalToWorld(0, 1 / l, -slope / l, rot);
  };
  p.top = baseY + H;
  Object.assign(p, over);
  return computeAabb(p, p.top);
}

function makeBowl(def, terrain) {
  need(def, ['x', 'z', 'w', 'd', 'r']);
  const rot = (def.rot || 0) * DEG;
  const baseY = def.y ?? terrain.heightAt(def.x, def.z);
  const r = def.r;
  const angle = Math.min(85, def.angle ?? 75) * DEG;
  const Lt = r * Math.sin(angle);
  const D = r * (1 - Math.cos(angle));
  const hw = def.w / 2;
  const hd = def.d / 2;
  const ihw = hw - Lt;
  const ihd = hd - Lt;
  if (ihw <= 0.5 || ihd <= 0.5) throw new Error(`bowl "${def.id}" is too small for its radius`);
  const p = base(def, 'bowl', 'bowl', def.x, def.z, rot, hw, hd, baseY);
  p.solid = false;
  p.surface = false;
  p.carve = true;
  p.vert = angle / DEG >= 65;
  p.depth = D;
  p.transition = Lt;
  p.radius = r;
  p.inner = { hw: ihw, hd: ihd };
  p.heightAtLocal = (lx, lz) => {
    const dx = Math.max(Math.abs(lx) - ihw, 0);
    const dz = Math.max(Math.abs(lz) - ihd, 0);
    const s = Math.hypot(dx, dz);
    if (s >= Lt) return baseY;
    return baseY - D + (r - Math.sqrt(r * r - s * s));
  };
  p.normalAtLocal = (lx, lz) => {
    const dx = Math.max(Math.abs(lx) - ihw, 0);
    const dz = Math.max(Math.abs(lz) - ihd, 0);
    const s = Math.hypot(dx, dz);
    if (s <= 1e-6 || s >= Lt) return UP;
    const slope = s / Math.sqrt(Math.max(1e-6, r * r - s * s));
    const ux = (Math.sign(lx) * dx) / s;
    const uz = (Math.sign(lz) * dz) / s;
    const l = Math.hypot(1, slope);
    return localNormalToWorld((-slope * ux) / l, 1 / l, (-slope * uz) / l, rot);
  };
  p.top = baseY;
  return computeAabb(p, baseY);
}

function makeRail(def, terrain, over = {}) {
  let a;
  let b;
  if (Array.isArray(def.a) && Array.isArray(def.b)) {
    a = { x: def.a[0], y: def.a[1], z: def.a[2] };
    b = { x: def.b[0], y: def.b[1], z: def.b[2] };
  } else {
    need(def, ['x1', 'z1', 'x2', 'z2', 'h']);
    a = { x: def.x1, y: (def.y1 ?? terrain.heightAt(def.x1, def.z1)) + def.h, z: def.z1 };
    b = { x: def.x2, y: (def.y2 ?? terrain.heightAt(def.x2, def.z2)) + (def.h2 ?? def.h), z: def.z2 };
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1) throw new Error(`rail "${def.id}" is shorter than 1 m`);
  const p = {
    id: def.id,
    type: 'rail',
    kind: def.kind || 'rail',
    a,
    b,
    len,
    dir: { x: dx / len, y: dy / len, z: dz / len },
    yaw: Math.atan2(dx, dz),
    radius: def.radius ?? 0.045,
    height: Math.max(a.y - terrain.heightAt(a.x, a.z), b.y - terrain.heightAt(b.x, b.z)),
    oneWay: def.direction === 'forward',
    noSolid: false,
    visible: true,
    color: def.color || null,
    def,
  };
  p.aabb = {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
    maxY: Math.max(a.y, b.y),
  };
  Object.assign(p, over);
  return p;
}

function makeStairs(def, terrain) {
  need(def, ['x', 'z', 'w', 'steps']);
  const rot = (def.rot || 0) * DEG;
  const baseY = def.y ?? terrain.heightAt(def.x, def.z);
  const steps = Math.max(1, Math.round(def.steps));
  const rise = def.rise ?? 0.17;
  const run = def.run ?? 0.34;
  const top = def.top ?? 0;
  const H = steps * rise;
  const d = top + steps * run;
  const hw = def.w / 2;
  const hd = d / 2;
  const p = base(def, 'stairs', 'stairs', def.x, def.z, rot, hw, hd, baseY);
  p.rideable = { maxAngle: def.maxAngle ?? 40, stepUp: rise + 0.05 };
  p.steps = steps;
  p.rise = rise;
  p.run = run;
  p.topDepth = top;
  p.height = H;
  p.heightAtLocal = (lx, lz) => {
    const s = lz + hd;
    if (s < top) return baseY + H;
    const i = Math.min(steps - 1, Math.max(0, Math.floor((s - top) / run)));
    return baseY + H - (i + 1) * rise;
  };
  p.normalAtLocal = () => UP;
  p.top = baseY + H;
  const out = [computeAabb(p, p.top)];
  const sides = def.rails === 'none' ? [] : def.rails === 'left' ? [1] : def.rails === 'right' ? [-1] : [1, -1];
  const railH = def.railHeight ?? 0.7;
  for (const side of sides) {
    const lx = side * (hw - 0.12);
    const wa = toWorld(lx, -hd + top, def.x, def.z, rot);
    const wb = toWorld(lx, hd, def.x, def.z, rot);
    out.push(
      makeRail(
        {
          id: `${def.id}-rail${side > 0 ? 'L' : 'R'}`,
          type: 'rail',
          kind: 'handrail',
          a: [wa.x, baseY + H + railH, wa.z],
          b: [wb.x, baseY + railH, wb.z],
        },
        terrain,
      ),
    );
  }
  return out;
}

function ledgeRailFor(p, def, terrain) {
  // Grind along the longer top edge center line.
  const alongZ = p.hd >= p.hw;
  const inset = 0.15;
  const l = (alongZ ? p.hd : p.hw) - inset;
  const a = alongZ ? toWorld(0, -l, p.cx, p.cz, p.rot) : toWorld(-l, 0, p.cx, p.cz, p.rot);
  const b = alongZ ? toWorld(0, l, p.cx, p.cz, p.rot) : toWorld(l, 0, p.cx, p.cz, p.rot);
  return makeRail(
    { id: `${def.id}-ledge`, type: 'rail', kind: 'ledge', a: [a.x, p.top, a.z], b: [b.x, p.top, b.z], radius: 0.06 },
    terrain,
    { noSolid: true, visible: false },
  );
}

/** Expand map object definitions into primitives. Throws on invalid data. */
export function expandObjects(defs, terrain) {
  const out = [];
  for (const def of defs) {
    const t = def.type;
    if (BOX_KINDS.includes(t)) {
      const p = makeBox(def, terrain);
      out.push(p);
      if (def.grind) out.push(ledgeRailFor(p, def, terrain));
    } else if (t === 'kicker') {
      out.push(makeKicker(def, terrain));
    } else if (t === 'quarter') {
      out.push(makeQuarter(def, terrain));
    } else if (t === 'halfpipe') {
      need(def, ['x', 'z', 'w', 'r']);
      const angle = Math.min(85, def.angle ?? 80) * DEG;
      const deck = def.deck ?? 1.2;
      const flat = def.flat ?? 4;
      const depth = def.r * Math.sin(angle) + deck;
      const off = flat / 2 + depth / 2;
      const rot = (def.rot || 0) * DEG;
      const baseY = def.y ?? terrain.heightAt(def.x, def.z);
      for (const s of [1, -1]) {
        const c = toWorld(0, s * off, def.x, def.z, rot);
        out.push(
          makeQuarter(
            { ...def, id: `${def.id}-${s > 0 ? 'a' : 'b'}`, type: 'quarter', x: c.x, z: c.z, y: baseY, rot: (def.rot || 0) + (s > 0 ? 0 : 180) },
            terrain,
          ),
        );
      }
    } else if (t === 'bowl') {
      out.push(makeBowl(def, terrain));
    } else if (t === 'stairs') {
      out.push(...makeStairs(def, terrain));
    } else if (t === 'rail') {
      out.push(makeRail(def, terrain));
    } else if (t === 'room') {
      need(def, ['x', 'z', 'w', 'd']);
      const h = def.h ?? 3;
      const th = def.t ?? 0.3;
      const rot = def.rot || 0;
      const door = def.door || null;
      const walls = [
        { side: 'north', lx: 0, lz: def.d / 2, len: def.w, alongX: true },
        { side: 'south', lx: 0, lz: -def.d / 2, len: def.w, alongX: true },
        { side: 'east', lx: def.w / 2, lz: 0, len: def.d, alongX: false },
        { side: 'west', lx: -def.w / 2, lz: 0, len: def.d, alongX: false },
      ];
      for (const w of walls) {
        const segs = [];
        if (door && door.side === w.side) {
          const dw = door.width ?? 3;
          const off = door.offset ?? 0;
          const a0 = -w.len / 2;
          const a1 = off - dw / 2;
          const b0 = off + dw / 2;
          const b1 = w.len / 2;
          if (a1 - a0 > 0.2) segs.push([a0, a1]);
          if (b1 - b0 > 0.2) segs.push([b0, b1]);
        } else segs.push([-w.len / 2, w.len / 2]);
        segs.forEach(([s0, s1], i) => {
          const mid = (s0 + s1) / 2;
          const len = s1 - s0;
          const lx = w.alongX ? mid : w.lx;
          const lz = w.alongX ? w.lz : mid;
          const c = toWorld(lx, lz, def.x, def.z, rot * DEG);
          out.push(
            makeBox(
              {
                id: `${def.id}-${w.side}${i}`,
                type: 'wall',
                x: c.x,
                z: c.z,
                rot,
                w: w.alongX ? len + th : th,
                d: w.alongX ? th : len + th,
                h,
                y: def.y,
                color: def.color,
              },
              terrain,
            ),
          );
        });
      }
    } else if (t === 'funbox') {
      need(def, ['x', 'z', 'w', 'd', 'h']);
      const ramp = def.ramp ?? 2.5;
      const rot = def.rot || 0;
      const baseY = def.y ?? terrain.heightAt(def.x, def.z);
      out.push(makeBox({ ...def, id: `${def.id}-top`, type: 'platform', y: baseY }, terrain));
      for (const s of [1, -1]) {
        const c = toWorld(0, s * (def.d / 2 + ramp / 2), def.x, def.z, rot * DEG);
        out.push(
          makeKicker(
            { id: `${def.id}-k${s > 0 ? 'a' : 'b'}`, type: 'kicker', x: c.x, z: c.z, y: baseY, rot: rot + (s > 0 ? 180 : 0), w: def.w, d: ramp, h: def.h },
            terrain,
          ),
        );
      }
      if (def.rail) {
        // Rail runs along one side of the deck so you can still roll straight over the box.
        const off = def.railOffset ?? def.w / 2 - 0.3;
        const a = toWorld(off, -def.d / 2 + 0.3, def.x, def.z, rot * DEG);
        const b = toWorld(off, def.d / 2 - 0.3, def.x, def.z, rot * DEG);
        out.push(makeRail({ id: `${def.id}-rail`, type: 'rail', a: [a.x, baseY + def.h + 0.4, a.z], b: [b.x, baseY + def.h + 0.4, b.z] }, terrain));
      }
    } else {
      throw new Error(`unknown object type "${t}" (id ${def.id})`);
    }
  }
  return out;
}

/** Ramps are the primitives a reachability check should be able to launch from. */
export function isRamp(p) {
  return p.type === 'kicker' || p.type === 'quarter' || p.type === 'bowl';
}
