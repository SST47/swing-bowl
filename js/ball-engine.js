/*
 * Swing Baseball — pitches, contact model, ball flight and the ballpark
 * (no DOM, testable in Node).
 * Units: metres, seconds. Home plate at the origin; +z towards the pitcher and
 * centre field, +x towards first base / right field, +y up.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;
  const G = 9.81;

  const PARK = {
    mound: 18.44,
    base: 27.43,
    fence(theta) {            // theta: spray angle, 0 = centre field, + = right field
      const c = Math.cos(2 * theta);
      return 100 + 22 * c * c * (Math.abs(theta) < Math.PI / 4 ? 1 : 0);
    },
    fenceH(theta) { return 3 + 0.8 * Math.cos(theta * 2) ** 2; },
    foul: Math.PI / 4,
  };

  const PITCHES = [
    { id: 'FB', name: 'Fastball',  speed: [25, 28.5], brk: [0, -0.05], weight: 5 },
    { id: 'CH', name: 'Changeup',  speed: [20, 22], brk: [-0.05, -0.2], weight: 2 },
    { id: 'CB', name: 'Curveball', speed: [21, 23.5], brk: [0.3, -0.35], weight: 2 },
    { id: 'SL', name: 'Slider',    speed: [23, 25.5], brk: [0.32, -0.1], weight: 2 },
  ];
  const ZONE = { x: 0.22, y0: 0.5, y1: 1.05 };
  const RELEASE = { x: -0.42, y: 1.9, z: 17.3 };   // right-handed pitcher: arm side is third base (-x)

  function rnd(rng, a, b) { return a + (b - a) * rng(); }

  // Build a pitch. Position at u in [0, 1]: release -> plate (z = 0).
  function makePitch(rng) {
    rng = rng || Math.random;
    const total = PITCHES.reduce((a, p) => a + p.weight, 0);
    let r = rng() * total, type = PITCHES[0];
    for (const p of PITCHES) { if ((r -= p.weight) <= 0) { type = p; break; } }
    const strike = rng() < 0.8;
    const tx = strike ? rnd(rng, -ZONE.x * 0.9, ZONE.x * 0.9) : (rng() < 0.5 ? -1 : 1) * rnd(rng, ZONE.x + 0.08, ZONE.x + 0.3);
    const ty = strike ? rnd(rng, ZONE.y0 + 0.05, ZONE.y1 - 0.05) : rnd(rng, 0.25, 1.35);
    const speed = rnd(rng, type.speed[0], type.speed[1]);
    const dist = Math.hypot(RELEASE.z, RELEASE.x - tx, RELEASE.y - ty);
    return { type, speed, dur: dist / speed, target: { x: tx, y: ty }, brk: { x: type.brk[0], y: type.brk[1] }, inZone: Math.abs(tx) <= ZONE.x + 0.037 && ty >= ZONE.y0 && ty <= ZONE.y1 };
  }

  function pitchPos(p, u) {
    // aim at (target - break), then the break comes in late (u^2) so the ball ends on target
    const ex = p.target.x - p.brk.x, ey = p.target.y - p.brk.y;
    const x = RELEASE.x + (ex - RELEASE.x) * u + p.brk.x * u * u;
    const y = RELEASE.y + (ey - RELEASE.y) * u + p.brk.y * u * u + 0.12 * 4 * u * (1 - u);
    const z = RELEASE.z * (1 - u);
    return { x, y, z };
  }

  /*
   * Contact model.
   * dt: swing time - time the ball crosses the plate (s); negative = early.
   * power: 0..1 swing speed; lefty: bats left-handed; rng optional.
   * Returns { kind: 'miss' | 'foul' | 'fair', ev (m/s), la (rad), spray (rad), quality }
   */
  const WINDOW = 0.2, FOUL_WINDOW = 0.28;
  function contact(dt, power, pitch, lefty, rng) {
    rng = rng || Math.random;
    const a = Math.abs(dt);
    if (a > FOUL_WINDOW) return { kind: 'miss', quality: 0 };
    const pull = lefty ? 1 : -1;   // righty pulls to left field (-x)
    if (a > WINDOW) {
      const side = (dt < 0 ? pull : -pull);
      return { kind: 'foul', quality: 0, ev: 18 + 14 * power * rng(), la: rnd(rng, -5, 50) * D2R, spray: side * rnd(rng, 50, 80) * D2R };
    }
    let q = 1 - (a / WINDOW) ** 2;
    // chasing a pitch out of the zone makes for weaker contact
    if (pitch && !pitch.inZone) q *= 0.8;
    const ev = (30 + 22 * Math.max(0, Math.min(1, power))) * (0.55 + 0.45 * q);
    let la = (-4 + 32 * q + rnd(rng, -10, 10)) * D2R;
    if (q < 0.45 && rng() < 0.3) la = rnd(rng, 45, 70) * D2R;   // popped up
    const spray = (dt / WINDOW) * 42 * (-pull) * D2R + rnd(rng, -6, 6) * D2R;
    // dt < 0 (early) -> pull side
    return { kind: Math.abs(spray) > PARK.foul ? 'foul' : 'fair', ev, la, spray: Math.max(-1.3, Math.min(1.3, spray)), quality: q };
  }

  /*
   * Fly the ball. start {x,y,z}. Returns { path, outcome, dist, apex, landAt }
   * outcome: 'hr' | 'wall' | 'fly' | 'ground' | 'foul'
   */
  function flight(start, ev, la, spray) {
    const k = 0.0047, lift = 0.0014;
    let x = start.x, y = Math.max(0.3, start.y), z = Math.max(0, start.z);
    let vx = ev * Math.cos(la) * Math.sin(spray), vz = ev * Math.cos(la) * Math.cos(spray), vy = ev * Math.sin(la);
    const dt = 1 / 120, path = [{ x, y, z }];
    let apex = y, bounced = false, outcome = null, landAt = null, t = 0;
    const theta = () => Math.atan2(x, z);
    for (let i = 0; i < 120 * 12; i++) {
      t += dt;
      const sp = Math.hypot(vx, vy, vz);
      vx += -k * sp * vx * dt; vz += -k * sp * vz * dt;
      vy += (-k * sp * vy - G + (bounced ? 0 : lift * sp * sp * Math.cos(la))) * dt;
      x += vx * dt; y += vy * dt; z += vz * dt;
      apex = Math.max(apex, y);
      const th = theta(), r = Math.hypot(x, z);
      const fair = Math.abs(th) <= PARK.foul && z > 0;
      if (!outcome && fair && r >= PARK.fence(th)) {
        if (y > PARK.fenceH(th)) outcome = 'hr';
        else { outcome = 'wall'; vx *= -0.3; vz *= -0.3; x += vx * dt * 3; z += vz * dt * 3; }
      }
      if (y <= 0) {
        y = 0;
        if (!landAt) {
          landAt = { x, z, r, fair: Math.abs(theta()) <= PARK.foul && z > 0 };
          if (!outcome) outcome = !landAt.fair ? 'foul' : la < 10 * D2R ? 'ground' : 'fly';
        }
        bounced = true;
        vy = -vy * 0.35; vx *= 0.6; vz *= 0.6;
        if (Math.hypot(vx, vz) < 1.5 && Math.abs(vy) < 1) { path.push({ x, y, z }); break; }
      }
      if (outcome === 'hr' && (r > PARK.fence(th) + 25 || y <= 0)) { path.push({ x, y, z }); break; }
      if (i % 2 === 0) path.push({ x, y, z });
    }
    const dist = outcome === 'hr' ? estimateHR(path) : landAt ? landAt.r : Math.hypot(x, z);
    return { path, outcome: outcome || 'fly', dist, apex, time: t };
  }

  // Projected landing distance of a home run (where it would have come down at field level).
  function estimateHR(path) {
    for (let i = 1; i < path.length; i++) if (path[i].y <= 0) return Math.hypot(path[i].x, path[i].z);
    const a = path[path.length - 2], b = path[path.length - 1];
    const vy = b.y - a.y, steps = vy < 0 ? b.y / -vy : 30;
    return Math.hypot(b.x + (b.x - a.x) * steps, b.z + (b.z - a.z) * steps);
  }

  const api = { PARK, PITCHES, ZONE, RELEASE, makePitch, pitchPos, contact, flight, WINDOW, FOUL_WINDOW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BASEBALL = api;
})(typeof self !== 'undefined' ? self : this);
