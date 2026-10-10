// A free camera for looking around while we build: drag to look, WASD to move, Q/E down/up,
// Shift for speed, mouse wheel to change the base speed.
import * as THREE from 'three';

export function createFlyCam(camera, dom, hf) {
  const keys = new Set();
  let yaw = 0, pitch = -0.2, speed = 40, dragging = false, lx = 0, ly = 0;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT') keys.add(e.code); });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  dom.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; ly = e.clientY; dom.setPointerCapture(e.pointerId); });
  dom.addEventListener('pointerup', e => { dragging = false; dom.releasePointerCapture(e.pointerId); });
  dom.addEventListener('pointermove', e => {
    if (!dragging) return;
    yaw -= (e.clientX - lx) * 0.0035; pitch -= (e.clientY - ly) * 0.0035;
    pitch = Math.max(-1.55, Math.min(1.55, pitch));
    lx = e.clientX; ly = e.clientY;
  });
  dom.addEventListener('wheel', e => { speed = Math.max(3, Math.min(800, speed * (e.deltaY > 0 ? 0.85 : 1.18))); e.preventDefault(); }, { passive: false });

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  return {
    enabled: true,
    get speed() { return speed; },
    set(pos, look) {
      camera.position.copy(pos);
      const d = look.clone().sub(pos).normalize();
      yaw = Math.atan2(-d.x, -d.z); pitch = Math.asin(d.y);
    },
    update(dt) {
      if (!this.enabled) return;
      euler.set(pitch, yaw, 0);
      camera.quaternion.setFromEuler(euler);
      fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      move.set(0, 0, 0);
      if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
      if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
      if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
      if (keys.has('KeyE') || keys.has('Space')) move.y += 1;
      if (keys.has('KeyQ')) move.y -= 1;
      if (move.lengthSq() > 0) {
        const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5 : 1;
        camera.position.addScaledVector(move.normalize(), speed * boost * dt);
      }
      const g = hf.inside(camera.position.x, camera.position.z) ? hf.at(camera.position.x, camera.position.z) : 0;
      camera.position.y = Math.max(camera.position.y, Math.max(g, 0) + 1.6);
    },
  };
}
