/*
 * Swing Sports — shared three.js helpers: textures, an articulated character with
 * keyframed poses, and celebration effects (confetti, fireworks).
 */
import * as THREE from 'three';

export const D2R = Math.PI / 180;

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Lowers the render resolution a step at a time while frames are slow (a 4K TV on a small laptop GPU),
// so motion stays smooth. A step that doesn't speed things up (a 30 Hz display, a busy CPU) is undone
// and adapting stops. Call the returned function once per rendered frame.
export function autoResolution(renderer, max) {
  const MIN = Math.min(max, 0.75);
  let ratio = max, prev = max, last = 0, sum = 0, n = 0, slow = 0, before = 0, done = false;
  let mark = performance.now(), wait = 4000;        // let shaders compile and the page settle first
  return function tick() {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    if (done || document.hidden || now - mark < wait || !(dt > 0) || dt > 0.5) return;
    sum += dt; n++;
    if (sum < 1.5) return;
    const avg = sum / n; sum = 0; n = 0;
    if (before) {
      const helped = avg < before * 0.9; before = 0;
      if (!helped) { ratio = prev; renderer.setPixelRatio(ratio); done = true; return; }
    }
    slow = avg > 1 / 42 ? slow + 1 : 0;
    if (slow >= 2 && ratio > MIN) {
      prev = ratio; ratio = Math.max(MIN, ratio * 0.8); before = avg; slow = 0;
      renderer.setPixelRatio(ratio); mark = now; wait = 2500;
    }
  };
}

export const NOISE_GLSL = `
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y); }`;

// Adds a world-position varying (vWPos) + noise helpers to a built-in material's shaders.
export function withWorldPos(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;' + NOISE_GLSL);
}

// Painted ground + close-up grass detail that fades with distance.
export function grassMaterial(map, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: opts.roughness ?? 0.95, metalness: 0 });
  m.onBeforeCompile = sh => {
    withWorldPos(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float camDist = length(vWPos - cameraPosition);
      float nearF = 1.0 - smoothstep(18.0, 70.0, camDist);
      float patchN = gn(vWPos.xz * 0.3) * 0.6 + gn(vWPos.xz * 1.1) * 0.4;
      diffuseColor.rgb *= 0.92 + 0.16 * patchN;
      float blades = gn(vWPos.xz * vec2(16.0, 11.0)) * 0.6 + gn(vWPos.xz * vec2(41.0, 29.0)) * 0.4;
      diffuseColor.rgb *= mix(1.0, 0.84 + 0.3 * blades, nearF);`);
  };
  return m;
}

export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
  t.anisotropy = 8;
  return t;
}

export function dotTexture() {
  return canvasTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
}

export function glowTexture() {
  return canvasTexture(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

// ---------------- articulated character ----------------
/*
 * A stylised person built from capsules, facing +Z with feet at y = 0.
 * Joints (all THREE.Groups you can rotate): root, hips, spine, neck,
 * arms.L/R { sh, el, hand }, legs.L/R { hip, kn }. L is the figure's left (+X).
 * Rotation conventions: negative x on a shoulder/elbow/hip raises that limb forward (+Z);
 * positive x on a knee bends it; positive x on the spine leans forward; y turns.
 */
export function makeFigure(o = {}) {
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.65 }, extra));
  const shirt = mat(o.shirt ?? 0xffffff), pants = mat(o.pants ?? 0x2b2f3a), skin = mat(o.skin ?? 0xe3ad86);
  const shoes = mat(o.shoes ?? 0xf2f2f2), hat = mat(o.hat ?? 0x1f2a44, { roughness: 0.45 }), sleeve = o.longSleeves ? shirt : skin;
  const part = (geo, m, parent, x = 0, y = 0, z = 0) => { const p = new THREE.Mesh(geo, m); p.position.set(x, y, z); p.castShadow = true; parent.add(p); return p; };
  const joint = (parent, x = 0, y = 0, z = 0) => { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; };
  const root = new THREE.Group();
  const hips = joint(root, 0, 1.0, 0);
  part(new THREE.CapsuleGeometry(0.135, 0.13, 6, 12).rotateZ(Math.PI / 2), pants, hips, 0, -0.02, 0);
  const legs = {};
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const hip = joint(hips, s * 0.1, -0.04, 0);
    part(new THREE.CapsuleGeometry(0.078, 0.3, 6, 12), pants, hip, 0, -0.22, 0);
    const kn = joint(hip, 0, -0.45, 0);
    part(new THREE.CapsuleGeometry(0.066, 0.3, 6, 12), o.socks ? mat(o.socks) : pants, kn, 0, -0.22, 0);
    const an = joint(kn, 0, -0.44, 0);
    part(new THREE.BoxGeometry(0.11, 0.08, 0.27), shoes, an, 0, -0.035, 0.05);
    legs[k] = { hip, kn, an };
  }
  const spine = joint(hips, 0, 0.02, 0);
  part(new THREE.CapsuleGeometry(0.17, 0.3, 6, 14), shirt, spine, 0, 0.29, 0);
  if (o.number) {   // a number on the back
    const t = canvasTexture(128, 128, (g) => { g.fillStyle = '#' + new THREE.Color(o.numberColor ?? 0x111111).getHexString(); g.font = '800 84px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(o.number), 64, 70); });
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7 }));
    num.position.set(0, 0.33, -0.172); num.rotation.y = Math.PI; spine.add(num);
  }
  const neck = joint(spine, 0, 0.58, 0);
  const head = part(new THREE.SphereGeometry(0.115, 20, 16), skin, neck, 0, 0.14, 0.01);
  if (o.hatType === 'helmet') {
    part(new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hat, neck, 0, 0.15, 0);
    const flap = part(new THREE.SphereGeometry(0.06, 12, 8), hat, neck, o.flapSide ?? -0.11, 0.1, 0); flap.scale.set(0.5, 1.2, 1);
    part(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), hat, neck, 0, 0.165, 0.07).scale.set(1, 1, 0.9);
  } else if (o.hatType === 'hair') {
    const hair = part(new THREE.SphereGeometry(0.122, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hat, neck, 0, 0.15, -0.012);
    hair.rotation.x = -0.35;
  } else if (o.hatType !== 'none') {
    part(new THREE.SphereGeometry(0.122, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hat, neck, 0, 0.16, 0);
    part(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), hat, neck, 0, 0.165, 0.09);
  }
  if (o.face !== false) {   // simple eyes so the figure reads as facing a direction
    const eye = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.014, 8, 6), eye, head, s * 0.04, 0.02, 0.105);
  }
  const arms = {};
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const sh = joint(spine, s * 0.215, 0.5, 0);
    part(new THREE.CapsuleGeometry(0.053, 0.2, 6, 10), shirt, sh, 0, -0.14, 0);
    const el = joint(sh, 0, -0.29, 0);
    part(new THREE.CapsuleGeometry(0.046, 0.19, 6, 10), sleeve, el, 0, -0.13, 0);
    const hand = joint(el, 0, -0.27, 0);
    part(new THREE.SphereGeometry(0.05, 12, 10), o.gloves ? mat(o.gloves) : skin, hand, 0, -0.02, 0);
    arms[k] = { sh, el, hand };
  }
  return { root, hips, spine, neck, head, arms, legs, mats: { shirt, pants, skin, hat } };
}

const JOINTS = ['hips', 'spine', 'neck', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR', 'anL', 'anR'];
function jointOf(f, k) {
  switch (k) {
    case 'hips': return f.hips; case 'spine': return f.spine; case 'neck': return f.neck;
    case 'shL': return f.arms.L.sh; case 'elL': return f.arms.L.el; case 'shR': return f.arms.R.sh; case 'elR': return f.arms.R.el;
    case 'hipL': return f.legs.L.hip; case 'knL': return f.legs.L.kn; case 'hipR': return f.legs.R.hip; case 'knR': return f.legs.R.kn;
    case 'anL': return f.legs.L.an; case 'anR': return f.legs.R.an;
  }
  return null;
}
const ease = t => t * t * (3 - 2 * t);

// Blend two poses by t in 0..1. Values are numbers, [x, y, z] arrays, or nested arrays of them.
function mixVal(a, b, t, k) {
  if (a === undefined) a = zeroLike(b, k);
  if (b === undefined) b = zeroLike(a, k);
  if (typeof a === 'number') return a + (b - a) * t;
  return a.map((v, i) => mixVal(v, b[i], t, k));
}
function zeroLike(v, k) {
  if (LIMBS.includes(k)) return REST[k];
  return typeof v === 'number' ? 0 : v.map(x => zeroLike(x));
}
export function mixPose(a, b, t) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = mixVal(a[k], b[k], t, k);
  return out;
}

const EASES = { in: t => t * t, out: t => 1 - (1 - t) * (1 - t), lin: t => t };
// keys: [{ t, pose, ease }] sorted by t. Smoothly interpolates between neighbouring keys. A key's
// ease ('in', 'out' or 'lin') shapes the segment that starts at it: 'in' then 'out' around a key
// keeps a limb moving fast through it (a bat at contact, an arm at release) instead of pausing there.
export function samplePose(keys, t) {
  if (t <= keys[0].t) return keys[0].pose;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b.t) return mixPose(a.pose, b.pose, (EASES[a.ease] || ease)((t - a.t) / (b.t - a.t)));
  }
  return keys[keys.length - 1].pose;
}

/*
 * Apply a pose. Joint rotations are Euler [x, y, z] (hips, spine, neck, shL, elL, ...).
 * Limbs can instead be aimed: armL/armR/legL/legR: [upper direction, lower direction],
 * each a vector in the parent's frame (spine for arms, hips for legs) — e.g. an arm
 * hanging straight down is [[0,-1,0],[0,-1,0]].
 * 'lift' moves the hips up/down (crouching); 'move' offsets the figure in its own frame.
 */
const DOWN = new THREE.Vector3(0, -1, 0), _q = new THREE.Quaternion(), _u = new THREE.Vector3(), _v = new THREE.Vector3();
const LIMBS = ['armL', 'armR', 'legL', 'legR'];
const REST = { armL: [[0, -1, 0], [0, -1, 0]], armR: [[0, -1, 0], [0, -1, 0]], legL: [[0, -1, 0], [0, -1, 0]], legR: [[0, -1, 0], [0, -1, 0]] };
function aimLimb(upperJoint, lowerJoint, dirs) {
  _u.fromArray(dirs[0]).normalize(); _v.fromArray(dirs[1]).normalize();
  upperJoint.quaternion.setFromUnitVectors(DOWN, _u);
  _q.copy(upperJoint.quaternion).invert();
  lowerJoint.quaternion.setFromUnitVectors(DOWN, _v.applyQuaternion(_q));
}
export function applyPose(f, pose) {
  for (const k of JOINTS) {
    const j = jointOf(f, k), v = pose[k];
    if (v) j.rotation.set(v[0], v[1], v[2]); else j.rotation.set(0, 0, 0);
  }
  if (pose.armL) aimLimb(f.arms.L.sh, f.arms.L.el, pose.armL);
  if (pose.armR) aimLimb(f.arms.R.sh, f.arms.R.el, pose.armR);
  if (pose.legL) aimLimb(f.legs.L.hip, f.legs.L.kn, pose.legL);
  if (pose.legR) aimLimb(f.legs.R.hip, f.legs.R.kn, pose.legR);
  f.hips.position.y = 1.0 + (pose.lift || 0);
  const m = pose.move || [0, 0, 0];
  f.hips.position.x = m[0]; f.hips.position.z = m[2];
}

// ---------------- celebrations ----------------
export class Confetti {
  constructor(scene, count = 360) {
    this.n = count;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.035), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), count);
    this.mesh.frustumCulled = false;
    this.p = Array.from({ length: count }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), ang: 0, spin: 0 }));
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) { this.mesh.setColorAt(i, c.setHSL(Math.random(), 0.9, 0.6)); this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); }
    scene.add(this.mesh);
    this.next = 0; this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1);
  }
  burst(at, n = 160, power = 3, spread = 1) {
    for (let k = 0; k < n; k++) {
      const p = this.p[this.next]; this.next = (this.next + 1) % this.n;
      p.life = 3 + Math.random() * 2;
      p.pos.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * spread));
      p.vel.set((Math.random() - 0.5) * power, power * (0.6 + Math.random() * 0.7), (Math.random() - 0.5) * power);
      p.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      p.spin = 6 + Math.random() * 10; p.ang = Math.random() * 6;
    }
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      p.vel.y -= 3.2 * dt; p.vel.multiplyScalar(Math.exp(-1.6 * dt));
      p.vel.x += Math.sin(p.ang * 0.7) * 0.6 * dt;
      p.pos.addScaledVector(p.vel, dt); p.ang += p.spin * dt;
      this.q.setFromAxisAngle(p.axis, p.ang);
      const s = p.life > 0 ? Math.min(1, p.life * 2) : 0;
      this.s.set(s, s, s);
      this.mesh.setMatrixAt(i, this.m.compose(p.pos, this.q, this.s));
    }
    if (any || this._dirty) { this.mesh.instanceMatrix.needsUpdate = true; this._dirty = any; }
  }
}

export class Fireworks {
  constructor(scene, max = 2400) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    this.p = Array.from({ length: max }, () => ({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), col: new THREE.Color() }));
    this.next = 0;
    this.queue = [];
  }
  // A show: several bursts over the next seconds.
  show(center, count = 7, radius = 30) {
    const t = performance.now();
    for (let i = 0; i < count; i++) {
      this.queue.push({ at: t + i * 330 + Math.random() * 200, pos: center.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius, Math.random() * radius * 0.4, (Math.random() - 0.5) * radius * 0.3)), col: new THREE.Color().setHSL(Math.random(), 0.9, 0.6) });
    }
  }
  burst(pos, col, n = 200, speed = 13) {
    for (let k = 0; k < n; k++) {
      const p = this.p[this.next]; this.next = (this.next + 1) % this.max;
      p.max = p.life = 1.4 + Math.random() * 0.8;
      p.pos.copy(pos);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.7 + Math.random() * 0.4));
      p.col.copy(col).offsetHSL((Math.random() - 0.5) * 0.08, 0, 0);
    }
  }
  update(dt) {
    const now = performance.now();
    this.queue = this.queue.filter(q => { if (q.at <= now) { this.burst(q.pos, q.col); return false; } return true; });
    const pos = this.pts.geometry.attributes.position, col = this.pts.geometry.attributes.color;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) { if (col.array[i * 3] !== 0) { col.setXYZ(i, 0, 0, 0); any = true; } continue; }
      any = true;
      p.life -= dt;
      p.vel.y -= 5 * dt; p.vel.multiplyScalar(Math.exp(-1.2 * dt));
      p.pos.addScaledVector(p.vel, dt);
      const f = Math.max(0, p.life / p.max), tw = 0.75 + 0.25 * Math.sin(now / 40 + i);
      pos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      col.setXYZ(i, p.col.r * f * tw * 2, p.col.g * f * tw * 2, p.col.b * f * tw * 2);
    }
    if (any) { pos.needsUpdate = true; col.needsUpdate = true; }
  }
}
