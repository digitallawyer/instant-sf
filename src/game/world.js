// What the player can stand on and bump into: the ground, bridge decks, pier decks and building walls.
// Everything is bucketed in coarse grids so a query only looks at what's nearby.

const PIER_Y = 2.4;

class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i * 100003 + j; }
  insertBox(x0, z0, x1, z1, item) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = this.key(i, j);
        let b = this.map.get(k);
        if (!b) this.map.set(k, b = []);
        b.push(item);
      }
  }
  at(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || EMPTY; }
}
const EMPTY = [];

function inside(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function createWorld(map, hf) {
  // building walls that reach the ground
  const walls = new Grid(16);
  const blds = new Grid(40);
  map.buildings.forEach((b, bi) => {
    if ((b.m || 0) > 2.5 || b.h < 1.5) return;
    const p = b.p, n = p.length / 2;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      walls.insertBox(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1, { ax, az, bx, bz, bi, top: b.b + b.h });
      x0 = Math.min(x0, ax); x1 = Math.max(x1, ax); z0 = Math.min(z0, az); z1 = Math.max(z1, az);
    }
    blds.insertBox(x0, z0, x1, z1, { p, x0, z0, x1, z1, bi, top: b.b + b.h, base: b.b });
  });

  // bridge and viaduct decks: segments with heights
  const decks = new Grid(30);
  for (const r of map.roads) {
    if (!r.br || !r.y) continue;
    const hw = r.w / 2 + 0.6;
    for (let i = 0; i < r.p.length / 2 - 1; i++) {
      const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      decks.insertBox(Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw,
        { ax, az, bx, bz, ay: r.y[i] + 0.15, by: r.y[i + 1] + 0.15, hw, n: r.n });
    }
  }

  // pier decks
  const piers = new Grid(60);
  for (const a of map.areas) {
    if (a.k !== 'pier') continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
    piers.insertBox(x0, z0, x1, z1, { p: a.p, x0, z0, x1, z1 });
  }

  // streets by name, for the HUD
  const streets = new Grid(40);
  for (const r of map.roads) {
    if (r.n === undefined || r.k > 9) continue;
    for (let i = 0; i < r.p.length / 2 - 1; i++) {
      const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      streets.insertBox(Math.min(ax, bx) - 12, Math.min(az, bz) - 12, Math.max(ax, bx) + 12, Math.max(az, bz) + 12, { ax, az, bx, bz, n: r.n, k: r.k, w: r.w });
    }
  }

  const segDist = (px, pz, s) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / L));
    const cx = s.ax + dx * t, cz = s.az + dz * t;
    return { d: Math.hypot(px - cx, pz - cz), t, cx, cz };
  };

  return {
    hf,
    // Height of whatever is underfoot at (x, z), for someone currently at height y.
    // Returns { y, kind: 'ground' | 'deck' | 'pier' | 'water', name }
    surface(x, z, y = Infinity) {
      const g = hf.inside(x, z) ? hf.at(x, z) : -20;
      let best = { y: Math.max(g, -0.6), kind: g < -0.35 ? 'water' : 'ground' };
      if (best.kind === 'ground') best.y += 0.27; // stand on the road surface rather than the raw terrain
      for (const pr of piers.at(x, z)) {
        if (x < pr.x0 || x > pr.x1 || z < pr.z0 || z > pr.z1) continue;
        if (PIER_Y > best.y && inside(x, z, pr.p)) best = { y: PIER_Y, kind: 'pier' };
      }
      for (const s of decks.at(x, z)) {
        const q = segDist(x, z, s);
        if (q.d > s.hw) continue;
        const dy = s.ay + (s.by - s.ay) * q.t;
        // step onto a deck from just below (ramps) but don't teleport up onto a viaduct overhead
        if (dy > best.y && dy <= y + 1.6) best = { y: dy, kind: 'deck', name: s.n };
      }
      return best;
    },
    // Pushes a circle out of building walls. Mutates pos {x, z}; returns true if it hit something.
    collide(pos, r, y = 0) {
      let hit = false;
      for (let iter = 0; iter < 2; iter++) {
        for (const w of walls.at(pos.x, pos.z)) {
          if (y > w.top + 0.5) continue; // above the roof
          const q = segDist(pos.x, pos.z, w);
          if (q.d < r && q.d > 1e-6) {
            const push = r - q.d;
            pos.x += (pos.x - q.cx) / q.d * push;
            pos.z += (pos.z - q.cz) / q.d * push;
            hit = true;
          }
        }
      }
      return hit;
    },
    // Is the point inside a building footprint (e.g. after a teleport)?
    insideBuilding(x, z, y = 0) {
      for (const b of blds.at(x, z)) {
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || y > b.top) continue;
        if (inside(x, z, b.p)) return b;
      }
      return null;
    },
    streetAt(x, z) {
      let best = null, bd = Infinity;
      for (const s of streets.at(x, z)) {
        const q = segDist(x, z, s);
        const d = q.d - s.w / 2;
        if (d < bd) { bd = d; best = s; }
      }
      return best && bd < 10 ? map.names[best.n] : null;
    },
    // Finds a free street spot near (x, z): the closest point on a car-or-foot street.
    nearestStreet(x, z, maxK = 7) {
      let best = null, bd = Infinity;
      for (const r of map.roads) {
        if (r.k > maxK || r.br) continue;
        for (let i = 0; i < r.p.length / 2 - 1; i++) {
          const q = segDist(x, z, { ax: r.p[i * 2], az: r.p[i * 2 + 1], bx: r.p[i * 2 + 2], bz: r.p[i * 2 + 3] });
          if (q.d < bd) { bd = q.d; best = { x: q.cx, z: q.cz, heading: Math.atan2(r.p[i * 2 + 2] - r.p[i * 2], r.p[i * 2 + 3] - r.p[i * 2 + 1]) }; }
        }
      }
      return best;
    },
  };
}
