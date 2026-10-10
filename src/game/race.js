// A race along real streets against three rivals, with Mario Kart-style items picked up from
// floating fortune cookies (carry up to three, use with F):
//   seagull   – flies to the rider just ahead and steals their snack: they wobble and slow
//   sourdough – a loaf dropped behind you; whoever rides over it spins out (jump to clear it)
//   karl      – a fog bank smothers whoever is leading: slow, and you can't see a thing
//   cable car – grab the cable: a big burst of speed
import * as THREE from 'three';
import { Track } from './route.js';
import { Avatar } from './avatar.js';
import { gate, cookieGeometry, itemMaterial, loafMesh, gullMesh, fogCloud } from './props.js';
import { project } from '../city/region.js';
import { RIVALS } from '../city/sf.js';

export const ITEMS = {
  seagull: { name: 'Seagull', icon: '🐦' },
  sourdough: { name: 'Sourdough', icon: '🥖' },
  karl: { name: 'Karl the Fog', icon: '🌫️' },
  cablecar: { name: 'Cable car boost', icon: '🚋' },
};
const ITEM_KEYS = Object.keys(ITEMS);
const AI_SPEED = 9.6;

export function buildRaceTrack(def, streets) {
  const pts = [];
  const way = def.way.map(([lat, lon]) => project(lat, lon));
  const legs = def.laps > 1 ? [...way, way[0]] : way;
  for (let i = 0; i < legs.length - 1; i++) {
    const p = streets.path(legs[i][0], legs[i][1], legs[i + 1][0], legs[i + 1][1]);
    if (!p) continue;
    if (pts.length) p.splice(0, 2);
    pts.push(...p);
  }
  if (pts.length < 4) return null;
  return new Track(pts, { loop: def.laps > 1 });
}

export class Race {
  constructor({ def, track, scene, world, players, hud, audio }) {
    Object.assign(this, { def, track, scene, world, players, hud, audio });
    this.player = players[0];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.laps = def.laps || 1;
    this.total = track.len * this.laps;
    this.state = 'countdown';
    this.t = -3.5;
    this.drops = [];     // loaves on the road
    this.flying = [];    // seagulls / fog clouds in flight
    this.finishOrder = [];
    this.buildProps();
    this.buildRacers();
  }

  surfaceY(x, z, y = 1e4) { return this.world.surface(x, z, y).y; }

  buildProps() {
    const tr = this.track, tmp = {};
    // start/finish + checkpoint gates
    const gateAt = (d, text, opts) => {
      tr.at(d, tmp);
      const g = gate(12, text, opts);
      g.position.set(tmp.x, this.surfaceY(tmp.x, tmp.z), tmp.z);
      g.rotation.y = Math.atan2(tmp.dx, tmp.dz);
      this.group.add(g);
    };
    gateAt(2, this.laps > 1 ? 'Start · Finish' : 'Start', { checker: true });
    if (this.laps === 1) gateAt(tr.len - 1, 'Finish', { checker: true });
    const nGates = Math.floor(tr.len / 260);
    for (let i = 1; i < nGates; i++) gateAt(i * tr.len / nGates, `Instant SF`);
    // fortune cookie rows
    this.cookieMat = itemMaterial();
    const cg = cookieGeometry();
    this.cookies = [];
    for (let d = 140; d < tr.len - 60; d += 230) {
      tr.at(d, tmp);
      for (const off of [-3, 0, 3]) {
        const x = tmp.x - tmp.dz * off, z = tmp.z + tmp.dx * off;
        const m = new THREE.Mesh(cg, this.cookieMat);
        m.position.set(x, this.surfaceY(x, z) + 1.0, z);
        m.castShadow = true;
        this.group.add(m);
        this.cookies.push({ m, x, z, respawn: 0 });
      }
    }
  }

  get items() { return this.racers[0].items; }
  get fogged() { return this.racers[0].fogged; }
  get offCourse() { return this.racers[0].offCourse; }
  get position() { return this.racers[0].position; }
  get humans() { return this.racers.filter(r => r.you); }
  X(r) { return r.you ? r.player.pos.x : r.x; }
  Z(r) { return r.you ? r.player.pos.z : r.z; }
  Y(r) { return r.you ? r.player.pos.y : r.y; }

  buildRacers() {
    const two = this.players.length > 1;
    this.racers = this.players.map((p, i) => ({ name: two ? `Player ${i + 1}` : 'You', you: true, player: p, items: [], d: 2, lap: 0, done: false, time: 0, fx: p.fx, fogged: 0, offCourse: false, position: 1 }));
    const tmp = {};
    RIVALS.slice(0, two ? 2 : 3).forEach((r, i) => {
      const av = new Avatar(); av.setColor(r.color);
      this.group.add(av.group);
      this.racers.push({ name: r.name, av, d: -1 - i * 2.8, off: (i - 1) * 2.2, lane: (i - 1) * 2.2, v: 0, skill: 0.95 + Math.random() * 0.1, fx: { spin: 0, boost: 0, slow: 0 }, items: [], lap: 0, done: false, time: 0, jump: 0, vy: 0, y: 0 });
    });
    // the players on the line, rivals on the grid just behind
    this.track.at(2, tmp);
    const ahead = this.track.at(16, {});
    this.humans.forEach((h, i) => {
      const off = two ? (i ? 1.6 : -1.6) : 0;
      h.player.place(tmp.x - tmp.dz * off, tmp.z + tmp.dx * off, Math.atan2(ahead.x - tmp.x, ahead.z - tmp.z));
      h.player.frozen = true;
    });
    for (const r of this.racers.filter(r => !r.you)) this.placeAI(r, 0);
  }

  placeAI(r, dt) {
    const tmp = this.track.at(r.d, r.s || (r.s = {}));
    const x = tmp.x - tmp.dz * r.off, z = tmp.z + tmp.dx * r.off;
    const ground = this.world.surface(x, z, (r.y || 0) + 2).y;
    if (r.jump > 0) { r.vy -= 22 * dt; r.y += r.vy * dt; if (r.y <= ground) { r.y = ground; r.jump = 0; } }
    else r.y = ground;
    // pitch from the track ahead
    const a = this.track.at(r.d + 1.5, {}), b = this.track.at(r.d - 1.5, {});
    const pitch = Math.atan2(this.surfaceY(a.x, a.z, r.y + 2) - this.surfaceY(b.x, b.z, r.y + 2), 3);
    r.pitch = pitch;
    r.av.group.position.set(x, r.y, z);
    r.av.group.rotation.order = 'YXZ';
    r.av.group.rotation.y = Math.atan2(tmp.dx, tmp.dz);
    r.av.group.rotation.x = -pitch;
    r.av.animate(dt, r.v, (r.lane - r.off) * 0.3 + (r.fx.spin > 0 ? Math.sin(performance.now() * 0.02) : 0), r.jump > 0, performance.now() / 1000);
    r.x = x; r.z = z;
  }

  progressOf(r) { return r.lap * this.track.len + r.d; }

  useItem(user) {
    const bag = user.items;
    if (!bag.length) return;
    const it = bag.shift();
    const order = this.ranked();
    const myIdx = order.indexOf(user);
    if (it === 'cablecar') {
      user.fx.boost = 3;
      if (user.you) { this.hud.toast('Cable car boost!'); this.audio?.bell(); }
    } else if (it === 'sourdough') {
      const pos = { x: this.X(user), z: this.Z(user) };
      const back = user.you ? { x: -Math.sin(user.player.heading), z: -Math.cos(user.player.heading) } : { x: -user.s.dx, z: -user.s.dz };
      const m = loafMesh();
      const x = pos.x + back.x * 2.5, z = pos.z + back.z * 2.5;
      m.position.set(x, this.surfaceY(x, z) + 0.25, z);
      this.group.add(m);
      this.drops.push({ m, x, z, owner: user, life: 40 });
    } else if (it === 'seagull') {
      const target = order[myIdx - 1];
      if (!target) return;
      const gm = gullMesh(); this.group.add(gm);
      gm.position.set(this.X(user), this.Y(user) + 4, this.Z(user));
      this.flying.push({ kind: 'seagull', m: gm, target, t: 0 });
      if (target.you) this.hud.toast('A seagull is after your snack!');
    } else if (it === 'karl') {
      const leader = order[0];
      if (leader === user) return;
      const fc = fogCloud(); this.group.add(fc);
      this.flying.push({ kind: 'karl', m: fc, target: leader, t: 0 });
      if (leader.you) this.hud.toast('Karl the Fog is rolling in on you!');
    }
  }

  hit(r, kind) {
    if (kind === 'seagull') { r.fx.spin = Math.max(r.fx.spin, 1.2); r.fx.slow = 1.5; }
    if (kind === 'loaf') r.fx.spin = Math.max(r.fx.spin, 1.6);
    if (kind === 'karl') { r.fx.slow = 4; if (r.you) r.fogged = 4; }
    if (r.you) this.audio?.bump?.(0.6);
  }

  ranked() {
    return [...this.racers].sort((a, b) => {
      if (a.done && b.done) return a.time - b.time;
      if (a.done) return -1; if (b.done) return 1;
      return this.progressOf(b) - this.progressOf(a);
    });
  }

  update(dt, inputs) {
    this.t += dt;
    if (this.state === 'countdown') {
      const n = Math.ceil(-this.t);
      if (n !== this.lastCount) { this.lastCount = n; this.audio?.countdown?.(n); }
      if (this.t >= 0) { this.state = 'racing'; for (const h of this.humans) h.player.frozen = false; this.hud.toast('Go!', 900); }
    }
    const racing = this.state === 'racing';
    const me = this.racers[0];
    // human progress along the track
    for (const h of this.humans) {
      const p = h.player;
      const prog = this.track.progress(p.pos.x, p.pos.z, h.d, 160);
      if (this.track.loop && prog.d < h.d - this.track.len * 0.5) h.lap++;
      else if (this.track.loop && prog.d > h.d + this.track.len * 0.5) h.lap--;
      h.d = prog.d; h.off = prog.off;
      if (racing && !h.done) h.time = this.t;
      if (racing && !h.done && this.progressOf(h) >= this.total - 3) { h.done = true; this.finishOrder.push(h); p.frozen = true; if (this.humans.every(x => x.done)) this.finish(); }
      if (h.fogged > 0) h.fogged -= dt;
      h.offCourse = h.off > 35;
    }
    // AI
    for (const r of this.racers.filter(r => !r.you)) {
      for (const k in r.fx) r.fx[k] = Math.max(0, r.fx[k] - dt);
      if (racing && !r.done) {
        const lead = Math.max(...this.humans.map(h => this.progressOf(h))) - this.progressOf(r);
        const rubber = Math.max(-0.12, Math.min(0.2, lead / 300));
        const slope = r.pitch || 0;
        let target = AI_SPEED * r.skill * (1 + rubber) * (1 - Math.max(-0.35, Math.min(0.45, slope * 2.6)));
        if (r.fx.boost > 0) target *= 1.55;
        if (r.fx.slow > 0) target *= 0.55;
        if (r.fx.spin > 0) target *= 0.25;
        r.v += (target - r.v) * Math.min(1, dt * 1.6);
        r.d += r.v * dt;
        if (this.track.loop && r.d > this.track.len) { r.d -= this.track.len; r.lap++; }
        if (this.progressOf(r) >= this.total - 3) { r.done = true; r.time = this.t; this.finishOrder.push(r); }
        // weave a little, dodge loaves by jumping, use items now and then
        if (Math.random() < dt * 0.15) r.lane = (Math.random() - 0.5) * 5;
        r.off += (r.lane - r.off) * Math.min(1, dt * 1.2);
        if (r.items.length && Math.random() < dt * 0.12) this.useItem(r);
      } else if (!racing) r.v = 0;
      else r.v *= Math.max(0, 1 - dt);
      this.placeAI(r, dt);
    }
    // cookies
    for (const c of this.cookies) {
      if (c.respawn > 0) { c.respawn -= dt; c.m.visible = c.respawn <= 0; continue; }
      c.m.rotation.y += dt * 2; c.m.position.y += Math.sin(this.t * 3 + c.x) * 0.004;
      for (const r of this.racers) {
        const x = this.X(r), z = this.Z(r);
        if (Math.hypot(x - c.x, z - c.z) < 1.5) {
          c.respawn = 4; c.m.visible = false;
          const bag = r.items;
          if (bag.length < 3) { const it = ITEM_KEYS[Math.floor(Math.random() * ITEM_KEYS.length)]; bag.push(it); if (r.you) { this.audio?.pickup?.(); this.hud.toast(`${ITEMS[it].icon} ${ITEMS[it].name}`, 1200); } }
          break;
        }
      }
    }
    this.humans.forEach((h, i) => { const inp = inputs[i]; if (inp?.itemPressed) { inp.itemPressed = false; if (racing) this.useItem(h); } });
    // loaves
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const dr = this.drops[i];
      dr.life -= dt;
      for (const r of this.racers) {
        const x = this.X(r), z = this.Z(r);
        const airborne = r.you ? r.player.air : r.jump > 0;
        if (Math.hypot(x - dr.x, z - dr.z) < 1.1 && !airborne && (r !== dr.owner || dr.life < 38)) { this.hit(r, 'loaf'); dr.life = 0; break; }
        // rivals hop over loaves they see coming
        if (!r.you && !airborne && Math.hypot(x - dr.x, z - dr.z) < 5 && Math.random() < 0.5 * dt * 10) { r.jump = 1; r.vy = 6.5; }
      }
      if (dr.life <= 0) { this.group.remove(dr.m); this.drops.splice(i, 1); }
    }
    // things in flight
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      const tx = this.X(f.target), tz = this.Z(f.target), ty = this.Y(f.target);
      const m = f.m;
      const k = Math.min(1, dt * (f.kind === 'seagull' ? 2.2 : 1.2));
      m.position.x += (tx - m.position.x) * k; m.position.z += (tz - m.position.z) * k;
      m.position.y += (ty + (f.kind === 'seagull' ? 2 : 2.5) - m.position.y) * k;
      if (f.kind === 'seagull') m.rotation.y = Math.atan2(tx - m.position.x, tz - m.position.z);
      if (Math.hypot(tx - m.position.x, tz - m.position.z) < 1.6 && !f.landed) { this.hit(f.target, f.kind); f.landed = true; f.t = Math.max(f.t, 2.5); }
      if (f.t > (f.kind === 'karl' ? 6 : 4)) { this.group.remove(m); this.flying.splice(i, 1); }
    }
    const order = this.ranked();
    for (const h of this.humans) h.position = order.indexOf(h) + 1;
  }

  finish() {
    this.state = 'finished';
    this.audio?.finish?.();
    for (const h of this.humans) h.player.frozen = true;
  }

  results() {
    return this.ranked().map((r, i) => ({ place: i + 1, name: r.name, you: !!r.you, time: r.done ? r.time : null }));
  }

  dispose() {
    this.scene.remove(this.group);
    for (const h of this.humans) h.player.frozen = false;
  }
}
