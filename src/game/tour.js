// The virtual tour: the camera glides between sights — rising over the rooftops between stops and
// settling into a slow orbit at each — while the day runs from a foggy dawn at the Golden Gate to
// night over the skyline. Automatic, or interactive (you click on to the next stop).
import * as THREE from 'three';
import { project } from '../city/region.js';
import { SIGHTS, TOUR } from '../city/sf.js';

const HOLD = 9, TRAVEL = 7;
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export class Tour {
  constructor({ camera, hf, sky, weather, interactive = false }) {
    Object.assign(this, { camera, hf, sky, weather, interactive });
    this.stops = TOUR.map(t => {
      const s = SIGHTS.find(x => x.id === t.sight);
      const [tx, tz] = project(s.lat, s.lon);
      const b = t.bearing * Math.PI / 180;
      const ground = Math.max(0, hf.inside(tx, tz) ? hf.at(tx, tz) : 0);
      const target = new THREE.Vector3(tx, ground + Math.min(40, t.height * 0.25), tz);
      const eye = new THREE.Vector3(tx + Math.sin(b) * t.dist, ground + t.height, tz - Math.cos(b) * t.dist);
      return { ...t, name: s.name, blurb: s.blurb, target, eye, b };
    });
    this.i = 0; this.t = 0; this.phase = 'hold';
    this.from = { eye: this.stops[0].eye.clone(), target: this.stops[0].target.clone() };
    this.apply(this.stops[0], 1);
    this.done = false;
  }
  get stop() { return this.phase === 'hold' ? this.stops[this.i] : null; }
  next() {
    if (this.i >= this.stops.length - 1) { this.done = true; return; }
    this.from = { eye: this.camera.position.clone(), target: this.look ? this.look.clone() : this.stops[this.i].target.clone() };
    this.i++; this.phase = 'travel'; this.t = 0;
  }
  apply(stop, k) {
    // drift time of day and fog towards this stop's mood
    const h = this.sky.state.hour;
    let dh = stop.hour - h; if (dh < -12) dh += 24;
    this.sky.setHour(h + dh * Math.min(1, k));
    this.weather.set(stop.karl ? 'fog' : 'clear');
  }
  update(dt) {
    if (this.done) return;
    this.t += dt;
    const s = this.stops[this.i];
    if (this.phase === 'travel') {
      const k = Math.min(1, this.t / TRAVEL), e = ease(k);
      const eye = this.from.eye.clone().lerp(s.eye, e);
      const dist = this.from.eye.distanceTo(s.eye);
      eye.y += Math.sin(Math.PI * k) * Math.min(220, 40 + dist * 0.12); // hop over the city
      const look = this.from.target.clone().lerp(s.target, ease(Math.min(1, k * 1.15)));
      this.camera.position.copy(eye); this.camera.lookAt(look); this.look = look;
      this.apply(s, dt * 0.25);
      if (k >= 1) { this.phase = 'hold'; this.t = 0; }
    } else {
      // slow orbit around the sight
      const a = s.b + this.t * 0.025;
      const r = s.dist * (1 - this.t * 0.006);
      const eye = new THREE.Vector3(s.target.x + Math.sin(a) * r, s.eye.y - this.t * 0.4, s.target.z - Math.cos(a) * r);
      const g = this.hf.inside(eye.x, eye.z) ? this.hf.at(eye.x, eye.z) : 0;
      eye.y = Math.max(eye.y, g + 6);
      this.camera.position.copy(eye); this.camera.lookAt(s.target); this.look = s.target.clone();
      this.apply(s, dt * 0.5);
      if (!this.interactive && this.t > HOLD) this.next();
    }
  }
}
