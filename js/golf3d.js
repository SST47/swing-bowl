/*
 * Swing Golf — 3D course renderer (three.js).
 *
 * The golf engine works in metres with x = east, y = north, z = up.
 * three.js is y-up, so world (x, y, z) is drawn at three (x, z + ground height, -y).
 * The engine's physics is flat; the visible ground has gentle shape (bunker bowls,
 * tilted greens, hills beyond the course) and balls are drawn on top of it.
 */
import * as THREE from 'three';
import { Sky } from '../vendor/three/Sky.js';
import { autoResolution } from './three-kit.js';

const GOLF = self.GOLF;
const { CLUBS } = GOLF;
const D2R = Math.PI / 180;
const SUN_ELEV = 34, SUN_AZIM = 215;
const BALL_R = 0.06;   // drawn ~3x real size so it reads on a TV

// ---------------- small helpers ----------------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash2(ix, iy) { let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / 0.9375; }
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
function ellipseQ(e, x, y) {
  const c = Math.cos(-e.rot * D2R), s = Math.sin(-e.rot * D2R), dx = x - e.x, dy = y - e.y;
  const u = dx * c - dy * s, v = dx * s + dy * c;
  return Math.sqrt((u * u) / (e.rx * e.rx) + (v * v) / (e.ry * e.ry));
}
function dispose(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { for (const k of ['map', 'alphaMap']) if (m[k]) m[k].dispose(); m.dispose(); }
  });
}

// Visible ground height (metres) at world (x, y) for a hole.
function makeHeight(hole) {
  const b = hole.bounds, gr = hole.green, tee = hole.tee;
  return (x, y) => {
    const dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1);
    const out = Math.hypot(dx, dy);
    const dg = Math.hypot(x - gr.x, y - gr.y);
    let h = (fbm(x / 45 + 3.1, y / 45 - 1.7) - 0.5) * 0.8;                      // gentle roll
    h *= smooth(gr.r + 1, gr.r + 9, dg) * smooth(6, 15, Math.hypot(x - tee.x, y - tee.y));
    // tilt the green so its break is visible (physics slope is in m/s²)
    if (dg < gr.r + 9) h += -((x - gr.x) * gr.slope.x + (y - gr.y) * gr.slope.y) * 0.22 * (1 - smooth(gr.r + 2, gr.r + 9, dg));
    for (const s of hole.bunkers) { const q = ellipseQ(s, x, y); if (q < 1.2) h -= 0.38 * (1 - smooth(0.5, 1.02, q)); }
    for (const w of hole.water) { const q = ellipseQ(w, x, y); if (q < 1.3) h -= 1.4 * (1 - smooth(0.55, 1.08, q)); }
    if (out > 0) h += smooth(0, 120, out) * (3 + 28 * fbm(x / 150 + 11, y / 150 - 5)) + out * 0.02;   // hills beyond the course
    return h;
  };
}

// The whole hole painted from above: the ground texture.
function paintCourse(hole, ext, size, trees, seed) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const W = ext.x1 - ext.x0, H = ext.y1 - ext.y0, sx = size / W, sy = size / H;
  g.setTransform(sx, 0, 0, -sy, -ext.x0 * sx, ext.y1 * sy);   // draw in world metres, north up
  const R = rng(seed), b = hole.bounds;
  const blot = (x, y, r, color, a) => { g.globalAlpha = a; g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };

  // meadow beyond the course
  g.fillStyle = '#3d6a2a'; g.fillRect(ext.x0, ext.y0, W, H);
  const meadow = ['#4b7a30', '#355f27', '#58833a', '#42712d', '#6b8f45', '#2f5724'];
  for (let i = 0; i < 2600; i++) blot(ext.x0 + R() * W, ext.y0 + R() * H, 3 + R() * 28, meadow[i % meadow.length], 0.16);
  // rough inside the course
  g.globalAlpha = 1; g.fillStyle = '#4d8735'; g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  for (let i = 0; i < 900; i++) blot(b.x0 + R() * (b.x1 - b.x0), b.y0 + R() * (b.y1 - b.y0), 2 + R() * 12, R() < 0.5 ? '#558f3b' : '#467f30', 0.22);
  g.globalAlpha = 1;

  // fairway path (+ a first cut of semi-rough around it)
  const axis = Math.atan2(hole.pin.y - hole.tee.y, hole.pin.x - hole.tee.x);
  const fwPath = grow => {
    const p = new Path2D();
    for (let i = 0; i < hole.fairway.length; i++) {
      const a = hole.fairway[i], w = a.w / 2 + grow;
      p.moveTo(a.x + w, a.y); p.arc(a.x, a.y, w, 0, Math.PI * 2);
      if (i < hole.fairway.length - 1) {
        const n = hole.fairway[i + 1], wn = n.w / 2 + grow, an = Math.atan2(n.y - a.y, n.x - a.x), nx = -Math.sin(an), ny = Math.cos(an);
        const q = [[a.x - nx * w, a.y - ny * w], [n.x - nx * wn, n.y - ny * wn], [n.x + nx * wn, n.y + ny * wn], [a.x + nx * w, a.y + ny * w]];
        let area = 0; for (let k = 0; k < 4; k++) { const u = q[k], v = q[(k + 1) % 4]; area += u[0] * v[1] - v[0] * u[1]; }
        if (area < 0) q.reverse();
        p.moveTo(q[0][0], q[0][1]); for (let k = 1; k < 4; k++) p.lineTo(q[k][0], q[k][1]); p.closePath();
      }
    }
    return p;
  };
  g.fillStyle = '#5a9a3f'; g.fill(fwPath(3.5));
  const stripes = (path, width, c1, c2) => {
    g.save(); g.clip(path);
    g.translate(hole.tee.x, hole.tee.y); g.rotate(axis);
    for (let k = -80; k < 120; k++) { g.fillStyle = k % 2 ? c1 : c2; g.fillRect(k * width, -400, width, 800); }
    g.restore();
  };
  const fw = fwPath(0);
  stripes(fw, 9, '#6cbb4a', '#5eab40');
  // tee box
  g.save(); g.translate(hole.tee.x, hole.tee.y); g.rotate(axis);
  g.fillStyle = '#5a9a3f'; g.fillRect(-7, -6.5, 14, 13);
  for (let k = -3; k < 3; k++) { g.fillStyle = k % 2 ? '#79c957' : '#6dbc4c'; g.fillRect(k * 2.2, -5.5, 2.2, 11); }
  g.restore();
  // fringe and green with fine stripes
  const gr = hole.green;
  g.fillStyle = '#69b94a'; g.beginPath(); g.arc(gr.x, gr.y, gr.r + 2.5, 0, Math.PI * 2); g.fill();
  const greenPath = new Path2D(); greenPath.arc(gr.x, gr.y, gr.r, 0, Math.PI * 2);
  stripes(greenPath, 2.2, '#86d662', '#79cc57');
  const gg = g.createRadialGradient(gr.x, gr.y, 0, gr.x, gr.y, gr.r);
  gg.addColorStop(0, 'rgba(255,255,220,0.10)'); gg.addColorStop(1, 'rgba(0,40,0,0.10)');
  g.fillStyle = gg; g.fill(greenPath);
  // water: muddy edge then deep colour (the 3D water surface sits on top)
  for (const w of hole.water) {
    g.save(); g.translate(w.x, w.y); g.rotate(w.rot * D2R);
    g.fillStyle = '#4a5a33'; g.beginPath(); g.ellipse(0, 0, w.rx + 1.2, w.ry + 1.2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d4e5c'; g.beginPath(); g.ellipse(0, 0, w.rx, w.ry, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // bunkers: lip, lit sand, grain
  for (const s of hole.bunkers) {
    g.save(); g.translate(s.x, s.y); g.rotate(s.rot * D2R);
    g.fillStyle = '#7d8a4c'; g.beginPath(); g.ellipse(0, 0, s.rx + 0.7, s.ry + 0.7, 0, 0, Math.PI * 2); g.fill();
    const sg = g.createRadialGradient(-s.rx * 0.25, s.ry * 0.25, 0, 0, 0, Math.max(s.rx, s.ry));
    sg.addColorStop(0, '#f3e5bb'); sg.addColorStop(0.7, '#e3cf98'); sg.addColorStop(1, '#c6ad72');
    g.fillStyle = sg; g.beginPath(); g.ellipse(0, 0, s.rx, s.ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(120,95,50,0.25)';
    for (let i = 0; i < 260; i++) { const a = R() * Math.PI * 2, r = Math.sqrt(R()); g.fillRect(Math.cos(a) * r * s.rx, Math.sin(a) * r * s.ry, 0.12, 0.12); }
    g.restore();
  }
  // soft shade under every tree
  for (const t of trees) {
    const r = t.r * 1.35, sh = g.createRadialGradient(t.x, t.y, 0, t.x, t.y, r);
    sh.addColorStop(0, 'rgba(10,30,5,0.45)'); sh.addColorStop(1, 'rgba(10,30,5,0)');
    g.globalAlpha = 1; g.fillStyle = sh; g.beginPath(); g.arc(t.x, t.y, r, 0, Math.PI * 2); g.fill();
  }
  // fine speckle on the playing area
  for (let i = 0; i < 26000; i++) {
    g.globalAlpha = 0.1; g.fillStyle = R() < 0.5 ? '#ffffff' : '#0b2a05';
    g.fillRect(b.x0 + R() * (b.x1 - b.x0), b.y0 + R() * (b.y1 - b.y0), 0.35, 0.35);
  }
  g.globalAlpha = 1;
  return cv;
}

// GLSL value noise shared by the grass and water shaders.
const NOISE_GLSL = `
float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y); }`;

function withWorldPos(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;' + NOISE_GLSL);
}

// Close-up grass detail on top of the painted course (fades out with distance).
function grassMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.96, metalness: 0 });
  m.onBeforeCompile = sh => {
    withWorldPos(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float camDist = length(vWPos - cameraPosition);
      float nearF = 1.0 - smoothstep(20.0, 80.0, camDist);
      float patchN = gn(vWPos.xz * 0.3) * 0.6 + gn(vWPos.xz * 1.1) * 0.4;
      diffuseColor.rgb *= 0.9 + 0.2 * patchN;
      float blades = gn(vWPos.xz * vec2(16.0, 11.0)) * 0.6 + gn(vWPos.xz * vec2(41.0, 29.0)) * 0.4;
      diffuseColor.rgb *= mix(1.0, 0.82 + 0.34 * blades, nearF);`);
  };
  return m;
}

// Stylised lake: deep blue looking down, sky-tinted at grazing angles, sun glints, moving ripples.
function waterMaterial(timeUniform, sunDir) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSun: { value: sunDir.clone() },
      uDeep: { value: new THREE.Color(0x0b4466) }, uSky: { value: new THREE.Color(0x7fb3dc) },
    }]),
    vertexShader: `
      varying vec3 vWPos;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0); vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun, uDeep, uSky;
      varying vec3 vWPos;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main() {
        vec2 p = vWPos.xz; float t = uTime;
        float dx = 0.09 * cos(p.x * 0.7 + t * 1.1) + 0.05 * cos(p.x * 2.0 - p.y * 1.5 + t * 1.9) + 0.03 * cos(p.y * 5.1 + t * 3.0) + 0.05 * (gn(p * 1.7 + t * 0.5) - 0.5);
        float dz = 0.09 * cos(p.y * 0.8 - t * 0.9) + 0.05 * cos(p.y * 2.3 + p.x * 1.2 + t * 1.4) + 0.03 * cos(p.x * 4.7 - t * 2.6) + 0.05 * (gn(p * 1.9 - t * 0.4) - 0.5);
        vec3 n = normalize(vec3(-dx * 1.6, 1.0, -dz * 1.6));
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 col = mix(uDeep, uSky, clamp(0.12 + fres * 0.7, 0.0, 0.8));
        vec3 H = normalize(V + normalize(uSun));
        col += vec3(1.0, 0.94, 0.8) * pow(max(dot(n, H), 0.0), 260.0) * 1.0;
        col += 0.05 * (gn(p * 6.0 + t) - 0.5);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function cloudTexture(seed) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'), R = rng(seed);
  for (let i = 0; i < 26; i++) {
    const x = 40 + R() * 176, y = 50 + R() * 40, r = 18 + R() * 34;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// A stylised golfer whose arms + club swing around the swing-plane axis.
function makeGolfer() {
  const group = new THREE.Group();
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  const shirt = mat(0xffffff), pants = mat(0x2b2f3a), skin = mat(0xe3ad86), cap = mat(0x1f2a44), white = mat(0xf2f2f2);
  const add = (geo, m, x, y, z, parent = group) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.075, 0.065, 0.86, 10), pants, s * 0.14, 0.45, 0);
    add(new THREE.BoxGeometry(0.12, 0.08, 0.27), white, s * 0.14, 0.04, 0.05);
  }
  const torso = add(new THREE.CapsuleGeometry(0.18, 0.4, 6, 14), shirt, 0, 1.14, 0.07); torso.rotation.x = 0.34;
  add(new THREE.SphereGeometry(0.12, 18, 14), skin, 0, 1.6, 0.25);
  const capM = add(new THREE.SphereGeometry(0.128, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap, 0, 1.62, 0.25);
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.014, 18), cap, 0, 1.63, 0.35).scale.set(1, 1, 0.8);
  void capM;
  // swing pivot between the shoulders; the ball sits at golfer-local (0, 0, 0.75)
  const pivot = new THREE.Group(); pivot.position.set(0, 1.36, 0.2); group.add(pivot);
  const between = (a, b, r, m) => {
    const len = a.distanceTo(b), o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), m);
    o.position.copy(a).add(b).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    o.castShadow = true; pivot.add(o); return o;
  };
  const hands = new THREE.Vector3(0, -0.58, 0.2), head = new THREE.Vector3(0, -1.335, 0.55);
  between(new THREE.Vector3(-0.19, 0.02, 0), hands, 0.045, shirt);
  between(new THREE.Vector3(0.19, 0.02, 0), hands, 0.045, shirt);
  add(new THREE.SphereGeometry(0.05, 10, 8), white, hands.x, hands.y, hands.z, pivot);
  between(hands, head, 0.011, new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.9, roughness: 0.25 }));
  add(new THREE.BoxGeometry(0.12, 0.05, 0.07), new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.7, roughness: 0.35 }), head.x, head.y, head.z, pivot);
  // swing-plane normal: contains the target line (+x) and the shoulder->ball line
  const axis = new THREE.Vector3(1, 0, 0).cross(head.clone()).normalize();
  return { group, pivot, axis, shirt };
}

export class Golf3D {
  constructor(container) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    r.setPixelRatio(ratio); this._autoRes = autoResolution(r, ratio);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.62;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.05, 7000);
    this.time = { value: 0 };
    this.dot = dotTexture();
    this._sky(); this._lights(); this._scenery(); this._dynamic();
    this.camPos = new THREE.Vector3(0, 30, 30); this.camLook = new THREE.Vector3();
    this.heading = Math.PI / 2;
    this.theta = 0; this.lastSwingAt = 0; this.swingAnim = null;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  _sky() {
    const sun = this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, (90 - SUN_ELEV) * D2R, SUN_AZIM * D2R);
    const tune = s => { const u = s.material.uniforms; u.turbidity.value = 1.2; u.rayleigh.value = 3.4; u.mieCoefficient.value = 0.002; u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(sun); return s; };
    const sky = tune(new Sky()); sky.scale.setScalar(5000); this.scene.add(sky);
    // image-based lighting from the same sky: soft fill + reflections on water and the ball
    const envScene = new THREE.Scene(), envSky = tune(new Sky()); envSky.scale.setScalar(80); envScene.add(envSky);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(envScene, 0.03, 0.1, 200).texture;
    this.scene.environmentIntensity = 0.75;
    pm.dispose();
    this.scene.fog = new THREE.Fog(0xa9c6e2, 300, 2600);
  }

  _lights() {
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 3.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera; c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 1; c.far = 400;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x4c6a2c, 0.8));
  }

  // Mountains and clouds that stay for every hole.
  _scenery() {
    const R = rng(99);
    const mGeo = new THREE.ConeGeometry(1, 1, 7, 1);
    const mMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
    const mountains = new THREE.InstancedMesh(mGeo, mMat, 34);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 34; i++) {
      const a = i / 34 * Math.PI * 2 + R() * 0.1, d = 1650 + R() * 600, h = 160 + R() * 320, w = 260 + R() * 340;
      p.set(Math.cos(a) * d, h / 2 - 25, Math.sin(a) * d - 200);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.3); s.set(w, h, w * (0.7 + R() * 0.5));
      mountains.setMatrixAt(i, m.compose(p, q, s));
      mountains.setColorAt(i, new THREE.Color().setHSL(0.3 + R() * 0.05, 0.18, 0.32 + R() * 0.1));
    }
    this.scene.add(mountains);
    for (let i = 0; i < 22; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(i + 3), transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0.9 }));
      const a = R() * Math.PI * 2, d = 500 + R() * 1500;
      sp.position.set(Math.cos(a) * d, 260 + R() * 220, Math.sin(a) * d - 200);
      sp.scale.set(260 + R() * 360, 80 + R() * 90, 1);
      this.scene.add(sp);
    }
  }

  // Things that move: balls, trail, aim guide, flag, golfer.
  _dynamic() {
    const sc = this.scene;
    this.balls = [];
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2400), 3));
    this.trail = new THREE.Points(this.trailGeo, new THREE.PointsMaterial({ size: 0.22, map: this.dot, transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.9 }));
    this.trail.frustumCulled = false; sc.add(this.trail);
    this.aimGeo = new THREE.BufferGeometry();
    this.aimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 400), 3));
    this.aim = new THREE.Points(this.aimGeo, new THREE.PointsMaterial({ size: 0.5, map: this.dot, transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.9 }));
    this.aim.frustumCulled = false; sc.add(this.aim);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.7, 56).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    sc.add(this.ring);
    this.shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    sc.add(this.shadowBlob);
    const g = this.golfer = makeGolfer(); sc.add(g.group);
  }

  _ballMesh(i) {
    while (this.balls.length <= i) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0 }));
      ball.castShadow = true;
      const mark = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
      this.scene.add(ball, mark);
      this.balls.push({ ball, mark });
    }
    return this.balls[i];
  }

  // ---------------- per-hole world ----------------
  setHole(index) {
    const hole = GOLF.HOLES[index];
    if (this.hole === hole) return;
    this.hole = hole;
    if (this.world) { this.scene.remove(this.world); dispose(this.world); }
    const W = this.world = new THREE.Group();
    this.scene.add(W);
    const hAt = this.hAt = makeHeight(hole);
    const b = hole.bounds, M = 260;
    const ext = this.ext = { x0: b.x0 - M, x1: b.x1 + M, y0: b.y0 - M, y1: b.y1 + M };
    const R = rng(index * 7919 + 13);

    // trees: the course's own (they're in the physics) plus forest around it
    const trees = hole.trees.map(t => ({ ...t, pine: R() < 0.3 }));
    for (let n = 0; n < 30000 && trees.length < 950; n++) {
      const x = ext.x0 + R() * (ext.x1 - ext.x0), y = ext.y0 + R() * (ext.y1 - ext.y0);
      const out = Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
      if (out < 7) continue;
      if (R() > (out < 70 ? 0.9 : out < 160 ? 0.45 : 0.18)) continue;
      if (fbm(x / 55 + 2, y / 55 + 9) < 0.42) continue;   // clumps and clearings
      trees.push({ x, y, r: 3 + R() * 4.5, pine: R() < 0.38 });
    }

    // ground: displaced plane + painted texture + close-up grass detail
    const segX = Math.round((ext.x1 - ext.x0) / 3), segY = Math.round((ext.y1 - ext.y0) / 3);
    const geo = new THREE.PlaneGeometry(ext.x1 - ext.x0, ext.y1 - ext.y0, segX, segY);
    const pos = geo.attributes.position, cx = (ext.x0 + ext.x1) / 2, cy = (ext.y0 + ext.y1) / 2;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + cx, y = pos.getY(i) + cy; pos.setZ(i, hAt(x, y)); }
    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx, 0, -cy);
    const max = this.renderer.capabilities.maxTextureSize;
    const tex = new THREE.CanvasTexture(paintCourse(hole, ext, max >= 8192 ? 4096 : 2048, trees, index + 1));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(geo, grassMaterial(tex));
    ground.receiveShadow = true;
    W.add(ground);

    // water
    for (const w of hole.water) {
      const wm = waterMaterial(this.time, this.sunDir); wm.uniforms.uTime = this.time;
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2), wm);
      m.scale.set(w.rx * 1.12, 1, w.ry * 1.12); m.rotation.y = w.rot * D2R;
      m.position.set(w.x, -0.12, -w.y);
      m.receiveShadow = true;
      W.add(m);
    }

    // trees (instanced: trunks, round canopies, pines)
    const oaks = trees.filter(t => !t.pine), pines = trees.filter(t => t.pine);
    const bark = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.32, 1, 7).translate(0, 0.5, 0), bark, trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), leaf, oaks.length * 2);
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 9).translate(0, 0.5, 0), leaf, pines.length * 2);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    let ti = 0, ci = 0, pi = 0;
    for (const t of trees) {
      const h0 = hAt(t.x, t.y), trunkH = t.pine ? 1.6 : 2.6 + t.r * 0.25;
      q.setFromAxisAngle(up, R() * 6.28);
      trunk.setMatrixAt(ti++, mtx.compose(pv.set(t.x, h0 - 0.2, -t.y), q, sv.set(1 + t.r * 0.05, trunkH + 0.3, 1 + t.r * 0.05)));
      if (t.pine) {
        col.setHSL(0.31 + R() * 0.03, 0.5, 0.11 + R() * 0.05);
        cone.setMatrixAt(pi, mtx.compose(pv.set(t.x, h0 + trunkH, -t.y), q, sv.set(t.r * 0.72, t.r * 2.4, t.r * 0.72))); cone.setColorAt(pi++, col);
        cone.setMatrixAt(pi, mtx.compose(pv.set(t.x, h0 + trunkH + t.r * 1.3, -t.y), q, sv.set(t.r * 0.48, t.r * 1.6, t.r * 0.48))); cone.setColorAt(pi++, col);
      } else {
        col.setHSL(0.23 + R() * 0.08, 0.5 + R() * 0.15, 0.14 + R() * 0.08);
        crown.setMatrixAt(ci, mtx.compose(pv.set(t.x, h0 + trunkH + t.r * 0.55, -t.y), q, sv.set(t.r, t.r * 0.82, t.r))); crown.setColorAt(ci++, col);
        col.offsetHSL(0, 0, 0.04);
        crown.setMatrixAt(ci, mtx.compose(pv.set(t.x + t.r * 0.3, h0 + trunkH + t.r * 1.05, -t.y - t.r * 0.2), q, sv.set(t.r * 0.62, t.r * 0.55, t.r * 0.62))); crown.setColorAt(ci++, col);
      }
    }
    for (const im of [trunk, crown, cone]) { im.castShadow = true; im.receiveShadow = true; W.add(im); }

    // pin, flag, cup, tee markers
    const pin = hole.pin, ph = hAt(pin.x, pin.y);
    this.pinPos = new THREE.Vector3(pin.x, ph, -pin.y);
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.11, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b0b0b }));
    cup.position.set(pin.x, ph + 0.012, -pin.y); W.add(cup);
    const lip = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.135, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lip.position.set(pin.x, ph + 0.013, -pin.y); W.add(lip);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.4, 10).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 }));
    pole.position.set(pin.x, ph, -pin.y); pole.castShadow = true; W.add(pole);
    const flagGeo = new THREE.PlaneGeometry(0.78, 0.5, 18, 6).translate(0.39, 0, 0);
    this.flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xe8333f, side: THREE.DoubleSide, roughness: 0.8 }));
    this.flag.position.set(pin.x, ph + 2.12, -pin.y); this.flag.castShadow = true; W.add(this.flag);
    this.flagBase = Float32Array.from(flagGeo.attributes.position.array);
    const axis = Math.atan2(pin.y - hole.tee.y, pin.x - hole.tee.x), nx = -Math.sin(axis), ny = Math.cos(axis);
    for (const sgn of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: sgn < 0 ? 0x2f6fe0 : 0xffffff, roughness: 0.4 }));
      const x = hole.tee.x + nx * 3.2 * sgn, y = hole.tee.y + ny * 3.2 * sgn;
      m.position.set(x, hAt(x, y) + 0.1, -y); m.castShadow = true; W.add(m);
    }

    // Wii-style putting grid over the green, with dots flowing downhill
    const gr = hole.green, gl = [], step = 1;
    const span = gr.r + 2.5;
    const addSeg = (x0, y0, x1, y1) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5));
      for (let i = 0; i < n; i++) {
        const xa = x0 + (x1 - x0) * i / n, ya = y0 + (y1 - y0) * i / n, xb = x0 + (x1 - x0) * (i + 1) / n, yb = y0 + (y1 - y0) * (i + 1) / n;
        if (Math.hypot(xa - gr.x, ya - gr.y) > span || Math.hypot(xb - gr.x, yb - gr.y) > span) continue;
        gl.push(xa, hAt(xa, ya) + 0.03, -ya, xb, hAt(xb, yb) + 0.03, -yb);
      }
    };
    for (let k = -span; k <= span; k += step) { addSeg(gr.x + k, gr.y - span, gr.x + k, gr.y + span); addSeg(gr.x - span, gr.y + k, gr.x + span, gr.y + k); }
    const gridGeo = new THREE.BufferGeometry(); gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
    this.grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false }));
    W.add(this.grid);
    this.flow = Array.from({ length: 140 }, () => this._flowSpawn());
    const flowGeo = new THREE.BufferGeometry(); flowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(140 * 3), 3));
    this.flowPts = new THREE.Points(flowGeo, new THREE.PointsMaterial({ size: 0.16, map: this.dot, transparent: true, depthWrite: false, color: 0x9fe8ff, opacity: 0.95 }));
    this.flowPts.frustumCulled = false; W.add(this.flowPts);

    // fly in from above the green to the tee
    this.flyover = { t0: performance.now(), dur: 4200 };
  }

  _flowSpawn() {
    const gr = this.hole.green, a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * gr.r;
    return { x: gr.x + Math.cos(a) * r, y: gr.y + Math.sin(a) * r, life: Math.random() * 3 };
  }

  // ground point (three coords) for world x, y with height z above the visible ground
  T(x, y, z = 0) { return new THREE.Vector3(x, z + this.hAt(x, y), -y); }

  // ---------------- every frame ----------------
  render(game, dt, now) {
    if (!this.hole || this.hole !== game.hole) this.setHole(game.hi);
    this.time.value = now / 1000;
    const p = game.current, hole = this.hole;
    const flying = game.anim ? game.ballInFlight() : null;
    const shot = game.anim || game.lastShot;
    const club = p ? CLUBS[p.club] : CLUBS[0];
    const putting = !!(p && (p.lie === 'green' || p.lie === 'fringe') && club.putter);

    // balls and their colour rings
    game.players.forEach((q, i) => {
      const bm = this._ballMesh(i);
      const hidden = q.holed && !(game.anim && game.anim.p === q);
      const at = game.anim && game.anim.p === q ? flying : { x: q.ball.x, y: q.ball.y, z: 0 };
      bm.ball.visible = bm.mark.visible = !hidden;
      if (hidden) return;
      bm.ball.position.copy(this.T(at.x, at.y, at.z + BALL_R));
      const sc = Math.max(1, Math.min(7, bm.ball.position.distanceTo(this.camera.position) / 20));
      bm.ball.scale.setScalar(sc);
      if (at.z < 0.05) bm.ball.position.y += BALL_R * (sc - 1);   // a big ball still sits on the grass
      bm.mark.position.copy(this.T(at.x, at.y, 0.02));
      bm.mark.material.color.set(q.color);
      bm.mark.visible = !(game.anim && game.anim.p === q) && at.z < 0.05;
    });
    for (let i = game.players.length; i < this.balls.length; i++) this.balls[i].ball.visible = this.balls[i].mark.visible = false;

    // blob shadow under the flying ball (real shadows only cover the area near the camera)
    if (flying) {
      this.shadowBlob.visible = true;
      this.shadowBlob.position.copy(this.T(flying.x, flying.y, 0.03));
      const s = 1 + flying.z * 0.06; this.shadowBlob.scale.set(s, 1, s);
      this.shadowBlob.material.opacity = 0.35 / (1 + flying.z * 0.08);
    } else this.shadowBlob.visible = false;

    // flight trail
    if (shot && (game.state === 'flight' || game.state === 'result')) {
      const path = shot.res.path;
      if (this._trailShot !== shot) {
        this._trailShot = shot;
        const arr = this.trailGeo.attributes.position.array;
        let c = 0;
        for (let i = 0; i < path.length && c < 2400; i += 2) { const v = this.T(path[i].x, path[i].y, path[i].z + 0.05); arr[c * 3] = v.x; arr[c * 3 + 1] = v.y; arr[c * 3 + 2] = v.z; c++; }
        this.trailGeo.attributes.position.needsUpdate = true;
      }
      this.trailGeo.setDrawRange(0, Math.min(1200, Math.floor(Math.min(path.length - 1, shot.i) / 2) + 1));
      this.trail.visible = true;
    } else this.trail.visible = false;

    // aim guide: dots toward the pin and a ring at the club's full distance
    const showAim = p && game.state === 'address' && !game.over;
    this.aim.visible = this.ring.visible = !!showAim;
    if (showAim) {
      const a = game.aimOf(p.ball), dist = Math.hypot(hole.pin.x - p.ball.x, hole.pin.y - p.ball.y);
      const reach = club.putter ? dist : Math.min(club.target, dist + 25);
      const gap = club.putter ? 0.5 : 3, arr = this.aimGeo.attributes.position.array;
      let c = 0;
      for (let d = gap; d <= reach && c < 400; d += gap) { const x = p.ball.x + Math.cos(a) * d, y = p.ball.y + Math.sin(a) * d, v = this.T(x, y, 0.12); arr[c * 3] = v.x; arr[c * 3 + 1] = v.y; arr[c * 3 + 2] = v.z; c++; }
      this.aimGeo.setDrawRange(0, c); this.aimGeo.attributes.position.needsUpdate = true;
      this.aim.material.color.set(p.color); this.aim.material.size = club.putter ? 0.18 : 0.6;
      this.ring.visible = !club.putter;
      if (!club.putter) {
        const x = p.ball.x + Math.cos(a) * club.target, y = p.ball.y + Math.sin(a) * club.target;
        this.ring.position.copy(this.T(x, y, 0.1));
        const pulse = 1 + 0.08 * Math.sin(now / 220); this.ring.scale.set(pulse, 1, pulse);
        this.ring.material.color.set(p.color);
      }
    }

    // putting grid + flow dots
    const showGrid = putting && (game.state === 'address' || game.state === 'flight');
    this.grid.visible = this.flowPts.visible = showGrid;
    if (showGrid) {
      const sl = hole.green.slope, len = Math.hypot(sl.x, sl.y) || 1, arr = this.flowPts.geometry.attributes.position.array;
      this.flow.forEach((f, i) => {
        f.x += sl.x / len * 0.9 * dt; f.y += sl.y / len * 0.9 * dt; f.life += dt;
        if (f.life > 3.5 || Math.hypot(f.x - hole.green.x, f.y - hole.green.y) > hole.green.r) Object.assign(f, this._flowSpawn(), { life: 0 });
        const v = this.T(f.x, f.y, 0.06); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
      });
      this.flowPts.geometry.attributes.position.needsUpdate = true;
    }

    // flag streams downwind
    if (this.flag) {
      this.flag.rotation.y = Math.atan2(game.wind.y, game.wind.x);
      const pa = this.flag.geometry.attributes.position, base = this.flagBase, t = now / 1000, amp = 0.03 + game.wind.v * 0.012;
      for (let i = 0; i < pa.count; i++) { const x = base[i * 3], y = base[i * 3 + 1]; pa.setZ(i, Math.sin(x * 6 - t * (4 + game.wind.v)) * amp * (x / 0.78) + Math.sin(y * 5 + t * 3) * 0.01 * x); }
      pa.needsUpdate = true;
      this.flag.geometry.computeVertexNormals();
    }

    this._golfer(game, club, dt, now);
    this._camera(game, dt, now, flying, putting);
    this._autoRes();
    this.renderer.render(this.scene, this.camera);
  }

  // Golfer stands at the current player's ball; backswing while the button is held, then swings through.
  _golfer(game, club, dt, now) {
    const G = this.golfer, p = game.current;
    if (!p || game.over) { G.group.visible = false; return; }
    if (game.swingAt !== this.lastSwingAt) { this.lastSwingAt = game.swingAt; this.swingAnim = { t0: now, from: this.theta, to: club.putter ? -0.45 : -2.25 }; }
    if (game.state === 'address' && (!this.swingAnim || now - this.swingAnim.t0 > 1200)) {
      this.swingAnim = null;
      // stand beside this ball, facing it, with the target to the golfer's left
      const a = game.aimOf(p.ball), d = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), f = new THREE.Vector3(-d.z, 0, d.x);
      const ballV = this.T(p.ball.x, p.ball.y, 0);
      G.group.position.copy(ballV).addScaledVector(f, -0.75);
      G.group.position.y = this.hAt(p.ball.x, p.ball.y);
      G.group.rotation.y = Math.atan2(f.x, f.z);
      G.shirt.color.set(p.color === '#ffffff' ? '#e8edf5' : p.color);
      const target = game.armed === game.cur ? (club.putter ? 0.42 : 2.3) : 0;
      this.theta += (target - this.theta) * Math.min(1, dt * (target ? 2.2 : 6));
    }
    if (this.swingAnim) {
      const k = Math.min(1, (now - this.swingAnim.t0) / 320), e = 1 - Math.pow(1 - k, 3);
      this.theta = this.swingAnim.from + (this.swingAnim.to - this.swingAnim.from) * e;
    }
    G.group.visible = game.state !== 'holeover';
    G.pivot.quaternion.setFromAxisAngle(G.axis, this.theta);
  }

  // Cameras: address (behind the ball), chase, landing, green orbit, hole flyover.
  _camera(game, dt, now, flying, putting) {
    const hole = this.hole, p = game.current;
    const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
    let rate = 3;
    const addressCam = (ball, outPos, outLook) => {
      const a = game.aimOf(ball), d = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), f = new THREE.Vector3(-d.z, 0, d.x);
      const b = this.T(ball.x, ball.y, 0), dist = Math.hypot(hole.pin.x - ball.x, hole.pin.y - ball.y);
      if (putting) {
        // stand on the far side from the golfer so the hole isn't hidden behind them
        outPos.copy(b).addScaledVector(d, -4.4).addScaledVector(f, 1.0); outPos.y += 1.9;
        outLook.copy(b).addScaledVector(d, Math.min(dist, 10) * 0.55); outLook.y -= 0.1;
      } else {
        outPos.copy(b).addScaledVector(d, -9).addScaledVector(f, -1.3); outPos.y += 2.7;
        outLook.copy(b).addScaledVector(d, Math.min(26, dist)); outLook.y += 0.2;
      }
    };

    if (!p && !this.flyover) {
      // nobody playing yet: slow orbit over the hole (attract mode)
      const t = now / 1000 * 0.06, mid = this.pinPos.clone().lerp(this.T(hole.tee.x, hole.tee.y, 0), 0.45);
      this.camPos.copy(mid).add(new THREE.Vector3(Math.cos(t) * 190, 85, Math.sin(t) * 190));
      this.camLook.copy(mid);
    } else if (this.flyover && (!p || game.state === 'address')) {
      const k = Math.min(1, (now - this.flyover.t0) / this.flyover.dur), e = k * k * (3 - 2 * k);
      const pin = this.pinPos, tee = this.T(hole.tee.x, hole.tee.y, 0), mid = pin.clone().lerp(tee, 0.5);
      const endPos = new THREE.Vector3(), endLook = new THREE.Vector3();
      if (p) addressCam(p.ball, endPos, endLook);
      else { endPos.copy(tee).add(new THREE.Vector3(0, 6, 0)).addScaledVector(pin.clone().sub(tee).setY(0).normalize(), -12); endLook.copy(mid); }
      const p0 = pin.clone().add(new THREE.Vector3(0, 32, 0)).lerp(tee, 0.08), p1 = mid.clone().add(new THREE.Vector3(0, 65, 0));
      if (e < 0.5) { const u = e * 2; wantPos.copy(p0).lerp(p1, u); wantLook.copy(pin).lerp(mid, u * 0.6); }
      else { const u = (e - 0.5) * 2; wantPos.copy(p1).lerp(endPos, u); wantLook.copy(pin.clone().lerp(mid, 0.6)).lerp(endLook, u); }
      this.camPos.copy(wantPos); this.camLook.copy(wantLook);
      if (k >= 1) this.flyover = null;
    } else {
      this.flyover = null;
      if (game.state === 'flight' && game.anim && flying) {
        const a = game.anim, path = a.res.path;
        if (a._land === undefined) {   // index where the ball first comes down
          let top = 0; for (let i = 1; i < path.length; i++) if (path[i].z > path[top].z) top = i;
          a._land = path.length - 1;
          for (let i = top; i < path.length; i++) if (path[i].z <= 0.02) { a._land = i; break; }
        }
        const hd = a.heading, d = new THREE.Vector3(Math.cos(hd), 0, -Math.sin(hd)), f = new THREE.Vector3(-d.z, 0, d.x);
        const ballV = this.T(flying.x, flying.y, flying.z);
        if (a.club.putter) {
          wantPos.copy(ballV).addScaledVector(d, -3).addScaledVector(f, -0.5); wantPos.y = this.hAt(flying.x, flying.y) + 1.3;
          wantLook.copy(ballV).addScaledVector(d, 2); rate = 4;
        } else if (a.i < a._land - 42) {
          wantPos.copy(ballV).addScaledVector(d, -16); wantPos.y = Math.max(this.hAt(flying.x, flying.y) + 3, ballV.y + 4 + flying.z * 0.15);
          wantLook.copy(ballV).addScaledVector(d, 10); rate = 4;
        } else {
          // landing cam: off to the side, ahead of where the ball comes down, looking back at it
          if (!a._landCam) {
            const L = path[a._land];
            const lp = this.T(L.x, L.y, 0).addScaledVector(d, 9).addScaledVector(f, 10);
            lp.y = Math.max(lp.y, this.hAt(L.x + Math.cos(hd) * 9, L.y + Math.sin(hd) * 9) + 0.5) + 2.6;
            a._landCam = lp;
          }
          wantPos.copy(a._landCam); wantLook.copy(ballV); rate = 2.5;
        }
      } else if ((game.state === 'result') && game.lastShot) {
        const ls = game.lastShot, end = ls.res.path[ls.res.path.length - 1];
        const target = ls.res.result === 'holed' ? this.pinPos : this.T(end.x, end.y, 0);
        if (ls._landCam) wantPos.copy(ls._landCam); else wantPos.copy(this.camPos);
        wantLook.copy(target); rate = 2;
      } else if (game.state === 'holeover' || game.over) {
        const t = now / 1000 * 0.18;
        wantPos.copy(this.pinPos).add(new THREE.Vector3(Math.cos(t) * 30, 13, Math.sin(t) * 30));
        wantLook.copy(this.pinPos); rate = 1.5;
      } else if (p) {
        addressCam(p.ball, wantPos, wantLook); rate = 2.6;
      } else {
        const tee = this.T(hole.tee.x, hole.tee.y, 0);
        wantPos.copy(tee).add(new THREE.Vector3(0, 30, 40)); wantLook.copy(this.pinPos);
      }
      const k = this.snapNext ? 1 : 1 - Math.exp(-dt * rate);
      this.snapNext = false;
      this.camPos.lerp(wantPos, k); this.camLook.lerp(wantLook, k);
      // never dip below the ground
      const gx = this.camPos.x, gy = -this.camPos.z, floor = this.hAt(gx, gy) + 0.6;
      if (this.camPos.y < floor) this.camPos.y = floor;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const dir = this.camLook.clone().sub(this.camPos);
    this.heading = Math.atan2(-dir.z, dir.x);
    // keep the sharp shadow area centred on what we're looking at
    const focus = this.camPos.clone().lerp(this.camLook, 0.35);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 180);
  }
}
