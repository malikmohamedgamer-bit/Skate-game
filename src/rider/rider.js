// Rider and board/scooter 3D model, built from primitives, plus pose animation.
// The same builder is used by the in-game rider and the shop preview so the
// preview always shows the actual model with the chosen parts.

import * as THREE from 'three';

const DEFAULT_LOOK = {
  vehicle: 'skateboard',
  parts: {
    deck: { color: '#d94a38', pattern: 'solid', accent: '#ffffff', shape: 'popsicle' },
    trucks: { color: '#b8bec6', pattern: 'solid' },
    wheels: { color: '#f2e9d0', pattern: 'solid', size: 1 },
    grip: { color: '#222222', pattern: 'solid', accent: '#555555' },
    bars: { color: '#2c7be5', pattern: 'solid' },
    fork: { color: '#b8bec6', pattern: 'solid' },
  },
  outfit: { shirt: '#2f80ed', pants: '#3b3f46', shoes: '#f5f5f5', skin: '#c68863' },
  helmet: { style: 'none', color: '#ffb000' },
  trail: { style: 'none', color: '#ffb000' },
};

export function mergeLook(look = {}) {
  const parts = {};
  for (const k of Object.keys(DEFAULT_LOOK.parts)) parts[k] = { ...DEFAULT_LOOK.parts[k], ...(look.parts?.[k] || {}) };
  return {
    vehicle: look.vehicle || DEFAULT_LOOK.vehicle,
    parts,
    outfit: { ...DEFAULT_LOOK.outfit, ...(look.outfit || {}) },
    helmet: { ...DEFAULT_LOOK.helmet, ...(look.helmet || {}) },
    trail: { ...DEFAULT_LOOK.trail, ...(look.trail || {}) },
  };
}

// ---------------------------------------------------------------------------
// Pattern textures (cached). Patterns always pair a shape with color so that
// choices are distinguishable without relying on color alone.
// ---------------------------------------------------------------------------
const textureCache = new Map();

export const PATTERNS = ['solid', 'stripes', 'checker', 'dots', 'flames', 'zigzag', 'camo'];

function patternTexture(pattern, color, accent) {
  if (pattern === 'solid' || !PATTERNS.includes(pattern)) return null;
  const key = `${pattern}|${color}|${accent}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  g.fillStyle = accent || '#ffffff';
  if (pattern === 'stripes') {
    for (let i = 0; i < size; i += 32) g.fillRect(i, 0, 14, size);
  } else if (pattern === 'checker') {
    for (let y = 0; y < size; y += 32) for (let x = 0; x < size; x += 32) if (((x + y) / 32) % 2 === 0) g.fillRect(x, y, 32, 32);
  } else if (pattern === 'dots') {
    for (let y = 16; y < size; y += 32)
      for (let x = 16; x < size; x += 32) {
        g.beginPath();
        g.arc(x, y, 8, 0, Math.PI * 2);
        g.fill();
      }
  } else if (pattern === 'flames') {
    for (let x = 0; x < size; x += 32) {
      g.beginPath();
      g.moveTo(x, size);
      g.quadraticCurveTo(x + 4, size * 0.4, x + 16, size * 0.15);
      g.quadraticCurveTo(x + 22, size * 0.5, x + 32, size);
      g.fill();
    }
  } else if (pattern === 'zigzag') {
    g.lineWidth = 9;
    g.strokeStyle = accent || '#ffffff';
    for (let y = 16; y < size; y += 40) {
      g.beginPath();
      for (let x = 0; x <= size; x += 16) g.lineTo(x, (x / 16) % 2 === 0 ? y : y + 14);
      g.stroke();
    }
  } else if (pattern === 'camo') {
    const blobs = [
      [20, 30, 18],
      [70, 20, 22],
      [100, 80, 20],
      [40, 90, 24],
      [90, 120, 14],
      [10, 120, 12],
    ];
    for (const [x, y, r] of blobs) {
      g.beginPath();
      g.ellipse(x, y, r, r * 0.6, x * 0.05, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  textureCache.set(key, tex);
  return tex;
}

function partMaterial(part) {
  const tex = patternTexture(part.pattern, part.color, part.accent);
  const m = new THREE.MeshLambertMaterial({ color: tex ? 0xffffff : part.color, map: tex || null });
  m.userData.partColor = part.color;
  m.userData.pattern = part.pattern || 'solid';
  return m;
}

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}
function cyl(r, h, mat, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Vehicle builders. Nose points to +Z. Ground is y = 0.
// ---------------------------------------------------------------------------
function buildSkateboard(look) {
  const p = look.parts;
  const root = new THREE.Group();
  root.name = 'skateboard';
  const wheelR = 0.03 * (p.wheels.size || 1);
  const deckY = wheelR * 2 + 0.035;
  const shape = p.deck.shape || 'popsicle';
  const len = shape === 'longboard' ? 0.95 : shape === 'cruiser' ? 0.66 : 0.62;
  const wid = shape === 'cruiser' ? 0.25 : 0.22;
  const deckMat = partMaterial(p.deck);
  const gripMat = partMaterial(p.grip);
  const truckMat = partMaterial(p.trucks);
  const wheelMat = partMaterial(p.wheels);
  deckMat.name = 'deck';
  gripMat.name = 'grip';
  truckMat.name = 'trucks';
  wheelMat.name = 'wheels';

  const deck = new THREE.Group();
  deck.position.y = deckY;
  const mid = box(wid, 0.018, len, deckMat);
  const midGrip = box(wid * 0.98, 0.004, len, gripMat);
  midGrip.position.y = 0.011;
  deck.add(mid, midGrip);
  const kickLen = shape === 'longboard' ? 0.06 : 0.13;
  const tilt = shape === 'longboard' ? 0.12 : shape === 'cruiser' ? 0.2 : 0.36;
  for (const s of [1, -1]) {
    const kick = new THREE.Group();
    kick.position.set(0, 0, (s * len) / 2);
    kick.rotation.x = -s * tilt;
    const k = box(wid, 0.018, kickLen, deckMat);
    k.position.z = (s * kickLen) / 2;
    const kg = box(wid * 0.98, 0.004, kickLen, gripMat);
    kg.position.set(0, 0.011, (s * kickLen) / 2);
    kick.add(k, kg);
    deck.add(kick);
  }
  const truckZ = len * 0.36;
  for (const s of [1, -1]) {
    const base = box(0.06, 0.02, 0.07, truckMat);
    base.position.set(0, -0.019, s * truckZ);
    const hanger = box(0.17, 0.025, 0.035, truckMat);
    hanger.position.set(0, -0.04, s * truckZ);
    deck.add(base, hanger);
    for (const side of [1, -1]) {
      const w = cyl(wheelR, 0.032, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * 0.095, -deckY + wheelR, s * truckZ);
      w.userData.wheel = true;
      deck.add(w);
    }
  }
  root.add(deck);
  root.userData = { deckTop: deckY + 0.013, kind: 'skateboard', materials: { deck: deckMat, grip: gripMat, trucks: truckMat, wheels: wheelMat } };
  return root;
}

function buildScooter(look) {
  const p = look.parts;
  const root = new THREE.Group();
  root.name = 'scooter';
  const wheelR = 0.055 * (p.wheels.size || 1);
  const deckMat = partMaterial(p.deck);
  const barMat = partMaterial(p.bars);
  const wheelMat = partMaterial(p.wheels);
  const forkMat = partMaterial(p.fork);
  const gripMat = partMaterial(p.grip);
  deckMat.name = 'deck';
  barMat.name = 'bars';
  wheelMat.name = 'wheels';
  forkMat.name = 'fork';
  gripMat.name = 'grip';
  const deckY = wheelR + 0.02;
  // Rear part (deck + rear wheel) can spin around the stem for tailwhips.
  const whip = new THREE.Group();
  whip.name = 'whip';
  whip.position.set(0, 0, 0.3);
  const deck = box(0.12, 0.03, 0.52, deckMat);
  deck.position.set(0, deckY, -0.3 - 0.02);
  const deckGrip = box(0.11, 0.004, 0.46, gripMat);
  deckGrip.position.set(0, deckY + 0.017, -0.33);
  const rear = cyl(wheelR, 0.024, wheelMat);
  rear.rotation.z = Math.PI / 2;
  rear.position.set(0, wheelR, -0.6);
  rear.userData.wheel = true;
  const fender = box(0.05, 0.01, 0.12, forkMat);
  fender.position.set(0, wheelR * 2 + 0.012, -0.6);
  const neck = box(0.07, 0.05, 0.08, deckMat);
  neck.position.set(0, deckY + 0.02, -0.04);
  whip.add(deck, deckGrip, rear, fender, neck);
  root.add(whip);
  // Front: fork, wheel, stem and bars.
  const front = new THREE.Group();
  front.name = 'front';
  const fw = cyl(wheelR, 0.024, wheelMat);
  fw.rotation.z = Math.PI / 2;
  fw.position.set(0, wheelR, 0.34);
  fw.userData.wheel = true;
  const forkL = box(0.012, wheelR * 2 + 0.04, 0.02, forkMat);
  forkL.position.set(0.02, wheelR + 0.02, 0.34);
  const forkR = forkL.clone();
  forkR.position.x = -0.02;
  const stem = cyl(0.017, 0.78, barMat);
  stem.position.set(0, wheelR * 2 + 0.4, 0.33);
  const bar = cyl(0.016, 0.54, barMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, wheelR * 2 + 0.79, 0.33);
  for (const s of [1, -1]) {
    const g = cyl(0.02, 0.1, gripMat);
    g.rotation.z = Math.PI / 2;
    g.position.set(s * 0.24, wheelR * 2 + 0.79, 0.33);
    front.add(g);
  }
  front.add(fw, forkL, forkR, stem, bar);
  root.add(front);
  root.userData = {
    deckTop: deckY + 0.02,
    barY: wheelR * 2 + 0.79,
    kind: 'scooter',
    materials: { deck: deckMat, bars: barMat, wheels: wheelMat, fork: forkMat, grip: gripMat },
  };
  return root;
}

function buildRiderBody(look) {
  const o = look.outfit;
  const shirt = new THREE.MeshLambertMaterial({ color: o.shirt });
  const pants = new THREE.MeshLambertMaterial({ color: o.pants });
  const skin = new THREE.MeshLambertMaterial({ color: o.skin });
  const shoes = new THREE.MeshLambertMaterial({ color: o.shoes });
  shirt.name = 'shirt';
  pants.name = 'pants';
  const root = new THREE.Group();
  root.name = 'rider';
  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  const chest = box(0.34, 0.52, 0.2, shirt);
  chest.position.y = 0.28;
  torso.add(chest);
  const head = new THREE.Group();
  head.position.y = 0.66;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin);
  skull.castShadow = true;
  head.add(skull);
  const helmetSlot = new THREE.Group();
  head.add(helmetSlot);
  const arms = [];
  for (const s of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.21, 0.5, 0);
    torso.add(shoulder);
    const upper = box(0.085, 0.3, 0.085, shirt);
    upper.position.y = -0.15;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    const fore = box(0.075, 0.28, 0.075, skin);
    fore.position.y = -0.14;
    elbow.add(fore);
    arms.push({ shoulder, elbow, side: s });
  }
  const legs = [];
  for (const s of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, 0, 0);
    hips.add(hip);
    const thigh = box(0.12, 0.44, 0.12, pants);
    thigh.position.y = -0.22;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);
    const shin = box(0.11, 0.42, 0.11, pants);
    shin.position.y = -0.21;
    knee.add(shin);
    const foot = box(0.11, 0.06, 0.24, shoes);
    foot.position.set(0, -0.43, 0.05);
    knee.add(foot);
    legs.push({ hip, knee, side: s });
  }
  root.userData = { hips, torso, head, helmetSlot, arms, legs, materials: { shirt, pants, skin, shoes } };
  return root;
}

function buildHelmet(look, slot) {
  slot.clear();
  const h = look.helmet;
  if (!h || h.style === 'none') return;
  const mat = new THREE.MeshLambertMaterial({ color: h.color });
  mat.name = 'helmet';
  if (h.style === 'full') {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), mat);
    const visor = box(0.2, 0.06, 0.05, new THREE.MeshLambertMaterial({ color: '#202830' }));
    visor.position.set(0, 0, 0.12);
    slot.add(shell, visor);
  } else {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    shell.position.y = 0.01;
    slot.add(shell);
    if (h.style === 'stripe') {
      const stripe = box(0.04, 0.02, 0.24, new THREE.MeshLambertMaterial({ color: '#ffffff' }));
      stripe.position.y = 0.13;
      slot.add(stripe);
    }
  }
  slot.traverse((m) => m.isMesh && (m.castShadow = true));
}

/** Build only the vehicle + rider (used by the shop preview and the in-game rider). */
export function buildVehicleMesh(lookIn) {
  const look = mergeLook(lookIn);
  const group = new THREE.Group();
  const vehicle = look.vehicle === 'scooter' ? buildScooter(look) : buildSkateboard(look);
  const boardPivot = new THREE.Group();
  boardPivot.name = 'boardPivot';
  boardPivot.position.y = vehicle.userData.deckTop * 0.5;
  vehicle.position.y = -vehicle.userData.deckTop * 0.5;
  boardPivot.add(vehicle);
  const rider = buildRiderBody(look);
  rider.position.y = vehicle.userData.deckTop;
  buildHelmet(look, rider.userData.helmetSlot);
  group.add(boardPivot, rider);
  group.userData = { look, vehicle, boardPivot, rider };
  return group;
}

/** Collect color info for tests and accessibility labels. */
export function describeMesh(group) {
  const out = {};
  const mats = group.userData.vehicle.userData.materials;
  for (const [slot, m] of Object.entries(mats)) out[slot] = { color: m.userData.partColor, pattern: m.userData.pattern };
  out.vehicle = group.userData.vehicle.userData.kind;
  return out;
}

export function disposeObject(obj) {
  obj.traverse((m) => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose(); // textures are cached and shared, not disposed here
    }
  });
}

// ---------------------------------------------------------------------------
// Animated in-game rider
// ---------------------------------------------------------------------------
const tmpUp = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const tmpX = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

function setPose(rider, kind, pose) {
  const { hips, torso, arms, legs, head } = rider.userData;
  const c = pose.crouch;
  hips.position.y = 0.9 - c * 0.32;
  for (const l of legs) {
    l.hip.rotation.set(-c * 0.9, 0, 0);
    l.knee.rotation.set(c * 1.7, 0, 0);
  }
  torso.rotation.set(c * 0.35 + pose.leanFwd, 0, pose.lean);
  head.rotation.set(-c * 0.3, pose.look, 0);
  if (kind === 'skateboard') {
    // Stand sideways: legs spread along the board (rider's local X).
    legs[0].hip.rotation.z = 0.2;
    legs[1].hip.rotation.z = -0.2;
    if (pose.push > 0) {
      // Back foot (rider's right = -X) swings down to the ground and back.
      const ph = Math.sin(pose.push * Math.PI);
      legs[1].hip.rotation.x = -c * 0.9 + ph * 0.25;
      legs[1].hip.rotation.z = -0.2 - ph * 0.35;
      legs[1].knee.rotation.x = c * 1.7 * (1 - ph);
      legs[0].knee.rotation.x = c * 1.7 + ph * 0.6;
      legs[0].hip.rotation.x = -c * 0.9 - ph * 0.3;
      hips.position.y -= ph * 0.12;
    }
    for (const a of arms) {
      a.shoulder.rotation.set(0, 0, a.side * (0.5 + pose.armsOut));
      a.elbow.rotation.set(-0.4, 0, 0);
    }
  } else {
    // Scooter: front foot forward, back foot behind, hands on bars.
    legs[0].hip.position.z = 0;
    legs[0].hip.rotation.y = 0;
    legs[0].hip.rotation.x = -c * 0.9 - 0.15;
    legs[1].hip.rotation.x = -c * 0.9 + 0.2;
    if (pose.push > 0) {
      const ph = Math.sin(pose.push * Math.PI);
      legs[1].hip.rotation.x = 0.2 + ph * 0.7;
      legs[1].knee.rotation.x = 0.3;
    }
    for (const a of arms) {
      a.shoulder.rotation.set(-1.0 - c * 0.3 + (pose.noHands ? 2.4 : 0), 0, a.side * (0.12 + pose.armsOut * 0.8));
      a.elbow.rotation.set(-0.5 + c * 0.2, 0, 0);
    }
  }
  if (pose.grab) {
    const a = arms[pose.grabArm || 0];
    a.shoulder.rotation.set(0.6, 0, a.side * 0.3);
    a.elbow.rotation.set(-0.2, 0, 0);
  }
}

export function createRiderModel(lookIn) {
  const outer = new THREE.Group();
  outer.name = 'riderModel';
  const orient = new THREE.Group(); // aligned with surface + heading
  outer.add(orient);
  let mesh = buildVehicleMesh(lookIn);
  orient.add(mesh);
  const smoothedUp = new THREE.Vector3(0, 1, 0);
  let crouch = 0.15;
  let landT = 0;
  let pushT = 0;
  let wheelSpin = 0;
  let bailT = 0;

  // Speed trail (ribbon of recent positions).
  const TRAIL_N = 36;
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(TRAIL_N * 2 * 3);
  const trailAlpha = new Float32Array(TRAIL_N * 2);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('alpha', new THREE.BufferAttribute(trailAlpha, 1));
  const idx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeo.setIndex(idx);
  const trailMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color('#ffb000') } },
    vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA * 0.7); }',
  });
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  trail.visible = false;
  const trailPts = [];
  let trailTimer = 0;

  function applyTrail(look) {
    const t = look.trail || {};
    trail.visible = t.style && t.style !== 'none';
    trailMat.uniforms.color.value.set(t.color || '#ffb000');
    trailPts.length = 0;
  }
  applyTrail(mergeLook(lookIn));

  return {
    group: outer,
    trail,
    get mesh() {
      return mesh;
    },
    setLook(look) {
      orient.remove(mesh);
      disposeObject(mesh);
      mesh = buildVehicleMesh(look);
      orient.add(mesh);
      applyTrail(mergeLook(look));
    },
    describe() {
      return describeMesh(mesh);
    },
    /**
     * view: { pos, yaw, airYaw, normal, state, speed, steer, pushing, trick, grind, stance, landed, reducedMotion }
     */
    update(view, dt) {
      const { vehicle, boardPivot, rider } = mesh.userData;
      const kind = vehicle.userData.kind;
      outer.position.set(view.pos.x, view.pos.y, view.pos.z);
      // Orientation: surface normal on the ground, world-up in the air.
      const targetUp = view.state === 'air' || view.state === 'grind' ? tmpUp.set(0, 1, 0) : tmpUp.set(view.normal.x, view.normal.y, view.normal.z);
      smoothedUp.lerp(targetUp, 1 - Math.exp(-dt * 18)).normalize();
      let yaw = view.state === 'air' ? view.airYaw : view.yaw;
      if (view.state === 'grind' && view.grind) yaw = view.grind.boardYaw;
      // Fakie: board nose points backwards (skateboard), rider still faces travel.
      const visualYaw = yaw + (view.stance < 0 && view.state !== 'air' && kind === 'skateboard' ? Math.PI : 0);
      tmpF.set(Math.sin(visualYaw), 0, Math.cos(visualYaw));
      tmpF.addScaledVector(smoothedUp, -tmpF.dot(smoothedUp)).normalize();
      tmpX.crossVectors(smoothedUp, tmpF).normalize();
      tmpM.makeBasis(tmpX, smoothedUp, tmpF);
      orient.quaternion.setFromRotationMatrix(tmpM);

      // Animation state.
      if (view.landed) landT = 0.25;
      landT = Math.max(0, landT - dt);
      if (view.pushing && pushT <= 0) pushT = 1;
      pushT = Math.max(0, pushT - dt / (kind === 'scooter' ? 0.45 : 0.6));
      let targetCrouch = 0.15 + Math.min(0.15, (view.speed || 0) * 0.01);
      if (view.state === 'air') targetCrouch = 0.55;
      if (view.state === 'grind') targetCrouch = 0.4;
      if (landT > 0) targetCrouch = 0.7;
      const trick = view.trick || {};
      if (trick.grab) targetCrouch = 0.85;
      crouch += (targetCrouch - crouch) * (1 - Math.exp(-dt * 14));

      // Board/body trick rotations.
      boardPivot.rotation.set(0, 0, 0);
      rider.rotation.set(0, kind === 'skateboard' ? -Math.PI / 2 : 0, 0);
      rider.position.set(0, vehicle.userData.deckTop, 0);
      orient.position.set(0, 0, 0);
      const whip = vehicle.getObjectByName('whip');
      if (whip) whip.rotation.set(0, 0, 0);
      if (view.state === 'air') {
        const pitch = ((trick.pitchDeg || 0) * Math.PI) / 180;
        const bYaw = ((trick.boardYawDeg || 0) * Math.PI) / 180;
        if (kind === 'skateboard') {
          // Kickflip/heelflip: the board rolls around its long axis under the rider.
          boardPivot.rotation.z = pitch;
          boardPivot.rotation.y = bYaw;
          boardPivot.position.y = vehicle.userData.deckTop * 0.5 + (Math.abs(pitch) > 0.01 || Math.abs(bYaw) > 0.01 ? 0.12 : 0);
        } else {
          // Scooter: whole-body front/back flips; deck spins around the stem for tailwhips.
          orient.position.y = 0.6;
          tmpQ.setFromAxisAngle(X_AXIS, pitch);
          mesh.position.set(0, -0.6, 0);
          mesh.quaternion.copy(tmpQ);
          if (whip) whip.rotation.y = bYaw;
        }
      } else {
        mesh.position.set(0, 0, 0);
        mesh.quaternion.identity();
        boardPivot.position.y = vehicle.userData.deckTop * 0.5;
      }
      // Bail tumble.
      if (view.state === 'bail') bailT = Math.min(1, bailT + dt * 2.5);
      else bailT = Math.max(0, bailT - dt * 4);
      if (bailT > 0) {
        rider.rotation.x = bailT * 1.35;
        rider.position.y = vehicle.userData.deckTop * (1 - bailT) + 0.05;
        rider.position.z = -bailT * 0.4;
        boardPivot.rotation.z = bailT * 2.6;
        boardPivot.position.x = bailT * 0.5;
      } else {
        boardPivot.position.x = 0;
      }

      const lean = view.state === 'ride' ? -(view.steer || 0) * Math.min(1, (view.speed || 0) / 6) * 0.35 : 0;
      setPose(rider, kind, {
        crouch,
        lean: kind === 'skateboard' ? 0 : lean,
        leanFwd: kind === 'skateboard' ? lean : 0,
        look: kind === 'skateboard' ? Math.PI / 2.4 : 0,
        push: pushT,
        armsOut: view.state === 'grind' ? 0.6 : view.state === 'air' ? 0.3 : 0,
        grab: !!trick.grab,
        grabArm: trick.grab === 'tail' ? 1 : 0,
        noHands: kind === 'scooter' && trick.grab === 'nohander',
      });

      // Wheels spin with speed.
      wheelSpin += ((view.speed || 0) * dt) / 0.03;
      vehicle.traverse((m) => {
        if (m.userData.wheel) m.rotation.x = wheelSpin;
      });

      // Trail.
      if (trail.visible) {
        trailTimer += dt;
        if (trailTimer > 1 / 45) {
          trailTimer = 0;
          const moving = (view.speed || 0) > 2.5;
          if (moving) trailPts.unshift({ x: view.pos.x, y: view.pos.y + 0.06, z: view.pos.z, yaw: visualYaw });
          else if (trailPts.length) trailPts.pop();
          if (trailPts.length > TRAIL_N) trailPts.length = TRAIL_N;
        }
        for (let i = 0; i < TRAIL_N; i++) {
          const p = trailPts[Math.min(i, trailPts.length - 1)] || { x: view.pos.x, y: view.pos.y, z: view.pos.z, yaw: 0 };
          const w = 0.12 * (1 - i / TRAIL_N);
          const cx = Math.cos(p.yaw) * w;
          const cz = -Math.sin(p.yaw) * w;
          trailPos.set([p.x + cx, p.y, p.z + cz, p.x - cx, p.y, p.z - cz], i * 6);
          const a = i < trailPts.length ? 1 - i / TRAIL_N : 0;
          trailAlpha[i * 2] = a;
          trailAlpha[i * 2 + 1] = a;
        }
        trailGeo.attributes.position.needsUpdate = true;
        trailGeo.attributes.alpha.needsUpdate = true;
      }
    },
    dispose() {
      disposeObject(mesh);
      trailGeo.dispose();
      trailMat.dispose();
    },
  };
}
