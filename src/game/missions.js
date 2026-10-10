// Timed missions. A light beam marks the current target and an arrow under the timer points the way;
// the city map is closed while a mission runs, so no teleporting out of trouble.
import * as THREE from 'three';
import { project } from '../city/region.js';
import { Track } from './route.js';
import { beacon, postcard } from './props.js';
import { personGeometry, peopleMaterial } from '../life/people.js';
import { Avatar } from './avatar.js';

const P = ll => project(ll[0], ll[1]);
const COSTUMES = [0xe5532d, 0xf2c94c, 0x7bc67b, 0x9b59b6, 0x3fa7d6, 0xffffff, 0xff7aa2, 0xf2994a];

export class Mission {
  constructor({ def, scene, world, player, streets, hud, audio, csm }) {
    Object.assign(this, { def, scene, world, player, streets, hud, audio, csm });
    this.group = new THREE.Group(); scene.add(this.group);
    this.t = 0; this.limit = def.limit; this.state = 'running';
    this.beacon = beacon(); this.group.add(this.beacon);
    let [sx, sz] = P(def.start);
    const st = world.nearestStreet(sx, sz);
    if (st && Math.hypot(st.x - sx, st.z - sz) < 60) { sx = st.x; sz = st.z; }
    player.place(sx, sz, def.heading ?? 0);
    this['setup_' + def.type]();
    // face the first objective
    const first = def.path ? P(def.path[0]) : this.target ? [this.target.x, this.target.z] : null;
    if (first) player.place(sx, sz, Math.atan2(first[0] - sx, first[1] - sz));
  }
  setTarget(x, z, name) { this.target = { x, z, name }; this.beacon.position.set(x, this.world.surface(x, z, 1e4).y, z); this.beacon.visible = true; }
  near(x, z, r) { return Math.hypot(this.player.pos.x - x, this.player.pos.z - z) < r; }

  // --- catch a fleeing sea lion
  setup_catch() {
    const pts = [];
    const way = this.def.path.map(P);
    let prev = P(this.def.start);
    for (const w of way) { const p = this.streets.path(prev[0], prev[1], w[0], w[1]); if (p) { if (pts.length) p.splice(0, 2); pts.push(...p); } prev = w; }
    this.track = new Track(pts);
    this.seal = new Avatar(); this.seal.setMount('sealion');
    this.group.add(this.seal.group);
    this.sealD = 45; this.sealV = 0;
    this.objective = 'Catch the runaway sea lion';
  }
  update_catch(dt) {
    const s = this.track.at(this.sealD, this.sealS || (this.sealS = {}));
    const dist = Math.hypot(this.player.pos.x - s.x, this.player.pos.z - s.z);
    const target = dist < 30 ? 7.4 : dist < 60 ? 5.5 : 3.2;
    this.sealV += (target - this.sealV) * Math.min(1, dt * 2);
    this.sealD += this.sealV * dt;
    const y = this.world.surface(s.x, s.z, 1e4).y;
    this.seal.group.position.set(s.x, y, s.z);
    this.seal.group.rotation.y = Math.atan2(s.dx, s.dz);
    this.seal.animate(dt, this.sealV, Math.sin(this.t * 2) * 0.3, false, this.t);
    this.setTarget(s.x, s.z);
    this.beacon.position.y = y + 1;
    if (dist < 2.2) return this.end(true);
    if (this.sealD >= this.track.len - 1) return this.end(false);
    this.objective = dist < 30 ? 'Almost! Grab it!' : 'Catch the runaway sea lion';
  }

  // --- get somewhere in time
  setup_goto() { const [x, z] = P(this.def.to); this.setTarget(x, z, this.def.toName); this.objective = `Get to ${this.def.toName}`; }
  update_goto() { if (this.near(this.target.x, this.target.z, 9)) this.end(true); }

  // --- pick up, then deliver in order
  setup_deliver() { this.stop = 0; this.next(); }
  next() {
    const [ll, name] = this.def.stops[this.stop];
    const [x, z] = P(ll);
    this.setTarget(x, z, name);
    this.objective = this.stop === 0 ? `Pick up the cookies at ${name}` : `Deliver to ${name} (${this.stop}/${this.def.stops.length - 1})`;
  }
  update_deliver() {
    if (this.near(this.target.x, this.target.z, 9)) {
      this.audio?.pickup?.();
      this.hud.toast(this.stop === 0 ? 'Cookies picked up — still warm!' : `Delivered to ${this.target.name}`);
      this.stop++;
      if (this.stop >= this.def.stops.length) return this.end(true);
      this.next();
    }
  }

  // --- through the Bay to Breakers crowd
  setup_crowd() {
    this.setup_goto();
    const a = P(this.def.crowd[0]), b = P(this.def.crowd[1]);
    const pts = this.streets.path(a[0], a[1], b[0], b[1]);
    this.crowdTrack = new Track(pts || [a[0], a[1], b[0], b[1]]);
    const N = 320;
    const geo = personGeometry();
    this.walk = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    geo.setAttribute('aWalk', this.walk);
    this.crowd = new THREE.InstancedMesh(geo, peopleMaterial(this.csm), N);
    this.crowd.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.crowd.castShadow = true; this.crowd.frustumCulled = false;
    this.runners = Array.from({ length: N }, (_, i) => ({ d: Math.random() * this.crowdTrack.len, off: (Math.random() - 0.5) * 9, v: 2.2 + Math.random() * 1.6, ph: Math.random() * 6, c: COSTUMES[i % COSTUMES.length], s: 0.9 + Math.random() * 0.25 }));
    this.group.add(this.crowd);
    this.bumpCool = 0;
  }
  update_crowd(dt) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), S = new THREE.Vector3(), col = new THREE.Color(), tmp = {};
    this.bumpCool -= dt;
    this.runners.forEach((r, i) => {
      r.d = (r.d + r.v * dt) % this.crowdTrack.len;
      r.ph += r.v * dt * 4;
      const p = this.crowdTrack.at(r.d, tmp);
      const x = p.x - p.dz * r.off, z = p.z + p.dx * r.off;
      if (this.bumpCool <= 0 && Math.hypot(this.player.pos.x - x, this.player.pos.z - z) < 0.9) { this.player.spinOut(0.9); this.bumpCool = 1.2; this.audio?.bump?.(0.5); this.hud.toast('Oops — sorry!', 900); }
      q.setFromAxisAngle(up, Math.atan2(p.dx, p.dz));
      m4.compose(V.set(x, this.world.hf.at(x, z) + 0.42, z), q, S.setScalar(r.s));
      this.crowd.setMatrixAt(i, m4); this.crowd.setColorAt(i, col.setHex(r.c));
      this.walk.array[i * 2] = r.ph; this.walk.array[i * 2 + 1] = 1.4;
    });
    this.crowd.instanceMatrix.needsUpdate = true; this.crowd.instanceColor.needsUpdate = true; this.walk.needsUpdate = true;
    this.update_goto();
  }

  // --- collect scattered things
  setup_collect() {
    this.cards = this.def.items.map((ll, i) => { const [x, z] = P(ll); const m = postcard(i); m.position.set(x, this.world.surface(x, z, 1e4).y + 1.4, z); this.group.add(m); return { m, x, z, got: false }; });
    this.beacon.visible = false;
  }
  update_collect(dt) {
    let left = 0, best = null, bd = Infinity;
    for (const c of this.cards) {
      if (c.got) continue;
      c.m.rotation.y += dt * 1.5; c.m.position.y += Math.sin(this.t * 2 + c.x) * 0.003;
      if (this.near(c.x, c.z, 2.2)) { c.got = true; c.m.visible = false; this.audio?.pickup?.(); this.hud.toast(`Postcard ${this.cards.filter(k => k.got).length} of ${this.cards.length}`, 1200); continue; }
      left++;
      const d = Math.hypot(this.player.pos.x - c.x, this.player.pos.z - c.z);
      if (d < bd) { bd = d; best = c; }
    }
    this.objective = `Find the postcards — ${this.cards.length - left} of ${this.cards.length}`;
    if (best) this.target = { x: best.x, z: best.z };
    if (!left) this.end(true);
  }

  update(dt) {
    if (this.state !== 'running') return;
    this.t += dt;
    this['update_' + this.def.type](dt);
    if (this.state === 'running' && this.t >= this.limit) this.end(false);
    // the guiding arrow: bearing to the target relative to where you're heading
    if (this.target) {
      const a = Math.atan2(this.target.x - this.player.pos.x, this.target.z - this.player.pos.z) - this.player.heading;
      this.arrow = ((-a * 180 / Math.PI) % 360 + 540) % 360 - 180;
    } else this.arrow = null;
  }
  end(ok) {
    this.state = ok ? 'won' : 'lost';
    this.ok = ok;
    ok ? this.audio?.finish?.() : this.audio?.fail?.();
    this.player.frozen = true;
  }
  dispose() { this.scene.remove(this.group); this.player.frozen = false; }
}
