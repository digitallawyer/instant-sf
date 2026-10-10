// The ground: the height field (for everything that needs to stand on it), its mesh, the land-use
// colouring painted from OSM areas, and the coarse backdrop of the rest of the Bay on the horizon.
import * as THREE from 'three';
import { GLSL_NOISE, addHook, useShared } from './fog.js';

export class HeightField {
  constructor(meta, data) {
    Object.assign(this, meta);
    this.data = data;
    this.maxX = this.minX + (this.nx - 1) * this.cell;
    this.maxZ = this.minZ + (this.nz - 1) * this.cell;
  }
  raw(i, j) {
    i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
    j = j < 0 ? 0 : j >= this.nz ? this.nz - 1 : j;
    return this.data[j * this.nx + i] * this.scale;
  }
  // Height on the triangulated mesh surface (matches what is drawn), not plain bilinear.
  at(x, z) {
    const fx = (x - this.minX) / this.cell, fz = (z - this.minZ) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h00 = this.raw(i, j), h10 = this.raw(i + 1, j), h01 = this.raw(i, j + 1), h11 = this.raw(i + 1, j + 1);
    // PlaneGeometry-style split: triangles (00,01,10) and (01,11,10)
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }
  normal(x, z, out = new THREE.Vector3()) {
    const e = this.cell;
    return out.set(this.at(x - e, z) - this.at(x + e, z), 2 * e, this.at(x, z - e) - this.at(x, z + e)).normalize();
  }
  inside(x, z) { return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ; }
}

export async function loadHeightField(base, name) {
  const [meta, buf] = await Promise.all([
    fetch(`${base}/${name}.json`).then(r => r.json()),
    fetch(`${base}/${name}.bin`).then(r => r.arrayBuffer()),
  ]);
  return new HeightField(meta, new Int16Array(buf));
}

function gridGeometry(hf, step, i0, j0, i1, j1, sink = 0) {
  const cols = Math.floor((i1 - i0) / step) + 1, rows = Math.floor((j1 - j0) / step) + 1;
  const pos = new Float32Array(cols * rows * 3);
  let k = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = i0 + c * step, j = j0 + r * step;
    pos[k++] = hf.minX + i * hf.cell; pos[k++] = hf.raw(i, j) - sink; pos[k++] = hf.minZ + j * hf.cell;
  }
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  k = 0;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = d; idx[k++] = e; idx[k++] = b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Paints OSM land use into two textures covering the play area:
//   landuse: R park/grass, G wood/scrub, B sand;   paved: R = built-up (buildings, roads, plazas)
export function paintLanduse(map, hf) {
  const W = 2048, H = Math.round(W * (hf.maxZ - hf.minZ) / (hf.maxX - hf.minX));
  const sx = W / (hf.maxX - hf.minX), sz = H / (hf.maxZ - hf.minZ);
  const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return [c, g]; };
  const [landC, land] = make();
  const [pavedC, paved] = make();
  const poly = (g, p, holes) => {
    g.beginPath();
    const ring = r => { for (let i = 0; i < r.length; i += 2) { const x = (r[i] - hf.minX) * sx, y = (r[i + 1] - hf.minZ) * sz; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); };
    ring(p); (holes || []).forEach(ring);
    g.fill('evenodd');
  };
  const COL = { park: '#ff0000', golf: '#ff0000', pitch: '#ff0000', playground: '#ff0000', wood: '#00ff00', scrub: '#80ff00', sand: '#0000ff' };
  land.globalCompositeOperation = 'lighter';
  for (const a of map.areas) if (COL[a.k]) { land.fillStyle = COL[a.k]; poly(land, a.p, a.h); }

  paved.fillStyle = '#ff0000';
  for (const b of map.buildings) poly(paved, b.p);
  for (const a of map.areas) if (a.k === 'plaza' || a.k === 'parking' || a.k === 'pier' || a.k === 'rail') poly(paved, a.p, a.h);
  paved.strokeStyle = '#ff0000'; paved.lineCap = 'round'; paved.lineJoin = 'round';
  for (const r of map.roads) {
    if (r.k >= 8) continue;
    paved.lineWidth = (r.w + 9) * sx;
    paved.beginPath();
    for (let i = 0; i < r.p.length; i += 2) { const x = (r.p[i] - hf.minX) * sx, y = (r.p[i + 1] - hf.minZ) * sz; i ? paved.lineTo(x, y) : paved.moveTo(x, y); }
    paved.stroke();
  }
  // soften once (a filter on every draw call would be tens of thousands of GPU blur passes)
  {
    const [tmpC, tmp] = make();
    tmp.filter = 'blur(2px)';
    tmp.drawImage(pavedC, 0, 0);
    paved.drawImage(tmpC, 0, 0);
  }
  // parks win over pavement inside them
  paved.fillStyle = 'rgba(0,0,0,0.85)';
  for (const a of map.areas) if (a.k === 'park' || a.k === 'wood' || a.k === 'golf' || a.k === 'scrub' || a.k === 'sand') poly(paved, a.p, a.h);

  const tex = c => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  return { landuse: tex(landC), paved: tex(pavedC), rect: new THREE.Vector4(hf.minX, hf.minZ, hf.maxX - hf.minX, hf.maxZ - hf.minZ) };
}

const groundGLSL = /* glsl */`
uniform sampler2D uLanduse, uPaved;
uniform vec4 uRect;
varying vec3 vWorld;
${GLSL_NOISE}
`;

export function createTerrain(hf, masks, csm) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.name = 'terrain';
  if (csm) csm.setupMaterial(mat);
  addHook(mat, shader => {
    useShared(shader);
    shader.uniforms.uLanduse = { value: masks.landuse };
    shader.uniforms.uPaved = { value: masks.paved };
    shader.uniforms.uRect = { value: masks.rect };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + groundGLSL)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        vec2 luv = (vWorld.xz - uRect.xy) / uRect.zw;
        vec3 lu = texture2D(uLanduse, luv).rgb;
        float pv = texture2D(uPaved, luv).r;
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        float slope = 1.0 - abs(n.y);
        float big = fbm(vWorld.xz * 0.012);
        float fine = vnoise(vWorld.xz * 0.9);
        vec3 grass = mix(vec3(0.16, 0.26, 0.08), vec3(0.28, 0.36, 0.12), big) * (0.85 + 0.3 * fine);
        vec3 dry = mix(vec3(0.42, 0.36, 0.2), vec3(0.55, 0.47, 0.28), big) * (0.85 + 0.25 * fine);   // golden California grass
        vec3 wood = mix(vec3(0.07, 0.13, 0.05), vec3(0.12, 0.18, 0.07), big);
        vec3 sand = mix(vec3(0.72, 0.64, 0.5), vec3(0.8, 0.72, 0.58), fine);
        vec3 pave = mix(vec3(0.46, 0.45, 0.43), vec3(0.56, 0.55, 0.52), big) * (0.92 + 0.12 * fine);
        vec3 rock = vec3(0.36, 0.33, 0.3) * (0.8 + 0.3 * fine);
        // within the city, unpaved ground is yards and lawns, not wild golden grass
        float urbanNear = smoothstep(0.02, 0.2, textureLod(uPaved, luv, 5.0).r);
        vec3 lawn = mix(vec3(0.2, 0.26, 0.11), vec3(0.3, 0.3, 0.17), big) * (0.85 + 0.3 * fine);
        vec3 c = mix(dry, lawn, urbanNear);
        c = mix(c, grass, clamp(lu.r, 0.0, 1.0));
        c = mix(c, wood, clamp(lu.g, 0.0, 1.0) * (1.0 - lu.r * 0.5));
        c = mix(c, sand, clamp(lu.b, 0.0, 1.0));
        c = mix(c, pave, smoothstep(0.25, 0.75, pv) * (1.0 - lu.r * 0.9));
        c = mix(c, rock, smoothstep(0.45, 0.75, slope));
        // underwater: sand fading to murk
        float under = smoothstep(0.8, -1.5, vWorld.y);
        c = mix(c, mix(vec3(0.42, 0.4, 0.33), vec3(0.06, 0.09, 0.09), smoothstep(-1.0, -12.0, vWorld.y)), under);
        diffuseColor.rgb = c;
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.97, 0.82, smoothstep(0.25, 0.75, pv)) - uWet * 0.5 * smoothstep(0.25, 0.75, pv);');
  });

  // chunks of 128 cells for culling
  const group = new THREE.Group();
  const C = 128;
  for (let j0 = 0; j0 < hf.nz - 1; j0 += C) for (let i0 = 0; i0 < hf.nx - 1; i0 += C) {
    const g = gridGeometry(hf, 1, i0, j0, Math.min(hf.nx - 1, i0 + C), Math.min(hf.nz - 1, j0 + C));
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// The rest of the Bay Area, coarse, sunk under the detailed play area.
export function createBackdrop(bf, hf) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = 'backdrop';
  addHook(mat, shader => {
    useShared(shader);
    shader.uniforms.uInner = { value: new THREE.Vector4(hf.minX + 20, hf.minZ + 20, hf.maxX - 20, hf.maxZ - 20) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nuniform vec4 uInner;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (transformed.x > uInner.x && transformed.x < uInner.z && transformed.z > uInner.y && transformed.z < uInner.w) transformed.y -= 40.0;`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        float big = fbm(vWorld.xz * 0.0015);
        vec3 dry = mix(vec3(0.42, 0.35, 0.2), vec3(0.5, 0.43, 0.26), big);
        vec3 green = mix(vec3(0.1, 0.16, 0.07), vec3(0.17, 0.22, 0.1), big);
        // north-facing slopes and higher ground hold more green (coastal oak and chaparral)
        float g = smoothstep(0.1, 0.6, -n.z * 0.8 + big * 0.6 + smoothstep(150.0, 500.0, vWorld.y) * 0.3);
        vec3 c = mix(dry, green, g);
        // low flats around the Bay are built up: a dusty urban grey-beige
        float urban = smoothstep(90.0, 20.0, vWorld.y) * smoothstep(0.85, 0.97, n.y) * smoothstep(0.5, 2.0, vWorld.y);
        c = mix(c, vec3(0.44, 0.42, 0.4) * (0.85 + 0.3 * vnoise(vWorld.xz * 0.02)), urban * 0.8);
        c = mix(c, vec3(0.08, 0.1, 0.1), smoothstep(0.5, -4.0, vWorld.y));
        diffuseColor.rgb = c;
      `);
  });
  const group = new THREE.Group();
  const C = 128;
  for (let j0 = 0; j0 < bf.nz - 1; j0 += C) for (let i0 = 0; i0 < bf.nx - 1; i0 += C) {
    const m = new THREE.Mesh(gridGeometry(bf, 1, i0, j0, Math.min(bf.nx - 1, i0 + C), Math.min(bf.nz - 1, j0 + C)), mat);
    m.receiveShadow = false;
    group.add(m);
  }
  return group;
}
