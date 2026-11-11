// File import/export (JSON, 3DS, OBJ, STL, glTF), including the minimal 3DS reader/writer.
import * as THREE from 'three';
import { outlineGeometry } from './model.js';
import { runWorkerTask, withWaitCursor } from './worker-client.js';

export { parse3ds, write3ds } from './tools/three-ds.js';

const $ = id => document.getElementById(id);

// --- File menu wiring

// Wires up the File menu: JSON/3DS/OBJ/STL/glTF export and import.
// ctx: { boxes (live array of meshes), addBox, applyColors, clearAll, commit, baseHex, round }
export function setupIO({ renderImage, boxes, addBox, applyColors, clearAll, commit, baseHex, round, docSaved, docReset, getDocName, getGroups, setGroups }) {
  // Import / Export
  $('exp').onclick = () => withWaitCursor(async () => {
    const objects = boxes.map(m => ({
      name: m.userData.name, position: m.position.toArray().map(round), size: m.scale.toArray().map(round),
      rotation: [m.rotation.x, m.rotation.y, m.rotation.z].map(round), color: baseHex(m), type: m.userData.type, params: m.userData.params,
      ...(m.userData.hidden && { hidden: true }), ...(m.userData.locked && { locked: true }), ...(m.userData.refGroup !== undefined && { refGroup: m.userData.refGroup }),
      ...(m.userData.custom && { positions: m.userData.model.positions.slice(), faces: m.userData.model.faceOfTri.slice() }),
      ...(m.userData.model?.faceColors.size && { faceColors: [...m.userData.model.faceColors] })
    }));
    const data = { format: 'scene', objects, selectionGroups: getGroups() };
    const transfer = objects.flatMap(object => object.positions instanceof Float32Array
      ? [object.positions.buffer, object.faces.buffer]
      : []);
    const text = await runWorkerTask('stringify-json', data, transfer);
    const name = await download(new Blob([text], { type: 'application/json' }), getDocName() || 'scene.json');
    if (name) docSaved(name);
  }).catch(err => alert(err.message || 'Save failed'));
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
  function exportMeshes() {
    return boxes.map(m => {
      m.updateMatrixWorld(true);
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const position = g.getAttribute('position');
      const vertexColors = !!m.material.vertexColors && !!g.getAttribute('color');
      const positions = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        positions[3 * i] = position.getX(i);
        positions[3 * i + 1] = position.getY(i);
        positions[3 * i + 2] = position.getZ(i);
      }
      const attributes = {};
      for (const name of ['normal', 'uv', 'uv1', 'tangent', ...(vertexColors ? ['color'] : [])]) {
        const attribute = g.getAttribute(name);
        if (!attribute) continue;
        const values = new Float32Array(attribute.count * attribute.itemSize);
        const getters = ['getX', 'getY', 'getZ', 'getW'];
        for (let i = 0; i < attribute.count; i++) {
          for (let component = 0; component < attribute.itemSize; component++) {
            values[i * attribute.itemSize + component] = attribute[getters[component]](i);
          }
        }
        attributes[name] = { array: values, itemSize: attribute.itemSize };
      }
      const object = {
        name: m.userData.name, color: '#' + m.material.color.getHexString(), vertexColors,
        positions, matrix: m.matrixWorld.toArray(),
        attributes
      };
      if (g !== m.geometry) g.dispose();
      return object;
    });
  }

  async function exportAs(fmt) {
    if (!boxes.length) { alert('The scene is empty'); return; }
    try {
      if (fmt === 'png') {
        await download(await renderImage(), 'scene.png');
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
        const data = await runWorkerTask('write-3ds', objs, objs.map(o => o.positions.buffer));
        await download(new Blob([data], { type: 'application/octet-stream' }), 'szene.3ds');
        return;
      }
      const objects = exportMeshes();
      const data = await runWorkerTask('export-mesh', { format: fmt, objects },
        objects.flatMap(object => [object.positions.buffer, ...Object.values(object.attributes).map(attribute => attribute.array.buffer)]));
      const type = fmt === 'obj' ? 'text/plain' : fmt === 'stl' ? 'model/stl' : 'model/gltf-binary';
      const name = fmt === 'obj' ? 'szene.obj' : fmt === 'stl' ? 'szene.stl' : 'szene.glb';
      await download(new Blob([data], { type }), name);
    } catch (err) { alert(err.message || 'Export failed'); }
  }
  document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => withWaitCursor(() => exportAs(b.dataset.exp)).catch(err => alert(err.message || 'Export failed')));

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
  document.querySelectorAll('[data-imp]').forEach(b => b.onclick = () => { $('file').accept = b.dataset.imp; $('file').click(); });
  $('file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await withWaitCursor(async () => {
        const ext = f.name.split('.').pop().toLowerCase();
        if (ext === '3ds') {
          const data = await f.arrayBuffer();
          addImported(await runWorkerTask('parse-3ds', data, [data]));
        }
        else if (ext === 'obj') addImported(await runWorkerTask('import-obj', await f.text()));
        else if (ext === 'stl') {
          const data = await f.arrayBuffer();
          addImported(await runWorkerTask('import-stl', data, [data]));
        } else if (ext === 'glb' || ext === 'gltf') {
          const data = ext === 'glb' ? await f.arrayBuffer() : await f.text();
          const transfer = data instanceof ArrayBuffer ? [data] : [];
          addImported(await runWorkerTask('import-gltf', { data, resourcePath: new URL('.', location.href).href }, transfer));
        } else {
          const parsed = await runWorkerTask('parse-json', await f.text());
          // Older files are a plain array of objects
          const data = Array.isArray(parsed) ? parsed : parsed.objects;
          clearAll();
          setGroups(Array.isArray(parsed) ? null : parsed.selectionGroups);
          for (const b of data) addBox({ position: new THREE.Vector3(...b.position), size: new THREE.Vector3(...b.size),
            color: b.color, rotation: b.rotation, type: b.type, params: b.params, positions: b.positions, faces: b.faces, faceColors: b.faceColors, name: b.name, hidden: b.hidden, locked: b.locked, refGroup: b.refGroup });
          commit();
          docSaved(f.name);
        }
      });
    } catch (err) { alert('Import failed: ' + (err.message || 'Invalid file')); }
    e.target.value = '';
  };
}
