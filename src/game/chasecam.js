// A springy third-person camera that trails the rider, looks a little ahead, rises on hills so you
// can see over the crest, and pulls in when a building would block the view.
import * as THREE from 'three';

export class ChaseCam {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.dist = 4.6;
    this.height = 1.9;
    this.yawOffset = 0;   // drag to orbit
    this.pitchOffset = 0;
    this.snap = true;
  }
  update(dt, player) {
    const h = player.heading + this.yawOffset;
    const fx = Math.sin(h), fz = Math.cos(h);
    const speedK = Math.min(1, Math.abs(player.speed) / 10);
    const dist = this.dist + speedK * 1.2;
    const target = player.pos;
    // desired spot behind and above
    let cx = target.x - fx * dist, cz = target.z - fz * dist;
    // pull in if a wall is in the way (march from the player outwards)
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = { x: target.x - fx * dist * t, z: target.z - fz * dist * t };
      const b = this.world.insideBuilding(p.x, p.z, target.y + 1.5);
      if (b) { const tt = Math.max(0.25, (i - 1) / steps); cx = target.x - fx * dist * tt; cz = target.z - fz * dist * tt; break; }
    }
    const ground = this.world.surface(cx, cz, target.y + 3).y;
    const cy = Math.max(target.y + this.height + this.pitchOffset * 4 + Math.max(0, -player.pitch) * 3, ground + 1.2);
    const desired = new THREE.Vector3(cx, cy, cz);
    const lookAt = new THREE.Vector3(target.x + fx * 2.5, target.y + 1.25, target.z + fz * 2.5);
    if (this.snap) { this.pos.copy(desired); this.look.copy(lookAt); this.snap = false; }
    const k = 1 - Math.exp(-dt * 7), kl = 1 - Math.exp(-dt * 12);
    this.pos.lerp(desired, k);
    this.look.lerp(lookAt, kl);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    // a touch of speed FOV
    const fov = 58 + speedK * 8;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * k; this.camera.updateProjectionMatrix(); }
    this.yawOffset *= Math.exp(-dt * 1.5);
    this.pitchOffset *= Math.exp(-dt * 1.5);
  }
}
