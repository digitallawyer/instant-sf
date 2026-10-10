// The player's look: a procedurally built rider (jointed, so it can pedal, walk and push) and what
// they ride: a road bike, a skateboard, or nothing at all. Plus a sea lion, because Pier 39.
// Models face +z; one unit is one metre.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const MOUNTS = [
  { id: 'bike', name: 'Bike' },
  { id: 'walk', name: 'On foot' },
  { id: 'skate', name: 'Skateboard' },
  { id: 'sealion', name: 'Sea lion' },
];

export const COLORS = [
  { name: 'International Orange', c: 0xd8462a },
  { name: 'Muni Red', c: 0xb3202a },
  { name: 'Bay Blue', c: 0x2e5f8a },
  { name: 'Fog Grey', c: 0xb9b6b0 },
  { name: 'Cable Car Green', c: 0x2f6b4f },
  { name: 'Mustard', c: 0xd6a12b },
];

const mat = (color, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

// a capsule from a to b (vectors), radius r
function limb(len, r, segs = 10) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, segs);
  g.translate(0, -len / 2, 0); // hangs down from its joint
  return g;
}
function tube(a, b, r, m) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, 10, 1);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  mesh.castShadow = true;
  return mesh;
}
const joint = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
const add = (parent, geo, m, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };

// ---------------------------------------------------------------- rider
function buildRider(shirtColor) {
  const skin = mat(0xc99a7a, 0.55), shirt = mat(shirtColor, 0.85), pants = mat(0x2a3140, 0.9), shoe = mat(0xe8e6e0, 0.6), hair = mat(0x2b1d14, 0.8);
  const helmet = mat(0x1d2126, 0.35, 0.1);
  const root = new THREE.Object3D();
  const hips = joint(root, 0, 0.95, 0);
  add(hips, new THREE.SphereGeometry(0.16, 16, 12).scale(1.15, 0.7, 0.85), pants);
  const spine = joint(hips, 0, 0.05, 0);
  const torso = add(spine, new THREE.CapsuleGeometry(0.15, 0.34, 6, 14).scale(1.15, 1, 0.75), shirt, 0, 0.27, 0);
  torso.name = 'torso';
  const neck = joint(spine, 0, 0.52, 0);
  add(neck, new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), skin, 0, 0.04, 0);
  const head = joint(neck, 0, 0.1, 0);
  add(head, new THREE.SphereGeometry(0.105, 20, 16).scale(0.9, 1.08, 1), skin, 0, 0.1, 0.01);
  add(head, new THREE.SphereGeometry(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.93, 1.05, 1.03), hair, 0, 0.115, -0.005);
  const hel = add(head, new THREE.SphereGeometry(0.128, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.95, 0.95, 1.12), helmet, 0, 0.13, -0.01);
  hel.name = 'helmet';
  // eyes for a hint of life
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.012, 8, 6), mat(0x111111, 0.3), s * 0.035, 0.115, 0.09);

  const arm = side => {
    const sh = joint(spine, side * 0.2, 0.47, 0);
    add(sh, limb(0.3, 0.05), shirt);
    const el = joint(sh, 0, -0.29, 0);
    add(el, limb(0.27, 0.042), skin);
    add(el, new THREE.SphereGeometry(0.045, 10, 8).scale(0.8, 1, 0.6), skin, 0, -0.28, 0);
    return { sh, el };
  };
  const leg = side => {
    const hip = joint(hips, side * 0.1, -0.03, 0);
    add(hip, limb(0.46, 0.075), pants);
    const knee = joint(hip, 0, -0.44, 0);
    add(knee, limb(0.45, 0.058), pants);
    const ankle = joint(knee, 0, -0.44, 0);
    add(ankle, new THREE.CapsuleGeometry(0.045, 0.16, 4, 8).rotateX(Math.PI / 2).scale(1.1, 0.75, 1), shoe, 0, -0.03, 0.05);
    return { hip, knee, ankle };
  };
  return { root, hips, spine, neck, head, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1), shirt, helmet: hel };
}

// two-bone IK in the leg's local sagittal plane: hip joint at origin, target (y down negative, z forward)
function solveLeg(leg, ty, tz, L1 = 0.44, L2 = 0.44) {
  const d = Math.min(L1 + L2 - 1e-3, Math.hypot(ty, tz));
  const a = Math.atan2(tz, -ty);                 // direction to target, from straight down
  const cosK = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
  const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosK)));
  const cosH = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const hip = a + Math.acos(Math.max(-1, Math.min(1, cosH)));
  leg.hip.rotation.x = -hip;
  leg.knee.rotation.x = knee;
  leg.ankle.rotation.x = hip - knee - 0.1;
}

// ---------------------------------------------------------------- bike
function buildBike(frameColor) {
  const g = new THREE.Group();
  const frame = mat(frameColor, 0.35, 0.4), black = mat(0x15171a, 0.6), chrome = mat(0xc8ccd0, 0.25, 1), tire = mat(0x1a1a1a, 0.9);
  const R = 0.34;
  const rear = new THREE.Vector3(0, R, -0.5), front = new THREE.Vector3(0, R, 0.52);
  const bb = new THREE.Vector3(0, 0.3, -0.06), seat = new THREE.Vector3(0, 0.85, -0.22), head = new THREE.Vector3(0, 0.82, 0.38);
  const headLow = new THREE.Vector3(0, 0.68, 0.42);
  [[bb, seat], [seat, head], [bb, headLow], [bb, rear], [seat, rear], [headLow, head]].forEach(([a, b]) => g.add(tube(a, b, 0.022, frame)));
  // fork
  for (const s of [-1, 1]) g.add(tube(new THREE.Vector3(s * 0.04, headLow.y, headLow.z), new THREE.Vector3(s * 0.05, R, front.z), 0.014, chrome));
  // seat post + saddle
  g.add(tube(seat, new THREE.Vector3(0, 0.93, -0.25), 0.014, chrome));
  add(g, new THREE.CapsuleGeometry(0.05, 0.14, 4, 8).rotateX(Math.PI / 2).scale(1, 0.45, 1), black, 0, 0.95, -0.24);
  // stem + bars
  g.add(tube(head, new THREE.Vector3(0, 0.92, 0.44), 0.016, chrome));
  g.add(tube(new THREE.Vector3(-0.22, 0.93, 0.46), new THREE.Vector3(0.22, 0.93, 0.46), 0.014, black));
  // wheels
  const wheel = () => {
    const w = new THREE.Group();
    add(w, new THREE.TorusGeometry(R - 0.018, 0.02, 10, 40).rotateY(Math.PI / 2), tire);
    add(w, new THREE.TorusGeometry(R - 0.045, 0.01, 6, 40).rotateY(Math.PI / 2), chrome);
    const spokes = [];
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      const c = new THREE.CylinderGeometry(0.0018, 0.0018, R - 0.05, 3).translate(0, (R - 0.05) / 2, 0).rotateX(a);
      spokes.push(c);
    }
    add(w, mergeGeometries(spokes), chrome);
    add(w, new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10).rotateZ(Math.PI / 2), chrome);
    return w;
  };
  const wr = wheel(), wf = wheel();
  wr.position.copy(rear); wf.position.copy(front);
  g.add(wr, wf);
  // crank + pedals
  const crank = new THREE.Group(); crank.position.copy(bb); g.add(crank);
  add(crank, new THREE.CylinderGeometry(0.09, 0.09, 0.01, 24).rotateZ(Math.PI / 2), chrome, 0.05, 0, 0);
  const pedals = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.rotation.x = s > 0 ? 0 : Math.PI; crank.add(arm);
    add(arm, new THREE.BoxGeometry(0.012, 0.17, 0.025), chrome, s * 0.08, -0.085, 0);
    const p = add(arm, new THREE.BoxGeometry(0.09, 0.015, 0.06), black, s * 0.12, -0.17, 0);
    pedals.push(p);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, wheels: [wr, wf], crank, R, frameMat: frame, seat: new THREE.Vector3(0, 0.98, -0.24), bars: new THREE.Vector3(0, 0.93, 0.46), bb };
}

function buildSkate(color) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  const L = 0.4, W = 0.105;
  shape.moveTo(-W, -L); shape.lineTo(W, -L); shape.absarc(0, L, W, 0, Math.PI, false); shape.lineTo(-W, -L);
  shape.absarc(0, -L, W, Math.PI, 0, false);
  const deck = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 }).rotateX(Math.PI / 2);
  add(g, deck, mat(color, 0.6), 0, 0.105, 0);
  const wheelM = mat(0xf0e9d8, 0.5), truck = mat(0xb0b4b8, 0.3, 1);
  const wheels = [];
  for (const z of [-0.3, 0.3]) {
    add(g, new THREE.BoxGeometry(0.17, 0.03, 0.04), truck, 0, 0.075, z);
    for (const x of [-0.09, 0.09]) wheels.push(add(g, new THREE.CylinderGeometry(0.028, 0.028, 0.035, 14).rotateZ(Math.PI / 2), wheelM, x, 0.03, z));
  }
  return { group: g, wheels };
}

function buildSeaLion() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.32, metalness: 0.05 });
  const belly = new THREE.MeshStandardMaterial({ color: 0x6b5139, roughness: 0.4 });
  // body: a lathe along z (nose at +z)
  const prof = [];
  const P = [[0, -1.0], [0.05, -0.95], [0.13, -0.8], [0.22, -0.55], [0.3, -0.25], [0.33, 0.0], [0.31, 0.25], [0.24, 0.45], [0.15, 0.58], [0.12, 0.66]];
  for (const [r, z] of P) prof.push(new THREE.Vector2(r, z));
  const body = new THREE.LatheGeometry(prof, 24).rotateX(Math.PI / 2);
  body.scale(1, 0.85, 1);
  const bodyMesh = add(g, body, skin, 0, 0.32, 0);
  // neck + head
  const neck = joint(g, 0, 0.42, 0.55);
  add(neck, new THREE.CapsuleGeometry(0.11, 0.22, 4, 12).rotateX(-0.9), skin, 0, 0.08, 0.06);
  const head = joint(neck, 0, 0.2, 0.15);
  add(head, new THREE.SphereGeometry(0.12, 18, 14).scale(0.9, 0.85, 1.15), skin);
  add(head, new THREE.CapsuleGeometry(0.06, 0.08, 4, 10).rotateX(Math.PI / 2), belly, 0, -0.03, 0.14);
  add(head, new THREE.SphereGeometry(0.022, 8, 6), mat(0x111111, 0.2), 0, -0.01, 0.22);
  for (const s of [-1, 1]) {
    add(head, new THREE.SphereGeometry(0.02, 10, 8), mat(0x0a0a0a, 0.1), s * 0.06, 0.04, 0.09);
    for (let w = 0; w < 3; w++) add(head, new THREE.CylinderGeometry(0.0015, 0.0015, 0.12, 3).rotateZ(Math.PI / 2 + s * (0.1 + w * 0.12)).translate(s * 0.08, -0.03 - w * 0.008, 0.16), mat(0xddd6c8, 0.5));
  }
  const flippers = [];
  for (const s of [-1, 1]) {
    const f = joint(g, s * 0.24, 0.15, 0.3);
    add(f, new THREE.SphereGeometry(0.15, 12, 8).scale(1.2, 0.18, 0.55), skin, s * 0.12, -0.05, 0.05);
    flippers.push(f);
  }
  const tail = joint(g, 0, 0.2, -0.85);
  for (const s of [-1, 1]) add(tail, new THREE.SphereGeometry(0.12, 12, 8).scale(0.6, 0.15, 1.2), skin, s * 0.09, -0.08, -0.12).rotation.y = s * 0.4;
  return { group: g, neck, head, flippers, tail, body: bodyMesh };
}

// Merges the meshes directly under each node that share a material, keeping the joint hierarchy
// (so animation still works) but cutting draw calls from ~70 per rider to ~20.
function mergeTree(node) {
  for (const c of [...node.children]) if (!c.isMesh) mergeTree(c);
  const byMat = new Map();
  for (const c of node.children) if (c.isMesh && !c.children.length) { if (!byMat.has(c.material)) byMat.set(c.material, []); byMat.get(c.material).push(c); }
  for (const [m, list] of byMat) {
    if (list.length < 2) continue;
    const geos = list.map(mesh => {
      mesh.updateMatrix();
      let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      return g.applyMatrix4(mesh.matrix);
    });
    const merged = new THREE.Mesh(mergeGeometries(geos), m);
    merged.castShadow = true; merged.receiveShadow = true;
    for (const mesh of list) node.remove(mesh);
    node.add(merged);
  }
}

// ---------------------------------------------------------------- the avatar
export class Avatar {
  constructor() {
    this.group = new THREE.Group();
    this.mount = 'bike';
    this.color = COLORS[0].c;
    this.dist = 0;
    this.lean = 0;
    this.build();
  }
  build() {
    this.group.clear();
    this.rider = null; this.bike = null; this.skate = null; this.seal = null;
    if (this.mount === 'sealion') {
      this.seal = buildSeaLion();
      this.group.add(this.seal.group);
    } else {
      this.rider = buildRider(this.color);
      this.group.add(this.rider.root);
      this.rider.helmet.visible = this.mount !== 'walk';
      if (this.mount === 'bike') { this.bike = buildBike(this.color); this.group.add(this.bike.group); }
      if (this.mount === 'skate') { this.skate = buildSkate(this.color); this.group.add(this.skate.group); }
    }
    mergeTree(this.group);
    this.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  setMount(id) { this.mount = id; this.build(); }
  setColor(c) { this.color = c; this.build(); }

  // speed in m/s, steer -1..1, airborne bool, dt seconds
  animate(dt, speed, steer, airborne, t) {
    this.dist += speed * dt;
    const targetLean = -steer * Math.min(1, Math.abs(speed) / 8) * 0.35;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 6);
    this.group.rotation.z = this.mount === 'walk' ? this.lean * 0.3 : this.lean;
    const r = this.rider;

    if (this.mount === 'bike' && r) {
      const b = this.bike;
      const spin = this.dist / b.R;
      b.wheels.forEach(w => (w.rotation.x = spin));
      const crankA = spin * 0.55;
      b.crank.rotation.x = crankA;
      r.hips.position.set(0, b.seat.y + 0.02, b.seat.z + 0.02);
      r.spine.rotation.x = 0.62;
      r.neck.rotation.x = -0.45;
      r.head.rotation.x = -0.15;
      // feet follow the pedals: pedal positions relative to the hip joint
      for (const [leg, ph] of [[r.legR, 0], [r.legL, Math.PI]]) {
        const a = crankA + ph;
        const py = b.bb.y - Math.cos(a) * 0.17 - 0.04, pz = b.bb.z - Math.sin(a) * 0.17;
        const hipY = r.hips.position.y - 0.03, hipZ = r.hips.position.z;
        solveLeg(leg, py - hipY, pz - hipZ);
      }
      // hands on the bars
      for (const arm of [r.armL, r.armR]) { arm.sh.rotation.x = -1.05; arm.el.rotation.x = -0.35; }
      if (airborne) { r.spine.rotation.x = 0.4; }
    } else if (this.mount === 'skate' && r) {
      const s = this.skate;
      s.wheels.forEach(w => (w.rotation.x = this.dist / 0.028));
      // stance: sideways on the board, knees bent; push with the back foot when slow
      r.root.rotation.y = Math.PI / 2 * 0.85;
      r.hips.position.set(0, 0.92, 0);
      const pushing = speed < 6 && !airborne;
      const ph = this.dist * 1.6;
      r.spine.rotation.x = 0.15;
      r.spine.rotation.z = 0;
      for (const arm of [r.armL, r.armR]) { arm.sh.rotation.z = (arm === r.armL ? -1 : 1) * 0.5; arm.sh.rotation.x = 0.1; arm.el.rotation.x = -0.4; }
      solveLeg(r.legL, -0.78, 0.18);
      if (pushing) solveLeg(r.legR, -0.86 + Math.max(0, Math.sin(ph)) * 0.12, -0.12 - Math.cos(ph) * 0.3);
      else solveLeg(r.legR, -0.78, -0.18);
      r.legL.hip.rotation.y = 0; r.legR.hip.rotation.y = 0;
    } else if (this.mount === 'walk' && r) {
      const run = Math.min(1, Math.abs(speed) / 6);
      const ph = this.dist * (run > 0.5 ? 1.35 : 1.8);
      const sw = Math.sin(ph) * (0.45 + 0.35 * run);
      r.root.rotation.y = 0;
      r.hips.position.set(0, 0.95 + Math.abs(Math.cos(ph)) * 0.05 * run, 0);
      r.spine.rotation.x = 0.08 + run * 0.15;
      r.legL.hip.rotation.x = sw; r.legR.hip.rotation.x = -sw;
      r.legL.knee.rotation.x = Math.max(0, -Math.cos(ph)) * (0.6 + run * 0.8) + 0.05;
      r.legR.knee.rotation.x = Math.max(0, Math.cos(ph)) * (0.6 + run * 0.8) + 0.05;
      r.legL.ankle.rotation.x = r.legR.ankle.rotation.x = 0;
      r.armL.sh.rotation.x = -sw * 0.8; r.armR.sh.rotation.x = sw * 0.8;
      r.armL.sh.rotation.z = -0.08; r.armR.sh.rotation.z = 0.08;
      r.armL.el.rotation.x = r.armR.el.rotation.x = -0.3 - run * 0.9;
      if (speed < 0.2) { r.legL.hip.rotation.x = r.legR.hip.rotation.x = 0; r.legL.knee.rotation.x = r.legR.knee.rotation.x = 0.05; r.armL.sh.rotation.x = r.armR.sh.rotation.x = 0; r.armL.el.rotation.x = r.armR.el.rotation.x = -0.1; }
      if (airborne) { r.legL.knee.rotation.x = r.legR.knee.rotation.x = 0.9; r.legL.hip.rotation.x = r.legR.hip.rotation.x = -0.6; }
    } else if (this.seal) {
      const s = this.seal;
      const ph = this.dist * 2.2;
      const gallop = Math.min(1, Math.abs(speed) / 4);
      s.body.rotation.x = Math.sin(ph) * 0.12 * gallop;
      s.group.position.y = Math.max(0, Math.sin(ph)) * 0.12 * gallop;
      s.neck.rotation.x = -0.2 + Math.sin(ph + 1) * 0.15 * gallop;
      s.head.rotation.x = 0.3 + Math.sin(t * 1.3) * 0.05;
      s.flippers.forEach((f, i) => (f.rotation.x = Math.sin(ph + i * 0.3) * 0.6 * gallop));
      s.tail.rotation.x = Math.sin(ph + Math.PI) * 0.4 * gallop;
    }
  }
}
