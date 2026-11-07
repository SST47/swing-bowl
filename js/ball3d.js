/*
 * Swing Baseball — 3D night ballpark (three.js): pitcher with a full windup, the batter
 * (your colours) loading and swinging, fielders chasing the ball, a crowd that cheers,
 * a live scoreboard, fireworks for home runs.
 *
 * Engine coordinates: home plate at the origin, +x to first base / right field, +z towards
 * centre field, y up. three.js: X = x, Y = y, Z = -z.
 */
import * as THREE from 'three';
import { rng, canvasTexture, grassMaterial, glowTexture, dotTexture, makeFigure, samplePose, mixPose, applyPose, Fireworks, D2R, autoResolution } from './three-kit.js';

const B = self.BASEBALL, PARK = B.PARK;
const V = (x, y, z) => new THREE.Vector3(x, y, -z);
const MOUND_H = 0.254;
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------- the field, painted from above ----------------
const EXT = { x0: -150, x1: 150, z0: -45, z1: 175 };
function fieldTexture() {
  const W = 4096, H = Math.round(4096 * (EXT.z1 - EXT.z0) / (EXT.x1 - EXT.x0));
  return canvasTexture(W, H, (g) => {
    const sx = W / (EXT.x1 - EXT.x0), sz = H / (EXT.z1 - EXT.z0);
    g.setTransform(sx, 0, 0, -sz, -EXT.x0 * sx, EXT.z1 * sz);   // draw in metres, centre field up
    const R = rng(11);
    g.fillStyle = '#2b6a2e'; g.fillRect(EXT.x0, EXT.z0, EXT.x1 - EXT.x0, EXT.z1 - EXT.z0);
    const fair = new Path2D();
    fair.moveTo(0, 0);
    for (let a = -45; a <= 45; a += 1) { const t = a * D2R, r = PARK.fence(t); fair.lineTo(Math.sin(t) * r, Math.cos(t) * r); }
    fair.closePath();
    g.save(); g.clip(fair);
    g.fillStyle = '#3a873b'; g.fillRect(-150, -10, 300, 200);
    // diamond mowing pattern
    g.save(); g.rotate(Math.PI / 4);
    for (let k = -40; k < 40; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.045)'; g.fillRect(k * 7, -300, 7, 600); }
    g.restore();
    g.save(); g.rotate(-Math.PI / 4);
    for (let k = -40; k < 40; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'; g.fillRect(k * 7, -300, 7, 600); }
    g.restore();
    // warning track
    g.fillStyle = '#9c6f45';
    const track = new Path2D();
    for (let a = -46; a <= 46; a += 1) { const t = a * D2R, r = PARK.fence(Math.max(-PARK.foul, Math.min(PARK.foul, t))); a === -46 ? track.moveTo(Math.sin(t) * r, Math.cos(t) * r) : track.lineTo(Math.sin(t) * r, Math.cos(t) * r); }
    for (let a = 46; a >= -46; a -= 1) { const t = a * D2R, r = PARK.fence(Math.max(-PARK.foul, Math.min(PARK.foul, t))) - 4.5; track.lineTo(Math.sin(t) * r, Math.cos(t) * r); }
    g.fill(track);
    g.restore();
    // infield dirt: a fan around the mound, the grass diamond, cut-outs
    const dirt = '#b47a4a', dirtDark = '#a06a3e';
    g.fillStyle = dirt; g.beginPath(); g.moveTo(0, -1.5);
    for (let a = -47; a <= 47; a += 1) { const t = a * D2R, r = PARK.mound * Math.cos(t) + Math.sqrt(28.5 ** 2 - (PARK.mound * Math.sin(t)) ** 2); g.lineTo(Math.sin(t) * r, Math.cos(t) * r); }
    g.closePath(); g.fill();
    g.fillStyle = '#3b893c'; g.beginPath(); g.moveTo(0, 4.6); g.lineTo(14.6, 19.4); g.lineTo(0, 34.2); g.lineTo(-14.6, 19.4); g.closePath(); g.fill();
    g.save(); g.clip(new Path2D('M0 4.6 L14.6 19.4 L0 34.2 L-14.6 19.4 Z'));
    g.rotate(Math.PI / 4); for (let k = -12; k < 12; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; g.fillRect(k * 3.5, -40, 3.5, 80); } g.restore();
    const disc = (x, z, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2); g.fill(); };
    disc(0, 0, 4.0, dirt); disc(0, PARK.mound, 2.75, dirtDark);
    for (const s of [-1, 1]) disc(s * 13, -4, 0.9, dirtDark);   // on-deck circles
    for (let i = 0; i < 9000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(80,45,20,0.18)' : 'rgba(230,190,140,0.14)'; const a = R() * Math.PI * 2, r = R() * 30; g.fillRect(Math.sin(a) * r, PARK.mound - 4 + Math.cos(a) * r, 0.18, 0.18); }
    // chalk: foul lines, batter's boxes, catcher's box
    g.strokeStyle = '#f2f2ee'; g.lineWidth = 0.1;
    for (const s of [-1, 1]) { const f = PARK.fence(s * PARK.foul); g.beginPath(); g.moveTo(s * 0.3, 0.3); g.lineTo(s * Math.sin(PARK.foul) * f, Math.cos(PARK.foul) * f); g.stroke(); }
    for (const s of [-1, 1]) g.strokeRect(s > 0 ? 0.36 : -1.58, -0.9, 1.22, 1.83);
    g.strokeRect(-0.55, -3.0, 1.1, 2.0);
  });
}

function wallTexture() {
  return canvasTexture(256, 128, (g, W, H) => {
    g.fillStyle = '#16452a'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 32) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, 0, 2, H); g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 2, 0, 3, H); }
  }, { repeat: [60, 1] });
}

function seatsTexture() {
  return canvasTexture(64, 256, (g, W, H) => {
    for (let y = 0; y < H; y += 16) { g.fillStyle = '#1b2554'; g.fillRect(0, y, W, 11); g.fillStyle = '#0d1230'; g.fillRect(0, y + 11, W, 5); }
  }, { repeat: [40, 6] });
}

function lampTexture() {
  return canvasTexture(256, 128, (g, W, H) => {
    g.fillStyle = '#1a1d24'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
      const cx = 16 + x * 32, cy = 16 + y * 32, gr = g.createRadialGradient(cx, cy, 0, cx, cy, 14);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#fff6d8'); gr.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.fill();
    }
  });
}

function seamTexture() {
  return canvasTexture(256, 128, (g, W, H) => {
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c8202a'; g.lineWidth = 3;
    for (const off of [0, Math.PI]) { g.beginPath(); for (let x = 0; x <= W; x += 4) { const y = H / 2 + Math.sin(x / W * Math.PI * 4 + off) * H * 0.28; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  });
}

// ---------------- animations ----------------
// Pitcher (right-handed, facing home = local +Z). Limb directions are in the parent's frame.
const P_SET = { hips: [0, 0, 0], spine: [0.05, 0, 0], armR: [[-0.25, -0.8, 0.45], [0.55, 0.5, 0.6]], armL: [[0.25, -0.8, 0.45], [-0.55, 0.5, 0.6]], legL: [[0.06, -1, 0], [0.04, -1, 0]], legR: [[-0.06, -1, 0], [-0.04, -1, 0]], lift: -0.02 };
const P_ROCK = { hips: [0, -0.35, 0], spine: [-0.08, 0, 0], armR: [[-0.2, -0.55, 0.75], [0.5, 0.75, 0.35]], armL: [[0.2, -0.55, 0.75], [-0.5, 0.75, 0.35]], legL: [[0.1, -0.98, -0.15], [0.06, -1, 0]], legR: [[-0.06, -1, 0], [-0.04, -1, 0]], lift: -0.03 };
// leg kick: turned sideways (chest towards third base), front knee high, hands together at the chest
const P_KICK = { hips: [0, -1.4, 0], spine: [0.05, 0.05, 0], armR: [[-0.15, -0.6, 0.78], [0.45, 0.8, 0.35]], armL: [[0.15, -0.6, 0.78], [-0.45, 0.8, 0.35]], legL: [[0.05, 0.3, 0.95], [0.02, -1, 0.15]], legR: [[0.02, -1, 0.02], [0, -1, 0]], lift: 0.0 };
// stride: front leg reaches towards home (local +X of the closed hips), throwing arm cocks back and up
const P_STRIDE = { move: [0, 0, 0.55], hips: [0, -1.15, 0], spine: [0.1, 0.1, 0.12], armR: [[-0.85, 0.35, -0.2], [-0.15, 0.95, 0.25]], armL: [[0.95, 0.15, 0.2], [0.8, 0.35, 0.3]], legL: [[0.8, -0.6, 0.1], [0.15, -0.99, 0]], legR: [[-0.5, -0.85, 0], [-0.55, -0.82, -0.15]], lift: -0.16 };
// release: hips open to home, arm whips over the top
const P_RELEASE = { move: [0, 0, 0.85], hips: [0, 0.25, 0], spine: [0.55, 0.2, 0], armR: [[-0.2, 0.55, 0.81], [-0.05, 0.1, 0.99]], armL: [[0.55, -0.6, 0.55], [0.3, -0.8, 0.5]], legL: [[0.05, -0.75, 0.66], [0.02, -1, 0.05]], legR: [[-0.1, -0.6, -0.8], [-0.1, -0.2, -0.98]], lift: -0.22 };
const P_FOLLOW = { move: [0, 0, 0.95], hips: [0, 0.45, 0], spine: [0.75, 0.35, 0], armR: [[0.45, -0.7, 0.55], [0.7, -0.6, 0.35]], armL: [[0.35, -0.85, 0.35], [0.2, -0.9, 0.35]], legL: [[0.02, -0.82, 0.55], [0.02, -1, 0.05]], legR: [[-0.1, -0.2, -0.98], [-0.05, 0.6, -0.8]], lift: -0.2 };
const P_FIELD = { move: [0, 0, 0.9], hips: [0, 0, 0], spine: [0.35, 0, 0], armR: [[-0.2, -0.85, 0.45], [0, -0.7, 0.7]], armL: [[0.2, -0.85, 0.45], [0, -0.7, 0.7]], legL: [[0.2, -0.9, 0.2], [0.1, -1, -0.1]], legR: [[-0.2, -0.9, 0.2], [-0.1, -1, -0.1]], lift: -0.14 };
function pitcherPose(sinceWindup, windupLen) {
  const s = sinceWindup / windupLen;   // 1 = release
  if (s < 1) return samplePose([{ t: 0, pose: P_SET }, { t: 0.18, pose: P_ROCK }, { t: 0.52, pose: P_KICK }, { t: 0.88, pose: P_STRIDE, ease: 'in' }, { t: 1, pose: P_RELEASE }], s);
  const after = (s - 1) * windupLen;   // seconds after release; the arm whips straight through
  return samplePose([{ t: 0, pose: P_RELEASE, ease: 'out' }, { t: 0.22, pose: P_FOLLOW }, { t: 0.9, pose: P_FOLLOW }, { t: 1.6, pose: P_FIELD }], after);
}

// Batter (right-handed, facing the plate = local +Z, pitcher towards local +X).
const BT_STANCE = { spine: [0.18, -0.38, 0], hips: [0, -0.12, 0], neck: [0.12, 1.42, 0], armR: [[-0.3, -0.72, 0.62], [0.42, 0.82, 0.38]], armL: [[-0.42, -0.62, 0.66], [-0.62, 0.62, 0.42]], legL: [[0.28, -0.95, 0.08], [0.12, -0.99, -0.05]], legR: [[-0.28, -0.95, 0.08], [-0.1, -0.99, -0.05]], lift: -0.1 };
const BT_LOAD = Object.assign({}, BT_STANCE, { spine: [0.2, -0.62, 0], hips: [0, -0.3, 0], neck: [0.15, 1.6, 0], legL: [[0.18, -0.92, 0.25], [0.12, -0.99, -0.05]] });
const BT_CONTACT = { spine: [0.22, 0.55, 0], hips: [0, 0.75, 0], neck: [0.38, 0.75, 0], armR: [[0.05, -0.5, 0.86], [0.2, -0.25, 0.95]], armL: [[-0.3, -0.48, 0.82], [0.15, -0.2, 0.97]], legL: [[0.32, -0.95, 0], [0.26, -0.97, 0]], legR: [[-0.12, -0.92, 0.32], [-0.32, -0.88, -0.25]], lift: -0.08 };
const BT_FOLLOW = { spine: [0.15, 1.45, 0], hips: [0, 1.1, 0], neck: [0.25, 0.1, 0], armR: [[0.62, 0.2, 0.75], [0.35, 0.85, -0.35]], armL: [[0.55, -0.05, 0.82], [0.15, 0.92, -0.3]], legL: [[0.3, -0.95, 0], [0.25, -0.97, 0]], legR: [[0.05, -0.85, 0.5], [-0.35, -0.85, -0.35]], lift: -0.06 };
// bat direction in the batter's own frame
const BAT_STANCE = [-0.35, 0.86, -0.38], BAT_LOAD = [-0.55, 0.72, -0.42], BAT_CONTACT = [0.3, -0.06, 0.95], BAT_FOLLOW = [0.55, 0.45, -0.7];
const SWING_CONTACT = 0.12;   // seconds from the start of the swing to contact
// the bat speeds up into contact and is still fast coming out of it
const SWING_KEYS = [{ t: 0, v: [BT_LOAD, BAT_LOAD], ease: 'in' }, { t: SWING_CONTACT, v: [BT_CONTACT, BAT_CONTACT], ease: 'out' }, { t: 0.3, v: [BT_FOLLOW, BAT_FOLLOW] }, { t: 1.0, v: [BT_FOLLOW, BAT_FOLLOW] }, { t: 1.6, v: [BT_STANCE, BAT_STANCE] }];
const SWING_BODY = SWING_KEYS.map(k => ({ t: k.t, pose: k.v[0], ease: k.ease })), SWING_BAT = SWING_KEYS.map(k => ({ t: k.t, pose: { d: k.v[1] }, ease: k.ease }));
const batDir = (since) => samplePose(SWING_BAT, since).d;
// since: seconds since the swing started (negative = not swinging); load: 0 stance .. 1 loaded for the pitch
function batterPose(since, load, t) {
  if (since >= 0 && since <= 1.6) return { pose: samplePose(SWING_BODY, since), bat: batDir(since) };
  const w = 1 - load;      // a small bat waggle while waiting, gone once the batter loads
  const stanceBat = [BAT_STANCE[0] + 0.08 * w * Math.sin(t * 2.4), BAT_STANCE[1], BAT_STANCE[2] + 0.07 * w * Math.cos(t * 2.4)];
  return { pose: mixPose(BT_STANCE, BT_LOAD, load), bat: mixPose({ d: stanceBat }, { d: BAT_LOAD }, load).d };
}

// Fielders: ready crouch, and a run cycle.
const F_READY = { spine: [0.38, 0, 0], armR: [[-0.15, -0.82, 0.55], [0.02, -0.75, 0.65]], armL: [[0.15, -0.82, 0.55], [-0.02, -0.75, 0.65]], legL: [[0.22, -0.92, 0.2], [0.12, -0.98, -0.12]], legR: [[-0.22, -0.92, 0.2], [-0.12, -0.98, -0.12]], lift: -0.16 };
function runPose(phase) {
  const s = Math.sin(phase), c = Math.cos(phase);
  return { spine: [0.25, 0, 0],
    legL: [[0, -0.85, 0.55 * s], [0, -0.9, -0.45 * Math.max(0, -c) - 0.1]], legR: [[0, -0.85, -0.55 * s], [0, -0.9, -0.45 * Math.max(0, c) - 0.1]],
    armL: [[0.15, -0.8, -0.5 * s], [0, -0.3, 0.9]], armR: [[-0.15, -0.8, 0.5 * s], [0, -0.3, 0.9]], lift: -0.05 + 0.04 * Math.abs(c) };
}

const FIELDERS = [[17, 21], [9, 33], [-8, 33], [-17, 21], [-33, 74], [0, 88], [33, 74]];

export class Ball3D {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    r.setPixelRatio(ratio); this._autoRes = autoResolution(r, ratio);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0c1433, 230, 800);
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 2500);
    this.camPos = new THREE.Vector3(0.45, 1.75, 4.4); this.camLook = new THREE.Vector3(0, 1.0, -14);
    this.snapNext = true;
    this.uTime = { value: 0 }; this.uCheer = { value: 0 };
    this._sky(); this._lights(); this._field(); this._stadium(); this._people(); this._dynamic();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  _sky() {
    const S = this.scene;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x02040f) }, mid: { value: new THREE.Color(0x0b1638) }, low: { value: new THREE.Color(0x1f2d5c) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top, mid, low; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(low, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    }));
    S.add(dome);
    const R = rng(3), pos = [];
    for (let i = 0; i < 1600; i++) { const a = R() * Math.PI * 2, e = 0.15 + R() * 1.3; pos.push(Math.cos(a) * Math.cos(e) * 1700, Math.sin(e) * 1700, Math.sin(a) * Math.cos(e) * 1700); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    S.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
    // reflections: night sky with bright lamps
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), new THREE.MeshBasicMaterial({ color: 0x0b1433, side: THREE.BackSide })));
    for (const a of [-70, -40, -15, 15, 40, 70]) { const m = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff6dc })); const t = a * D2R; m.position.set(Math.sin(t) * 40, 22, -Math.cos(t) * 40); m.lookAt(0, 0, 0); es.add(m); }
    const green = new THREE.Mesh(new THREE.CircleGeometry(48, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1d4a20 })); green.position.y = -2; es.add(green);
    const pm = new THREE.PMREMGenerator(this.renderer);
    S.environment = pm.fromScene(es, 0.02).texture; S.environmentIntensity = 0.6;
    pm.dispose();
  }

  _lights() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0x8ea6ff, 0x1d2a14, 0.55));
    const key = this.key = new THREE.DirectionalLight(0xfff4e0, 2.6);
    key.position.set(35, 80, 55); key.target.position.set(0, 0, -22);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera; c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 10; c.far = 220;
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
    S.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xc9d6ff, 0.9); fill.position.set(-70, 60, -40); S.add(fill);
    const plate = new THREE.SpotLight(0xffffff, 120, 0, 0.35, 0.7, 2); plate.position.set(4, 14, 10); plate.target.position.set(-0.4, 1, 0); S.add(plate, plate.target);
  }

  _field() {
    const S = this.scene;
    const tex = fieldTexture(); tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(EXT.x1 - EXT.x0, EXT.z1 - EXT.z0).rotateX(-Math.PI / 2), grassMaterial(tex, { roughness: 0.92 }));
    ground.position.set((EXT.x0 + EXT.x1) / 2, 0, -(EXT.z0 + EXT.z1) / 2); ground.receiveShadow = true; S.add(ground);
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0xa86f43, roughness: 1 });
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 2.75, MOUND_H, 48), dirtMat);
    mound.position.copy(V(0, MOUND_H / 2, PARK.mound)); mound.receiveShadow = true; S.add(mound);
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.5 });
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.03, 0.15), white); rubber.position.copy(V(0, MOUND_H + 0.01, PARK.mound)); S.add(rubber);
    const b45 = PARK.base * Math.SQRT1_2;
    for (const [x, z] of [[b45, b45], [0, b45 * 2], [-b45, b45]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.38), white); b.rotation.y = Math.PI / 4; b.position.copy(V(x, 0.04, z)); b.castShadow = b.receiveShadow = true; S.add(b); }
    const shape = new THREE.Shape([new THREE.Vector2(-0.216, 0.216), new THREE.Vector2(0.216, 0.216), new THREE.Vector2(0.216, 0), new THREE.Vector2(0, -0.216), new THREE.Vector2(-0.216, 0)]);
    const plateM = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), white); plateM.position.y = 0.012; plateM.receiveShadow = true; S.add(plateM);
    // strike zone outline (shown while a pitch is coming)
    const z = B.ZONE, pts = [V(-z.x, z.y0, 0), V(z.x, z.y0, 0), V(z.x, z.y1, 0), V(-z.x, z.y1, 0)];
    this.zone = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }));
    S.add(this.zone);
  }

  _stadium() {
    const S = this.scene, R = rng(21);
    // outfield wall (+ yellow top line) as strips along the fence curve
    const N = 120, wallPos = [], topPos = [], uvs = [];
    for (let i = 0; i <= N; i++) {
      const t = (-45 + 90 * i / N) * D2R, r = PARK.fence(t), h = PARK.fenceH(t), x = Math.sin(t) * r, zz = Math.cos(t) * r;
      wallPos.push(x, 0, -zz, x, h, -zz); uvs.push(i / N, 0, i / N, 1);
      topPos.push(x, h, -zz, x, h + 0.14, -zz);
    }
    const strip = (pos, uv) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); const idx = []; for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx); g.computeVertexNormals(); return g; };
    const wall = new THREE.Mesh(strip(wallPos, uvs), new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.85, side: THREE.DoubleSide }));
    wall.receiveShadow = true; S.add(wall);
    S.add(new THREE.Mesh(strip(topPos), new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide })));
    for (const a of [-45, -22.5, 0, 22.5, 45]) {
      const t = a * D2R, txt = String(Math.round(PARK.fence(t)));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.4), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTexture(384, 128, (g) => { g.fillStyle = '#ffffff'; g.font = '900 100px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 192, 70); }) }));
      // lie flat along the wall: it curves, so follow its tangent rather than facing home plate
      const at = (u) => new THREE.Vector3(Math.sin(u) * PARK.fence(u), 0, -Math.cos(u) * PARK.fence(u));
      const tan = at(t + 0.01).sub(at(t - 0.01)), rot = Math.atan2(-tan.z, tan.x);
      m.rotation.y = rot;
      m.position.copy(at(t)).add(new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)).multiplyScalar(0.12)); m.position.y = PARK.fenceH(t) * 0.5;
      S.add(m);
    }
    // foul poles
    for (const s of [-1, 1]) { const f = PARK.fence(s * PARK.foul), p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 22, 10), new THREE.MeshBasicMaterial({ color: 0xffd23f })); p.position.set(s * Math.sin(PARK.foul) * f, 11, -Math.cos(PARK.foul) * f); S.add(p); }

    // stands: an outfield bowl beyond the wall and grandstands down both lines
    const seats = new THREE.MeshStandardMaterial({ map: seatsTexture(), roughness: 0.9 });
    const crowdSpots = [];
    const bowl = [], bowlIdx = [], M = 80;
    for (let i = 0; i <= M; i++) {
      const t = (-52 + 104 * i / M) * D2R, r0 = PARK.fence(Math.max(-PARK.foul, Math.min(PARK.foul, t))) + 3;
      bowl.push(Math.sin(t) * r0, 3.5, -Math.cos(t) * r0, Math.sin(t) * (r0 + 46), 30, -Math.cos(t) * (r0 + 46));
      if (i < M) { const a = i * 2; bowlIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      for (let k = 0; k < 26; k++) { const u = R(); crowdSpots.push([Math.sin(t + (R() - 0.5) * 0.02) * (r0 + 2 + u * 43), 3.6 + u * 25.6, -Math.cos(t) * (r0 + 2 + u * 43)]); }
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bowl, 3));
    const buv = []; for (let i = 0; i <= M; i++) buv.push(i / M, 0, i / M, 1); bg.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
    bg.setIndex(bowlIdx); bg.computeVertexNormals();
    const bowlMesh = new THREE.Mesh(bg, seats); bowlMesh.material.side = THREE.DoubleSide; S.add(bowlMesh);
    // facade under the bowl's front edge + roof rim with lights
    const facade = [], fIdx = [];
    for (let i = 0; i <= M; i++) { const t = (-52 + 104 * i / M) * D2R, r0 = PARK.fence(Math.max(-PARK.foul, Math.min(PARK.foul, t))) + 3; facade.push(Math.sin(t) * r0, 0, -Math.cos(t) * r0, Math.sin(t) * r0, 3.5, -Math.cos(t) * r0); if (i < M) { const a = i * 2; fIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(facade, 3)); fg.setIndex(fIdx); fg.computeVertexNormals();
    S.add(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0x101733, roughness: 0.9, side: THREE.DoubleSide })));
    for (const s of [-1, 1]) {
      // grandstand parallel to the foul line, set back into foul territory
      const along = new THREE.Vector2(s * Math.SQRT1_2, Math.SQRT1_2), out = new THREE.Vector2(s * Math.SQRT1_2, -Math.SQRT1_2);
      const a0 = 8, a1 = 98, o0 = 20, o1 = 58;
      const p = (a, o) => { const x = along.x * a + out.x * o, zz = along.y * a + out.y * o; return [x, -zz]; };
      const q = [p(a0, o0), p(a1, o0), p(a1, o1), p(a0, o1)];
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute([q[0][0], 2.5, q[0][1], q[1][0], 2.5, q[1][1], q[2][0], 28, q[2][1], q[3][0], 28, q[3][1]], 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      sg.setIndex([0, 1, 2, 0, 2, 3]); sg.computeVertexNormals();
      S.add(new THREE.Mesh(sg, seats));
      const fq = new THREE.BufferGeometry();
      fq.setAttribute('position', new THREE.Float32BufferAttribute([q[0][0], 0, q[0][1], q[1][0], 0, q[1][1], q[1][0], 2.5, q[1][1], q[0][0], 2.5, q[0][1]], 3));
      fq.setIndex([0, 1, 2, 0, 2, 3]); fq.computeVertexNormals();
      S.add(new THREE.Mesh(fq, new THREE.MeshStandardMaterial({ color: 0x101733, roughness: 0.9, side: THREE.DoubleSide })));
      for (let k = 0; k < 1100; k++) { const u = R(), v = R(), a = a0 + (a1 - a0) * u, o = o0 + 1 + (o1 - o0 - 2) * v, [x, zz] = p(a, o); crowdSpots.push([x, 2.6 + 25.4 * ((o - o0) / (o1 - o0)), zz]); }
      // dugout
      const d = p(30, 14), dug = new THREE.Mesh(new THREE.BoxGeometry(16, 2.2, 3.5), new THREE.MeshStandardMaterial({ color: 0x0d1430, roughness: 0.8 }));
      dug.position.set(d[0], 0.6, d[1]); dug.rotation.y = s * Math.PI / 4; S.add(dug);
    }
    // crowd: little people that bob (on the GPU), and cheer on home runs
    const crowdGeo = new THREE.CapsuleGeometry(0.24, 0.42, 2, 6).translate(0, 0.45, 0);
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    crowdMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.uTime; sh.uniforms.uCheer = this.uCheer;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uCheer;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float id = float(gl_InstanceID);
          float wave = sin(uTime * (2.0 + uCheer * 9.0) + id * 1.7) * (0.04 + uCheer * 0.45) * (0.4 + 0.6 * fract(sin(id * 12.9898) * 43758.5));
          transformed.y += max(wave, -0.02);`);
    };
    const crowd = this.crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdSpots.length);
    const mm = new THREE.Matrix4(), col = new THREE.Color(), palette = [0xe8e8e8, 0xff5a5f, 0x3fa9f5, 0xffd23f, 0x3ddc97, 0x1f2a44, 0xff9f1c, 0xc77dff];
    crowdSpots.forEach((p, i) => { mm.makeTranslation(p[0], p[1], p[2]); crowd.setMatrixAt(i, mm); crowd.setColorAt(i, col.set(palette[Math.floor(R() * palette.length)]).multiplyScalar(0.55 + R() * 0.45)); });
    S.add(crowd);
    // light towers with glowing lamp banks
    const glow = glowTexture(), lamp = new THREE.MeshStandardMaterial({ map: lampTexture(), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 1.4, roughness: 0.5 });
    lamp.emissiveMap = lamp.map;
    for (const a of [-62, -35, -12, 12, 35, 62]) {
      const t = a * D2R, r = PARK.fence(Math.max(-PARK.foul, Math.min(PARK.foul, t))) + 58, x = Math.sin(t) * r, zz = -Math.cos(t) * r;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 52, 8), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7 })); pole.position.set(x, 26, zz); S.add(pole);
      const bank = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 1), [lamp, lamp, lamp, lamp, lamp, lamp]); bank.position.set(x, 54, zz); bank.lookAt(0, 0, -20); S.add(bank);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff3d6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85, fog: false }));
      sp.position.set(x, 54, zz).add(new THREE.Vector3(-x, 0, -zz - 20).normalize().multiplyScalar(1.2)); sp.scale.set(38, 26, 1); S.add(sp);
    }
    // scoreboard in centre field
    this.sbCanvas = document.createElement('canvas'); this.sbCanvas.width = 1024; this.sbCanvas.height = 420;
    this.sbTex = new THREE.CanvasTexture(this.sbCanvas); this.sbTex.colorSpace = THREE.SRGBColorSpace;
    const sbMat = new THREE.MeshStandardMaterial({ map: this.sbTex, emissive: 0xffffff, emissiveMap: this.sbTex, emissiveIntensity: 1.1, roughness: 0.6 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x111522, roughness: 0.7 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(40, 16.4, 1.5), [frame, frame, frame, frame, sbMat, frame]);
    const r0 = PARK.fence(0) + 52; board.position.set(0, 42, -r0); S.add(board);
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 30, 1.2), frame); leg.position.set(s * 14, 18, -r0 - 0.5); S.add(leg); }
    this.sbCenter = new THREE.Vector3(0, 56, -r0 + 4);
    this._scoreboard({ title: 'HOME RUN DERBY' });
  }

  _scoreboard(d) {
    const key = JSON.stringify(d);
    if (key === this._sbKey) return;
    this._sbKey = key;
    const g = this.sbCanvas.getContext('2d'), W = 1024, H = 420;
    g.fillStyle = '#05070f'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.04)'; for (let x = 0; x < W; x += 6) g.fillRect(x, 0, 2, H); for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd23f'; g.font = '900 64px system-ui, sans-serif'; g.fillText(d.title || 'HOME RUN DERBY', W / 2, 62);
    if (d.flash) { g.fillStyle = '#ff5a5f'; g.font = '900 120px system-ui, sans-serif'; g.fillText(d.flash, W / 2, 220); }
    else if (d.name) {
      g.fillStyle = d.color || '#ffffff'; g.font = '800 92px system-ui, sans-serif'; g.fillText(d.name.toUpperCase(), W / 2, 170);
      g.fillStyle = '#ffffff'; g.font = '700 56px system-ui, sans-serif';
      g.fillText(`HR ${d.hrs}    ·    SWINGS LEFT ${d.left}`, W / 2, 268);
      if (d.last) { g.fillStyle = '#9fe8ff'; g.font = '700 46px system-ui, sans-serif'; g.fillText(d.last, W / 2, 350); }
    } else { g.fillStyle = '#ffffff'; g.font = '700 64px system-ui, sans-serif'; g.fillText('SCAN TO PLAY', W / 2, 220); }
    this.sbTex.needsUpdate = true;
  }

  _people() {
    const S = this.scene;
    const away = { shirt: 0xc7cad1, pants: 0xc7cad1, hat: 0x1f2a44, socks: 0x1f2a44, shoes: 0x111111, longSleeves: false };
    this.pitcher = makeFigure(Object.assign({}, away, { number: 27, numberColor: 0x1f2a44 }));
    this.pitcher.root.position.copy(V(0, MOUND_H, PARK.mound));
    S.add(this.pitcher.root);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), new THREE.MeshStandardMaterial({ color: 0x6b3d1f, roughness: 0.8 }));
    glove.scale.set(1, 1.2, 0.7); this.pitcher.arms.L.hand.add(glove);
    this.fielders = FIELDERS.map(([x, z], i) => {
      const f = makeFigure(Object.assign({}, away, { number: [3, 4, 6, 5, 7, 8, 9][i], numberColor: 0x1f2a44 }));
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), glove.material); g.scale.set(1, 1.2, 0.7); f.arms.L.hand.add(g);
      f.root.position.copy(V(x, 0, z)); S.add(f.root);
      return { f, home: V(x, 0, z), pos: V(x, 0, z), phase: Math.random() * 6, running: false };
    });
    // batter: rebuilt when the batter changes (colours)
    this.batterKey = '';
    this.bat = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.013, 0], [0.013, 0.02], [0.011, 0.05], [0.012, 0.32], [0.022, 0.55], [0.033, 0.78], [0.034, 0.84], [0.025, 0.86], [0, 0.86]].map(([r, h]) => new THREE.Vector2(r, h)), 16), new THREE.MeshPhysicalMaterial({ color: 0xc8935a, roughness: 0.35, clearcoat: 0.6 }));
    this.bat.castShadow = true; S.add(this.bat);
  }

  _batter(color, lefty) {
    const key = color + (lefty ? 'L' : 'R');
    if (key === this.batterKey) return;
    this.batterKey = key;
    if (this.batter) { this.scene.remove(this.batter.root); }
    const c = new THREE.Color(color);
    const b = this.batter = makeFigure({ shirt: c.getHex(), pants: 0xf2f2f2, hat: c.clone().multiplyScalar(0.55).getHex(), hatType: 'helmet', socks: c.getHex(), shoes: 0x111111, gloves: 0xf5f5f5, flapSide: lefty ? 0.11 : -0.11 });
    b.root.position.copy(V(lefty ? 0.85 : -0.85, 0, -0.05));
    b.root.rotation.y = lefty ? -Math.PI / 2 : Math.PI / 2;
    if (lefty) b.root.scale.x = -1;   // mirror the right-handed animation
    this.scene.add(b.root);
  }

  _dynamic() {
    const S = this.scene;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), new THREE.MeshStandardMaterial({ map: seamTexture(), roughness: 0.55 }));
    this.ball.castShadow = true; S.add(this.ball);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    S.add(this.shadow);
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 1500), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4 * 1500), 4));
    // fixed on-screen size so the trail stays visible however far the ball goes; it fades towards the tail
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.trail.frustumCulled = false; S.add(this.trail);
    // a soft glow around the batted ball so it reads against the night sky
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff6dc, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.halo.visible = false; S.add(this.halo);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    S.add(this.ring);
    this.fireworks = new Fireworks(S);
    this.lastOutcomeAt = 0;
    this.load = 0;
    // swoosh: a fading fan behind the bat through the fast part of the swing
    const SW = this.swooshN = 14, sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SW * 2 * 3), 3));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SW * 2 * 4), 4));
    const idx = []; for (let i = 0; i < SW - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    sg.setIndex(idx);
    this.swoosh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.swoosh.frustumCulled = false; this.swoosh.visible = false; S.add(this.swoosh);
    // contact flash
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff2c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.flash.visible = false; this.flashAt = -10; this.lastHit = null; S.add(this.flash);
  }

  _swoosh(since, hand, m) {
    const on = since > 0.03 && since < 0.36;
    this.swoosh.visible = on;
    if (!on) return;
    const N = this.swooshN, pos = this.swoosh.geometry.attributes.position, col = this.swoosh.geometry.attributes.color;
    const fade = Math.min(1, (0.36 - since) / 0.14), d = new THREE.Vector3();
    for (let k = 0; k < N; k++) {
      const a = k / (N - 1);                                  // 0 oldest .. 1 now
      d.fromArray(batDir(Math.max(0, since - 0.12 * (1 - a)))).normalize().transformDirection(m);
      pos.setXYZ(k * 2, hand.x + d.x * 0.45, hand.y + d.y * 0.45, hand.z + d.z * 0.45);
      pos.setXYZ(k * 2 + 1, hand.x + d.x * 0.9, hand.y + d.y * 0.9, hand.z + d.z * 0.9);
      const al = a * a * 0.5 * fade;
      col.setXYZW(k * 2, 1, 0.95, 0.85, 0); col.setXYZW(k * 2 + 1, 1, 0.97, 0.9, al);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  }

  // ---------------- every frame ----------------
  render(game, dt, t) {
    this.uTime.value = t;
    const p = game.players[game.cur];
    this._batter(p ? p.color : '#3fa9f5', game.lefty);

    // scoreboard
    if (game.over) this._scoreboard({ title: 'HOME RUN DERBY', flash: 'FINAL' });
    else if (p) {
      const lo = game.lastOutcome;
      const last = lo && t - lo.at < 12 ? (lo.type === 'hr' ? `LAST: HOME RUN · ${Math.round(lo.dist)} M` : lo.type === 'wall' ? `LAST: OFF THE WALL · ${Math.round(lo.dist)} M` : '') : '';
      const hrFlash = lo && lo.type === 'hr' && t - lo.at < 3.5 ? 'HOME RUN!' : '';
      this._scoreboard({ title: 'HOME RUN DERBY', name: p.name, color: p.color, hrs: p.hrs, left: Math.max(0, B.SWINGS - p.swings), last, flash: hrFlash });
    } else this._scoreboard({ title: 'HOME RUN DERBY' });

    // home run: fireworks + the crowd jumps
    const lo = game.lastOutcome;
    if (lo && lo.at !== this.lastOutcomeAt) {
      this.lastOutcomeAt = lo.at;
      if (lo.type === 'hr') { this.fireworks.show(this.sbCenter, 8, 60); this.cheerUntil = t + 5; }
      else if (lo.type === 'wall') this.cheerUntil = t + 1.5;
    }
    const cheer = this.cheerUntil > t ? 1 : 0;
    this.uCheer.value += (cheer - this.uCheer.value) * Math.min(1, dt * 3);
    this.fireworks.update(dt);

    // pitcher
    const P = this.pitcher;
    let ppose;
    if (game.state === 'windup') ppose = pitcherPose(t - game.windupStart, game.WINDUP);
    else if (game.pitch && (game.state === 'pitch' || game.state === 'hit' || game.state === 'result')) ppose = pitcherPose(game.WINDUP + (t - game.pitch.releaseT), game.WINDUP);
    else ppose = P_SET;
    applyPose(P, ppose);
    P.root.updateMatrixWorld(true);

    // batter + bat: loads up as the pitch comes in; the swing is timed so contact lands on the swing's peak
    const BT = this.batter;
    const loadTo = game.state === 'pitch' ? 1 : game.state === 'windup' ? 0.45 * Math.max(0, Math.min(1, ((t - game.windupStart) / game.WINDUP - 0.55) / 0.45)) : 0;
    this.load += (loadTo - this.load) * Math.min(1, dt * (loadTo > this.load ? 6 : 2.5));
    const since = t - game.swingAt + SWING_CONTACT, bp = batterPose(since, this.load, t);
    applyPose(BT, bp.pose);
    BT.root.updateMatrixWorld(true);
    const hand = BT.arms.R.hand.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3().fromArray(bp.bat).normalize().transformDirection(BT.root.matrixWorld);
    this.bat.position.copy(hand).addScaledVector(dir, -0.08);
    this.bat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this._swoosh(since, hand, BT.root.matrixWorld);

    // contact: a flash where the bat met the ball
    if (game.hit && game.hit !== this.lastHit) {
      this.lastHit = game.hit;
      const p0 = game.hit.f.path[0];
      this.flash.position.copy(V(p0.x, p0.y, p0.z)); this.flashAt = t;
    }
    const fa = (t - this.flashAt) / 0.22;
    this.flash.visible = fa >= 0 && fa < 1;
    if (this.flash.visible) { this.flash.scale.setScalar(0.35 + 1.6 * Math.sqrt(fa)); this.flash.material.opacity = (1 - fa) * (1 - fa); }

    // ball: in the pitcher's hand, then the pitch, then the batted ball
    const ballE = game.ballNow(t);
    let ballV = null;
    if (ballE) ballV = V(ballE.x, Math.max(0.05, ballE.y), ballE.z);
    else if (game.state === 'wait' || game.state === 'windup') ballV = P.arms.R.hand.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.04, 0));
    else if (game.state === 'result' && game.lastBall) ballV = V(game.lastBall.x, Math.max(0.06, game.lastBall.y), game.lastBall.z);
    this.ball.visible = !!ballV && !(ballV.z > 3);
    if (ballV) {
      this.ball.position.copy(ballV);
      const camD = ballV.distanceTo(this.camera.position);
      // a batted ball is drawn bigger far away (and glows) so you can follow it all the way out
      const flying = game.state === 'hit' || (game.state === 'result' && game.lastBall);
      const sc = flying ? Math.max(1, Math.min(16, camD / 13)) : Math.max(1, Math.min(9, camD / 25));
      this.ball.scale.setScalar(sc);
      this.halo.visible = flying && this.ball.visible && game.state === 'hit';
      if (this.halo.visible) { this.halo.position.copy(ballV); this.halo.scale.setScalar(sc * 0.55); }
      this.ball.rotation.x += dt * 25;
      this.shadow.visible = this.ball.visible && ballV.y > 0.1;
      this.shadow.position.set(ballV.x, 0.02, ballV.z);
    } else { this.shadow.visible = false; this.halo.visible = false; }

    // timing ring + strike zone during the pitch
    const pitching = game.state === 'pitch' && game.pitch;
    this.zone.visible = game.state === 'windup' || pitching;
    if (pitching) {
      const u = (t - game.pitch.releaseT) / game.pitch.p.dur, tg = game.pitch.p.target;
      this.ring.visible = u <= 1.05;
      this.ring.position.copy(V(tg.x, tg.y, 0));
      const s = 0.06 + 0.55 * Math.max(0, 1 - u); this.ring.scale.set(s, s, s);
      this.ring.quaternion.copy(this.camera.quaternion);
      this.ring.material.color.set(Math.abs(1 - u) < 0.12 ? 0x3ddc97 : 0xffd23f);
    } else this.ring.visible = false;

    // batted-ball trail
    if (game.hit) {
      const path = game.hit.f.path, n = Math.min(path.length - 1, Math.floor(game.hit.i)), g = this.trail.geometry;
      const arr = g.attributes.position.array, col = g.attributes.color.array, i0 = Math.max(0, n - 120);
      let c = 0;
      for (let i = i0; i <= n; i += 2) {
        arr[c * 3] = path[i].x; arr[c * 3 + 1] = Math.max(0.05, path[i].y); arr[c * 3 + 2] = -path[i].z;
        const a = (i - i0 + 1) / (n - i0 + 1);
        col[c * 4] = 1; col[c * 4 + 1] = 0.93; col[c * 4 + 2] = 0.75; col[c * 4 + 3] = 0.15 + 0.6 * a * a;
        c++;
      }
      g.setDrawRange(0, c); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      this.trail.visible = true;
    } else this.trail.visible = false;

    this._fielders(game, dt, t, ballE);
    this._camera(game, dt, t, ballE);
    this._autoRes();
    this.renderer.render(this.scene, this.camera);
  }

  // Fielders crouch for the pitch, watch the ball, and the nearest ones run after it.
  _fielders(game, dt, t, ballE) {
    const hit = game.hit;
    if (hit && !hit._targets) {
      const path = hit.f.path;
      let land = path[path.length - 1];
      for (let i = 1; i < path.length; i++) if (path[i].y <= 0.05 && i > 10) { land = path[i]; break; }
      const L = V(land.x, 0, land.z), r = Math.hypot(land.x, land.z), th = Math.atan2(land.x, land.z);
      const capped = r > PARK.fence(th) - 3 ? V(Math.sin(th) * (PARK.fence(th) - 3), 0, Math.cos(th) * (PARK.fence(th) - 3)) : L;
      hit._targets = new Map();
      [...this.fielders].sort((a, b) => a.home.distanceTo(capped) - b.home.distanceTo(capped)).slice(0, 2).forEach(f => hit._targets.set(f, capped));
    }
    const ballV = ballE ? V(ballE.x, 0, ballE.z) : null;
    for (const F of this.fielders) {
      const target = hit && hit._targets ? hit._targets.get(F) : null;
      const goHome = !hit && game.state === 'wait';
      let dest = target || (goHome ? F.home : null);
      let pose = game.state === 'pitch' || game.state === 'windup' ? F_READY : F_READY;
      if (dest && F.pos.distanceTo(dest) > 0.8) {
        const step = Math.min(F.pos.distanceTo(dest), dt * (target ? 7.5 : 4));
        const dir = dest.clone().sub(F.pos).normalize();
        F.pos.addScaledVector(dir, step);
        F.phase += dt * (target ? 11 : 7);
        pose = runPose(F.phase);
        F.f.root.rotation.y = Math.atan2(dir.x, dir.z);
      } else {
        // face the ball if there is one, otherwise home plate
        const look = ballV || new THREE.Vector3(0, 0, 0);
        const d = look.clone().sub(F.pos);
        const want = Math.atan2(d.x, d.z);
        let diff = want - F.f.root.rotation.y; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        F.f.root.rotation.y += diff * Math.min(1, dt * 4);
        pose = Object.assign({}, F_READY, { lift: -0.16 + Math.sin(t * 1.7 + F.phase) * 0.01 });
      }
      F.f.root.position.copy(F.pos);
      applyPose(F.f, pose);
    }
  }

  _camera(game, dt, t, ballE) {
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    let rate = 3;
    const side = game.lefty ? -1 : 1;
    if (game.over) {
      const a = t * 0.08; pos.set(Math.sin(a) * 70, 38, -40 + Math.cos(a) * 70); look.set(0, 0, -40); rate = 1;
    } else if (game.state === 'result' && game.lastOutcome && game.lastOutcome.type === 'hr' && t - game.lastOutcome.at < 4) {
      // home run: look out over the outfield at the fireworks above the scoreboard
      pos.set(side * 3, 7, 14); look.copy(this.sbCenter).add(new THREE.Vector3(0, -2, 0)); rate = 1.6;
    } else if (game.state === 'hit' && ballE && t - game.hit.at < 0.45) {
      // right after contact: stay with the batter and watch the ball jump off the bat
      pos.set(side * 0.5, 1.8, 4.9); look.set(ballE.x * 0.7, Math.max(1.05, ballE.y * 0.7), -ballE.z * 0.7); rate = 7;
      this.camPos.lerp(pos, 1 - Math.exp(-dt * 2));    // position barely moves; the look follows the ball
      const kl = 1 - Math.exp(-dt * rate);
      this.camLook.lerp(look, kl);
      this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
      return;
    } else if ((game.state === 'hit' && ballE) || (game.state === 'result' && game.lastBall)) {
      // broadcast-style: rise up behind home plate and track the ball over the field
      const b = game.state === 'hit' ? ballE : game.lastBall;
      const r = Math.hypot(b.x, b.z), th = Math.atan2(b.x, b.z);
      const hor = new THREE.Vector3(Math.sin(th), 0, -Math.cos(th));
      const along = Math.max(-14, Math.min(38, r * 0.35 - 14));
      pos.copy(hor).multiplyScalar(along); pos.y = 8 + Math.min(18, b.y * 0.25 + r * 0.04);
      look.set(b.x, Math.max(0.5, b.y * 0.85), -b.z);
      rate = game.state === 'hit' ? 2.4 : 1.8;
    } else {
      pos.set(side * 0.5, 1.72, 4.6); look.set(side * -0.15, 1.05, -14); rate = 2.5;
    }
    const k = this.snapNext ? 1 : 1 - Math.exp(-dt * rate);
    this.snapNext = false;
    this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
  }
}
