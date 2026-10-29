// File import/export (JSON, 3DS, OBJ, STL, glTF), including the minimal 3DS reader/writer.
import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { outlineGeometry } from './model.js';

const $ = id => document.getElementById(id);

// --- 3DS format: minimal reader/writer (triangle meshes + diffuse colours). 3DS is Z-up, the scene is Y-up.
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
const u16 = v => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, v, true); return a; };
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
      }
      else if (id === MATERIAL) {
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
      for (const face of assignment.faces) {
        if (face < triColors.length) triColors[face] = color;
      }
      hasMaterial = true;
    }
    return { name: o.name, color: '#4c8bf5', ...(hasMaterial && { triColors }), positions };
  });
}

// --- File menu wiring

// Wires up the File menu: JSON/3DS/OBJ/STL/glTF export and import.
// ctx: { boxes (live array of meshes), addBox, applyColors, clearAll, commit, baseHex, round }
export function setupIO({ renderImage, boxes, addBox, applyColors, clearAll, commit, baseHex, round, docSaved, docReset, getDocName, getGroups, setGroups }) {
  // Import / Export
  $('exp').onclick = () => {
    const objects = boxes.map(m => ({
      name: m.userData.name, position: m.position.toArray().map(round), size: m.scale.toArray().map(round),
      rotation: [m.rotation.x, m.rotation.y, m.rotation.z].map(round), color: baseHex(m), type: m.userData.type, params: m.userData.params,
      ...(m.userData.hidden && { hidden: true }), ...(m.userData.locked && { locked: true }), ...(m.userData.refGroup !== undefined && { refGroup: m.userData.refGroup }),
      ...(m.userData.custom && { positions: Array.from(m.userData.model.positions, v => Math.round(v * 1e4) / 1e4), faces: Array.from(m.userData.model.faceOfTri) }),
      ...(m.userData.model?.faceColors.size && { faceColors: [...m.userData.model.faceColors] })
    }));
    const data = { format: 'scene', objects, selectionGroups: getGroups() };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), getDocName() || 'scene.json').then(name => name && docSaved(name));
  };
  // In the Tauri desktop app a native save dialog is used (WebView downloads are unreliable); in the browser a normal download
  // Resolves to the saved file name (null if cancelled)
  async function download(blob, name) {
    const tauri = window.__TAURI__;
    if (tauri?.dialog && tauri?.fs) {
      const path = await tauri.dialog.save({ defaultPath: name });
      if (!path) return null;
      await tauri.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      return path.split(/[\\/]/).pop();
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    return name;
  }
  // Scene with transforms baked in, without outline lines (for OBJ/STL/glTF)
  function bakedScene() {
    const g = new THREE.Group();
    boxes.forEach((m, i) => {
      m.updateMatrixWorld(true);
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: m.material.color.clone(), roughness: 0.6, vertexColors: m.material.vertexColors }));
      mesh.name = m.userData.name;
      g.add(mesh);
    });
    return g;
  }
  function disposeBaked(g) { g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }

  async function exportAs(fmt) {
    if (!boxes.length) { alert('The scene is empty'); return; }
    try {
      if (fmt === 'png') {
        download(await renderImage(), 'scene.png');
        return;
      }
      if (fmt === '3ds') {
        const objs = boxes.map((m, i) => {
          m.updateMatrixWorld(true);
          const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
          const pos = g.getAttribute('position'), colors = g.getAttribute('color');
          const out = new Float32Array(pos.count * 3), v = new THREE.Vector3();
          const triColors = m.material.vertexColors && colors
            ? Array.from({ length: pos.count / 3 }, (_, t) => {
              const c = new THREE.Color().setRGB(colors.getX(3 * t), colors.getY(3 * t), colors.getZ(3 * t));
              return '#' + c.getHexString();
            })
            : undefined;
          for (let k = 0; k < pos.count; k++) v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld).toArray(out, 3 * k);
          if (g !== m.geometry) g.dispose();
          return { name: m.userData.name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10), color: baseHex(m), triColors, positions: out };
        });
        download(new Blob([write3ds(objs)], { type: 'application/octet-stream' }), 'szene.3ds');
        return;
      }
      const g = bakedScene();
      try {
        if (fmt === 'obj') download(new Blob([new OBJExporter().parse(g)], { type: 'text/plain' }), 'szene.obj');
        else if (fmt === 'stl') download(new Blob([new STLExporter().parse(g, { binary: true })], { type: 'model/stl' }), 'szene.stl');
        else if (fmt === 'glb') {
          const buf = await new Promise((res, rej) => new GLTFExporter().parse(g, res, rej, { binary: true }));
          download(new Blob([buf], { type: 'model/gltf-binary' }), 'szene.glb');
        }
      } finally { disposeBaked(g); }
    } catch (err) { alert(err.message || 'Export failed'); }
  }
  document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => exportAs(b.dataset.exp));

  // Imported meshes -> editable objects (centre becomes the origin)
  function addImported(list) {
    if (!list.length) throw new Error('No objects found');
    clearAll();
    for (const o of list) {
      const box = new THREE.Box3(), v = new THREE.Vector3();
      for (let i = 0; i < o.positions.length; i += 3) box.expandByPoint(v.fromArray(o.positions, i));
      const c = box.getCenter(new THREE.Vector3());
      for (let i = 0; i < o.positions.length; i += 3) { o.positions[i] -= c.x; o.positions[i + 1] -= c.y; o.positions[i + 2] -= c.z; }
      let color = o.color, faceColors;
      if (o.triColors) {
        // Most frequent triangle colour becomes the object colour, the rest become per-face colours
        const count = new Map();
        o.triColors.forEach(h => count.set(h, (count.get(h) || 0) + 1));
        color = [...count].sort((a, b) => b[1] - a[1])[0][0];
        if (count.size > 1) faceColors = o.triColors;
      }
      const mesh = addBox({ position: c, size: new THREE.Vector3(1, 1, 1), color, positions: o.positions, name: o.name });
      if (faceColors) {
        const model = mesh.userData.model, map = new Map(), faceIds = model.faceOfTri.slice(), faceByColor = new Map();
        let nextFace = 0;
        for (let t = 0; t < model.nTri; t++) {
          const colorKey = faceColors[t] ?? color, key = `${faceIds[t]}:${colorKey}`;
          if (!faceByColor.has(key)) faceByColor.set(key, nextFace++);
          const f = faceByColor.get(key);
          model.faceOfTri[t] = f;
          if (colorKey !== color) map.set(f, colorKey);
        }
        model.faceColors = map;
        model.buildFacesAndEdges();
        const outline = mesh.userData.outline;
        outline.geometry.dispose();
        outline.geometry = outlineGeometry(mesh.geometry, model);
        applyColors(mesh);
      }
    }
    commit();
    docReset();
  }
  function meshesOf(root) {
    root.updateMatrixWorld(true);
    const list = [];
    root.traverse(o => {
      if (!o.isMesh || !o.geometry.getAttribute('position')) return;
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      const pos = g.getAttribute('position'), vertexColors = g.getAttribute('color');
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      const fallback = new THREE.Color('#4c8bf5');
      const materialForTri = new Uint32Array(pos.count / 3);
      for (const group of g.groups) {
        const end = Math.min(group.start + group.count, pos.count);
        for (let i = group.start; i + 2 < end; i += 3) materialForTri[Math.floor(i / 3)] = group.materialIndex;
      }
      const samplers = new Map();
      const textureSampler = texture => {
        if (!texture?.image) return null;
        if (samplers.has(texture)) return samplers.get(texture);
        const image = texture.image, width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
        if (!width || !height) return null;
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not read an imported texture');
        context.drawImage(image, 0, 0, width, height);
        const sampler = { data: context.getImageData(0, 0, width, height).data, width, height, uv: new THREE.Vector2() };
        texture.updateMatrix();
        samplers.set(texture, sampler);
        return sampler;
      };
      const sampleTexture = (texture, tri) => {
        const sampler = textureSampler(texture);
        const uv = g.getAttribute(texture?.channel ? `uv${texture.channel}` : 'uv');
        if (!sampler || !uv) return null;
        sampler.uv.set(
          (uv.getX(3 * tri) + uv.getX(3 * tri + 1) + uv.getX(3 * tri + 2)) / 3,
          (uv.getY(3 * tri) + uv.getY(3 * tri + 1) + uv.getY(3 * tri + 2)) / 3
        );
        texture.transformUv(sampler.uv);
        const x = Math.min(sampler.width - 1, Math.max(0, Math.floor(sampler.uv.x * sampler.width)));
        const yUv = texture.flipY ? 1 - sampler.uv.y : sampler.uv.y;
        const y = Math.min(sampler.height - 1, Math.max(0, Math.floor(yUv * sampler.height)));
        const offset = 4 * (y * sampler.width + x);
        return sampler.data.subarray(offset, offset + 4);
      };
      const entry = {
        name: o.name, color: '#' + (materials[0]?.color ?? fallback).getHexString(),
        positions: Float32Array.from(pos.array), triColors: []
      };
      for (let tri = 0; tri < materialForTri.length; tri++) {
        const material = materials[materialForTri[tri]] ?? materials[0];
        const color = material?.color?.clone() ?? fallback.clone();
        const textureColor = sampleTexture(material?.map, tri);
        if (textureColor) {
          color.multiply(new THREE.Color().setRGB(textureColor[0] / 255, textureColor[1] / 255, textureColor[2] / 255, THREE.SRGBColorSpace));
        }
        if (vertexColors && vertexColors.count === pos.count) {
          const vertexColor = new THREE.Color();
          vertexColor.setRGB(
            (vertexColors.getX(3 * tri) + vertexColors.getX(3 * tri + 1) + vertexColors.getX(3 * tri + 2)) / 3,
            (vertexColors.getY(3 * tri) + vertexColors.getY(3 * tri + 1) + vertexColors.getY(3 * tri + 2)) / 3,
            (vertexColors.getZ(3 * tri) + vertexColors.getZ(3 * tri + 1) + vertexColors.getZ(3 * tri + 2)) / 3
          );
          color.multiply(vertexColor);
        }
        entry.triColors.push('#' + color.getHexString());
      }
      list.push(entry);
      g.dispose();
    });
    return list;
  }
  document.querySelectorAll('[data-imp]').forEach(b => b.onclick = () => { $('file').accept = b.dataset.imp; $('file').click(); });
  $('file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      if (ext === '3ds') addImported(parse3ds(await f.arrayBuffer()));
      else if (ext === 'obj') addImported(meshesOf(new OBJLoader().parse(await f.text())));
      else if (ext === 'stl') {
        const geo = new STLLoader().parse(await f.arrayBuffer());
        addImported(meshesOf(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#4c8bf5' }))));
      } else if (ext === 'glb' || ext === 'gltf') {
        const data = ext === 'glb' ? await f.arrayBuffer() : await f.text();
        const gltf = await new Promise((res, rej) => new GLTFLoader().parse(data, '', res, rej));
        addImported(meshesOf(gltf.scene));
      } else {
        const parsed = JSON.parse(await f.text());
        // Older files are a plain array of objects
        const data = Array.isArray(parsed) ? parsed : parsed.objects;
        clearAll();
        setGroups(Array.isArray(parsed) ? null : parsed.selectionGroups);
        for (const b of data) addBox({ position: new THREE.Vector3(...b.position), size: new THREE.Vector3(...b.size),
          color: b.color, rotation: b.rotation, type: b.type, params: b.params, positions: b.positions, faces: b.faces, faceColors: b.faceColors, name: b.name, hidden: b.hidden, locked: b.locked, refGroup: b.refGroup });
        commit();
        docSaved(f.name);
      }
    } catch (err) { alert('Import failed: ' + (err.message || 'Invalid file')); }
    e.target.value = '';
  };
}
