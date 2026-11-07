/*
 * Swing Bowl — 3D bowling alley (three.js). Same interface as the 2D Renderer
 * (follow, snapCamera, drawScene), so GameApp can use either.
 *
 * Engine coordinates: x across the lane, z down the lane from the foul line, y up.
 * three.js: X = x, Y = y, Z = -z (so the pins are towards -Z).
 */
import * as THREE from 'three';
import { Reflector } from '../vendor/three/Reflector.js';
import { rng, canvasTexture, makeFigure, samplePose, applyPose, Confetti, glowTexture, autoResolution } from './three-kit.js';

const SB = self.SB, C = SB.C;
const LANE_W = C.LANE_HALF * 2, LANE_LEN = 19.15, APPROACH = 4.6, PITCH = 1.95;   // PITCH: lane centre to lane centre
const PIN_PROFILE = [[0.026, 0], [0.047, 0.03], [0.0605, 0.105], [0.052, 0.18], [0.03, 0.24], [0.021, 0.272], [0.026, 0.305], [0.032, 0.335], [0.026, 0.365], [0.0, 0.381]];

// ---------------- textures ----------------
function laneTexture(seed) {
  const R = rng(seed), W = 256, H = 4096, zOf = z => (1 - z / LANE_LEN) * H, bw = W / 39;
  return canvasTexture(W, H, (g) => {
    for (let b = 0; b < 39; b++) {
      const tone = (R() - 0.5) * 18;
      g.fillStyle = `rgb(${226 + tone},${178 + tone * 0.8},${120 + tone * 0.6})`; g.fillRect(b * bw, 0, bw + 1, H);
      g.fillStyle = `rgba(150,82,30,${0.16 + R() * 0.08})`; g.fillRect(b * bw, zOf(17.6), bw + 1, zOf(4.9) - zOf(17.6));   // pine section
    }
    for (let i = 0; i < 2600; i++) {   // grain
      g.fillStyle = `rgba(${R() < 0.5 ? '120,64,20' : '255,235,200'},${0.05 + R() * 0.07})`;
      g.fillRect(Math.floor(R() * 39) * bw + R() * bw, R() * H, 0.6 + R(), 20 + R() * 160);
    }
    g.fillStyle = 'rgba(90,45,15,0.35)'; for (let b = 1; b < 39; b++) g.fillRect(b * bw - 0.5, 0, 1, H);   // seams
    // target arrows (boards 5..35) and dots
    g.fillStyle = '#3a1e0c';
    for (let k = 0; k < 7; k++) {
      const board = 5 + k * 5, x = W - (board - 0.5) * bw, z = 4.57 + (3 - Math.abs(k - 3)) * 0.3;
      g.beginPath(); g.moveTo(x - bw * 0.9, zOf(z)); g.lineTo(x + bw * 0.9, zOf(z)); g.lineTo(x, zOf(z + 0.32)); g.fill();
    }
    for (const board of [3, 5, 8, 11, 14]) for (const side of [-1, 1]) { const x = side < 0 ? (board - 0.5) * bw : W - (board - 0.5) * bw; g.beginPath(); g.arc(x, zOf(2.13), 2.2, 0, Math.PI * 2); g.fill(); }
    for (const s of SB.SPOTS) { g.fillStyle = 'rgba(70,35,10,0.5)'; g.beginPath(); g.arc(W / 2 + s.x / LANE_W * W, zOf(s.z), 4, 0, Math.PI * 2); g.fill(); }
  });
}

function approachTexture(seed) {
  const R = rng(seed), W = 512, H = 1024, bw = W / 72;
  return canvasTexture(W, H, (g) => {
    for (let b = 0; b < 72; b++) { const t = (R() - 0.5) * 16; g.fillStyle = `rgb(${214 + t},${168 + t * 0.8},${112 + t * 0.6})`; g.fillRect(b * bw, 0, bw + 1, H); }
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(120,64,20,${0.05 + R() * 0.06})`; g.fillRect(R() * W, R() * H, 0.8, 10 + R() * 70); }
    g.fillStyle = 'rgba(90,45,15,0.3)'; for (let b = 1; b < 72; b++) g.fillRect(b * bw - 0.5, 0, 1, H);
    // approach dots at 12 ft and 15 ft behind the foul line, foul line at the top
    g.fillStyle = '#3a1e0c';
    for (const z of [3.66, 4.57]) for (let k = -2; k <= 2; k++) { g.beginPath(); g.arc(W / 2 + k * 5 * bw, z / APPROACH * H, 3.5, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#5a0d0d'; g.fillRect(0, 0, W, 6); g.fillStyle = '#111'; g.fillRect(0, 6, W, 3);
  });
}

function carpetTexture() {
  const R = rng(5);
  return canvasTexture(512, 512, (g, W, H) => {
    g.fillStyle = '#120c2e'; g.fillRect(0, 0, W, H);
    const cols = ['#ff3d7f', '#26c6da', '#ffd23f', '#7b4dff', '#3ddc97'];
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.55; g.lineWidth = 3;
      const x = R() * W, y = R() * H, s = 6 + R() * 20, k = R();
      if (k < 0.3) { g.beginPath(); g.arc(x, y, s / 2, 0, Math.PI * 2); g.stroke(); }
      else if (k < 0.55) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s * 0.3); g.lineTo(x + s * 0.3, y + s); g.closePath(); g.stroke(); }
      else if (k < 0.8) { g.beginPath(); g.moveTo(x, y); for (let j = 1; j < 6; j++) g.lineTo(x + j * s * 0.4, y + (j % 2 ? -1 : 1) * s * 0.3); g.stroke(); }
      else { g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill(); }
    }
  }, { repeat: [6, 6] });
}

function signTexture(text, lane) {
  return canvasTexture(1024, 320, (g, W, H) => {
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#1a0b3a'); bg.addColorStop(1, '#0b1638');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#7b4dff'; g.lineWidth = 6; g.shadowColor = '#7b4dff'; g.shadowBlur = 20; g.strokeRect(14, 14, W - 28, H - 28);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 150px system-ui, sans-serif';
    g.shadowColor = '#ff3d7f'; g.shadowBlur = 40; g.fillStyle = '#ffd1e3'; g.fillText(text, W / 2, H / 2 + 8);
    g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = '#ff3d7f'; g.strokeText(text, W / 2, H / 2 + 8);
    g.font = '800 64px system-ui, sans-serif'; g.shadowColor = '#26c6da'; g.shadowBlur = 24; g.fillStyle = '#bff6ff';
    g.fillText(String(lane), 80, 80); g.fillText(String(lane), W - 80, 80);
    for (let i = 0; i < 26; i++) { g.fillStyle = i % 2 ? '#26c6da' : '#ffd23f'; g.shadowColor = g.fillStyle; g.shadowBlur = 12; g.beginPath(); g.arc(60 + i * 35.5, H - 40, 4, 0, Math.PI * 2); g.fill(); }
  });
}

const ballTexCache = new Map();
function ballTexture(hex) {
  if (ballTexCache.has(hex)) return ballTexCache.get(hex);
  const base = new THREE.Color(hex), hsl = {}; base.getHSL(hsl);
  const toRGB = c => { const s = c.clone().convertLinearToSRGB(); return [s.r * 255, s.g * 255, s.b * 255]; };
  const dark = toRGB(new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.95 + 0.05), Math.max(0.06, hsl.l * 0.32)));
  const mid = toRGB(new THREE.Color().setHSL(hsl.h + 0.03, Math.min(1, hsl.s + 0.1), Math.min(0.6, hsl.l * 0.85)));
  const light = toRGB(new THREE.Color().setHSL(hsl.h - 0.05, 0.55, 0.82));
  const t = canvasTexture(512, 256, (g, W, H) => {
    const img = g.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W * Math.PI * 2, v = y / H * Math.PI;
      const px = Math.cos(u) * Math.sin(v), py = Math.cos(v), pz = Math.sin(u) * Math.sin(v);   // seamless on the sphere
      const n = Math.sin(px * 4.2 + Math.sin(py * 6.5 + pz * 3.7) * 2.4 + Math.sin(pz * 5.3 + px * 2) * 1.6);
      let m = 0.5 + 0.5 * n; m = m * m;
      let c = [0, 1, 2].map(i => dark[i] + (mid[i] - dark[i]) * m);
      const vein = Math.abs(Math.sin(px * 8.5 + py * 3.1 + pz * 5.7 + n));
      if (vein < 0.07) c = c.map((v0, i) => v0 + (light[i] - v0) * (1 - vein / 0.07) * 0.8);
      const k = (y * W + x) * 4; d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // finger holes near the top of the ball
    for (const [u, v, r] of [[0.23, 0.2, 12], [0.27, 0.2, 12], [0.25, 0.33, 15]]) {
      const x = u * W, y = v * H, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, '#000'); gr.addColorStop(0.7, '#0a0a0a'); gr.addColorStop(1, 'rgba(0,0,0,0.2)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2); g.fill();
    }
  });
  ballTexCache.set(hex, t);
  return t;
}

function pinGeometry() {
  const curve = new THREE.SplineCurve(PIN_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)));
  const pts = [new THREE.Vector2(0, 0)].concat(curve.getSpacedPoints(48).map(p => new THREE.Vector2(Math.max(0.0005, p.x), p.y)));
  const geo = new THREE.LatheGeometry(pts, 28);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / C.PIN_H);   // v = height, so the neck stripes land in the right place
  geo.computeVertexNormals();
  return geo;
}
function pinTexture() {
  return canvasTexture(8, 512, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d7263d';
    for (const [a, b] of [[0.229, 0.244], [0.251, 0.262]]) { const y0 = (1 - b / C.PIN_H) * H, y1 = (1 - a / C.PIN_H) * H; g.fillRect(0, y0, W, y1 - y0); }
  });
}

// Overlay that adds the mirror image of pins/ball onto the glossy lane.
const ReflectOverlay = {
  name: 'ReflectOverlay',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, strength: { value: 0.3 } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv;
    void main() { vUv = textureMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; uniform float strength; varying vec4 vUv;
    void main() { vec4 base = texture2DProj(tDiffuse, vUv); gl_FragColor = vec4(base.rgb * color, strength);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

// ---------------- bowler animation ----------------
const POSE = {
  idle: { shR: [-0.75, 0, 0.3], elR: [-1.55, 0, 0], shL: [-0.7, 0, -0.3], elL: [-1.55, 0, 0], hipL: [-0.08, 0, 0], knL: [0.15, 0, 0], hipR: [-0.08, 0, 0], knR: [0.15, 0, 0], lift: -0.02 },
  back: { shR: [1.45, 0, 0.12], elR: [-0.1, 0, 0], shL: [-0.35, 0, 1.0], elL: [-0.3, 0, 0], spine: [0.32, 0, 0], hipL: [-0.55, 0, 0], knL: [0.65, 0, 0], hipR: [0.15, 0, 0], knR: [0.25, 0, 0], lift: -0.1 },
  release: { shR: [-0.45, 0, 0.08], elR: [-0.05, 0, 0], shL: [-0.25, 0, 1.25], elL: [-0.2, 0, 0], spine: [0.55, 0, 0], hipL: [-1.05, 0, 0], knL: [1.05, 0, 0], hipR: [0.95, 0, 0], knR: [0.35, 0, 0], lift: -0.3 },
  follow: { shR: [-2.55, 0, 0.18], elR: [-0.35, 0, 0], shL: [-0.25, 0, 1.2], elL: [-0.2, 0, 0], spine: [0.38, 0, 0], hipL: [-1.0, 0, 0], knL: [0.95, 0, 0], hipR: [0.85, 0, 0], knR: [0.3, 0, 0], lift: -0.26 },
};
const THROW_KEYS = [{ t: 0, pose: POSE.back, ease: 'in' }, { t: 0.26, pose: POSE.release, ease: 'out' }, { t: 0.7, pose: POSE.follow }];   // fastest at release

export class Bowl3D {
  constructor(container, opts = {}) {
    this.container = container;
    this.low = opts.quality === 'low';
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const ratio = Math.min(window.devicePixelRatio || 1, this.low ? 1.5 : 2);
    r.setPixelRatio(ratio); this._autoRes = autoResolution(r, ratio);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07051a);
    this.scene.fog = new THREE.Fog(0x07051a, 34, 70);
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.03, 200);
    this.camPos = new THREE.Vector3(0, 1.9, 5.6); this.camLook = new THREE.Vector3(0, 0.4, -14);
    this.snapNext = true;
    this._env(); this._alley(); this._lights(); this._dynamic();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.reflector) this.reflector.getRenderTarget().setSize(Math.round(w * 0.6), Math.round(h * 0.6));
  }

  // A little neon room, used only for reflections in the glossy ball, pins and lane.
  _env() {
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.BoxGeometry(30, 8, 60), new THREE.MeshBasicMaterial({ color: 0x0a0820, side: THREE.BackSide })));
    const strip = (c, x, y, z, w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); es.add(m); };
    for (let i = -3; i <= 3; i++) strip(0xfff0dc, i * 2, 3.8, -6, 0.25, 0.05, 22);
    strip(0xff3d7f, -14.8, 1.5, -6, 0.1, 0.4, 40); strip(0x26c6da, 14.8, 1.5, -6, 0.1, 0.4, 40);
    strip(0x7b4dff, 0, 2, -29.5, 16, 1.6, 0.1); strip(0xffd8a8, 0, 2.5, 29.5, 12, 3, 0.1);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(es, 0.02).texture;
    this.scene.environmentIntensity = 0.9;
    pm.dispose();
  }

  _alley() {
    const S = this.scene;
    this.pinGeo = pinGeometry();
    this.pinMat = new THREE.MeshPhysicalMaterial({ map: pinTexture(), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const laneMat = new THREE.MeshPhysicalMaterial({ map: laneTexture(3), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 });
    const appMat = new THREE.MeshPhysicalMaterial({ map: approachTexture(4), roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.1 });
    const gutterMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide });
    const capMat = new THREE.MeshPhysicalMaterial({ color: 0x1b1d2c, roughness: 0.35, clearcoat: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b0a14, roughness: 0.95 });
    const kickMat = new THREE.MeshStandardMaterial({ color: 0x151633, roughness: 0.6 });
    const neon = c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    const box = (w, h, d, m, x, y, z, parent = S, cast = false) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.receiveShadow = true; b.castShadow = cast; parent.add(b); return b; };

    const lanes = this.low ? [0, -1, 1] : [0, -2, -1, 1, 2];
    this.signs = [];
    for (const n of lanes) {
      const X = n * PITCH, G = new THREE.Group(); S.add(G);
      // lane bed + approach
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W, LANE_LEN).rotateX(-Math.PI / 2), laneMat);
      lane.position.set(X, 0, -LANE_LEN / 2); lane.receiveShadow = true; G.add(lane);
      const app = new THREE.Mesh(new THREE.PlaneGeometry(PITCH, APPROACH).rotateX(-Math.PI / 2), appMat);
      app.position.set(X, 0, APPROACH / 2); app.receiveShadow = true; G.add(app);
      // gutters: half pipes along the lane
      for (const s of [-1, 1]) {
        const gut = new THREE.Mesh(new THREE.CylinderGeometry(C.GUTTER_W / 2, C.GUTTER_W / 2, LANE_LEN + 0.3, 20, 1, true, Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), gutterMat);
        gut.position.set(X + s * C.GUTTER_X, 0, -(LANE_LEN + 0.3) / 2); gut.receiveShadow = true; G.add(gut);
        // capping between this lane's gutter and the next
        box(PITCH - LANE_W - C.GUTTER_W * 2 - 0.004, 0.05, LANE_LEN, capMat, X + s * PITCH / 2, 0.02, -LANE_LEN / 2, G);
        // kickback walls by the pin deck, with a neon edge
        box(0.05, 0.8, 4.2, kickMat, X + s * (C.KICKBACK_X + 0.03), 0.4, -18.5, G, true);
        box(0.06, 0.03, 4.2, neon(s < 0 ? 0xff3d7f : 0x26c6da), X + s * (C.KICKBACK_X + 0.03), 0.81, -18.5, G);
      }
      // pit + curtain behind the pins
      box(PITCH - 0.06, 0.04, 2.4, dark, X, -0.25, -20.4, G);
      box(PITCH, 1.3, 0.05, new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 1 }), X, 0.4, -21.4, G);
      // masking unit with a neon sign over the pins
      const sign = new THREE.MeshStandardMaterial({ color: 0xffffff, map: signTexture(n === 0 ? 'SWING BOWL' : ['GUTTER', 'SPARE', '', 'TURKEY', 'STRIKE'][n + 2] || 'BOWL', n + 3), emissive: 0xffffff, roughness: 0.6 });
      sign.emissiveMap = sign.map; sign.emissiveIntensity = 1.1;
      const unit = box(PITCH, 1.1, 0.5, [dark, dark, dark, dark, sign, dark].map(m => m), X, 1.62, -18.2, G);
      unit.material = [dark, dark, dark, dark, sign, dark];
      this.signs.push(sign);
      if (n === 0) this.mainSign = sign;
      // the other lanes' pins
      if (n !== 0) {
        const ip = new THREE.InstancedMesh(this.pinGeo, this.pinMat, 10), m = new THREE.Matrix4();
        SB.SPOTS.forEach((s, i) => ip.setMatrixAt(i, m.makeTranslation(X + s.x, 0, -s.z)));
        ip.castShadow = true; G.add(ip);
      }
    }
    // the wall above the masking units, ceiling with light strips, side walls, floor and carpet
    box(14, 2.4, 0.1, new THREE.MeshStandardMaterial({ color: 0x0c0a1e, roughness: 0.9 }), 0, 3.25, -18.5);
    box(14, 0.1, 30, new THREE.MeshStandardMaterial({ color: 0x0a0818, roughness: 1 }), 0, 3.6, -8);
    for (const n of lanes) box(0.14, 0.03, 15, neon(0xfff0dc), n * PITCH, 3.53, -8);
    for (const s of [-1, 1]) {
      const w = (lanes.length / 2 + 0.6) * PITCH;
      box(0.1, 3.6, 34, new THREE.MeshStandardMaterial({ color: 0x0d0b22, roughness: 0.9 }), s * w, 1.8, -6);
      box(0.06, 0.05, 34, neon(s < 0 ? 0xff3d7f : 0x26c6da), s * (w - 0.06), 1.2, -6);
      box(0.06, 0.05, 34, neon(0x7b4dff), s * (w - 0.06), 2.6, -6);
    }
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(16, 14).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95 }));
    carpet.position.set(0, -0.01, APPROACH + 7); carpet.receiveShadow = true; S.add(carpet);
    box(16, 0.02, 30, dark, 0, -0.3, -8);
    // ball-return hoods between the lanes
    // soft glows for the light strips and neon
    const glow = glowTexture();
    for (const n of lanes) for (let k = 0; k < 4; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff0dc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.25 }));
      sp.position.set(n * PITCH, 3.45, -1 - k * 4.5); sp.scale.set(1.6, 0.8, 1); S.add(sp);
    }
  }

  _lights() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0x9a8cff, 0x20142c, 0.5));
    const key = this.key = new THREE.DirectionalLight(0xfff2e2, 1.7);
    key.position.set(0.5, 9, -7); key.target.position.set(0, 0, -9.5);
    key.castShadow = true; key.shadow.mapSize.set(this.low ? 1024 : 2048, this.low ? 1024 : 2048);
    const c = key.shadow.camera; c.left = -3.2; c.right = 3.2; c.top = 14; c.bottom = -14; c.near = 1; c.far = 20; c.up.set(0, 0, -1);
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    S.add(key, key.target);
    const spot = new THREE.SpotLight(0xffffff, 45, 0, 0.55, 0.6, 2);
    spot.position.set(0, 3.1, -15.6); spot.target.position.set(0, 0.2, -18.8);
    spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0008;
    S.add(spot, spot.target);
    this.neons = [];
    for (const [x, c2] of [[-0.95, 0xff3d7f], [0.95, 0x26c6da]]) { const p = new THREE.PointLight(c2, 2.2, 5, 2); p.position.set(x, 0.7, -17.6); S.add(p); this.neons.push(p); }
  }

  _dynamic() {
    const S = this.scene;
    this.pins = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(this.pinGeo, this.pinMat); m.castShadow = true; m.receiveShadow = true; S.add(m); return m; });
    this.ballMat = new THREE.MeshPhysicalMaterial({ map: ballTexture('#3fa9f5'), roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.03 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R, 48, 32), this.ballMat);
    this.ball.castShadow = true; S.add(this.ball);
    this.ballColor = '#3fa9f5';
    this.lastBall = null; this.ballQ = new THREE.Quaternion();
    // aiming guide: a soft line of dots from the start position
    const dots = new THREE.BufferGeometry(), arr = [];
    for (let z = 0.5; z <= 9; z += 0.45) arr.push(0, 0.004, -z);
    dots.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    this.guide = new THREE.Points(dots, new THREE.PointsMaterial({ size: 0.045, color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    S.add(this.guide);
    // bowler
    this.bowler = makeFigure({ shirt: 0x3fa9f5, pants: 0x262b38, shoes: 0xc8323c, hatType: 'hair', hat: 0x2a1a12 });
    this.bowler.root.rotation.y = Math.PI;   // face down the lane
    S.add(this.bowler.root);
    this.confetti = new Confetti(S, 420);
    this.lastCelebrate = 0;
    // glossy lane reflections of the pins and ball (main lane only)
    if (!this.low) {
      const refl = this.reflector = new Reflector(new THREE.PlaneGeometry(LANE_W, LANE_LEN), { shader: ReflectOverlay, textureWidth: 1024, textureHeight: 576, clipBias: 0.003, color: 0xffffff });
      refl.material.transparent = true; refl.material.depthWrite = false;
      refl.material.uniforms.strength.value = 0.32;
      refl.rotation.x = -Math.PI / 2; refl.position.set(0, 0.0015, -LANE_LEN / 2);
      S.add(refl);
    }
  }

  // 2D-renderer compatibility
  follow() {}
  snapCamera() { this.snapNext = true; }

  drawScene(lane, o) {
    const dt = Math.min(0.05, o.dt || 1 / 60), now = performance.now();
    const state = o.state || 'aim';

    // pins
    for (let i = 0; i < 10; i++) {
      const m = this.pins[i], p = lane.pins[i];
      if (!p || p.gone) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(p.x, 0, -p.z);
      if (p.fallen) {
        const t = Math.min(1, p.tilt) * Math.PI / 2, dir = new THREE.Vector3(Math.cos(p.dir), 0, -Math.sin(p.dir));
        const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
        m.quaternion.setFromAxisAngle(axis, t);
        m.position.y = Math.sin(t) * 0.058;
      } else if (p.wob) {
        const w = Math.sin(now / 45 + p.n) * p.wob * 0.09;
        m.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), w);
      } else m.quaternion.identity();
    }

    // ball colour per player
    if (o.color && o.color !== this.ballColor) {
      this.ballColor = o.color; this.ballMat.map = ballTexture(o.color); this.ballMat.needsUpdate = true;
      this.bowler.mats.shirt.color.set(o.color);
    }

    // bowler pose + position
    const B = this.bowler, startX = o.startX || 0;
    let pose, slide = 0;
    const sinceThrow = (now - (o.throwAt || 0)) / 1000;
    const throwing = (state === 'throwing' || state === 'rolling' || state === 'result') && o.throwAt && sinceThrow < 6;
    if (throwing) { pose = samplePose(THROW_KEYS, sinceThrow); slide = Math.min(1, sinceThrow / 0.26); }
    else {
      const k = this._holdK = Math.max(0, Math.min(1, (this._holdK || 0) + (o.holding ? dt / 0.75 : -dt / 0.3)));
      pose = samplePose([{ t: 0, pose: POSE.idle }, { t: 1, pose: POSE.back }], k);
      if (state === 'aim') this._lastAimX = startX;
    }
    const bx = (throwing ? (this._lastAimX ?? startX) : startX) - 0.215;
    B.root.position.set(bx, 0, 1.75 - 1.25 * (slide * slide * (3 - 2 * slide)));
    B.root.visible = state !== 'over';
    applyPose(B, pose);
    B.root.updateMatrixWorld(true);

    // ball: in the bowler's hand until it's released, then the engine's ball
    const b = lane.ball;
    if (b && (state === 'rolling' || state === 'result')) {
      const inGutter = Math.abs(b.x) > C.LANE_HALF + 0.02;
      const pos = new THREE.Vector3(b.x, inGutter ? -C.GUTTER_W / 2 + C.BALL_R + 0.002 : C.BALL_R, -b.z);
      if (this.lastBall) {
        const d = pos.clone().sub(this.lastBall); d.y = 0;
        const dist = d.length();
        if (dist > 1e-5) { const axis = new THREE.Vector3(0, 1, 0).cross(d.normalize()); this.ballQ.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / C.BALL_R)); }
      }
      this.lastBall = pos.clone();
      this.ball.position.copy(pos); this.ball.quaternion.copy(this.ballQ);
      this.ball.visible = !(b.z > C.PIT_Z + 0.1);
    } else {
      const hand = B.arms.R.hand.getWorldPosition(new THREE.Vector3());
      const elbow = B.arms.R.el.getWorldPosition(new THREE.Vector3());
      const along = hand.clone().sub(elbow).normalize();
      this.ball.position.copy(hand).addScaledVector(along, C.BALL_R * 0.75);
      this.ball.visible = state !== 'over';
      this.lastBall = null;
    }

    // aiming guide
    this.guide.visible = state === 'aim';
    this.guide.position.x = startX;

    // celebrations: confetti and a flash of the sign on strikes and spares
    if (o.celebrate && o.celebrate.at !== this.lastCelebrate) {
      this.lastCelebrate = o.celebrate.at;
      if (o.celebrate.kind === 'strike') { this.confetti.burst(new THREE.Vector3(0, 0.35, -17.7), 320, 3.4, 1.2); this.flashUntil = now + 1800; }
      else if (o.celebrate.kind === 'spare') { this.confetti.burst(new THREE.Vector3(0, 0.35, -17.7), 150, 2.8, 1.0); this.flashUntil = now + 1000; }
    }
    this.confetti.update(dt);
    const flash = this.flashUntil > now ? 1 + Math.abs(Math.sin(now / 90)) * 2.2 : 1.1 + Math.sin(now / 900) * 0.08;
    this.mainSign.emissiveIntensity = flash;
    for (const p of this.neons) p.intensity = this.flashUntil > now ? 2.2 + Math.abs(Math.sin(now / 90)) * 5 : 2.2;

    this._camera(state, b, startX, dt);
    this._autoRes();
    this.renderer.render(this.scene, this.camera);
  }

  _camera(state, b, startX, dt) {
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    let rate = 3;
    const pinCam = () => { pos.set(0.42, 0.95, -15.2); look.set(-0.04, 0.2, -18.75); rate = 3.5; };   // front-right of the deck, inside the kickbacks
    if (state === 'over') { pos.set(0, 2.4, 7.5); look.set(0, 0.5, -18); rate = 1.2; }
    else if ((state === 'rolling' || state === 'result') && b) {
      if (state === 'result' || b.z > 12.5) pinCam();
      else {
        // chase the ball; stay high until the camera has passed over the bowler, then drop down behind the ball
        const z = -b.z + 4.4, u = Math.min(1, Math.max(0, (z + 2.6) / 1.4)), over = u * u * (3 - 2 * u);
        pos.set(b.x * 0.55, 1.35 - b.z * 0.03 + over * 0.95, z); look.set(b.x * 0.4, 0.12, -(b.z + 8)); rate = 6;
      }
    } else {
      // Over the bowler's right shoulder and high enough that the bowler never hides the pins.
      pos.set(startX * 0.6 + 0.3, 2.45, 6.6); look.set(startX * 0.3, 0.15, -18); rate = state === 'throwing' ? 2 : 3;
    }
    const k = this.snapNext ? 1 : 1 - Math.exp(-dt * rate);
    this.snapNext = false;
    this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    // never let the camera end up inside the bowler
    const br = this.bowler.root.position, c = this.camPos;
    if (c.y < 2.05 && Math.abs(c.z - br.z) < 0.5 && Math.abs(c.x - br.x) < 0.6) this.bowler.root.visible = false;
  }
}
