# Instant San Francisco

A free, browser-based 3D San Francisco you can ride through. It was inspired by
[Instant Gent](https://instantgent.be). Every building stands at its measured height, every hill
has its real grade, and the whole city is generated from open data.

```bash
npm install
npm run dev        # http://127.0.0.1:5273 (site) and /play/ (the game)
```

## Data pipeline (`tools/`)

| step | command | output |
| --- | --- | --- |
| OpenStreetMap via Overpass, tiled and cached | `npm run data:osm` | `data/cache/osm/*.json` |
| Elevation (AWS Terrain Tiles / USGS 3DEP), city and Bay backdrop | `npm run data:terrain` | `public/data/sf/terrain.bin`, `backdrop.bin` |
| Compact game map: buildings, roads, bridges, areas, transit, POIs | `npm run data:build` | `public/data/sf/map.json` |
| Slim index for the site's Eat / Streets pages | `node tools/build-index.mjs` | `public/data/sf/index.json` |

The region is set in `src/city/region.js`. Hand-curated content lives in `src/city/sf.js`: sights,
races, missions, the tour and the rivals.

## Code map

- `src/engine/`: the renderer and the world
  - renderer: cascaded shadows, N8AO, bloom, AgX
  - sky and time of day; height fog ("Karl")
  - terrain, buildings (procedural facades with interior-mapped windows, Victorian bays and gables), roads, sidewalks and rails
  - water, trees (leaf cards with LOD), street furniture and night light pools
  - weather; procedural audio
- `src/landmarks/`: hand-built Golden Gate, Transamerica, Coit Tower, Ferry Building, Salesforce Tower and Palace of Fine Arts
- `src/life/`: traffic (lane graph, IDM, signals), parked cars, cable cars, streetcars and ferries, pedestrians, sea lions, gulls, sailboats
- `src/game/`: player physics, avatars, chase cam, route planning, races, missions, tour
- `src/ui/`: HUD, minimap, city map and search, menu, game-mode overlays, touch controls
- `src/site/` and the root HTML pages: the companion website

## Controls

- Arrows or WASD: ride
- Space: jump
- E: hop on or off a cable car
- M: map and teleport
- C: change ride
- R: weather
- `[` and `]`: time of day
- Esc: menu
- In races, F uses an item.
- Two players on one keyboard: player 1 uses WASD, Space and F; player 2 uses the arrows, Enter and right Shift.
- Dev keys: V toggles a free fly camera (1–9 jump to viewpoints in fly mode); N shows the stats overlay.

### URL parameters

`/play/` accepts these:

| parameter | effect |
| --- | --- |
| `?race=<id>`, `?mission=<id>`, `?tour[=interactive]` | start a race, mission or tour |
| `?goto=<sight>`, `?street=<name>`, `?place=<name>[&x=&z=]` | go to a place |
| `?t=<hour>` | set the time of day |
| `?w=clear\|fog\|cloudy\|rain` | set the weather |
| `?q=low\|high` | quality preset |
| `?dev` | show the stats overlay |

## Credits

- Map data © OpenStreetMap contributors (ODbL).
- Elevation: USGS 3DEP via AWS Terrain Tiles.
- Built with three.js, postprocessing and n8ao.
