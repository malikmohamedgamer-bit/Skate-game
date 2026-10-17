// Builds the Three.js scene for a map: sky, lights, terrain mesh, boundary fence.
// Object meshes come from objects-mesh.js.

import * as THREE from 'three';
import { baseGround } from '../physics/collide.js';

const texCache = new Map();

function groundTexture(color, lineColor, highContrast) {
  const key = `${color}|${lineColor}|${highContrast}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  // Speckle noise so motion is easy to read.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const v = Math.floor(rnd() * 40) - 20;
    g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 260})`;
    g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  // Expansion joints every tile.
  g.strokeStyle = lineColor;
  g.lineWidth = highContrast ? 6 : 3;
  g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

export function buildMapScene(map, world, { highContrast = false, shadows = true, objectMeshes = null } = {}) {
  const scene = new THREE.Scene();
  const theme = map.theme;
  const sky = new THREE.Color(highContrast ? '#000000' : theme.sky);
  scene.background = sky;
  scene.fog = new THREE.Fog(highContrast ? '#000000' : theme.fog, 60, 170);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x556070, highContrast ? 1.6 : 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, highContrast ? 1.2 : 1.6);
  sun.position.set(18, 30, 10);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera;
    s.left = s.bottom = -22;
    s.right = s.top = 22;
    s.near = 1;
    s.far = 80;
    sun.shadow.bias = -0.0008;
  }
  scene.add(sun);
  scene.add(sun.target);

  // Terrain mesh, extended beyond the bounds so the horizon is not empty.
  const b = map.bounds;
  const margin = 40;
  const w = b.maxX - b.minX + margin * 2;
  const d = b.maxZ - b.minZ + margin * 2;
  const flat = world.terrain.flat && world.carves.length === 0;
  const seg = flat ? 1 : 1.0;
  const segX = flat ? 1 : Math.ceil(w / seg);
  const segZ = flat ? 1 : Math.ceil(d / seg);
  const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  geo.translate(cx, 0, cz);
  if (!flat) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const g = baseGround(world, x, z);
      // Inside a carved bowl, hide the ground just below the bowl mesh.
      pos.setY(i, g.prim ? g.h - 0.04 : g.h);
    }
    geo.computeVertexNormals();
  }
  // UVs: one texture tile every 4 m.
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
  const groundMat = new THREE.MeshLambertMaterial({
    map: groundTexture(highContrast ? '#3a3a3a' : theme.ground, highContrast ? '#ffffff' : 'rgba(0,0,0,0.25)', highContrast),
  });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // Boundary fence (the rider physically cannot cross the bounds box).
  const fenceMat = new THREE.MeshLambertMaterial({ color: highContrast ? '#ffff00' : '#5d6670' });
  const fence = new THREE.Group();
  fence.name = 'fence';
  const H = 1.4;
  const edges = [
    [b.minX, b.minZ, b.maxX, b.minZ],
    [b.maxX, b.minZ, b.maxX, b.maxZ],
    [b.maxX, b.maxZ, b.minX, b.maxZ],
    [b.minX, b.maxZ, b.minX, b.minZ],
  ];
  const postGeo = new THREE.BoxGeometry(0.1, H, 0.1);
  let postCount = 0;
  for (const [x1, z1, x2, z2] of edges) postCount += Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 4);
  const posts = new THREE.InstancedMesh(postGeo, fenceMat, postCount);
  let pi = 0;
  const m4 = new THREE.Matrix4();
  for (const [x1, z1, x2, z2] of edges) {
    const L = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.ceil(L / 4);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = x1 + (x2 - x1) * t;
      const z = z1 + (z2 - z1) * t;
      m4.makeTranslation(x, baseGround(world, x, z).h + H / 2, z);
      posts.setMatrixAt(pi++, m4);
    }
    for (const yy of [H, H * 0.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.06, 0.06), fenceMat);
      rail.position.set((x1 + x2) / 2, baseGround(world, (x1 + x2) / 2, (z1 + z2) / 2).h + yy, (z1 + z2) / 2);
      rail.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      fence.add(rail);
    }
  }
  fence.add(posts);
  scene.add(fence);

  if (objectMeshes) scene.add(objectMeshes);

  return {
    scene,
    sun,
    ground,
    /** Keep the shadow camera centred on the rider. */
    follow(p) {
      sun.position.set(p.x + 18, p.y + 30, p.z + 10);
      sun.target.position.set(p.x, p.y, p.z);
    },
    dispose() {
      // Materials do not free their textures, and lights do not free their shadow maps:
      // release both explicitly or every new session leaks GPU memory.
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
          if (m.map && !m.map.userData.shared) m.map.dispose();
          m.dispose();
        }
        if (o.isLight && o.shadow) o.shadow.dispose();
      });
    },
  };
}
