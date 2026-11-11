// Minimal 3DS reader/writer (triangle meshes + diffuse colours). 3DS is Z-up, the scene is Y-up.
const MAIN = 0x4d4d, VERSION = 0x0002, EDIT = 0x3d3d, MESHVER = 0x3d3e, OBJECT = 0x4000, MESH = 0x4100,
  VERTS = 0x4110, FACES = 0x4120, FACEMAT = 0x4130, MATERIAL = 0xafff, MATNAME = 0xa000, DIFFUSE = 0xa020, COLOR24 = 0x0011;
const LIMIT = 65535;

const chunk = (id, ...parts) => {
  const body = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(6 + body);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, id, true); dv.setUint32(2, 6 + body, true);
  let o = 6;
  for (const p of parts) { out.set(new Uint8Array(p.buffer ?? p, p.byteOffset ?? 0, p.byteLength), o); o += p.byteLength; }
  return out;
};
const cstr = s => Uint8Array.from([...new TextEncoder().encode(s), 0]);

// objects: [{ name, color: '#rrggbb', triColors?: string[], positions: Float32Array (non-indexed, Y-up, world coordinates) }]
export function write3ds(objects) {
  const edit = [chunk(MESHVER, new Uint8Array(Uint32Array.of(3).buffer))];
  objects.forEach((o, n) => {
    const map = new Map(), verts = [], tris = [];
    const p = o.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = Math.fround(p[i]), y = Math.fround(-p[i + 2]), z = Math.fround(p[i + 1]);
      const k = x + ',' + y + ',' + z;
      let id = map.get(k);
      if (id === undefined) { id = verts.length / 3; map.set(k, id); verts.push(x, y, z); }
      tris.push(id);
    }
    if (verts.length / 3 > LIMIT || tris.length / 3 > LIMIT) throw new Error(`Object ${n + 1} has too many vertices/faces for 3DS (max. ${LIMIT})`);
    const vb = new Uint8Array(2 + verts.length * 4);
    new DataView(vb.buffer).setUint16(0, verts.length / 3, true);
    const vdv = new DataView(vb.buffer);
    verts.forEach((v, i) => vdv.setFloat32(2 + 4 * i, v, true));
    const fb = new Uint8Array(2 + tris.length / 3 * 8);
    const fdv = new DataView(fb.buffer);
    fdv.setUint16(0, tris.length / 3, true);
    for (let t = 0; t < tris.length / 3; t++) for (let k = 0; k < 3; k++) fdv.setUint16(2 + 8 * t + 2 * k, tris[3 * t + k], true);
    const facesByColor = new Map();
    for (let t = 0; t < tris.length / 3; t++) {
      const color = o.triColors?.[t] ?? o.color;
      if (!facesByColor.has(color)) facesByColor.set(color, []);
      facesByColor.get(color).push(t);
    }
    const assignments = [], materials = [];
    let matIndex = 0;
    for (const [color, faces] of facesByColor) {
      const matName = `M${n + 1}_${++matIndex}`;
      const name = cstr(matName), matAssign = new Uint8Array(name.length + 2 + faces.length * 2);
      const mdv = new DataView(matAssign.buffer);
      matAssign.set(name, 0);
      mdv.setUint16(name.length, faces.length, true);
      faces.forEach((face, i) => mdv.setUint16(name.length + 2 + 2 * i, face, true));
      assignments.push(chunk(FACEMAT, matAssign));
      const rgb = Uint8Array.from([1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)));
      materials.push(chunk(MATERIAL, chunk(MATNAME, name), chunk(DIFFUSE, chunk(COLOR24, rgb))));
    }
    edit.push(chunk(OBJECT, cstr(o.name), chunk(MESH, chunk(VERTS, vb), chunk(FACES, fb, ...assignments))));
    edit.push(...materials);
  });
  return chunk(MAIN, chunk(VERSION, new Uint8Array(Uint32Array.of(3).buffer)), chunk(EDIT, ...edit)).buffer;
}

export function parse3ds(buffer) {
  const dv = new DataView(buffer);
  if (buffer.byteLength < 6 || dv.getUint16(0, true) !== MAIN) throw new Error('Not a 3DS file');
  const objects = [], mats = new Map();
  const readStr = (pos, end) => { let s = ''; while (pos < end && dv.getUint8(pos)) s += String.fromCharCode(dv.getUint8(pos++)); return [s, pos + 1]; };
  const walk = (start, end, ctx) => {
    for (let p = start; p + 6 <= end;) {
      const id = dv.getUint16(p, true), len = dv.getUint32(p + 2, true);
      if (len < 6) break;
      const body = p + 6, next = Math.min(p + len, end);
      if (id === EDIT || id === MESH) walk(body, next, ctx);
      else if (id === OBJECT) {
        const [name, pos] = readStr(body, next);
        const obj = { name, verts: null, faces: null, assignments: [] };
        objects.push(obj);
        walk(pos, next, obj);
      } else if (id === VERTS && ctx) {
        const n = dv.getUint16(body, true);
        ctx.verts = new Float32Array(3 * n);
        for (let i = 0; i < 3 * n; i++) ctx.verts[i] = dv.getFloat32(body + 2 + 4 * i, true);
      } else if (id === FACES && ctx) {
        const n = dv.getUint16(body, true);
        ctx.faces = new Uint16Array(3 * n);
        for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) ctx.faces[3 * t + k] = dv.getUint16(body + 2 + 8 * t + 2 * k, true);
        walk(body + 2 + 8 * n, next, ctx);
      } else if (id === FACEMAT && ctx) {
        const [name, pos] = readStr(body, next);
        const count = dv.getUint16(pos, true), faces = [];
        for (let i = 0; i < count; i++) faces.push(dv.getUint16(pos + 2 + 2 * i, true));
        ctx.assignments.push({ name, faces });
      } else if (id === MATERIAL) {
        const m = { name: '', color: '#cccccc' };
        walk(body, next, m);
        mats.set(m.name, m.color);
      } else if (id === MATNAME && ctx) ctx.name = readStr(body, next)[0];
      else if (id === DIFFUSE && ctx) walk(body, next, { diffuse: ctx });
      else if (id === COLOR24 && ctx?.diffuse) {
        ctx.diffuse.color = '#' + [0, 1, 2].map(i => dv.getUint8(body + i).toString(16).padStart(2, '0')).join('');
      }
      p += len;
    }
  };
  walk(6, buffer.byteLength, null);
  return objects.filter(o => o.verts && o.faces?.length).map(o => {
    const positions = new Float32Array(o.faces.length * 3);
    o.faces.forEach((vi, i) => {
      const x = o.verts[3 * vi], y = o.verts[3 * vi + 1], z = o.verts[3 * vi + 2];
      positions.set([x, z, -y], 3 * i);
    });
    const triColors = new Array(o.faces.length / 3).fill('#4c8bf5');
    let hasMaterial = false;
    for (const assignment of o.assignments) {
      const color = mats.get(assignment.name);
      if (!color) continue;
      for (const face of assignment.faces) if (face < triColors.length) triColors[face] = color;
      hasMaterial = true;
    }
    return { name: o.name, color: '#4c8bf5', ...(hasMaterial && { triColors }), positions };
  });
}
