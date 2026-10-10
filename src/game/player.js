// Arcade riding physics. The hills matter: climbing Nob Hill on a bike is slow, bombing down
// California Street is fast. Collides with buildings, rides bridge decks and piers, swims in the Bay.
import * as THREE from 'three';
import { Avatar } from './avatar.js';

const MAX = { bike: 10.5, walk: 6.2, skate: 9.5, sealion: 8.0 };
const ACCEL = 7, BRAKE = 14, DRAG = 0.6, GRAV = 22, JUMP = 6.8;

export class Player {
  constructor(world, input) {
    this.world = world;
    this.input = input;
    this.avatar = new Avatar();
    this.object = this.avatar.group;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.vy = 0;
    this.air = false;
    this.steer = 0;
    this.surface = { y: 0, kind: 'ground' };
    this.pitch = 0;
    this.time = 0;
    this.frozen = false;
    this.obstacles = null; // () => [{ x, z, y, yaw, len, w }] moving vehicles to bump into
    this.riding = null;    // a transit vehicle we're hanging on to
    this.fx = { spin: 0, boost: 0, slow: 0 }; // race item effects, seconds remaining
  }
  spinOut(t = 1.6) { this.fx.spin = Math.max(this.fx.spin, t); }
  get mount() { return this.avatar.mount; }
  place(x, z, heading = this.heading) {
    this.pos.set(x, 0, z);
    const s = this.world.surface(x, z, 1e4);
    this.pos.y = s.y;
    this.heading = heading;
    this.speed = 0; this.vy = 0; this.air = false;
    this.sync();
  }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  update(dt) {
    this.time += dt;
    const I = this.input;
    const eff = this.fx;
    for (const k in eff) eff[k] = Math.max(0, eff[k] - dt);
    const max = MAX[this.mount] * (eff.boost > 0 ? 1.55 : 1) * (eff.slow > 0 ? 0.55 : 1);
    let steerIn = (I.right ? 1 : 0) - (I.left ? 1 : 0) + (I.steerAxis || 0);
    if (eff.spin > 0) { steerIn = Math.sin(this.time * 18) * 1.5; this.speed *= Math.max(0, 1 - dt * 2.2); }
    this.steer += (Math.max(-1, Math.min(1, steerIn)) - this.steer) * Math.min(1, dt * 8);

    if (!this.frozen) {
      // throttle and brakes
      const throttle = (I.up ? 1 : 0) - (I.down ? 1 : 0) + (I.throttleAxis || 0);
      if (throttle > 0) this.speed += ACCEL * throttle * dt * (this.speed < 0 ? 2 : 1) * (eff.boost > 0 ? 1.8 : 1);
      else if (throttle < 0) this.speed -= (this.speed > 0.2 ? BRAKE : ACCEL * 0.6) * -throttle * dt;
      else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), DRAG * dt * (1 + Math.abs(this.speed) * 0.15));
      // gravity along the slope (SF!): downhill speeds you up, uphill slows you
      if (!this.air && this.surface.kind !== 'water') this.speed -= Math.sin(this.pitch) * 9.8 * dt * (this.mount === 'walk' ? 0.25 : 0.55);
      const water = this.surface.kind === 'water';
      const cap = water ? max * 0.45 : max * (1 + Math.min(0.45, Math.max(0, -this.pitch) * 2.2));
      if (this.speed > cap) this.speed -= (this.speed - cap) * Math.min(1, dt * (throttle > 0 ? 2.5 : 1.2));
      this.speed = Math.max(-max * 0.35, this.speed);
    } else this.speed *= Math.max(0, 1 - dt * 4);

    // steering: tighter when slow, still possible standing (on foot you just turn)
    const turnRate = this.mount === 'walk' ? 3.2 : 2.4 / (1 + Math.abs(this.speed) * 0.09);
    const mobility = this.mount === 'walk' ? 1 : Math.min(1, 0.25 + Math.abs(this.speed) / 3);
    this.heading -= this.steer * turnRate * mobility * dt * (this.speed < -0.1 ? -1 : 1);

    // move in small steps so fast riders don't tunnel through thin walls
    const dist = this.speed * dt;
    const steps = Math.max(1, Math.ceil(Math.abs(dist) / 0.35));
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const p = { x: this.pos.x, z: this.pos.z };
    let bumped = false;
    for (let s = 0; s < steps; s++) {
      p.x += fx * dist / steps; p.z += fz * dist / steps;
      if (this.world.collide(p, 0.45, this.pos.y)) bumped = true;
    }
    if (this.obstacles) for (const o of this.obstacles(p.x, p.z)) {
      if (Math.abs((o.y ?? this.pos.y) - this.pos.y) > 3) continue;
      const sy = Math.sin(o.yaw), cy = Math.cos(o.yaw), dx = p.x - o.x, dz = p.z - o.z;
      const f = dx * sy + dz * cy, rt = dx * cy - dz * sy;
      const hl = o.len / 2 + 0.45, hw = o.w / 2 + 0.45;
      if (Math.abs(f) < hl && Math.abs(rt) < hw) {
        const pf = hl - Math.abs(f), pr = hw - Math.abs(rt);
        if (pf < pr) { p.x += sy * Math.sign(f) * pf; p.z += cy * Math.sign(f) * pf; }
        else { p.x += cy * Math.sign(rt) * pr; p.z -= sy * Math.sign(rt) * pr; }
        bumped = true;
        this.onBump?.(Math.min(1, Math.abs(this.speed) / 8));
      }
    }
    if (bumped) {
      // scrub speed by how head-on the hit was
      const mx = p.x - this.pos.x, mz = p.z - this.pos.z, ml = Math.hypot(mx, mz);
      const along = ml > 1e-4 ? (mx * fx + mz * fz) / ml : 0;
      this.speed *= Math.max(0.2, Math.min(1, along));
    }
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x = p.x; this.pos.z = p.z;

    // vertical: stick to the surface, or fly
    const surf = this.world.surface(this.pos.x, this.pos.z, this.pos.y);
    if (I.jumpPressed && !this.air && surf.kind !== 'water') { this.vy = JUMP; this.air = true; I.jumpPressed = false; }
    if (this.air) {
      this.vy -= GRAV * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= surf.y) { this.pos.y = surf.y; this.air = false; this.vy = 0; }
    } else {
      const drop = this.pos.y - surf.y;
      if (drop > 1.2) { this.air = true; this.vy = 0; } // rode off an edge
      else this.pos.y = surf.y;
    }
    this.surface = surf;
    // slope pitch from the ground ahead/behind
    const ahead = this.world.surface(this.pos.x + fx * 1.2, this.pos.z + fz * 1.2, this.pos.y).y;
    const behind = this.world.surface(this.pos.x - fx * 1.2, this.pos.z - fz * 1.2, this.pos.y).y;
    const targetPitch = surf.kind === 'water' ? 0 : Math.atan2(ahead - behind, 2.4);
    if (!this.air) this.pitch += (Math.max(-0.5, Math.min(0.5, targetPitch)) - this.pitch) * Math.min(1, dt * 10);
    this.moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);

    this.avatar.animate(dt, this.speed, this.steer, this.air, this.time);
    this.sync();
  }
  sync() {
    const o = this.object;
    const swim = this.surface.kind === 'water' && !this.air;
    o.position.set(this.pos.x, this.pos.y - (swim ? (this.mount === 'sealion' ? 0.3 : 0.9) : 0), this.pos.z);
    o.rotation.order = 'YXZ';
    o.rotation.y = this.heading;
    o.rotation.x = -this.pitch * (this.mount === 'walk' ? 0.2 : 1);
  }
}

// Keyboard state. layout: 'all' (one player: WASD or arrows), 'p1' (WASD, Space jump, F item) or
// 'p2' (arrows, Enter jump, right Shift item) for two players on one keyboard.
const LAYOUTS = {
  all: { keys: { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }, jump: ['Space'], item: ['KeyF'] },
  p1: { keys: { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }, jump: ['Space'], item: ['KeyF'] },
  p2: { keys: { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }, jump: ['Enter', 'Numpad0'], item: ['ShiftRight', 'Slash'] },
};
export function createInput(layout = 'all', target = window) {
  const I = { up: false, down: false, left: false, right: false, jumpPressed: false, itemPressed: false, steerAxis: 0, throttleAxis: 0, enabled: true, layout };
  target.addEventListener('keydown', e => {
    if (!I.enabled || e.target.tagName === 'INPUT') return;
    const L = LAYOUTS[I.layout];
    if (L.keys[e.code]) { I[L.keys[e.code]] = true; e.preventDefault(); }
    if (L.jump.includes(e.code) && !e.repeat) { I.jumpPressed = true; e.preventDefault(); }
    if (L.item.includes(e.code) && !e.repeat) I.itemPressed = true;
  });
  target.addEventListener('keyup', e => { const k = LAYOUTS.all.keys[e.code]; if (k && (LAYOUTS[I.layout].keys[e.code])) I[k] = false; });
  target.addEventListener('blur', () => { I.up = I.down = I.left = I.right = false; });
  return I;
}
