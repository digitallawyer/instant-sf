// Shared 2D map drawing: a dark, editorial cartography for the minimap and the big map.
// Vector features are bucketed in a grid so a small view only draws what's in it.

export const MAP_STYLE = {
  water: '#16232c', land: '#2a2d31', park: '#2f3d2c', wood: '#283624', sand: '#4a4438', pier: '#3a3c40', plaza: '#34363a',
  building: '#3d4146', buildingTall: '#4a4f56', road: ['#000', '#e3a24a', '#d9d4c8', '#c9c4b8', '#b9b4aa', '#9a968f', '#7c7975', '#6e6b67', '#5d5a57', '#5d5a57', '#6e6b67', '#6a5e50'],
  rail: '#b8402e',
};

export function buildMapIndex(map) {
  const G = 120;
  const grid = new Map();
  const put = (x0, z0, x1, z1, item) => {
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++)
      for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
        const k = i + ',' + j; let b = grid.get(k); if (!b) grid.set(k, b = { a: [], b: [], r: [], l: [] }); b[item.t].push(item.o);
      }
  };
  const bb = p => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } return [x0, z0, x1, z1]; };
  for (const a of map.areas) { const [x0, z0, x1, z1] = bb(a.p); if ((x1 - x0) * (z1 - z0) > 4e6) continue; put(x0, z0, x1, z1, { t: 'a', o: a }); }
  for (const b of map.buildings) { const [x0, z0, x1, z1] = bb(b.p); put(x0, z0, x1, z1, { t: 'b', o: b }); }
  for (const r of map.roads) { const [x0, z0, x1, z1] = bb(r.p); put(x0, z0, x1, z1, { t: 'r', o: r }); }
  for (const r of map.rails) { const [x0, z0, x1, z1] = bb(r.p); put(x0, z0, x1, z1, { t: 'l', o: r }); }
  return {
    G,
    query(x0, z0, x1, z1) {
      const out = { a: new Set(), b: new Set(), r: new Set(), l: new Set() };
      for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++)
        for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
          const c = grid.get(i + ',' + j); if (!c) continue;
          c.a.forEach(o => out.a.add(o)); c.b.forEach(o => out.b.add(o)); c.r.forEach(o => out.r.add(o)); c.l.forEach(o => out.l.add(o));
        }
      return out;
    },
  };
}

const AREA_FILL = { park: 'park', golf: 'park', pitch: 'park', playground: 'park', wood: 'wood', scrub: 'wood', sand: 'sand', pier: 'pier', plaza: 'plaza', parking: 'plaza', water: 'water' };

// Draws features into ctx, which is already transformed so that world metres map to pixels.
// px = how many world metres one screen pixel covers (to size lines).
export function drawFeatures(ctx, set, px, opts = {}) {
  const S = MAP_STYLE;
  const path = p => { ctx.beginPath(); for (let i = 0; i < p.length; i += 2) i ? ctx.lineTo(p[i], p[i + 1]) : ctx.moveTo(p[i], p[i + 1]); };
  for (const k of ['water', 'park', 'wood', 'sand', 'plaza', 'pier']) {
    ctx.fillStyle = S[k];
    for (const a of set.a) if (AREA_FILL[a.k] === k) { path(a.p); ctx.closePath(); ctx.fill(); }
  }
  // roads under buildings' outlines, widest first
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const roads = [...set.r].sort((a, b) => b.k - a.k);
  for (const r of roads) {
    if (r.k >= 8 && px > 2.5) continue;
    ctx.strokeStyle = S.road[r.k] || '#666';
    ctx.lineWidth = Math.max(px * (r.k <= 2 ? 1.6 : 1), r.w * (opts.roadScale || 1));
    path(r.p); ctx.stroke();
  }
  if (px < 6) {
    for (const b of set.b) { ctx.fillStyle = b.h > 40 ? S.buildingTall : S.building; path(b.p); ctx.closePath(); ctx.fill(); }
  }
  ctx.strokeStyle = S.rail; ctx.lineWidth = Math.max(px * 1.2, 1.2);
  ctx.setLineDash([px * 4, px * 3]);
  for (const l of set.l) { if (l.k !== 'cable_car' && l.k !== 'tram') continue; path(l.p); ctx.stroke(); }
  ctx.setLineDash([]);
}
