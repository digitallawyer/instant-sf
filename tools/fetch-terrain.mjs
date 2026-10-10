// Builds the height field under the city from the AWS open Terrain Tiles (terrarium encoding;
// USGS 3DEP in the US, with bathymetry under the Bay). Output: public/data/sf/terrain.bin, a grid of
// Int16 decimetres on the game's own metre grid, plus terrain.json describing it.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { BBOX, WORLD, unproject } from '../src/city/region.js';

const Z = 14;
const CELL = 8; // metres per sample
const CACHE = 'data/cache/terrain';
const OUT = 'public/data/sf';
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const lon2x = lon => (lon + 180) / 360 * 2 ** Z;
const lat2y = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** Z;

const tx0 = Math.floor(lon2x(BBOX.west)), tx1 = Math.floor(lon2x(BBOX.east));
const ty0 = Math.floor(lat2y(BBOX.north)), ty1 = Math.floor(lat2y(BBOX.south));
const tiles = new Map();

for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
  const file = path.join(CACHE, `${Z}_${tx}_${ty}.png`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
    if (!res.ok) throw new Error(`tile ${tx},${ty}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    process.stdout.write('.');
  }
  tiles.set(`${tx},${ty}`, PNG.sync.read(fs.readFileSync(file)));
}
console.log(`\n${tiles.size} tiles`);

function px(gx, gy) {
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const t = tiles.get(`${tx},${ty}`);
  if (!t) return 0;
  const x = Math.min(255, Math.max(0, gx - tx * 256)), y = Math.min(255, Math.max(0, gy - ty * 256));
  const i = (y * 256 + x) * 4;
  return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
}

function elevation(lat, lon) {
  const fx = lon2x(lon) * 256 - 0.5, fy = lat2y(lat) * 256 - 0.5;
  const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
  return px(x, y) * (1 - u) * (1 - v) + px(x + 1, y) * u * (1 - v) + px(x, y + 1) * (1 - u) * v + px(x + 1, y + 1) * u * v;
}

const nx = Math.ceil((WORLD.maxX - WORLD.minX) / CELL) + 1;
const nz = Math.ceil((WORLD.maxZ - WORLD.minZ) / CELL) + 1;
const grid = new Int16Array(nx * nz);
let lo = Infinity, hi = -Infinity;
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const { lat, lon } = unproject(WORLD.minX + i * CELL, WORLD.minZ + j * CELL);
  const h = elevation(lat, lon);
  lo = Math.min(lo, h); hi = Math.max(hi, h);
  grid[j * nx + i] = Math.round(Math.max(-3000, Math.min(3000, h)) * 10);
}

fs.writeFileSync(path.join(OUT, 'terrain.bin'), Buffer.from(grid.buffer));
fs.writeFileSync(path.join(OUT, 'terrain.json'), JSON.stringify({ minX: WORLD.minX, minZ: WORLD.minZ, cell: CELL, nx, nz, scale: 0.1 }));
console.log(`grid ${nx}x${nz}, ${lo.toFixed(1)}..${hi.toFixed(1)} m`);

// ---- backdrop: a coarse height field of the whole Bay for the horizon (Marin, East Bay hills, Twin Peaks) ----
{
  const ZB = 11, CELLB = 60;
  const BB = { south: 37.60, west: -122.68, north: 38.0, east: -122.12 };
  const l2x = lon => (lon + 180) / 360 * 2 ** ZB;
  const l2y = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** ZB;
  const bt = new Map();
  for (let tx = Math.floor(l2x(BB.west)); tx <= Math.floor(l2x(BB.east)); tx++) for (let ty = Math.floor(l2y(BB.north)); ty <= Math.floor(l2y(BB.south)); ty++) {
    const file = path.join(CACHE, `${ZB}_${tx}_${ty}.png`);
    if (!fs.existsSync(file)) {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZB}/${tx}/${ty}.png`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    bt.set(`${tx},${ty}`, PNG.sync.read(fs.readFileSync(file)));
  }
  const bpx = (gx, gy) => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256), t = bt.get(`${tx},${ty}`);
    if (!t) return -20;
    const i = ((gy - ty * 256) * 256 + (gx - tx * 256)) * 4;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  const elev = (lat, lon) => {
    const fx = l2x(lon) * 256 - 0.5, fy = l2y(lat) * 256 - 0.5, x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
    return bpx(x, y) * (1 - u) * (1 - v) + bpx(x + 1, y) * u * (1 - v) + bpx(x, y + 1) * (1 - u) * v + bpx(x + 1, y + 1) * u * v;
  };
  const { project } = await import('../src/city/region.js');
  const [bx0, bz0] = project(BB.north, BB.west), [bx1, bz1] = project(BB.south, BB.east);
  const bnx = Math.ceil((bx1 - bx0) / CELLB) + 1, bnz = Math.ceil((bz1 - bz0) / CELLB) + 1;
  const bg = new Int16Array(bnx * bnz);
  for (let j = 0; j < bnz; j++) for (let i = 0; i < bnx; i++) {
    const { lat, lon } = unproject(bx0 + i * CELLB, bz0 + j * CELLB);
    bg[j * bnx + i] = Math.round(Math.max(-3000, Math.min(3000, elev(lat, lon))) * 10);
  }
  fs.writeFileSync(path.join(OUT, 'backdrop.bin'), Buffer.from(bg.buffer));
  fs.writeFileSync(path.join(OUT, 'backdrop.json'), JSON.stringify({ minX: bx0, minZ: bz0, cell: CELLB, nx: bnx, nz: bnz, scale: 0.1 }));
  console.log(`backdrop ${bnx}x${bnz}`);
}
