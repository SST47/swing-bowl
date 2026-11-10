/*
 * Swing Tennis — 3D stadium court (three.js): a hard court under the sun, two or four players with
 * rackets (forehands, two-handed backhands, serves, running, celebrating), a crowd, an umpire in the
 * chair, scoreboards, and a broadcast camera that swings round to whichever end it's told to sit behind.
 *
 * Engine coordinates (see tennis-engine.js): x across, y up, z along the court, near end at -z.
 * three.js: X = x, Y = y, Z = -z, so the camera sits behind the near baseline at +Z.
 */
import * as THREE from 'three';
import { Sky } from '../vendor/three/Sky.js';
import { rng, canvasTexture, glowTexture, dotTexture, makeFigure, samplePose, mixPose, applyPose, Confetti, D2R, autoResolution } from './three-kit.js';

const T = self.TENNIS, C = T.COURT;
const V = (x, y, z) => new THREE.Vector3(x, y, -z);
const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------- poses (arms in the torso's frame: +x the player's left, +y up, +z forward) ----------------
const READY = { lift: -0.14, spine: [0.32, 0, 0], neck: [-0.22, 0, 0],
  legL: [[0.14, -0.85, 0.42], [0.04, -0.93, -0.3]], legR: [[-0.14, -0.85, 0.42], [-0.04, -0.93, -0.3]],
  armR: [[-0.18, -0.75, 0.6], [0.35, -0.1, 0.93]], armL: [[0.18, -0.75, 0.6], [-0.3, -0.05, 0.95]], rk: [0, 0.7, 0.3] };
const FH_BACK = { lift: -0.12, hips: [0, -0.55, 0], spine: [0.2, -0.65, 0], neck: [-0.1, 0.95, 0],
  legL: [[0.2, -0.88, 0.42], [0.05, -0.95, -0.25]], legR: [[-0.25, -0.9, -0.2], [-0.05, -0.92, -0.35]],
  armR: [[-0.8, -0.35, -0.45], [-0.35, 0.35, -0.87]], armL: [[0.45, -0.05, 0.9], [0.2, 0.05, 0.98]], rk: [0, 0.5, 0] };
const FH_HIT = { lift: -0.1, hips: [0, 0.15, 0], spine: [0.25, 0.25, 0], neck: [-0.15, -0.35, 0],
  legL: [[0.15, -0.85, 0.45], [0.02, -0.95, -0.2]], legR: [[-0.2, -0.88, -0.35], [-0.02, -0.9, -0.42]],
  armR: [[-0.85, -0.3, 0.45], [-0.45, -0.05, 0.89]], armL: [[0.7, -0.2, 0.68], [0.35, -0.3, 0.88]], rk: [-0.3, 0.1, 0.2] };
const FH_FOLLOW = { lift: -0.06, hips: [0, 0.65, 0], spine: [0.15, 0.7, 0], neck: [-0.1, -0.9, 0],
  legL: [[0.15, -0.9, 0.3], [0.02, -0.97, -0.15]], legR: [[-0.15, -0.85, -0.45], [-0.02, -0.75, -0.65]],
  armR: [[0.55, 0.45, 0.7], [0.45, 0.55, -0.7]], armL: [[0.6, -0.55, -0.1], [0.3, -0.2, 0.93]], rk: [0.2, 0, -0.3] };
const BH_BACK = { lift: -0.12, hips: [0, 0.6, 0], spine: [0.22, 0.75, 0], neck: [-0.1, -1.1, 0],
  legL: [[0.25, -0.9, -0.2], [0.05, -0.92, -0.35]], legR: [[-0.2, -0.88, 0.42], [-0.05, -0.95, -0.25]],
  armR: [[0.45, -0.6, -0.1], [0.55, 0.2, -0.8]], armL: [[0.75, -0.5, -0.3], [0.45, 0.25, -0.86]], rk: [0, 0.4, 0] };
const BH_HIT = { lift: -0.1, hips: [0, -0.1, 0], spine: [0.25, -0.2, 0], neck: [-0.15, 0.3, 0],
  legL: [[0.2, -0.88, -0.35], [0.02, -0.9, -0.42]], legR: [[-0.15, -0.85, 0.45], [-0.02, -0.95, -0.2]],
  armR: [[0.35, -0.45, 0.82], [0.75, -0.05, 0.66]], armL: [[0.62, -0.45, 0.64], [0.65, -0.1, 0.75]], rk: [0.3, 0.1, 0.1] };
const BH_FOLLOW = { lift: -0.06, hips: [0, -0.6, 0], spine: [0.15, -0.75, 0], neck: [-0.1, 0.9, 0],
  legL: [[0.15, -0.85, -0.45], [0.02, -0.75, -0.65]], legR: [[-0.15, -0.9, 0.3], [-0.02, -0.97, -0.15]],
  armR: [[-0.35, 0.55, 0.75], [-0.55, 0.6, -0.55]], armL: [[-0.1, 0.45, 0.88], [-0.6, 0.5, -0.6]], rk: [-0.2, 0, -0.3] };
const S_STANCE = { hips: [0, -1.1, 0], spine: [0.05, -0.15, 0], neck: [0, 1.0, 0],
  legL: [[0.1, -0.97, 0.2], [0, -1, 0.05]], legR: [[-0.15, -0.97, -0.15], [0, -1, 0]],
  armR: [[-0.2, -0.85, 0.45], [0.2, -0.3, 0.93]], armL: [[0.15, -0.8, 0.55], [-0.2, -0.3, 0.93]], rk: [0, 0.4, 0.3] };
const S_TOSS = { lift: -0.08, hips: [0, -1.0, 0], spine: [-0.25, -0.25, 0], neck: [-0.6, 0.9, 0],
  legL: [[0.12, -0.92, 0.3], [0, -0.92, -0.35]], legR: [[-0.15, -0.95, -0.2], [0, -0.9, -0.4]],
  armL: [[0.1, 0.97, 0.2], [0.05, 0.99, 0.12]], armR: [[-0.75, -0.2, -0.62], [-0.3, 0.55, -0.78]], rk: [0, 0.3, 0] };
const S_TROPHY = { lift: -0.14, hips: [0, -0.9, 0], spine: [-0.35, -0.3, 0], neck: [-0.7, 0.8, 0],
  legL: [[0.12, -0.88, 0.4], [0, -0.9, -0.42]], legR: [[-0.12, -0.9, -0.1], [0, -0.88, -0.45]],
  armL: [[0.2, 0.95, 0.25], [0.1, 0.97, 0.2]], armR: [[-0.85, 0.5, -0.15], [0.15, -0.55, -0.82]], rk: [0.1, -0.4, -0.3] };
const S_HIT = { lift: 0.1, hips: [0, -0.25, 0], spine: [-0.05, -0.1, 0], neck: [-0.55, 0.3, 0],
  legL: [[0.05, -0.99, 0.12], [0, -1, 0.05]], legR: [[-0.1, -0.95, -0.3], [0, -0.85, -0.52]],
  armL: [[0.45, -0.6, 0.66], [0.2, 0.3, 0.93]], armR: [[-0.18, 0.96, 0.2], [-0.05, 0.97, 0.25]], rk: [0, 0.3, 0.25] };
const S_FOLLOW = { lift: -0.05, hips: [0, 0.45, 0], spine: [0.6, 0.5, 0], neck: [-0.3, -0.5, 0],
  legL: [[0.1, -0.9, 0.42], [0.03, -0.96, -0.2]], legR: [[-0.1, -0.7, -0.7], [0, -0.3, -0.95]],
  armR: [[0.55, -0.7, 0.45], [0.7, -0.5, 0.5]], armL: [[0.3, -0.85, 0.3], [0.2, -0.6, 0.75]], rk: [0.2, -0.2, -0.2] };
const YES = { lift: -0.1, spine: [0.15, 0, 0], neck: [-0.1, 0, 0],
  legL: [[0.12, -0.9, 0.3], [0.03, -0.95, -0.2]], legR: [[-0.12, -0.9, 0.3], [-0.03, -0.95, -0.2]],
  armR: [[-0.2, -0.85, 0.4], [0.2, -0.2, 0.95]], armL: [[0.45, -0.3, 0.84], [-0.05, 0.97, 0.2]], rk: [0, 0.5, 0.3] };
const WIN = { lift: 0.05, spine: [-0.15, 0, 0], neck: [-0.35, 0, 0],
  legL: [[0.12, -0.98, 0.05], [0, -1, 0]], legR: [[-0.12, -0.98, 0.05], [0, -1, 0]],
  armR: [[-0.35, 0.93, 0.1], [-0.1, 0.99, 0.05]], armL: [[0.35, 0.93, 0.1], [0.1, 0.99, 0.05]], rk: [0, 0.4, 0] };
const LOSE = { lift: -0.04, spine: [0.45, 0, 0], neck: [0.5, 0, 0],
  legL: [[0.1, -0.99, 0.05], [0, -1, 0]], legR: [[-0.1, -0.99, 0.05], [0, -1, 0]],
  armR: [[-0.12, -0.99, 0.05], [0, -0.98, 0.2]], armL: [[0.12, -0.99, 0.05], [0, -1, 0.05]], rk: [0, -0.3, 0.2] };

const CONTACT = 0.13;   // seconds from the start of a stroke to contact
const swingKeys = (back, hit, follow) => [{ t: 0, pose: back, ease: 'in' }, { t: CONTACT, pose: hit, ease: 'out' }, { t: 0.42, pose: follow }, { t: 0.85, pose: follow }, { t: 1.3, pose: READY }];
const FH_KEYS = swingKeys(FH_BACK, FH_HIT, FH_FOLLOW), BH_KEYS = swingKeys(BH_BACK, BH_HIT, BH_FOLLOW);
const SERVE_KEYS = [{ t: 0, pose: S_TROPHY, ease: 'in' }, { t: CONTACT, pose: S_HIT, ease: 'out' }, { t: 0.45, pose: S_FOLLOW }, { t: 0.9, pose: S_FOLLOW }, { t: 1.4, pose: READY }];
function runPose(phase) {
  const s = Math.sin(phase), c = Math.cos(phase);
  return { lift: -0.06 + 0.04 * Math.abs(c), spine: [0.3, 0, 0], neck: [-0.2, 0, 0],
    legL: [[0, -0.85, 0.55 * s], [0, -0.9, -0.45 * Math.max(0, -c) - 0.1]], legR: [[0, -0.85, -0.55 * s], [0, -0.9, -0.45 * Math.max(0, c) - 0.1]],
    armR: [[-0.2, -0.8, 0.45 - 0.3 * s], [0.3, -0.1, 0.95]], armL: [[0.2, -0.8, 0.3 * s], [0, -0.3, 0.95]], rk: [0, 0.6, 0.3] };
}

// ---------------- textures ----------------
const PAINT = { x: 9.5, z: 18.5 };   // painted court area: |x| <= 9.5, |z| <= 18.5
function courtTexture() {
  const W = 1024, H = Math.round(1024 * PAINT.z / PAINT.x);
  return canvasTexture(W, H, (g) => {
    const s = W / (2 * PAINT.x);
    g.setTransform(s, 0, 0, s, W / 2, H / 2);   // metres, origin at the centre of the court
    g.fillStyle = '#3e7d5a'; g.fillRect(-PAINT.x, -PAINT.z, 2 * PAINT.x, 2 * PAINT.z);
    g.fillStyle = '#2f62a3'; g.fillRect(-C.DW, -C.L, 2 * C.DW, 2 * C.L);
    // a little texture in the acrylic
    const R = rng(4);
    for (let i = 0; i < 9000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)'; g.fillRect((R() - 0.5) * 2 * PAINT.x, (R() - 0.5) * 2 * PAINT.z, 0.05 + R() * 0.12, 0.05 + R() * 0.12); }
    g.fillStyle = '#f7f7f2';
    const line = (x0, z0, x1, z1, w = 0.05) => { g.fillRect(Math.min(x0, x1) - w / 2, Math.min(z0, z1) - w / 2, Math.abs(x1 - x0) + w, Math.abs(z1 - z0) + w); };
    for (const z of [-C.L, C.L]) line(-C.DW, z, C.DW, z, 0.1);
    for (const x of [-C.DW, -C.W, C.W, C.DW]) line(x, -C.L, x, C.L);
    for (const z of [-C.SERVICE, C.SERVICE]) line(-C.W, z, C.W, z);
    line(0, -C.SERVICE, 0, C.SERVICE);
    for (const z of [-C.L, C.L]) line(0, z, 0, z - Math.sign(z) * 0.15);
  }, {});
}
function netTexture() {
  return canvasTexture(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(15,18,22,0.92)'; g.lineWidth = 6;
    g.strokeRect(0, 0, 64, 64);
  }, { repeat: [1, 1] });
}
function seatsTexture(color) {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = color; g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 8; r++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, r * 32 + 26, 256, 6); }
  }, { repeat: [12, 3] });
}
function windscreenTexture(text) {
  return canvasTexture(2048, 128, (g) => {
    g.fillStyle = '#16324f'; g.fillRect(0, 0, 2048, 128);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '800 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) g.fillText(text, 256 + i * 512, 66);
  });
}
function ballTexture() {
  return canvasTexture(256, 128, (g) => {
    g.fillStyle = '#d8ef3c'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 7; g.beginPath();
    for (let x = 0; x <= 256; x += 2) { const y = 64 + Math.sin(x / 256 * Math.PI * 4) * 30; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  });
}
function ringTexture() {
  return canvasTexture(128, 128, (g) => { g.strokeStyle = '#fff'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke(); });
}

// a racket: handle along +y, the head beyond it, strings facing +z
function makeRacket(color) {
  const R = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2 });
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.19, 8).translate(0, 0.02, 0), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }));
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.16, 6).translate(0, 0.19, 0), frame);
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.01, 6, 28).scale(0.88, 1.18, 1).translate(0, 0.39, 0), frame);
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24).scale(0.88, 1.18, 1).translate(0, 0.39, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, roughness: 0.6 }));
  for (const m of [grip, throat, head]) { m.castShadow = true; R.add(m); }
  R.add(strings);
  return R;
}

export class Tennis3D {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    r.setPixelRatio(ratio); this._autoRes = autoResolution(r, ratio);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 6000);
    this.camPos = new THREE.Vector3(0, 6.6, 26); this.camLook = new THREE.Vector3(0, 0.2, -2.5);
    this.snapNext = true;
    this.uTime = { value: 0 }; this.uCheer = { value: 0 };
    this._sky(); this._court(); this._stadium(); this._people(); this._dynamic();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the whole court in shot on narrow screens
    this.camera.fov = w / h < 1.5 ? 40 * Math.min(1.5, 1.6 / (w / h)) : 40;
    this.camera.updateProjectionMatrix();
  }

  _sky() {
    const S = this.scene;
    const sun = this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, (90 - 48) * D2R, 205 * D2R);
    const tune = s => { const u = s.material.uniforms; u.turbidity.value = 1.2; u.rayleigh.value = 3.2; u.mieCoefficient.value = 0.002; u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(sun); return s; };
    const sky = tune(new Sky()); sky.scale.setScalar(5000); S.add(sky);
    const envScene = new THREE.Scene(), envSky = tune(new Sky()); envSky.scale.setScalar(80); envScene.add(envSky);
    const pm = new THREE.PMREMGenerator(this.renderer);
    S.environment = pm.fromScene(envScene, 0.03, 0.1, 200).texture; S.environmentIntensity = 0.7;
    pm.dispose();
    S.add(new THREE.HemisphereLight(0xdfeaff, 0x3a4a3a, 0.5));
    const key = this.key = new THREE.DirectionalLight(0xfff1dc, 3.1);
    key.position.copy(sun).multiplyScalar(80); key.target.position.set(0, 0, 0);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera; c.left = -22; c.right = 22; c.top = 26; c.bottom = -26; c.near = 20; c.far = 180;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    S.add(key, key.target);
  }

  _court() {
    const S = this.scene;
    const tex = courtTexture(); tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const court = new THREE.Mesh(new THREE.PlaneGeometry(2 * PAINT.x, 2 * PAINT.z).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78 }));
    court.receiveShadow = true; S.add(court);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(80, 90).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f6a4c, roughness: 0.9 }));
    apron.position.y = -0.01; apron.receiveShadow = true; S.add(apron);
    // the net: a mesh strip sagging from the posts to the centre strap, a white tape on top
    const N = 64, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const x = -C.POST_X + (2 * C.POST_X) * i / N, h = T.netHeight(x);
      pos.push(x, 0.03, 0, x, h, 0); uv.push(x / 0.045, 0, x / 0.045, h / 0.045);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ng.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); ng.setIndex(idx); ng.computeVertexNormals();
    const nt = netTexture(); nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.anisotropy = 8;
    const net = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ map: nt, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 0.9 }));
    net.castShadow = true; S.add(net);
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.5 });
    const tapePts = []; for (let i = 0; i <= N; i++) { const x = -C.POST_X + (2 * C.POST_X) * i / N; tapePts.push(new THREE.Vector3(x, T.netHeight(x), 0)); }
    const tape = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tapePts), 64, 0.028, 6), white); tape.castShadow = true; S.add(tape);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, C.NET_H, 0.012).translate(0, C.NET_H / 2, 0), white); S.add(strap);
    const postM = new THREE.MeshStandardMaterial({ color: 0x1d4430, roughness: 0.5, metalness: 0.3 });
    for (const x of [-C.POST_X, C.POST_X]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, C.POST_H + 0.05, 12).translate(0, (C.POST_H + 0.05) / 2, 0), postM); p.position.x = x; p.castShadow = true; S.add(p); }
    // windscreens behind the baselines and low walls along the sides
    const ws = windscreenTexture('SWING TENNIS');
    for (const z of [-19.5, 19.5]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(26, 2.6), new THREE.MeshStandardMaterial({ map: ws, roughness: 0.8 })); w.position.set(0, 1.3, z); if (z < 0) w.rotation.y = 0; else w.rotation.y = Math.PI; S.add(w); }
    const side = new THREE.MeshStandardMaterial({ color: 0x16324f, roughness: 0.8 });
    for (const x of [-12.5, 12.5]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 39), side); w.position.set(x, 0.6, 0); w.receiveShadow = true; S.add(w); }
  }

  _stadium() {
    const S = this.scene, R = rng(9);
    const seats = new THREE.MeshStandardMaterial({ map: seatsTexture('#24476e'), roughness: 0.85 });
    const spots = [];
    // stands down both sides and behind the far end, rising away from the court
    const tier = (cx, cz, len, ang, rows) => {
      const g = new THREE.Group();
      const depth = rows * 0.85, rise = rows * 0.45;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, depth), seats);
      slab.position.set(0, rise / 2 + 0.6, depth / 2); slab.rotation.x = -Math.atan2(rise, depth); g.add(slab);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, rise + 3, 0.5), new THREE.MeshStandardMaterial({ color: 0x1b2f48, roughness: 0.9 }));
      back.position.set(0, (rise + 3) / 2, depth + 0.3); g.add(back);
      g.position.set(cx, 0, cz); g.rotation.y = ang; S.add(g);
      g.updateMatrixWorld(true);
      for (let rI = 0; rI < rows; rI++) for (let k = 0; k < len / 0.62; k++) {
        if (R() < 0.12) continue;
        const p = new THREE.Vector3(-len / 2 + 0.3 + k * 0.62 + (R() - 0.5) * 0.1, 0.85 + rI * 0.45 + 0.2, 0.4 + rI * 0.85).applyMatrix4(g.matrixWorld);
        spots.push(p);
      }
    };
    tier(-13.4, 0, 38, Math.PI / 2 + Math.PI, 14);   // left side, rising to -x
    tier(13.4, 0, 38, Math.PI / 2, 14);              // right side
    tier(0, -20.4, 26, Math.PI, 12);                 // behind the far baseline
    tier(0, 20.4, 26, 0, 12);                        // behind the near baseline (seen when the camera changes ends)
    const crowdGeo = new THREE.CapsuleGeometry(0.2, 0.36, 2, 6).translate(0, 0.38, 0);
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    crowdMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.uTime; sh.uniforms.uCheer = this.uCheer;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uCheer;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float id = float(gl_InstanceID);
          float wave = sin(uTime * (1.6 + uCheer * 8.0) + id * 1.7) * (0.02 + uCheer * 0.3) * (0.4 + 0.6 * fract(sin(id * 12.9898) * 43758.5));
          transformed.y += max(wave, -0.02);`);
    };
    const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, spots.length);
    const mm = new THREE.Matrix4(), col = new THREE.Color(), palette = [0xf2f2f2, 0xff5a5f, 0x3fa9f5, 0xffd23f, 0x3ddc97, 0x1f2a44, 0xff9f1c, 0xc77dff, 0xe9d5b5];
    spots.forEach((p, i) => { mm.makeTranslation(p.x, p.y, p.z); crowd.setMatrixAt(i, mm); crowd.setColorAt(i, col.set(palette[Math.floor(R() * palette.length)]).multiplyScalar(0.6 + R() * 0.4)); });
    S.add(crowd);
    // the umpire's chair by the net, and the umpire
    const chairM = new THREE.MeshStandardMaterial({ color: 0x1d4430, roughness: 0.6 });
    const chair = new THREE.Group(); chair.position.set(-7.4, 0, 0); S.add(chair);
    for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.06), chairM); l.position.set(x, 0.95, z); l.castShadow = true; chair.add(l); }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.85), chairM); seat.position.y = 1.9; chair.add(seat);
    const backr = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.85), chairM); backr.position.set(-0.4, 2.25, 0); chair.add(backr);
    const ump = makeFigure({ shirt: 0x1f3b63, pants: 0xd9d4c7, shoes: 0x222222, hatType: 'cap', hat: 0xf2f2f2 });
    applyPose(ump, { hips: [0, 0, 0], legL: [[0.1, 0, 1], [0, -1, 0.1]], legR: [[-0.1, 0, 1], [0, -1, 0.1]], armL: [[0.2, -0.8, 0.5], [0, -0.2, 1]], armR: [[-0.2, -0.8, 0.5], [0, -0.2, 1]], spine: [-0.05, 0, 0], lift: -0.06 });
    ump.root.position.set(-7.25, 1.94 - 0.55, 0); ump.root.rotation.y = Math.PI / 2; ump.root.scale.setScalar(0.95); S.add(ump.root);
    this.umpire = ump;
    // a scoreboard over each end stand
    this.sbCanvas = document.createElement('canvas'); this.sbCanvas.width = 1024; this.sbCanvas.height = 300;
    this.sbTex = new THREE.CanvasTexture(this.sbCanvas); this.sbTex.colorSpace = THREE.SRGBColorSpace;
    const frameM = new THREE.MeshStandardMaterial({ color: 0x0d1626, roughness: 0.7 });
    for (const sz of [-1, 1]) {
      const g = new THREE.Group(); g.rotation.y = sz < 0 ? 0 : Math.PI; S.add(g);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(10.24, 3.0), new THREE.MeshBasicMaterial({ map: this.sbTex, toneMapped: false }));
      board.position.set(0, 10.4, -27.3); g.add(board);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(10.8, 3.5, 0.4), frameM); frame.position.set(0, 10.4, -27.55); g.add(frame);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), frameM); pole.position.set(0, 4.5, -27.6); g.add(pole);
    }
    this.sbKey = '';
  }

  _people() {
    this.players = [];      // one per figure on court (two in singles, four in doubles)
    this.playerKey = [];
  }
  _dropPlayer(i) { const old = this.players[i]; if (old) { this.scene.remove(old.f.root); this.scene.remove(old.racket); } this.players[i] = null; }
  _player(i, color, end, lefty) {
    this._dropPlayer(i);
    const S = this.scene;
    const f = makeFigure({ shirt: new THREE.Color(color).getHex(), pants: 0xf2f2f2, shoes: 0xf2f2f2, socks: 0xf2f2f2, hatType: 'cap', hat: new THREE.Color(color).getHex(), longSleeves: false });
    f.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    f.root.rotation.y = end === 0 ? Math.PI : 0;
    if (lefty) f.root.scale.x = -1;   // a left-hander: the right-handed strokes, mirrored
    S.add(f.root);
    const racket = makeRacket(new THREE.Color(color).lerp(new THREE.Color(0x111111), 0.35).getHex()); S.add(racket);
    this.players[i] = { f, racket, phase: 0 };
  }

  _dynamic() {
    const S = this.scene;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(T.BALL_R, 20, 14), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.75 }));
    this.ball.castShadow = true; S.add(this.ball);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(T.BALL_R * 1.2, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    S.add(this.shadow);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 80), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4 * 80), 4));
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.trail.frustumCulled = false; S.add(this.trail);
    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTexture(), transparent: true, depthTest: false, toneMapped: false }));
    this.ring.renderOrder = 10; this.ring.visible = false; S.add(this.ring);
    // a puff where the ball bounces
    this.puffs = [];
    const glow = glowTexture();
    for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.12, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); p.position.y = 0.015; S.add(p); this.puffs.push({ m: p, t: -9 }); }
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff6c8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.flash.visible = false; S.add(this.flash);
    this.confetti = new Confetti(S, 420);
    this.seenFlight = null; this.seenEvents = 0; this.puffNext = 0; this.lastHitSeen = -1; this.flashAt = -9; this.trailFlight = null;
  }

  _scoreboard(game) {
    const s = game.score, info = [0, 1].map(e => ({ w: game.who(e), g: s.games[e], p: game.over ? '' : s.label(e), srv: s.server === e && !game.over }));
    const key = JSON.stringify(info) + game.state;
    if (key === this.sbKey) return;
    this.sbKey = key;
    const g = this.sbCanvas.getContext('2d');
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, 1024, 300);
    g.fillStyle = '#ffd23f'; g.font = '800 34px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('SWING TENNIS', 36, 40);
    g.fillStyle = '#7f8aa3'; g.font = '700 26px system-ui, sans-serif'; g.textAlign = 'right'; g.fillText('GAMES', 790, 40); g.fillText('POINTS', 980, 40);
    info.forEach((r, i) => {
      const y = 120 + i * 105;
      g.fillStyle = r.w.color; g.fillRect(36, y - 34, 14, 68);
      const nm = r.w.name.toUpperCase().slice(0, 22);
      g.fillStyle = '#ffffff'; g.font = `800 ${nm.length > 12 ? Math.max(34, Math.round(58 * 12 / nm.length)) : 58}px system-ui, sans-serif`; g.textAlign = 'left';
      g.fillText(nm, 70, y, 520);
      if (r.srv) { g.fillStyle = '#d8ef3c'; g.beginPath(); g.arc(620, y, 14, 0, Math.PI * 2); g.fill(); }
      g.textAlign = 'right'; g.fillStyle = '#ffd23f'; g.fillText(String(r.g), 780, y); g.fillStyle = '#ffffff'; g.fillText(r.p, 980, y);
    });
    this.sbTex.needsUpdate = true;
  }

  render(game, dt, t) {
    this.uTime.value = t;
    if (game.state !== this.lastState) { this.lastState = game.state; this.stateAt = t; }
    const S = this.scene;
    // players (rebuilt when who's playing changes)
    const figs = game.figs;
    for (let i = 0; i < figs.length; i++) {
      const F = figs[i], w = game.figWho(i);
      const color = F.idx === null && F.slot === 1 ? '#a7b2c8' : w.color;   // the computer pair: two shades of grey
      const lefty = game.isLefty(i), key = `${figs.length}|${F.end}|${w.name}|${color}|${lefty}`;
      if (key !== this.playerKey[i] || !this.players[i]) { this.playerKey[i] = key; this._player(i, color, F.end, lefty); }
      this._animate(game, i, dt, t);
    }
    for (let i = figs.length; i < this.players.length; i++) { this._dropPlayer(i); this.playerKey[i] = ''; }
    this._ballAndEffects(game, dt, t);
    this._scoreboard(game);
    // the crowd: a ripple after points, a roar for games and the match
    const lp = game.lastPoint, since = lp ? t - lp.at : 99;
    const cheer = since < 2.5 ? (lp.res === 'point' ? 0.35 : 1) * (1 - since / 2.5) : 0;
    this.uCheer.value += (cheer - this.uCheer.value) * Math.min(1, dt * 4);
    if (lp && lp.res === 'match' && lp !== this.lastMatchSeen) { this.lastMatchSeen = lp; const P = this._endMid(game, lp.end); this.confetti.burst(V(P.x, 2.2, P.z), 260, 4.5, 2); }
    this.confetti.update(dt);
    this._camera(game, dt, t);
    this._autoRes();
    this.renderer.render(S, this.camera);
  }

  // the middle of the players at one end
  _endMid(game, end) {
    const fs = game.figs.filter(F => F.end === end);
    return fs.length ? { x: fs.reduce((a, F) => a + F.pos.x, 0) / fs.length, z: fs.reduce((a, F) => a + F.pos.z, 0) / fs.length } : { x: 0, z: 0 };
  }

  _animate(game, end, dt, t) {
    const P = this.players[end], E = game.figs[end], f = P.f;
    const facing = E.side === -1 ? Math.PI : 0;      // the near player looks down -Z at the net, the far one up +Z
    f.root.position.copy(V(E.pos.x, 0, E.pos.z));
    const speed = Math.hypot(E.vel.x, E.vel.z);
    P.phase += dt * (4 + speed * 2.2);
    let pose = mixPose(READY, runPose(P.phase), smooth(0.4, 3, speed));
    const X = game.expect, serving = (game.state === 'serve' || game.state === 'toss') && game.serverFig() === end;
    // getting ready for the ball: take the racket back as it comes
    if (X && X.fig === end && !X.done) pose = mixPose(pose, X.forehand ? FH_BACK : BH_BACK, smooth(X.T - 0.75, X.T - 0.22, t));
    if (serving) {
      if (game.state === 'serve') pose = mixPose(pose, S_STANCE, smooth(0, 0.45, t - this.stateAt) * (1 - smooth(0.6, 2.5, speed)));   // settle into the stance once in place
      else { const st = t - E.tossAt, ct = game.toss ? game.toss.contactT : 1; pose = samplePose([{ t: 0, pose: S_STANCE }, { t: 0.3, pose: S_TOSS }, { t: Math.max(0.5, ct - 0.2), pose: S_TROPHY }], st); }
    }
    // a swing (timed so contact lands on the swing's peak)
    const since = t - E.swingAt + CONTACT;
    if (since >= 0 && since < 1.4) pose = samplePose(E.swingKind === 'serve' ? SERVE_KEYS : E.swingKind === 'fh' ? FH_KEYS : BH_KEYS, since);
    // after a point: celebrate (or not), and ease out of it when the next point starts
    if (E.mood && game.state === 'point') { P.mood = E.mood; P.moodAt = E.moodAt; }
    P.moodW = Math.max(0, Math.min(1, (P.moodW || 0) + (E.mood && game.state === 'point' ? dt / 0.4 : -dt / 0.35)));
    if (P.mood && P.moodW > 0) {
      const k = Math.min(smooth(0.2, 0.6, t - P.moodAt), smooth(0, 1, P.moodW)), m = P.mood === 'win' ? WIN : P.mood === 'lose' ? LOSE : YES;
      pose = mixPose(pose, m, k);
      if (P.mood === 'win') pose = Object.assign({}, pose, { lift: (pose.lift || 0) + Math.max(0, Math.sin((t - P.moodAt) * 9)) * 0.12 * k });
    }
    // a light smoothing pass catches any remaining jumps between poses (quicker during a stroke)
    P.pose = P.pose ? mixPose(P.pose, pose, 1 - Math.exp(-dt * (since >= 0 && since < 0.7 ? 60 : 26))) : pose;
    pose = P.pose;
    applyPose(f, pose);
    // face the net; when sprinting, turn part of the way toward where you're running
    let yaw = facing;
    const turn = a => ((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;   // shortest signed angle
    if (speed > 2.5 && !(since >= 0 && since < 0.6)) yaw = facing + 0.45 * turn(Math.atan2(E.vel.x, -E.vel.z) - facing);
    f.root.rotation.y += turn(yaw - f.root.rotation.y) * Math.min(1, dt * 8);
    f.root.updateMatrixWorld(true);
    // racket in the right hand, along the forearm (plus the pose's wrist angle), strings facing forward
    const hand = f.arms.R.hand.getWorldPosition(new THREE.Vector3()), elbow = f.arms.R.el.getWorldPosition(new THREE.Vector3());
    const dir = hand.clone().sub(elbow).normalize();
    if (pose.rk) dir.add(new THREE.Vector3().fromArray(pose.rk).transformDirection(f.root.matrixWorld).multiplyScalar(new THREE.Vector3().fromArray(pose.rk).length())).normalize();
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(f.root.matrixWorld);
    let n = fwd.clone().addScaledVector(dir, -fwd.dot(dir));
    if (n.lengthSq() < 1e-4) n = new THREE.Vector3(1, 0, 0).transformDirection(f.root.matrixWorld);
    n.normalize();
    const xA = new THREE.Vector3().crossVectors(dir, n);
    P.racket.matrixAutoUpdate = false;
    P.racket.matrix.makeBasis(xA, dir, n).setPosition(hand.addScaledVector(dir, -0.06));
    P.racket.matrixWorldNeedsUpdate = true;
  }

  // The ball as shown. A phone's swing reaches the big screen a moment after the real swing, so while one
  // may still be on its way the ball eases up near that player's racket, and when the shot lands the ball
  // slides onto its true path (which started a moment ago) instead of jumping.
  _shownBall(game, t, dt) {
    const slow = u => (u < 0.18 ? u * 0.4 : u < 0.3 ? 0.072 + (u - 0.18) * 1.9 : u);   // seconds past contact -> shown (a brief ease, then it catches up)
    const X = game.expect, B = game.ball;
    let tb = t;
    if (game.toss) { const c = game.toss.t0 + game.toss.contactT; if (!game.isCpu(game.serverFig()) && t > c) tb = c + slow(t - c); }
    else if (B && X && !X.done && !game.isCpu(X.fig) && t > X.T) tb = X.T + slow(t - X.T);
    let p = game.ballNow(tb);
    const key = game.toss || (B && B.flight) || null;
    if (key !== this.shownKey) {
      this.shownOff = this.shownPos && p && key ? { x: this.shownPos.x - p.x, y: this.shownPos.y - p.y, z: this.shownPos.z - p.z, t0: t } : null;
      this.shownKey = key;
    }
    if (p && this.shownOff) {
      // slide from where the ball was drawn onto its true path: gently at first, over a fifth of a second
      const o = this.shownOff, k = 1 - smooth(0, 0.2, t - o.t0);
      p = { x: p.x + o.x * k, y: Math.max(T.BALL_R, p.y + o.y * k), z: p.z + o.z * k };
      if (k <= 0) this.shownOff = null;
    }
    this.shownPos = p ? { x: p.x, y: p.y, z: p.z } : null;
    this.shownT = tb;
    return p;
  }

  _ballAndEffects(game, dt, t) {
    let b = this._shownBall(game, t, dt);
    const tb = this.shownT;
    // before the toss, the server holds the ball
    if (!b && (game.state === 'serve') && this.players[game.serverFig()]) {
      const h = this.players[game.serverFig()].f.arms.L.hand.getWorldPosition(new THREE.Vector3());
      b = { x: h.x, y: h.y - 0.02, z: -h.z };
    }
    this.ball.visible = !!b;
    const camD = b ? V(b.x, b.y, b.z).distanceTo(this.camera.position) : 10;
    const sc = Math.max(1.6, camD / 9);
    if (b) {
      this.ball.position.copy(V(b.x, b.y, b.z));
      this.ball.scale.setScalar(sc);
      this.ball.rotation.x += dt * 14; this.ball.rotation.y += dt * 9;
      this.shadow.visible = b.y > 0.05;
      this.shadow.position.set(b.x, 0.012, -b.z); this.shadow.scale.setScalar(sc * (1 - Math.min(0.6, b.y / 6)));
    } else this.shadow.visible = false;
    // trail behind a fast ball
    const B = game.ball;
    if (B && game.state !== 'serve') {
      const g = this.trail.geometry, arr = g.attributes.position.array, col = g.attributes.color.array;
      const n = Math.max(0, Math.min(B.flight.pts.length - 1, Math.round((tb - B.t0) * T.HZ)));
      let c = 0;
      for (let i = Math.max(0, n - 70); i <= n; i += 2) {
        const p = B.flight.pts[i]; arr[c * 3] = p.x; arr[c * 3 + 1] = p.y; arr[c * 3 + 2] = -p.z;
        const a = (i - (n - 70)) / 70; col[c * 4] = 1; col[c * 4 + 1] = 1; col[c * 4 + 2] = 0.75; col[c * 4 + 3] = Math.max(0, a) * 0.45;
        c++;
      }
      g.setDrawRange(0, c); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      this.trail.visible = true;
      // bounce puffs and the hit flash
      if (this.seenFlight !== B.flight) { this.seenFlight = B.flight; this.seenEvents = 0; this.flash.position.copy(V(B.flight.pts[0].x, B.flight.pts[0].y, B.flight.pts[0].z)); this.flashAt = Math.max(B.t0, t - 0.04); }
      const ev = B.flight.events;
      while (this.seenEvents < ev.length && ev[this.seenEvents].i / T.HZ <= tb - B.t0) {
        const e = ev[this.seenEvents++];
        if (e.type === 'bounce' && !e.roll) { const p = this.puffs[this.puffNext++ % this.puffs.length]; p.m.position.set(e.x, 0.015, -e.z); p.t = t; }
      }
    } else this.trail.visible = false;
    for (const p of this.puffs) { const a = (t - p.t) / 0.5; p.m.visible = a >= 0 && a < 1; if (p.m.visible) { p.m.scale.setScalar(1 + a * 3.5); p.m.material.opacity = 0.55 * (1 - a); } }
    const fa = (t - this.flashAt) / 0.2;
    this.flash.visible = fa >= 0 && fa < 1;
    if (this.flash.visible) { this.flash.scale.setScalar(0.4 + 1.4 * Math.sqrt(fa)); this.flash.material.opacity = (1 - fa) * (1 - fa) * 0.9; }
    // timing ring: closes on the ball at the moment to hit it (only for a person, not the computer)
    const X = game.expect;
    let ringOn = false;
    if (b && X && !X.done && !game.isCpu(X.fig) && game.state === 'rally') {
      const left = X.T - t;
      if (left < 0.75 && left > -0.12) {
        ringOn = true;
        const k = Math.max(0, left) / 0.75;
        this.ring.position.copy(this.ball.position);
        this.ring.scale.setScalar(T.BALL_R * sc * 2.6 * (1 + 4 * k));
        this.ring.material.color.set(game.figWho(X.fig).color).lerp(new THREE.Color(0x7dff9a), left < 0.1 ? 1 : 0);
        this.ring.material.opacity = 0.95;
      }
    }
    if (!ringOn && b && game.state === 'toss' && !game.isCpu(game.serverFig()) && game.toss) {
      const left = game.toss.t0 + game.toss.contactT - t;
      if (left < 0.9 && left > -0.12) {
        ringOn = true;
        const k = Math.max(0, left) / 0.9;
        this.ring.position.copy(this.ball.position);
        this.ring.scale.setScalar(T.BALL_R * sc * 2.6 * (1 + 4 * k));
        this.ring.material.color.set(game.figWho(game.serverFig()).color).lerp(new THREE.Color(0x7dff9a), left < 0.1 ? 1 : 0);
      }
    }
    this.ring.visible = ringOn;
  }

  _camera(game, dt, t) {
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    const b = game.ballNow(t);
    // broadcast view from high behind one baseline, drifting a little with the ball. When the camera changes
    // ends it swings round the side of the court (angle 0: behind the near end, π: behind the far end).
    const want = game.camEnd === 1 ? Math.PI : 0;
    if (this.camAng === undefined || this.snapNext) this.camAng = want;
    this.camAng += (want - this.camAng) * (1 - Math.exp(-dt * 1.5));
    if (Math.abs(want - this.camAng) < 1e-3) this.camAng = want;
    const a = this.camAng, ca = Math.cos(a), sa = Math.sin(a);
    const bx = b ? Math.max(-5, Math.min(5, b.x)) : 0;
    pos.set(sa * 28 + bx * 0.18 * ca, 6.6 + 10 * sa, ca * 26); look.set(bx * 0.3, 0.2, -2.5 * ca);   // up and over the side stand
    let rate = sa > 0.05 ? 6 : 2.2;   // follow the swing closely
    // match won: swing in on the winner
    const lp = game.lastPoint;
    if (game.over && lp && lp.res === 'match' && game.state === 'point') {
      const P = this._endMid(game, lp.end), s = lp.end === 0 ? -1 : 1;
      pos.copy(V(P.x + 2.5, 2.4, P.z - s * 5.5)); look.copy(V(P.x, 1.3, P.z)); rate = 1.3;
    }
    const k = this.snapNext ? 1 : 1 - Math.exp(-dt * rate);
    this.snapNext = false;
    this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
  }
}
