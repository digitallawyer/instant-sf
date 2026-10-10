// Downloads the raw OpenStreetMap data for the region from Overpass, tile by tile, into data/cache/osm.
// Re-running skips tiles already on disk; delete the folder to refresh.
// Map data © OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { BBOX } from '../src/city/region.js';

const OUT = 'data/cache/osm';
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const STEP_LON = 0.017, STEP_LAT = 0.0135;

fs.mkdirSync(OUT, { recursive: true });

const query = (s, w, n, e) => `[out:json][timeout:180][bbox:${s},${w},${n},${e}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["building:part"];
  relation["building:part"]["type"="multipolygon"];
  way["highway"];
  way["railway"~"^(tram|cable_car|light_rail|rail|subway|funicular)$"];
  way["natural"~"^(water|wood|scrub|beach|sand|grassland|heath|bare_rock|cliff)$"];
  relation["natural"~"^(water|wood|scrub|beach|sand|grassland)$"]["type"="multipolygon"];
  way["waterway"];
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery|railway|construction)$"];
  way["leisure"~"^(park|garden|pitch|playground|golf_course|stadium|track|marina|nature_reserve|dog_park)$"];
  relation["leisure"~"^(park|garden|golf_course|nature_reserve)$"]["type"="multipolygon"];
  way["man_made"~"^(pier|breakwater|bridge|groyne)$"];
  way["amenity"="parking"];
  way["place"~"^(square|island)$"];
  relation["place"="island"];
  node["natural"="tree"];
  node["highway"~"^(traffic_signals|crossing|stop|street_lamp|bus_stop)$"];
  node["railway"~"^(tram_stop|station|halt)$"];
  node["public_transport"="stop_position"];
  node["tourism"];
  node["historic"];
  node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|ice_cream|library|theatre|cinema|museum|school|university|hospital|fountain|bench|place_of_worship|townhall)$"];
  node["leisure"="park"]["name"];
  node["place"~"^(neighbourhood|suburb|quarter)$"];
  way["tourism"]["name"];
  way["historic"]["name"];
  way["amenity"~"^(place_of_worship|university|school|hospital|townhall|museum|theatre)$"]["name"];
);
out body geom;`;

async function fetchTile(s, w, n, e, file) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'User-Agent': 'instant-sf-dev/0.1 (hobby 3D city game)', 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query(s, w, n, e)),
      });
      if (res.status === 429 || res.status === 504) throw new Error('busy ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
      const text = await res.text();
      JSON.parse(text);
      fs.writeFileSync(file, text);
      return;
    } catch (err) {
      const wait = 5000 * (attempt + 1);
      console.warn(`  ${path.basename(file)}: ${err.message}, retrying in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error('gave up on ' + file);
}

const tiles = [];
for (let s = BBOX.south; s < BBOX.north - 1e-9; s += STEP_LAT)
  for (let w = BBOX.west; w < BBOX.east - 1e-9; w += STEP_LON)
    tiles.push([s, w, Math.min(s + STEP_LAT, BBOX.north), Math.min(w + STEP_LON, BBOX.east)]);

console.log(`${tiles.length} tiles`);
let i = 0;
for (const [s, w, n, e] of tiles) {
  i++;
  const file = path.join(OUT, `${s.toFixed(4)}_${w.toFixed(4)}.json`);
  if (fs.existsSync(file)) { console.log(`[${i}/${tiles.length}] cached`); continue; }
  const t = Date.now();
  await fetchTile(s, w, n, e, file);
  console.log(`[${i}/${tiles.length}] ${(fs.statSync(file).size / 1e6).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  await new Promise(r => setTimeout(r, 1500));
}

// Transit routes once for the whole region (they span many tiles).
const routesFile = path.join(OUT, 'routes.json');
if (!fs.existsSync(routesFile)) {
  const q = `[out:json][timeout:180][bbox:${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}];
relation["route"~"^(cable_car|tram|light_rail|ferry)$"];
out body geom;`;
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'User-Agent': 'instant-sf-dev/0.1 (hobby 3D city game)', 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
  fs.writeFileSync(routesFile, await res.text());
  console.log('routes', (fs.statSync(routesFile).size / 1e6).toFixed(1), 'MB');
}
