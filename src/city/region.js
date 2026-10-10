// The slice of San Francisco the game covers, and how lat/lon maps to game metres.
// World axes: x = east, z = south (so north is -z, as three.js cameras look down -z), y = up.
// Origin sits near Union Square-ish so coordinates stay small where most of the action is.

export const BBOX = { south: 37.740, west: -122.485, north: 37.835, east: -122.383 };
export const ORIGIN = { lat: 37.7955, lon: -122.418 };

const R = 6378137;
const k = Math.PI / 180;
const cosLat = Math.cos(ORIGIN.lat * k);

export function project(lat, lon) {
  const x = (lon - ORIGIN.lon) * k * R * cosLat;
  const z = -(lat - ORIGIN.lat) * k * R;
  return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
}

export function unproject(x, z) {
  return { lat: ORIGIN.lat - z / (k * R), lon: ORIGIN.lon + x / (k * R * cosLat) };
}

export const WORLD = (() => {
  const [x0, z0] = project(BBOX.north, BBOX.west);
  const [x1, z1] = project(BBOX.south, BBOX.east);
  return { minX: x0, minZ: z0, maxX: x1, maxZ: z1 };
})();
