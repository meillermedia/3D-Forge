// App entry point: wires scene, toolbar, panels, object list, undo/redo and navigation together.
// Related modules: stage.js (3D stage), io.js (file import/export), shapes.js (primitives),
// subedit.js (vertex/edge/face editor).
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { rectPolygon, circlePolygon, pointIn, shapeHit } from './tools/region.js';
import { SubObjectEditor, applySelectOp, createGeometry, applyColors, outlineGeometry } from './edit/editor.js';
import { createStage } from './stage.js';
import { booleanOp, fillHoles } from './tools/csg.js';
import { Lattice } from './tools/lattice.js';
import { registerWebMCP } from './webmcp.js';
import { Model, nonIndexedPositions as nonIdx, edgeKey } from './model.js';
import { nonIndexedPositions } from './model.js';
import { remesh, skinOnly } from './tools/remesh.js';
import { setupIO } from './io.js';
import { setupShortcuts } from './shortcuts.js';
import { SHAPES, defaultParams, normalizeParams, buildShape } from './shapes.js';
import { setupNavGizmo } from './navgizmo.js';
import { setupNumberScrub } from './numscrub.js';
import { isTauri } from './nativemenu.js';

const $ = id => document.getElementById(id);
const container = $('view');

const { scene, camera, renderer, orbit, ground, resize, setZoomCenter, setRotateBlocked, navigate } = createStage(container);

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSpace('local');
scene.add(gizmo);
const editor = new SubObjectEditor({ camera, dom: renderer.domElement, gizmo, scene, snap: v => snapV(v) });
let clipboard = [], pasteCount = 0;
editor.extrudeOffset = () => { const v = parseFloat($('addOffset').value); return isFinite(v) ? v : 0.5; };
editor.onSelectionChange = () => { updateToolbar(); syncGizmoForModifier(); };
editor.onMessage = msg => { $('status').textContent = msg; setTimeout(() => { $('status').textContent = `${boxes.length} objects`; }, 2500); };
gizmo.addEventListener('dragging-changed', e => orbit.enabled = !e.value);
gizmo.addEventListener('objectChange', () => {
  if (gizmo.object === latticeProxy && lattice) { lattice.setPointWorld(latticeSel, latticeProxy.position); return; }
  if (editor.active) return; applySnapToSelection(); syncPanel(); });

const boxes = [];
let selected = null; // primary object (last selected)
let selection = []; // all selected objects
let mode = 'place';
let shape = 'box';

// Grid 0 = off (continuous movement)
function snapV(v) { const s = +$('snap').value; return s > 0 ? Math.round(v / s) * s : v; }
const baseHex = m => '#' + m.userData.baseColor.getHexString();
const round = v => Math.round(v * 1000) / 1000;

function uniqueName(base) {
  const used = new Set(boxes.map(b => b.userData.name));
  if (base && !used.has(base)) return base;
  base = (base || '').replace(/ \d+$/, '') || 'Object';
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

function addBox({ position, size, color, rotation, type = 'box', params, positions, faces, faceColors, name, hidden, locked, refGroup }) {
  if (!SHAPES[type]) type = 'box';
  params = normalizeParams(type, params);
  let geo, edges, model = null;
  if (positions) {
    ({ geometry: geo, model } = createGeometry(positions, faces));
    edges = outlineGeometry(geo, model);
  } else {
    ({ geometry: geo, edges } = buildShape(type, params));
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: type === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  Object.assign(mesh.userData, { type, params, baseColor: new THREE.Color(color), name: uniqueName(name || SHAPES[type].label + ' 1') });
  if (model) {
    Object.assign(mesh.userData, { custom: true, model });
    if (faceColors) model.faceColors = new Map(faceColors);
    applyColors(mesh);
  }
  const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
  outline.userData.own = true;
  mesh.userData.outline = outline;
  mesh.add(outline);
  mesh.position.copy(position);
  if (size) mesh.scale.copy(size);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  boxes.push(mesh);
  mesh.userData.hidden = !!hidden;
  mesh.userData.locked = !!locked;
  if (refGroup !== undefined) { mesh.userData.refGroup = refGroup; nextRefGroup = Math.max(nextRefGroup, refGroup + 1); }
  mesh.userData.refKey = geoKey(mesh);
  mesh.visible = !hidden;
  if (shading !== 'standard') applyShading(mesh);
  return mesh;
}

// Shading modes: standard (translucent edges), edges (solid edges), rendered (no edges), better (glossy + environment light, no edges)
let shading = 'standard';
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

function applyShading(mesh) {
  const mat = mesh.material, ol = mesh.userData.outline;
  const better = shading === 'better';
  mat.roughness = better ? 0.3 : 0.6;
  mat.metalness = better ? 0.15 : 0;
  mat.envMapIntensity = better ? 0.8 : 1;
  mat.needsUpdate = true;
  if (ol) {
    ol.material.visible = shading === 'standard' || shading === 'edges';
    ol.material.opacity = shading === 'edges' ? 1 : 0.5;
    // Edges mode also shows the hidden edges behind faces
    ol.material.depthTest = shading !== 'edges';
    ol.renderOrder = shading === 'edges' ? 1 : 0;
    ol.material.needsUpdate = true;
    // Edges mode also shows the triangle lines, slightly lighter than the edges
    let wire = ol.userData.wire;
    if (shading === 'edges') {
      if (!wire) {
        wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x666666, depthTest: false, transparent: true, opacity: 0.8 }));
        ol.userData.wire = wire;
        ol.add(wire);
      }
      wire.geometry.dispose();
      wire.geometry = new THREE.WireframeGeometry(mesh.geometry);
    } else if (wire) {
      wire.geometry.dispose();
      ol.remove(wire);
      delete ol.userData.wire;
    }
    // Primitives normally hide smooth edges (<30°); Edges mode shows every non-coplanar edge
    if (!mesh.userData.model) {
      if (shading === 'edges') {
        if (!ol.userData.std) ol.userData.std = ol.geometry;
        ol.geometry = new THREE.EdgesGeometry(mesh.geometry, 1);
      } else if (ol.userData.std) {
        ol.geometry.dispose();
        ol.geometry = ol.userData.std;
        delete ol.userData.std;
      }
    }
  }
}

function setShading(mode) {
  shading = mode;
  scene.environment = mode === 'better' ? envMap : null;
  boxes.forEach(applyShading);
  document.querySelectorAll('[data-shading]').forEach(b => b.classList.toggle('active', b.dataset.shading === mode));
}
document.querySelectorAll('[data-shading]').forEach(b => b.addEventListener('click', () => setShading(b.dataset.shading)));

// Shape parameters (remembered per shape) and the placement preview
const shapeParams = Object.fromEntries(Object.keys(SHAPES).map(t => [t, defaultParams(t)]));
let ghostSize = new THREE.Vector3(1, 1, 1);
const ghost = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x4c8bf5, transparent: true, opacity: 0.35, depthWrite: false }));
ghost.visible = false;
scene.add(ghost);

function rebuildGhost() {
  const { geometry, size } = buildShape(shape, shapeParams[shape]);
  ghost.geometry.dispose();
  ghost.geometry = geometry;
  ghostSize = size;
}

function renderParams() {
  const def = SHAPES[shape];
  $('createTitle').textContent = 'New: ' + def.label;
  const box = $('params');
  box.replaceChildren();
  for (const f of def.fields) {
    const label = document.createElement('label');
    label.textContent = f.label;
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', value: shapeParams[shape][f.key], min: f.min, step: f.step });
    if (f.max !== undefined) input.max = f.max;
    input.addEventListener('input', () => {
      if (input.value === '' || !Number.isFinite(+input.value)) return;
      shapeParams[shape] = normalizeParams(shape, { ...shapeParams[shape], [f.key]: +input.value });
      rebuildGhost();
    });
    // Reset to the valid value when the field loses focus
    input.addEventListener('change', () => { input.value = shapeParams[shape][f.key]; });
    box.append(label, input);
  }
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

// Computes the placement position (centre) of a new object under the mouse pointer
function placementAt(e) {
  setPointer(e);
  const size = ghostSize;
  const hit = raycaster.intersectObjects([...boxes.filter(m => m.visible), ground], false)[0];
  if (!hit) return null;
  const p = new THREE.Vector3();
  if (hit.object === ground) {
    p.set(snapV(hit.point.x), size.y / 2, snapV(hit.point.z));
  } else {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const ax = ['x', 'y', 'z'].reduce((a, b) => Math.abs(n[b]) > Math.abs(n[a]) ? b : a);
    const bounds = new THREE.Box3().setFromObject(hit.object);
    p.set(snapV(hit.point.x), snapV(hit.point.y), snapV(hit.point.z));
    p[ax] = n[ax] > 0 ? bounds.max[ax] + size[ax] / 2 : bounds.min[ax] - size[ax] / 2;
  }
  return { position: p, size };
}

// Several selected objects are moved together by temporarily parenting them to a group at the selection centre
const groupPivot = new THREE.Object3D();
scene.add(groupPivot);
function selectionBox() {
  const b = new THREE.Box3();
  selection.forEach(m => b.expandByObject(m));
  return b;
}
// Frame around the selected object(s)
const selFrame = new THREE.Box3Helper(new THREE.Box3(), 0xffc233);
selFrame.material.depthTest = false;
selFrame.renderOrder = 10;
selFrame.visible = false;
scene.add(selFrame);
let modifierHeld = false;
let tool = 'translate'; // select | translate | rotate | scale; 'select' hides the gizmo
let toolBeforeModifier = null;
function syncGizmoForModifier(e) {
  if (e) modifierHeld = !!(e.shiftKey || e.ctrlKey || e.metaKey);
  // In edit mode a held modifier (multi-select) temporarily switches to the Select tool
  if (mode === 'edit' && modifierHeld && tool !== 'select' && !gizmo.dragging) {
    toolBeforeModifier = tool;
    setTool('select', true);
  } else if (toolBeforeModifier && !(mode === 'edit' && modifierHeld) && !gizmo.dragging) {
    const prev = toolBeforeModifier;
    toolBeforeModifier = null;
    setTool(prev, true);
  }
  const hide = !gizmo.object || tool === 'select' || (mode === 'edit' && modifierHeld && !gizmo.dragging);
  gizmo.enabled = !hide;
  gizmo.visible = !hide;
}
function updateSelFrame() {
  const show = selection.length > 0 && mode === 'select';
  selFrame.visible = show;
  if (!show) return;
  selFrame.box.copy(selectionBox()).expandByScalar(0.02);
}
let xformPivot = false;
const pivotProxy = new THREE.Object3D();
const latticeProxy = new THREE.Object3D();
scene.add(latticeProxy);
scene.add(pivotProxy);
function attachGizmo() {
  if (selection.some(m => !isPickable(m))) gizmo.detach();
  else if (latticeOpen) {
    if (latticeSel >= 0) {
      lattice.worldPoint(latticeSel, latticeProxy.position);
      latticeProxy.quaternion.identity();
      latticeProxy.updateMatrixWorld(true);
      gizmo.attach(latticeProxy);
    } else gizmo.detach();
  } else if (xformPivot && selection.length === 1 && !editor.active) {
    pivotProxy.position.copy(selected.position);
    pivotProxy.quaternion.copy(selected.quaternion);
    pivotProxy.scale.set(1, 1, 1);
    pivotProxy.updateMatrixWorld(true);
    gizmo.attach(pivotProxy);
  } else if (selection.length > 1) {
    groupPivot.position.copy(selectionBox().getCenter(new THREE.Vector3()));
    groupPivot.quaternion.identity();
    groupPivot.scale.set(1, 1, 1);
    groupPivot.updateMatrixWorld(true);
    gizmo.attach(groupPivot);
  } else if (selected) gizmo.attach(selected);
  else gizmo.detach();
  syncGizmoForModifier();
}
gizmo.addEventListener('dragging-changed', e => {
  if (editor.active || gizmo.object !== groupPivot) return;
  if (e.value) selection.forEach(m => groupPivot.attach(m));
  else { selection.forEach(m => scene.attach(m)); attachGizmo(); }
});

// Hidden or locked objects cannot be picked or selected
const isPickable = m => m.visible && !m.userData.locked;

// additive = toggle the object in the current selection
function select(mesh, additive = false, fromList = false) {
  if (mesh && !fromList && !isPickable(mesh)) mesh = null;
  selection.forEach(m => m.material.emissive.setHex(0x000000));
  if (additive && mesh) {
    const i = selection.indexOf(mesh);
    if (i >= 0) selection.splice(i, 1); else selection.push(mesh);
  } else selection = mesh ? [mesh] : [];
  selected = selection[selection.length - 1] ?? null;
  selection.forEach(m => m.material.emissive.setHex(0x222222));
  attachGizmo();
  updateToolbar();
  syncPanel();
}

// Keeps the existing selection order (the first selected object matters for Bool)
const keepOrder = set => [...selection.filter(o => set.has(o)), ...[...set].filter(o => !selection.includes(o))];
function setSelectionList(list, keepAll = false) {
  selection.forEach(m => m.material.emissive.setHex(0x000000));
  selection = keepAll ? list.slice() : list.filter(isPickable);
  selected = selection[selection.length - 1] ?? null;
  selection.forEach(m => m.material.emissive.setHex(0x222222));
  attachGizmo();
  updateToolbar();
  syncPanel();
}

function syncPanel() {
  if (!selected) return;
  const m = selected;
  const d = THREE.MathUtils.radToDeg;
  [['px', m.position.x], ['py', m.position.y], ['pz', m.position.z],
   ['sx', m.scale.x], ['sy', m.scale.y], ['sz', m.scale.z],
   ['rx', d(m.rotation.x)], ['ry', d(m.rotation.y)], ['rz', d(m.rotation.z)]]
    .forEach(([id, v]) => $(id).value = round(v));
  $('col').value = baseHex(m);
}

function applySnapToSelection() {
  if (!selected) return;
  const m = gizmo.object;
  if (gizmo.mode === 'translate') m.position.set(snapV(m.position.x), snapV(m.position.y), snapV(m.position.z));
}

let pivotBeforeEdit = null;
let selectionBeforePlace = [];
function setMode(m) {
  if (m === 'edit' && (selection.length !== 1 || !isPickable(selection[0]))) return;
  if (mode === 'edit' && m !== 'edit') {
    editor.exit();
    if (shading === 'edges') boxes.forEach(applyShading);
    attachGizmo();
    if (pivotBeforeEdit) setPivotMode(pivotBeforeEdit);
    pivotBeforeEdit = null;
  }
  if (mode === 'poly' && m !== 'poly') polyReset();
  const wasPlace = mode === 'place';
  if (m === 'place' && !wasPlace) selectionBeforePlace = selection.slice();
  mode = m;
  if (wasPlace && m === 'select') {
    const prev = selectionBeforePlace.filter(b => boxes.includes(b));
    selectionBeforePlace = [];
    if (!selection.length) prev.forEach(b => select(b, true));
  }
  if (m === 'edit') {
    gizmo.detach();
    editor.enter(selected);
    pivotBeforeEdit = pivotMode;
    setPivotMode('selection');
  }
  const creating = m === 'place' || m === 'poly';
  $('mCreate').classList.toggle('active', creating);
  $('secCreate').hidden = !creating;
  $('secSel').hidden = creating;
  $('gCreate').classList.toggle('open', creating);
  document.querySelectorAll('[data-shape]').forEach(b => b.classList.toggle('active', m === 'place' && b.dataset.shape === shape));
  if (m === 'place' || m === 'poly') select(null);
  if (m !== 'place') ghost.visible = false;
  if (m === 'poly') $('status').textContent = 'Polygon: click points, Enter or click the first point closes, Backspace removes, Esc cancels';
  updateToolbar();
}
function setSub(kind) {
  document.querySelectorAll('[data-sub]').forEach(b => b.classList.toggle('active', b.dataset.sub === kind));
  if (mode === 'edit') editor.setKind(kind); else editor.kind = kind;
  updateToolbar();
}
const ADD_TITLES = { vertex: 'Add vertex: click in the view', edge: 'Connect two selected points with a new edge', face: 'Extrude selected faces' };
const DEL_TITLES = { vertex: 'Remove selected vertices', edge: 'Remove selected edges / merge faces', face: 'Delete selected faces' };
function subAdd() { if (mode !== 'edit' || !editor.canAdd()) return; editor.add(); commit(); updateToolbar(); }
function subDel() { if (mode !== 'edit' || !editor.canRemove()) return; editor.remove(); commit(); updateToolbar(); }
function subChamfer() {
  if (mode !== 'edit' || !editor.canChamfer()) return;
  if (editor.chamferEdges(parseFloat($('chamferW').value))) commit();
  updateToolbar();
}
function subDivide() {
  if (mode !== 'edit' || !editor.canSubdivide()) return;
  if (editor.subdivide()) commit();
  updateToolbar();
}
$('subDivide').onclick = subDivide;
$('subChamfer').onclick = subChamfer;
$('subAdd').onclick = subAdd;
$('subDel').onclick = subDel;
document.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => setSub(b.dataset.sub));
$('mEdit').onclick = () => setMode(mode === 'edit' ? 'select' : 'edit');
function setShape(t) {
  shape = t;
  renderParams();
  rebuildGhost();
  setMode('place');
}
document.querySelectorAll('[data-shape]').forEach(b => b.onclick = () => setShape(b.dataset.shape));
$('mSelect').onclick = selectTool;
// Tools flyout: toggled by its button, closed by clicking elsewhere
$('mTools').onclick = e => {
  e.stopPropagation();
  if (mode === 'place') setMode('select');
  $('gTools').classList.toggle('open');
};
document.addEventListener('click', e => { if (!e.target.closest('#gTools')) $('gTools').classList.remove('open'); });
$('mCreate').onclick = () => (mode === 'place' ? setMode('select') : setShape(shape));
function updateToolbar() {
  const editing = mode === 'edit';
  for (const id of ['tMove', 'tRot', 'tScale']) $(id).disabled = !selected;
  for (const id of ['dup', 'del', 'cut', 'copy', 'cloneRef']) $(id).disabled = !selected || editing;
  $('paste').disabled = !clipboard.length || editing;
  $('mEdit').disabled = selection.length !== 1;
  $('polyBtn').classList.toggle('active', mode === 'poly');
  $('mTools').disabled = !selection.length;
  if (!selection.length) $('gTools').classList.remove('open');
  if (!canBool()) boolOpen = false;
  $('bool').disabled = !canBool();
  $('bool').classList.toggle('active', boolOpen);
  $('boolRow').hidden = !boolOpen;
  if (!canMerge()) mergeOpen = false;
  $('mergeBtn').disabled = !canMerge();
  $('mergeBtn').classList.toggle('active', mergeOpen);
  $('mergeRow').hidden = !mergeOpen;
  if (latticeOpen && (selection.length !== 1 || selected !== lattice?.mesh || editing)) closeLattice();
  $('latticeBtn').disabled = selection.length !== 1 || editing;
  $('latticeBtn').classList.toggle('active', latticeOpen);
  $('latticeRow').hidden = !latticeOpen;
  document.querySelectorAll('[data-latdiv]').forEach(b => b.classList.toggle('active', +b.dataset.latdiv === latticeDiv));
  if (!canSmooth()) remeshOpen = false;
  $('remeshBtn').disabled = !canSmooth();
  $('flipBtn').disabled = !canSmooth();
  $('remeshBtn').classList.toggle('active', remeshOpen);
  $('remeshRow').hidden = !remeshOpen;
  if (!canSmooth()) arrayOpen = false;
  $('arrayBtn').disabled = !canSmooth();
  $('arrayBtn').classList.toggle('active', arrayOpen);
  $('arrayRow').hidden = !arrayOpen;
  if (!canSmooth()) smoothOpen = false;
  $('smooth').disabled = !canSmooth();
  $('closeHoles').disabled = !canSmooth();
  $('smooth').classList.toggle('active', smoothOpen);
  $('smoothRow').hidden = !smoothOpen;
  if (boolOpen) $('boolInfo').textContent = `A = ${selection[0].userData.name}, B = ${selection[1].userData.name} (A = first selected)`;
  $('secSelTool').hidden = !(tool === 'select' && (mode === 'select' || mode === 'edit'));
  refreshGroupList();
  if (xformPivot && (selection.length !== 1 || editing)) { xformPivot = false; $('xformPivot').classList.remove('active'); }
  $('alignPivot').hidden = !editing;
  $('alignPivot').disabled = !editing || editor.selCount() !== 1;
  $('xformPivot').hidden = editing;
  $('xformPivot').disabled = selection.length !== 1;
  $('selLoopRow').hidden = !(editing && editor.kind === 'edge');
  editor.loopMode = $('selLoop').checked;
  $('mEdit').classList.toggle('active', editing);
  $('gEdit').classList.toggle('open', editing);
  document.querySelectorAll('[data-sub]').forEach(b => b.disabled = !editing);
  $('subAdd').disabled = !editing || !editor.canAdd();
  $('subDel').disabled = !editing || !editor.canRemove();
  $('subDivide').disabled = !editing || !editor.canSubdivide();
  $('subChamfer').hidden = !editing || editor.kind !== 'edge';
  $('chamferRow').hidden = $('subChamfer').hidden;
  $('offsetRow').hidden = !editing || editor.kind !== 'face';
  $('subChamfer').disabled = !editing || !editor.canChamfer();
  $('subAdd').classList.toggle('active', editing && (editor.addMode || editor.connectMode));
  $('subAdd').dataset.tip = ADD_TITLES[editor.kind];
  $('subDel').dataset.tip = DEL_TITLES[editor.kind];
  $('props').classList.toggle('disabled', !selected);
  $('props').classList.toggle('multi', selection.length > 1 && !editing);
  if (!editing) { $('lblS').textContent = 'Scale'; $('lblR').textContent = 'Rot °'; }
}

let selectOp = 'set';
function setSelectOp(op) {
  selectOp = op;
  document.querySelectorAll('[data-selop]').forEach(b => b.classList.toggle('active', b.dataset.selop === op));
}
document.querySelectorAll('[data-selop]').forEach(b => b.onclick = () => setSelectOp(b.dataset.selop));
setSelectOp('set');
$('selLoop').addEventListener('change', () => { editor.loopMode = $('selLoop').checked; });

// Named selection groups. Objects are stored by name; edit-mode groups per object name and sub-object kind.
const objGroups = new Map();
const editGroups = new Map();
const groupMap = (create = false) => {
  if (mode !== 'edit') return objGroups;
  const k = editor.mesh.userData.name + '|' + editor.kind;
  if (!editGroups.has(k) && create) editGroups.set(k, new Map());
  return editGroups.get(k);
};
const editSet = () => (editor.kind === 'vertex' ? editor.selV : editor.kind === 'edge' ? editor.selE : editor.selF);
let groupListKey = '';
function refreshGroupList(force = false) {
  const sel = $('selGroupList');
  const names = mode === 'edit' && !editor.mesh ? [] : [...(groupMap()?.keys() ?? [])];
  const key = (mode === 'edit' ? editor.mesh?.userData.name + editor.kind : 'obj') + '\n' + names.join('\n');
  const has = names.length > 0;
  $('selGroupApply').disabled = $('selGroupDel').disabled = !has;
  if (!force && key === groupListKey) return;
  groupListKey = key;
  const cur = sel.value;
  sel.innerHTML = '';
  for (const n of names) sel.add(new Option(n, n));
  if (!has) sel.add(new Option('(no groups)', ''));
  if (names.includes(cur)) sel.value = cur;
}
$('selGroupSave').onclick = () => {
  const name = $('selGroupName').value.trim();
  const list = mode === 'edit' ? [...editSet()] : selection.map(m => m.userData.name);
  if (!name) { $('status').textContent = 'Enter a group name first'; return; }
  if (!list.length) { $('status').textContent = 'Nothing selected'; return; }
  groupMap(true).set(name, list);
  refreshGroupList(true);
  $('selGroupList').value = name;
  $('selGroupName').value = '';
  $('status').textContent = `Group "${name}" saved (${list.length})`;
};
$('selGroupName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('selGroupSave').click(); } });
$('selGroupApply').onclick = () => {
  const name = $('selGroupList').value, g = groupMap()?.get(name);
  if (!g) return;
  if (mode === 'edit') {
    const m = editor.model;
    const ok = { vertex: i => i < m.nVerts, edge: k => m.edgeByKey.has(k), face: f => m.faces.has(f) }[editor.kind];
    if (selectOp === 'set') { editor.selV.clear(); editor.selE.clear(); editor.selF.clear(); }
    applySelectOp(editSet(), new Set(g.filter(ok)), selectOp);
    editor.refreshSelection();
  } else {
    const hits = new Set(boxes.filter(b => g.includes(b.userData.name)));
    const cur = new Set(selection);
    applySelectOp(cur, hits, selectOp);
    setSelectionList(keepOrder(cur), true);
  }
};
$('selGroupList').onchange = () => $('selGroupApply').click();
$('selGroupDel').onclick = () => {
  const g = groupMap(), name = $('selGroupList').value;
  if (g?.delete(name)) { refreshGroupList(true); $('status').textContent = `Group "${name}" deleted`; }
};
editor.onRebuild = () => {
  const n = editor.mesh.userData.name + '|';
  for (const k of [...editGroups.keys()]) if (k.startsWith(n)) editGroups.delete(k);
};
function renameGroups(from, to) {
  for (const [k, v] of [...editGroups]) if (k.startsWith(from + '|')) { editGroups.delete(k); editGroups.set(to + k.slice(from.length), v); }
  for (const g of objGroups.values()) g.forEach((n, i) => { if (n === from) g[i] = to; });
}
$('alignPivot').onclick = () => {
  if (!editor.active || editor.selCount() !== 1) return;
  if (editor.alignPivotToSelection($('pivotPos').checked, $('pivotRot').checked)) { commit(); $('status').textContent = 'Pivot aligned'; }
};

// Object mode: the gizmo works on a proxy; on release the pivot of the object follows and the shape stays in place
function setXformPivot(on) {
  xformPivot = on && mode !== 'edit' && selection.length === 1;
  $('xformPivot').classList.toggle('active', xformPivot);
  if (xformPivot) {
    if (tool === 'select' || tool === 'scale') setTool('translate');
    $('status').textContent = 'Transform pivot: move / rotate the gizmo, the shape stays in place';
  }
  attachGizmo();
}
$('xformPivot').onclick = () => setXformPivot(!xformPivot);
gizmo.addEventListener('dragging-changed', e => {
  if (e.value || !xformPivot || gizmo.object !== pivotProxy || !selected) return;
  editor.setObjectPivot(selected,
    $('pivotPos').checked ? pivotProxy.position : selected.position,
    $('pivotRot').checked ? pivotProxy.quaternion : selected.quaternion);
  if (shading === 'edges') applyShading(selected);
  attachGizmo();
  syncPanel();
});
let selShape = 'rect';
function setSelShape(s) {
  selShape = s;
  document.querySelectorAll('[data-selshape]').forEach(b => b.classList.toggle('active', b.dataset.selshape === s));
}
document.querySelectorAll('[data-selshape]').forEach(b => b.onclick = () => setSelShape(b.dataset.selshape));
setSelShape('rect');
const SVGNS = 'http://www.w3.org/2000/svg';
const selBox = document.createElementNS(SVGNS, 'svg');
selBox.id = 'selBox';
const selPoly = document.createElementNS(SVGNS, 'polygon');
selBox.appendChild(selPoly);
renderer.domElement.parentElement.appendChild(selBox);

function setTool(t, temporary = false) {
  if (!temporary) toolBeforeModifier = null;
  tool = t;
  if (t !== 'select') gizmo.setMode(t);
  $('mSelect').classList.toggle('active', t === 'select');
  $('secSelTool').hidden = !(t === 'select' && (mode === 'select' || mode === 'edit'));
  $('tMove').classList.toggle('active', t === 'translate');
  $('tRot').classList.toggle('active', t === 'rotate');
  $('tScale').classList.toggle('active', t === 'scale');
  syncGizmoForModifier();
}
function selectTool() { if (mode !== 'edit') setMode('select'); setTool('select'); }
$('tMove').onclick = () => setTool('translate');
$('tRot').onclick = () => setTool('rotate');
$('tScale').onclick = () => setTool('scale');

function setSpace(s) {
  gizmo.setSpace(s);
  $('spaceLbl').textContent = s === 'local' ? 'Local' : 'Global';
  $('tSpace').classList.toggle('active', s === 'local');
  if (editor.active) editor.updatePivot();
}
$('tSpace').onclick = () => setSpace(gizmo.space === 'local' ? 'world' : 'local');

// Colour of the selected faces
$('fcol').addEventListener('input', () => { editor.setFaceColor($('fcol').value); fcolKey = ''; });
$('fcol').addEventListener('change', commit);
$('fcolReset').onclick = () => { editor.resetFaceColor(); fcolKey = ''; commit(); };

// Input fields -> selection
function editFieldsChanged(id) {
  const g = p => [+$(p + 'x').value || 0, +$(p + 'y').value || 0, +$(p + 'z').value || 0];
  const ok = id[0] === 'p' ? editor.applyPanel({ pos: g('p') })
    : id[0] === 's' ? editor.applyPanel({ scale: g('s').map(v => Math.max(0.01, v)) })
    : editor.applyPanel({ rot: g('r') });
  if (ok) { syncEditPanel(true); updateToolbar(); }
}
for (const id of ['px', 'py', 'pz', 'sx', 'sy', 'sz', 'rx', 'ry', 'rz']) {
  $(id).addEventListener('change', () => { if (editor.active) editFieldsChanged(id); });
}
// In edit mode the panel shows the centre (world), scale 1 and rotation 0 of the sub-object selection
document.querySelectorAll('[data-mirror]').forEach(c => c.onchange = () => editor.setMirror(c.dataset.mirror, c.checked));
let fcolKey = '';
function syncEditPanel(force) {
  $('mirrorRow').hidden = !editor.active;
  if (!editor.active) { $('faceColRow').hidden = true; return; }
  const has = editor.hasSelection() && editor.gizmo.object === editor.pivot;
  $('props').classList.toggle('disabled', !has);
  $('lblS').textContent = 'Scale ×'; $('lblR').textContent = 'Rotate °';
  const showFc = editor.kind === 'face' && editor.hasSelection();
  $('faceColRow').hidden = !showFc;
  const fkey = showFc ? [...editor.selF].join(',') + '|' + editor.model.faceColors.size : '';
  if (showFc && fkey !== fcolKey) { fcolKey = fkey; $('fcol').value = editor.selectedFaceColor(); }
  if (!showFc) fcolKey = '';
  if (!has) return;
  const a = document.activeElement;
  if (!force && a && a.closest && a.closest('#props') && a.tagName === 'INPUT') return;
  const p = editor.center;
  [['px', p.x], ['py', p.y], ['pz', p.z], ['sx', 1], ['sy', 1], ['sz', 1], ['rx', 0], ['ry', 0], ['rz', 0]]
    .forEach(([id, v]) => $(id).value = round(v));
}
for (const id of ['px', 'py', 'pz', 'sx', 'sy', 'sz', 'rx', 'ry', 'rz']) {
  $(id).addEventListener('input', () => {
    if (!selected || editor.active || selection.length > 1) return;
    const v = id => +$(id).value || 0;
    const r = THREE.MathUtils.degToRad;
    if (xformPivot && (id[0] === 'p' || id[0] === 'r')) {
      const pos = new THREE.Vector3(v('px'), v('py'), v('pz'));
      const rot = new THREE.Euler(r(v('rx')), r(v('ry')), r(v('rz')), selected.rotation.order);
      editor.setObjectPivot(selected,
        id[0] === 'p' ? pos : selected.position,
        id[0] === 'r' ? new THREE.Quaternion().setFromEuler(rot) : selected.quaternion);
      if (shading === 'edges') applyShading(selected);
      attachGizmo();
      return;
    }
    selected.position.set(v('px'), v('py'), v('pz'));
    selected.scale.set(Math.max(0.01, v('sx')), Math.max(0.01, v('sy')), Math.max(0.01, v('sz')));
    selected.rotation.set(r(v('rx')), r(v('ry')), r(v('rz')));
  });
}
$('col').addEventListener('input', () => {
  if (!selected) return;
  for (const m of selection) { m.userData.baseColor.set($('col').value); applyColors(m); }
});
$('ncol').addEventListener('input', () => ghost.material.color.set($('ncol').value));

function disposeMesh(m) {
  scene.remove(m);
  m.material.dispose();
  m.geometry.dispose();
  m.userData.outline.geometry.dispose();
}
function deleteSelected() {
  if (!selected || mode === 'edit') return;
  const doomed = selection.slice();
  select(null);
  for (const m of doomed) { boxes.splice(boxes.indexOf(m), 1); disposeMesh(m); }
  commit();
}
// References: objects sharing a refGroup id keep identical geometry; an edit of any member is copied to the others on commit
var nextRefGroup = 1;
function geoKey(m) {
  const um = m.userData;
  if (!um.model || (editor.active && editor.mesh === m && !editor.changed && !editor.wasCustom)) return 'p';
  return um.model.positions.join(',') + '|' + um.model.faceOfTri.join(',') + '|' + [...um.model.faceColors].join(';');
}
function copyGeometry(src, dst) {
  const sm = src.userData.model;
  if (!sm) return;
  const { geometry, model } = createGeometry(sm.positions, sm.faceOfTri);
  model.faceColors = new Map(sm.faceColors);
  dst.geometry.dispose();
  dst.geometry = geometry;
  Object.assign(dst.userData, { custom: true, model });
  applyColors(dst);
  const ol = dst.userData.outline;
  if (ol.userData.own) ol.geometry.dispose();
  delete ol.userData.std;
  ol.geometry = outlineGeometry(geometry, model);
  ol.userData.own = true;
  if (shading !== 'standard') applyShading(dst);
}
function syncReferences() {
  const groups = new Map();
  for (const m of boxes) if (m.userData.refGroup !== undefined) (groups.get(m.userData.refGroup) || groups.set(m.userData.refGroup, []).get(m.userData.refGroup)).push(m);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keys = new Map(list.map(m => [m, geoKey(m)]));
    const changed = list.filter(m => keys.get(m) !== m.userData.refKey);
    if (!changed.length) continue;
    const src = changed.find(m => editor.active && editor.mesh === m) || changed[0];
    for (const m of list) {
      if (m !== src) copyGeometry(src, m);
      m.userData.refKey = keys.get(src);
    }
  }
}
function cloneReference() {
  if (!selected || mode === 'edit') return;
  const copies = selection.map(s => {
    if (s.userData.refGroup === undefined) s.userData.refGroup = nextRefGroup++;
    return addBox({ position: s.position.clone().add(new THREE.Vector3(+$('snap').value || 0.5, 0, 0)),
      size: s.scale.clone(), color: s.userData.baseColor.clone(), rotation: [s.rotation.x, s.rotation.y, s.rotation.z], type: s.userData.type, params: { ...s.userData.params },
      positions: s.userData.model?.positions, faces: s.userData.model?.faceOfTri, faceColors: s.userData.model?.faceColors, name: s.userData.name, hidden: s.userData.hidden, locked: s.userData.locked,
      refGroup: s.userData.refGroup });
  });
  select(null);
  copies.forEach(c => select(c, true));
  commit();
}
// Object clipboard (in memory): snapshots of the copied objects; each paste is shifted a bit further
function copySelected() {
  if (!selected || mode === 'edit') return;
  clipboard = selection.map(s => ({ position: s.position.clone(), size: s.scale.clone(), color: s.userData.baseColor.clone(),
    rotation: [s.rotation.x, s.rotation.y, s.rotation.z], type: s.userData.type, params: structuredClone(s.userData.params),
    positions: s.userData.model?.positions.slice(), faces: s.userData.model?.faceOfTri.slice(),
    faceColors: s.userData.model?.faceColors && new Map(s.userData.model.faceColors), name: s.userData.name, hidden: s.userData.hidden, locked: s.userData.locked }));
  pasteCount = 0;
  updateToolbar();
}
function cutSelected() {
  if (!selected || mode === 'edit') return;
  copySelected();
  deleteSelected();
}
function pasteClipboard() {
  if (!clipboard.length || mode === 'edit') return;
  const off = (+$('snap').value || 0.5) * ++pasteCount;
  const copies = clipboard.map(c => addBox({ ...c, position: c.position.clone().add(new THREE.Vector3(off, 0, 0)), size: c.size.clone(), color: c.color.clone(),
    params: structuredClone(c.params), positions: c.positions?.slice(), faces: c.faces?.slice(), faceColors: c.faceColors && new Map(c.faceColors) }));
  select(null);
  copies.forEach(c => select(c, true));
  commit();
}
function duplicateSelected() {
  if (!selected || mode === 'edit') return;
  const copies = selection.map(s => addBox({ position: s.position.clone().add(new THREE.Vector3(+$('snap').value || 0.5, 0, 0)),
    size: s.scale.clone(), color: s.userData.baseColor.clone(), rotation: [s.rotation.x, s.rotation.y, s.rotation.z], type: s.userData.type, params: { ...s.userData.params },
    positions: s.userData.model?.positions, faces: s.userData.model?.faceOfTri, faceColors: s.userData.model?.faceColors, name: s.userData.name, hidden: s.userData.hidden, locked: s.userData.locked }));
  select(null);
  copies.forEach(c => select(c, true));
  commit();
}
// Hide edges: merges neighbouring faces whose angle is below the limit
let smoothOpen = false;
let latticeOpen = false, lattice = null, latticeSel = -1, latticeDiv = 3;
const canSmooth = () => mode === 'select' && selection.length > 0;
function smoothMesh(mesh, deg) {
  const um = mesh.userData;
  const pos = um.model ? um.model.positions.slice() : nonIdx(mesh.geometry);
  const m = new Model(pos.slice(), um.model?.faceOfTri);
  const cos = Math.cos(deg * Math.PI / 180);
  const parent = new Map();
  const find = f => { while (parent.has(f)) f = parent.get(f); return f; };
  const edgeTris = new Map();
  for (let t = 0; t < m.nTri; t++) {
    if (!m.valid[t]) continue;
    const [a, b, c] = m.triVids(t);
    for (const k of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
      if (!edgeTris.has(k)) edgeTris.set(k, []);
      edgeTris.get(k).push(t);
    }
  }
  for (const ts of edgeTris.values()) {
    if (ts.length !== 2) continue;
    const [p, q] = ts;
    if (m.un[3 * p] * m.un[3 * q] + m.un[3 * p + 1] * m.un[3 * q + 1] + m.un[3 * p + 2] * m.un[3 * q + 2] < cos) continue;
    const r1 = find(m.faceOfTri[p]), r2 = find(m.faceOfTri[q]);
    if (r1 !== r2) parent.set(r2, r1);
  }
  const faces = Array.from(m.faceOfTri, f => find(f));
  if (new Set(faces).size === new Set(m.faceOfTri).size) return false;
  const faceColors = new Map();
  m.faceOfTri.forEach((f, i) => { const c = um.model?.faceColors.get(f); if (c !== undefined && !faceColors.has(faces[i])) faceColors.set(faces[i], c); });
  const idx = boxes.indexOf(mesh), name = um.name;
  const nm = addBox({ position: mesh.position.clone(), size: mesh.scale.clone(), color: um.baseColor.clone(),
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], positions: pos, faces, faceColors, name: name + '_tmp' });
  boxes.splice(boxes.indexOf(nm), 1); boxes.splice(idx, 0, nm);
  boxes.splice(boxes.indexOf(mesh), 1);
  return { old: mesh, nm, name };
}
function applySmooth() {
  if (!canSmooth()) return;
  const deg = Math.min(89, Math.max(1, +$('smoothAngle').value || 30));
  const sel = selection.slice(), out = [];
  select(null);
  for (const mesh of sel) {
    const r = smoothMesh(mesh, deg);
    if (r) { disposeMesh(r.old); r.nm.userData.name = r.name; out.push(r.nm); } else out.push(mesh);
  }
  out.forEach(o => select(o, true));
  $('smoothMsg').textContent = '';
  commit();
  syncList();
}
// Close holes: fills open boundary loops of the selected meshes
function closeHolesSelected() {
  if (!canSmooth()) return;
  const sel = selection.slice(), out = [];
  let filled = 0;
  select(null);
  for (const mesh of sel) {
    const um = mesh.userData;
    const base = um.model ? um.model.positions.slice() : nonIdx(mesh.geometry);
    const r = fillHoles(base);
    if (!r.added) { out.push(mesh); continue; }
    const m0 = um.model || new Model(base.slice());
    const faces = Array.from(m0.faceOfTri);
    const top = Math.max(-1, ...faces) + 1;
    r.faceOfNew.forEach(l => faces.push(top + l));
    const idx = boxes.indexOf(mesh), name = um.name;
    const nm = addBox({ position: mesh.position.clone(), size: mesh.scale.clone(), color: um.baseColor.clone(),
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], positions: r.positions, faces,
      faceColors: um.model?.faceColors, name: name + '_tmp' });
    boxes.splice(boxes.indexOf(nm), 1); boxes.splice(idx, 0, nm);
    boxes.splice(boxes.indexOf(mesh), 1);
    disposeMesh(mesh);
    nm.userData.name = name;
    out.push(nm);
    filled++;
  }
  out.forEach(o => select(o, true));
  commit();
  syncList();
  const st = $('status');
  if (st) st.textContent = filled ? `Holes closed in ${filled} object(s)` : 'No holes found';
}
// Boolean: A = first selected object, B = second; the result replaces both
let boolOpen = false;
const canBool = () => mode === 'select' && selection.length === 2;
function worldPositions(mesh) {
  mesh.updateMatrixWorld(true);
  const pos = nonIndexedPositions(mesh.geometry), v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) v.fromArray(pos, i).applyMatrix4(mesh.matrixWorld).toArray(pos, i);
  if (mesh.matrixWorld.determinant() < 0) {
    for (let i = 0; i < pos.length; i += 9) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
  }
  return pos;
}
function toggleBool() { if (!canBool()) return; toggleTool('bool'); }
function applyBool() {
  if (!canBool()) return;
  const [A, B] = selection, op = document.querySelector('[name=boolOp]:checked').value;
  const msg = t => { $('boolMsg').textContent = t; };
  msg('Working…');
  let pos;
  try { pos = booleanOp(worldPositions(A), worldPositions(B), op); } catch (err) { msg('Operation failed (mesh too complex)'); return; }
  if (!pos.length) { msg('Result is empty'); return; }
  finishBoolean(pos, [A, B], op === 'union' ? 'Union' : 'Difference');
  boolOpen = false;
  msg('');
  commit();
  updateToolbar();
}
// Centre the boolean result, group its triangles into faces and replace the source objects with it
function finishBoolean(pos, parts, name) {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = min.clone().negate();
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min.setComponent(k, Math.min(min.getComponent(k), pos[i + k])); max.setComponent(k, Math.max(max.getComponent(k), pos[i + k])); }
  const c = min.add(max).multiplyScalar(0.5);
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= c.x; pos[i + 1] -= c.y; pos[i + 2] -= c.z; }
  // Group triangles lying in the same plane into one face (BSP splitting creates T-junctions that break edge-based grouping)
  const faceOf = [], planes = new Map(), q = v => Math.round(v * 1e3);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let t = 0; t < pos.length / 9; t++) {
    va.fromArray(pos, 9 * t); vb.fromArray(pos, 9 * t + 3); vc.fromArray(pos, 9 * t + 6);
    nrm.subVectors(vb, va).cross(vc.sub(va)).normalize();
    const k = q(nrm.x) + ',' + q(nrm.y) + ',' + q(nrm.z) + ',' + q(nrm.dot(va));
    if (!planes.has(k)) planes.set(k, planes.size);
    faceOf.push(planes.get(k));
  }
  // Merge smoothly connected triangles (curved surfaces) so only real creases remain as edges
  const nT = faceOf.length, parent = Array.from({ length: Math.max(...faceOf, 0) + 1 }, (_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const tn = [], vk = i => [0, 1, 2].map(c => Math.round(pos[i + c] * 1e4)).join(',');
  const edgeTri = new Map();
  for (let t = 0; t < nT; t++) {
    va.fromArray(pos, 9 * t); vb.fromArray(pos, 9 * t + 3); vc.fromArray(pos, 9 * t + 6);
    tn.push(nrm.subVectors(vb, va).cross(vc.sub(va)).normalize().clone());
    const ks = [vk(9 * t), vk(9 * t + 3), vk(9 * t + 6)];
    for (let e = 0; e < 3; e++) {
      const a = ks[e], b = ks[(e + 1) % 3], key = a < b ? a + '|' + b : b + '|' + a, o = edgeTri.get(key);
      if (o === undefined) edgeTri.set(key, t);
      else if (tn[o].dot(tn[t]) > 0.866) parent[find(faceOf[o])] = find(faceOf[t]);
    }
  }
  for (let t = 0; t < nT; t++) faceOf[t] = find(faceOf[t]);
  const color = baseHex(parts[0]);
  select(null);
  for (const m of parts) { boxes.splice(boxes.indexOf(m), 1); disposeMesh(m); }
  select(addBox({ position: c, color, positions: pos, faces: faceOf, name }));
}
// Merge: combine all selected objects into one mesh (world-space geometry, face colours kept)
const canMerge = () => mode === 'select' && selection.length > 1;
let mergeOpen = false;
function mergeUnion() {
  const parts = selection.slice();
  const msg = t => { $('mergeMsg').textContent = t; };
  msg('Working…');
  let pos;
  try {
    pos = worldPositions(parts[0]);
    for (let i = 1; i < parts.length && pos.length; i++) pos = booleanOp(pos, worldPositions(parts[i]), 'union');
  } catch (err) { msg('Operation failed (mesh too complex)'); return; }
  if (!pos.length) { msg('Result is empty'); return; }
  finishBoolean(pos, parts, 'Union');
  mergeOpen = false;
  msg('');
  commit();
  updateToolbar();
}
function mergeSelected() {
  if (!canMerge()) return;
  if ($('mergeUnion').checked) { mergeUnion(); return; }
  mergeOpen = false;
  const parts = selection.slice(), all = [], faces = [], faceColors = new Map();
  const baseHexes = new Set(parts.map(baseHex));
  const needColors = baseHexes.size > 1 || parts.some(p => p.userData.model?.faceColors.size);
  let faceBase = 0;
  for (const p of parts) {
    const pos = worldPositions(p), m = new Model(pos.slice(), p.userData.model?.faceOfTri);
    all.push(pos);
    let maxF = -1;
    m.faceOfTri.forEach(f => { faces.push(faceBase + f); if (f > maxF) maxF = f; });
    if (needColors) {
      const own = p.userData.model?.faceColors, fallback = baseHex(p);
      for (let f = 0; f <= maxF; f++) faceColors.set(faceBase + f, own?.get(f) ?? fallback);
    }
    faceBase += maxF + 1;
  }
  const pos = new Float32Array(all.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of all) { pos.set(a, o); o += a.length; }
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = min.clone().negate();
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min.setComponent(k, Math.min(min.getComponent(k), pos[i + k])); max.setComponent(k, Math.max(max.getComponent(k), pos[i + k])); }
  const c = min.add(max).multiplyScalar(0.5);
  for (let i = 0; i < pos.length; i += 3) { pos[i] -= c.x; pos[i + 1] -= c.y; pos[i + 2] -= c.z; }
  const color = baseHex(parts[0]);
  select(null);
  for (const m of parts) { boxes.splice(boxes.indexOf(m), 1); disposeMesh(m); }
  select(addBox({ position: c, color, positions: pos, faces, faceColors: needColors ? faceColors : undefined, name: 'Merged' }));
  commit();
  updateToolbar();
}
$('mergeBtn').onclick = () => { if (canMerge()) toggleTool('merge'); };
$('mergeApply').onclick = mergeSelected;
// Remesh: rebuild each selected mesh with evenly sized triangles (edge length = longest side / fineness)
let remeshOpen = false;
function remeshObject(mesh, fineness) {
  const um = mesh.userData, s = mesh.scale;
  const pos = um.model ? um.model.positions.slice() : nonIdx(mesh.geometry);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] *= s.x; pos[i + 1] *= s.y; pos[i + 2] *= s.z;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
  }
  const side = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(side > 0)) return null;
  const skin = skinOnly(pos), r = remesh(skin.positions, side / fineness);
  if (!r) return null;
  const faces = new Model(r.positions.slice()).faceOfTri, faceColors = new Map(), oldM = um.model;
  if (oldM?.faceColors.size) {
    faces.forEach((f, i) => { const c = oldM.faceColors.get(oldM.faceOfTri[skin.map[r.src[i]]]); if (c !== undefined && !faceColors.has(f)) faceColors.set(f, c); });
  }
  const idx = boxes.indexOf(mesh), name = um.name;
  const nm = addBox({ position: mesh.position.clone(), size: new THREE.Vector3(1, 1, 1), color: um.baseColor.clone(),
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], positions: r.positions, faces, faceColors,
    name: name + '_tmp', hidden: um.hidden, locked: um.locked });
  boxes.splice(boxes.indexOf(nm), 1); boxes.splice(idx, 0, nm);
  boxes.splice(boxes.indexOf(mesh), 1);
  return { old: mesh, nm, name };
}
function applyRemesh() {
  if (!canSmooth()) return;
  const fineness = Math.min(200, Math.max(2, +$('rmFine').value || 10));
  const msg = t => { $('remeshMsg').textContent = t; };
  const sel = selection.slice(), done = [];
  msg('Working…');
  select(null);
  let failed = false;
  for (const mesh of sel) {
    try {
      const r = remeshObject(mesh, fineness);
      if (r) { disposeMesh(r.old); r.nm.userData.name = r.name; done.push(r.nm); } else done.push(mesh);
    } catch (err) { failed = true; done.push(mesh); }
  }
  done.forEach(o => select(o, true));
  msg(failed ? 'Too fine for some objects (skipped)' : '');
  commit();
  syncList();
  updateToolbar();
}
$('remeshBtn').onclick = () => { if (canSmooth()) toggleTool('remesh'); };
$('remeshApply').onclick = applyRemesh;
// Flip: reverse the triangle winding of every selected object, which turns its normals around
function flipSelected() {
  if (!canSmooth()) return;
  const sel = selection.slice(), done = [];
  select(null);
  for (const mesh of sel) {
    const um = mesh.userData, pos = nonIndexedPositions(mesh.geometry);
    for (let i = 0; i < pos.length; i += 9) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    const oldM = um.model;
    const faces = oldM ? oldM.faceOfTri : new Model(pos.slice()).faceOfTri;
    const idx = boxes.indexOf(mesh), name = um.name;
    const nm = addBox({ position: mesh.position.clone(), size: mesh.scale.clone(), color: um.baseColor.clone(),
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z], positions: pos, faces,
      faceColors: oldM?.faceColors.size ? [...oldM.faceColors] : undefined, name: name + '_tmp', hidden: um.hidden, locked: um.locked });
    boxes.splice(boxes.indexOf(nm), 1); boxes.splice(idx, 0, nm);
    boxes.splice(boxes.indexOf(mesh), 1);
    disposeMesh(mesh);
    nm.userData.name = name;
    done.push(nm);
  }
  done.forEach(o => select(o, true));
  commit();
  syncList();
  updateToolbar();
  $('status').textContent = `Normals flipped on ${done.length} object(s)`;
}
$('flipBtn').onclick = flipSelected;

// Polygon: click points on a surface (the grid or an object's face), Enter closes the outline into a flat face
let polyPts = [], polyPlane = null, polyCursor = null;
const polyLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffc233, depthTest: false }));
const polyDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffc233, size: 8, sizeAttenuation: false, depthTest: false }));
polyLine.renderOrder = polyDots.renderOrder = 999;
polyLine.frustumCulled = polyDots.frustumCulled = false;
polyLine.visible = polyDots.visible = false;
scene.add(polyLine, polyDots);
function polyRefresh() {
  const pts = polyCursor ? [...polyPts, polyCursor] : polyPts.slice();
  if (polyPts.length > 2 && polyCursor) pts.push(polyPts[0]);
  polyLine.geometry.dispose();
  polyLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  polyDots.geometry.dispose();
  polyDots.geometry = new THREE.BufferGeometry().setFromPoints(polyPts);
  polyLine.visible = pts.length > 1;
  polyDots.visible = polyPts.length > 0;
}
function polyReset() { polyPts = []; polyPlane = null; polyCursor = null; polyRefresh(); }
// Point under the mouse on the drawing surface; the first click defines the surface
function polyPointAt(e) {
  setPointer(e);
  let p = null;
  if (!polyPlane) {
    const hit = raycaster.intersectObjects([...boxes.filter(m => m.visible), ground], false)[0];
    if (!hit) return null;
    const n = hit.object === ground ? new THREE.Vector3(0, 1, 0) : hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (n.dot(raycaster.ray.direction) > 0) n.negate();
    polyPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point);
    p = hit.point.clone();
  } else {
    p = raycaster.ray.intersectPlane(polyPlane, new THREE.Vector3());
    if (!p) return null;
  }
  // Snap on axis-aligned surfaces only, so that the points stay on the surface
  const n = polyPlane.normal, axes = ['x', 'y', 'z'];
  const ax = axes.reduce((a, b) => Math.abs(n[b]) > Math.abs(n[a]) ? b : a);
  if (Math.abs(n[ax]) > 0.999) {
    axes.forEach(a => { if (a !== ax) p[a] = snapV(p[a]); });
    p[ax] = -polyPlane.constant / n[ax];
  }
  return p;
}
function polyFinish() {
  if (polyPts.length < 3) { $('status').textContent = 'Polygon needs at least 3 points'; return; }
  const n = polyPlane.normal.clone();
  const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const tris = THREE.ShapeUtils.triangulateShape(polyPts.map(p => new THREE.Vector2(p.dot(u), p.dot(v))), []);
  if (!tris.length) { $('status').textContent = 'Polygon outline is degenerate'; return; }
  const c = polyPts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(polyPts.length);
  const pos = [];
  for (const t of tris) {
    const [a, b, d] = t.map(i => polyPts[i]);
    const flip = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).dot(n) < 0;
    for (const p of flip ? [a, d, b] : [a, b, d]) pos.push(p.x - c.x, p.y - c.y, p.z - c.z);
  }
  polyReset();
  setMode('select');
  select(addBox({ position: c, color: $('ncol').value, type: 'plane', positions: new Float32Array(pos), name: 'Polygon 1' }));
  commit();
  $('status').textContent = 'Polygon face created';
}
function polyClick(e) {
  const p = polyPointAt(e);
  if (!p) return;
  if (polyPts.length > 2) {
    const r = renderer.domElement.getBoundingClientRect(), s = polyPts[0].clone().project(camera);
    if (Math.hypot(e.clientX - (r.left + (s.x + 1) / 2 * r.width), e.clientY - (r.top + (1 - s.y) / 2 * r.height)) < 10) { polyFinish(); return; }
  }
  if (polyPts.length && polyPts[polyPts.length - 1].distanceTo(p) < 1e-6) return;
  polyPts.push(p);
  polyRefresh();
}
$('polyBtn').onclick = () => { setMode(mode === 'poly' ? 'select' : 'poly'); };
window.addEventListener('keydown', e => {
  if (mode !== 'poly' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Enter') polyFinish();
  else if (e.key === 'Escape') setMode('select');
  else if (e.key === 'Backspace') { polyPts.pop(); if (!polyPts.length) polyPlane = null; polyRefresh(); }
  else return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
// Array: copy i (1..n) of each selected object gets i times the offset / rotation and scale^i
let arrayOpen = false;
// Placement of copy i. Local: offset and rotation accumulate on the source (rotation around the object's own axes).
// Not local: the predecessor is the pivot, so its displacement vector and orientation are rotated by the step (world axes) and added.
function arrayTransforms(src, off, rot, n, local) {
  const step = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  const out = [], q = src.quaternion.clone(), pos = src.position.clone(), d = new THREE.Vector3(...off);
  for (let i = 1; i <= n; i++) {
    if (local) { q.multiply(step); pos.add(d); }
    else { if (i > 1) d.applyQuaternion(step); q.premultiply(step); pos.add(d); }
    const e = new THREE.Euler().setFromQuaternion(q, src.rotation.order);
    out.push({ position: pos.clone(), rotation: [e.x, e.y, e.z] });
  }
  return out;
}
function applyArray() {
  if (!canSmooth()) return;
  const num = id => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : 0; };
  const n = Math.min(100, Math.max(1, Math.round(num('arCount'))));
  const off = ['x', 'y', 'z'].map(a => num('arP' + a));
  const rot = ['x', 'y', 'z'].map(a => THREE.MathUtils.degToRad(num('arR' + a)));
  const scl = ['x', 'y', 'z'].map(a => num('arS' + a) || 1);
  const local = $('arRel').checked, sources = selection.slice(), copies = [];
  const asRef = $('arRef').checked;
  for (const s of sources) {
    if (asRef && s.userData.refGroup === undefined) s.userData.refGroup = nextRefGroup++;
    const tr = arrayTransforms(s, off, rot, n, local);
    for (let i = 1; i <= n; i++) {
      copies.push(addBox({
        position: tr[i - 1].position,
        size: new THREE.Vector3(s.scale.x * scl[0] ** i, s.scale.y * scl[1] ** i, s.scale.z * scl[2] ** i),
        color: s.userData.baseColor.clone(),
        rotation: tr[i - 1].rotation,
        type: s.userData.type, params: { ...s.userData.params },
        positions: s.userData.model?.positions, faces: s.userData.model?.faceOfTri, faceColors: s.userData.model?.faceColors,
        name: s.userData.name, hidden: s.userData.hidden, locked: s.userData.locked,
        refGroup: asRef ? s.userData.refGroup : undefined }));
    }
  }
  select(null);
  sources.forEach(c => select(c, true));
  copies.forEach(c => select(c, true));
  arrayOpen = false;
  commit();
  updateToolbar();
  $('status').textContent = `${copies.length} copies created`;
}
$('arrayBtn').onclick = () => { if (canSmooth()) toggleTool('array'); };
$('arrayApply').onclick = applyArray;
$('bool').onclick = toggleBool;
$('smooth').onclick = () => { if (canSmooth()) toggleTool('smooth'); };
// Only one tool panel can be open at a time
function toggleTool(name) {
  const wasOpen = { lattice: latticeOpen, bool: boolOpen, merge: mergeOpen, remesh: remeshOpen, array: arrayOpen, smooth: smoothOpen }[name];
  if (name !== 'lattice') closeLattice();
  boolOpen = mergeOpen = remeshOpen = arrayOpen = smoothOpen = false;
  if (name === 'lattice') { wasOpen ? closeLattice() : openLattice(); updateToolbar(); return; }
  if (!wasOpen) ({ bool: () => boolOpen = true, merge: () => mergeOpen = true, remesh: () => remeshOpen = true, array: () => arrayOpen = true, smooth: () => smoothOpen = true })[name]();
  updateToolbar();
}
$('smoothApply').onclick = applySmooth;
// Lattice: preview on the geometry, bake into the mesh on Apply
function openLattice(div) {
  if (selection.length !== 1 || mode === 'edit') return;
  if (div) latticeDiv = div;
  lattice = new Lattice(selected, latticeDiv);
  latticeOpen = true;
  latticeSel = -1;
  if (tool !== 'translate') setTool('translate');
  attachGizmo();
  return lattice;
}
function closeLattice() {
  if (!latticeOpen) return;
  latticeOpen = false;
  latticeSel = -1;
  lattice?.dispose();
  lattice = null;
  gizmo.object === latticeProxy && attachGizmo();
}
function latticePick(e) {
  const r = dom.getBoundingClientRect(), p = new THREE.Vector3();
  let best = -1, bd = 16;
  for (let i = 0; i < lattice.count; i++) {
    lattice.worldPoint(i, p).project(camera);
    const d = Math.hypot((p.x + 1) / 2 * r.width + r.left - e.clientX, (1 - p.y) / 2 * r.height + r.top - e.clientY);
    if (p.z < 1 && d < bd) { bd = d; best = i; }
  }
  latticeSel = best;
  if (best >= 0 && tool !== 'translate') setTool('translate');
  attachGizmo();
}
function applyLattice() {
  if (!latticeOpen) return;
  const mesh = lattice.mesh, lat = lattice;
  lat.restore();
  editor.enter(mesh);
  const v = editor.model.verts, q = new THREE.Vector3();
  for (let i = 0; i < editor.model.nVerts * 3; i += 3) { lat.deform(v[i], v[i + 1], v[i + 2], q); v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; }
  editor.changed = true;
  editor.applyVerts();
  editor.exit();
  latticeOpen = false;
  latticeSel = -1;
  lat.dispose(false);
  lattice = null;
  if (shading === 'edges') applyShading(mesh);
  attachGizmo();
  commit();
  updateToolbar();
  syncPanel();
}
$('latticeBtn').onclick = () => { if (selection.length === 1 && mode !== 'edit') toggleTool('lattice'); };
$('latticeApply').onclick = applyLattice;
$('latticeReset').onclick = () => { closeLattice(); updateToolbar(); };
document.querySelectorAll('[data-latdiv]').forEach(b => b.onclick = () => {
  latticeDiv = +b.dataset.latdiv;
  if (lattice) { lattice.setDivisions(latticeDiv); latticeSel = -1; attachGizmo(); }
  updateToolbar();
});
$('closeHoles').onclick = closeHolesSelected;
$('boolApply').onclick = applyBool;
$('del').onclick = deleteSelected;
$('dup').onclick = duplicateSelected;
$('cloneRef').onclick = cloneReference;
$('cut').onclick = cutSelected;
$('copy').onclick = copySelected;
$('paste').onclick = pasteClipboard;

window.addEventListener('keydown', syncGizmoForModifier);
window.addEventListener('keyup', syncGizmoForModifier);
window.addEventListener('blur', () => {
  modifierHeld = false;
  syncGizmoForModifier();
});
// Tell clicks from drags so orbiting does not place anything
let down = null;
const dom = renderer.domElement;
// Click uses the chosen operation; a modifier turns Set into toggle (click) or extend (drag)
const modHeld = e => e.shiftKey || e.ctrlKey || e.metaKey;
const clickOp = e => (tool !== 'select' ? (modHeld(e) ? 'difference' : 'set') : selectOp === 'set' && modHeld(e) ? 'difference' : selectOp);
const dragOp = e => (selectOp === 'set' && modHeld(e) ? 'extend' : selectOp);
const canBoxSelect = () => tool === 'select' && !latticeOpen && ((mode === 'edit' && !editor.addMode) || mode === 'select');
dom.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, b: e.button, onGizmo: !!gizmo.axis && gizmo.visible && gizmo.enabled, box: e.button === 0 && canBoxSelect(), shape: selShape, path: [[e.clientX - dom.getBoundingClientRect().left, e.clientY - dom.getBoundingClientRect().top]] };
  if (down.box) dom.setPointerCapture(e.pointerId);
});
// Selection region as a polygon in canvas coordinates
function regionPolygon(d, e) {
  const r = dom.getBoundingClientRect();
  const x0 = d.x - r.left, y0 = d.y - r.top, x1 = e.clientX - r.left, y1 = e.clientY - r.top;
  if (d.shape === 'circle') return circlePolygon(x0, y0, Math.hypot(x1 - x0, y1 - y0));
  if (d.shape === 'lasso') return d.path.length > 2 ? d.path : null;
  return rectPolygon(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
}
function updateSelBox(e) {
  if (down.shape === 'lasso') { const r = dom.getBoundingClientRect(); down.path.push([e.clientX - r.left, e.clientY - r.top]); }
  const poly = regionPolygon(down, e);
  if (!poly) return;
  const box = dom.getBoundingClientRect(), par = dom.parentElement.getBoundingClientRect();
  selBox.style.display = 'block';
  selPoly.setAttribute('points', poly.map(([x, y]) => `${x + box.left - par.left},${y + box.top - par.top}`).join(' '));
}
// Object mode: projected bounding box inside (or, with touch, overlapping) the region
function regionSelectObjects(poly, op, touch) {
  const r = dom.getBoundingClientRect();
  const hits = new Set();
  const p = new THREE.Vector3();
  camera.updateMatrixWorld(true);
  boxes.filter(isPickable).forEach(o => {
    o.updateMatrixWorld(true);
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld).project(camera);
      if (p.z <= -1 || p.z >= 1) continue;
      const x = (p.x * 0.5 + 0.5) * r.width, y = (-p.y * 0.5 + 0.5) * r.height;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
    }
    if (bx0 > bx1) return;
    const quad = rectPolygon(bx0, by0, bx1, by1);
    if (touch ? shapeHit(poly, quad) : quad.every(([x, y]) => pointIn(poly, x, y))) hits.add(o);
  });
  const cur = new Set(selection);
  applySelectOp(cur, hits, op);
  setSelectionList(keepOrder(cur));
}
dom.addEventListener('pointermove', e => {
  if (down?.box && (e.buttons & 1) && (down.dragged || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8)) { down.dragged = true; updateSelBox(e); return; }
  if (mode === 'poly') {
    if (polyPlane && !e.buttons) { polyCursor = polyPointAt(e); polyRefresh(); }
    return;
  }
  if (mode !== 'place' || e.buttons) { if (e.buttons) ghost.visible = false; return; }
  const pl = placementAt(e);
  if (!pl) { ghost.visible = false; return; }
  ghost.visible = true;
  ghost.position.copy(pl.position);
});
dom.addEventListener('pointerleave', () => ghost.visible = false);
dom.addEventListener('pointerup', e => {
  if (!down) return;
  const click = down;
  down = null;
  selBox.style.display = 'none';
  if (click.box && dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
  if (click.b !== 0) return;
  if (click.dragged || Math.hypot(e.clientX - click.x, e.clientY - click.y) > 8) {
    const poly = click.box && canBoxSelect() && regionPolygon(click, e);
    if (poly) {
      if (mode === 'edit') editor.regionSelect(poly, dragOp(e), $('selTouch').checked);
      else regionSelectObjects(poly, dragOp(e), $('selTouch').checked);
    }
    return;
  }
  const onGizmo = click.onGizmo;
  if (gizmo.dragging || onGizmo) return;
  if (latticeOpen) {
    latticePick(e);
  } else if (mode === 'edit') {
    if (editor.addMode) { editor.insertPoint(e); commit(); } else editor.pick(e, clickOp(e));
  } else if (mode === 'poly') {
    polyClick(e);
  } else if (mode === 'place') {
    const pl = placementAt(e);
    if (pl) {
      select(addBox({ position: pl.position, color: $('ncol').value, type: shape, params: shapeParams[shape] }));
      commit();
    }
  } else {
    setPointer(e);
    const hit = raycaster.intersectObjects(boxes.filter(isPickable), false)[0];
    const op = clickOp(e);
    const cur = new Set(selection);
    if (op === 'set') cur.clear();
    applySelectOp(cur, new Set(hit ? [hit.object] : []), op === 'set' ? 'extend' : op);
    if (!hit && op === 'set' && !selection.length) return;
    setSelectionList(keepOrder(cur));
  }
});

// Keyboard shortcuts: the key table lives in shortcuts.js, this maps action ids to app functions
const clickEl = sel => document.querySelector(sel).click();
const stepSelection = d => {
  const list = boxes.filter(isPickable);
  if (!list.length) return;
  const i = list.indexOf(selected);
  if (mode === 'place') setMode('select');
  select(list[i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length]);
};
const toggleMirror = a => { const c = document.querySelector(`[data-mirror=${a}]`); c.checked = !c.checked; c.dispatchEvent(new Event('change')); };
const stepChamfer = d => { const w = $('chamferW'); w.value = Math.max(0.01, round(parseFloat(w.value || 0.1) + d * 0.05)); };
setupShortcuts({
  open: () => clickEl('[data-imp=".json"]'),
  save: () => $('exp').click(),
  clear: () => $('clear').click(),
  undo, redo,
  dup: duplicateSelected, cloneRef: cloneReference, cut: cutSelected, copy: copySelected, paste: pasteClipboard,
  del: deleteSelected,
  deselect: () => select(null),
  bool: toggleBool,
  selectAllObjects: () => { if (mode === 'place') setMode('select'); select(null); boxes.forEach(b => select(b, true)); },
  prev: () => stepSelection(-1),
  next: () => stepSelection(1),
  rename: () => { const inp = listEl.querySelector('.sel input'); if (!inp) return false; inp.readOnly = false; inp.focus(); inp.select(); },
  objColor: () => $('col').click(),
  select: selectTool,
  box: () => setShape('box'), sphere: () => setShape('sphere'), icosphere: () => setShape('icosphere'), cylinder: () => setShape('cylinder'), tube: () => setShape('tube'), plane: () => setShape('plane'), cone: () => setShape('cone'), torus: () => setShape('torus'),
  editMode: () => setMode(mode === 'edit' ? 'select' : 'edit'),
  move: () => setTool('translate'), rotate: () => setTool('rotate'), scale: () => setTool('scale'),
  space: () => setSpace(gizmo.space === 'local' ? 'world' : 'local'),
  snap: () => { $('snap').focus(); $('snap').select(); },
  focus: focusPivot, home: homeView,
  pvOrigin: () => setPivotMode('origin'), pvSel: () => setPivotMode('selection'),
  vertex: () => setSub('vertex'), edge: () => setSub('edge'), face: () => setSub('face'),
  selectAll: () => editor.selectAll(),
  subAdd, subDel, chamfer: subChamfer, subdivide: subDivide,
  chamferDown: () => stepChamfer(-1), chamferUp: () => stepChamfer(1),
  mirrorX: () => toggleMirror('x'), mirrorY: () => toggleMirror('y'), mirrorZ: () => toggleMirror('z'),
  faceColor: () => { if ($('faceColRow').hidden) return false; $('fcol').click(); },
  faceColorReset: () => { if ($('faceColRow').hidden) return false; $('fcolReset').click(); },
  editEsc: () => {
    if (editor.addMode) { editor.setAddMode(false); updateToolbar(); }
    else if (!editor.clearSelection()) setMode('select');
  },
  helpKeys: () => $('helpKeysDlg').showModal(),
  help: () => $('helpDlg').showModal(),
  helpEdit: () => $('helpEditDlg').showModal(),
  about: () => $('logoBtn').click(),
}, { edit: () => mode === 'edit', sel: () => !!selected });

setupIO({ boxes, addBox, applyColors, clearAll, commit, baseHex, round, docSaved, docReset, getDocName: () => docName,
  getGroups: () => ({
    objects: Object.fromEntries(objGroups),
    edit: Object.fromEntries([...editGroups].map(([k, g]) => [k, Object.fromEntries(g)])),
  }),
  setGroups: data => {
    objGroups.clear(); editGroups.clear();
    for (const [n, l] of Object.entries(data?.objects ?? {})) objGroups.set(n, l);
    for (const [k, g] of Object.entries(data?.edit ?? {})) editGroups.set(k, new Map(Object.entries(g)));
    refreshGroupList(true);
  },
});

function clearAll() { if (mode === 'edit') setMode('select'); select(null); while (boxes.length) disposeMesh(boxes.pop()); }
$('clear').onclick = () => { if (!boxes.length || confirm('Delete all objects?')) { clearAll(); commit(); docReset(); } };

addEventListener('resize', resize);
resize();

// Initial scene
addBox({ position: new THREE.Vector3(0, 0.5, 0), size: new THREE.Vector3(1, 1, 1), color: '#4c8bf5' });

// Fly navigation: hold the right mouse button, then W/S forward/back, A/D left/right, E/Q up/down (Shift = faster), drag to look around
const flyKeys = new Set();
let flying = false, flyLast = 0;
const FLY_KEYS = { KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r', KeyE: 'u', KeyQ: 'd' };
dom.addEventListener('contextmenu', e => e.preventDefault());
dom.addEventListener('pointerdown', e => {
  if (e.button !== 2) return;
  flying = true;
  dom.setPointerCapture(e.pointerId);
  down = null;
});
const flyStop = () => { flying = false; flyKeys.clear(); };
dom.addEventListener('pointerup', e => { if (e.button === 2) flyStop(); });
dom.addEventListener('pointercancel', flyStop);
window.addEventListener('blur', flyStop);
dom.addEventListener('pointermove', e => {
  if (!flying || !(e.buttons & 2)) return;
  const dist = camera.position.distanceTo(orbit.target);
  const view = orbit.target.clone().sub(camera.position);
  const sph = new THREE.Spherical().setFromVector3(view);
  sph.theta -= e.movementX * 0.005;
  sph.phi = THREE.MathUtils.clamp(sph.phi - e.movementY * 0.005, 0.05, Math.PI - 0.05);
  orbit.target.copy(camera.position).add(new THREE.Vector3().setFromSpherical(sph).setLength(dist));
});
window.addEventListener('keydown', e => {
  if (!flying || !FLY_KEYS[e.code] || e.ctrlKey || e.metaKey || e.altKey) return;
  flyKeys.add(FLY_KEYS[e.code]);
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
window.addEventListener('keyup', e => { if (FLY_KEYS[e.code]) flyKeys.delete(FLY_KEYS[e.code]); }, true);
function stepFly(now) {
  const dt = Math.min(0.1, (now - flyLast) / 1000 || 0);
  flyLast = now;
  if (!flying || !flyKeys.size) return;
  const dir = new THREE.Vector3(), fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  if (flyKeys.has('f')) dir.add(fwd);
  if (flyKeys.has('b')) dir.sub(fwd);
  if (flyKeys.has('r')) dir.add(right);
  if (flyKeys.has('l')) dir.sub(right);
  if (flyKeys.has('u')) dir.y += 1;
  if (flyKeys.has('d')) dir.y -= 1;
  if (!dir.lengthSq()) return;
  const speed = 4 * (shiftHeld ? 3 : 1);
  dir.normalize().multiplyScalar(speed * dt);
  camera.position.add(dir);
  orbit.target.add(dir);
}
let shiftHeld = false;
window.addEventListener('keydown', e => { shiftHeld = e.shiftKey; }, true);
window.addEventListener('keyup', e => { shiftHeld = e.shiftKey; }, true);

renderer.setAnimationLoop(now => {
  trackSelection();
  updateSelFrame();
  stepNav();
  stepFly(now);
  orbit.update();
  $('status').textContent = `${boxes.length} objects`;
  renderer.render(scene, camera);
});
updateToolbar();
setShape('box');

// Undo / redo via snapshots of the whole scene
const undoStack = [], redoStack = [];
let current = null;
const MAX_HISTORY = 100;
function snapshot() {
  return boxes.map(m => {
    const ed = editor.active && editor.mesh === m;
    return {
      name: m.userData.name, position: m.position.toArray(), size: m.scale.toArray(), rotation: [m.rotation.x, m.rotation.y, m.rotation.z],
      color: baseHex(m), type: m.userData.type, params: { ...m.userData.params },
      ...(m.userData.hidden && { hidden: true }), ...(m.userData.locked && { locked: true }),
      ...(m.userData.refGroup !== undefined && { refGroup: m.userData.refGroup }),
      ...(m.userData.custom && (!ed || editor.changed || editor.wasCustom) && { positions: Array.from(m.userData.model.positions), faces: Array.from(m.userData.model.faceOfTri), ...(m.userData.model.faceColors.size && { faceColors: [...m.userData.model.faceColors] }) }),
    };
  });
}
function updateHistoryUI() {
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
  updateTitle();
}
// Document title: file name (or "scene"), with "*" while there are changes not saved to that file
var docName = null, savedState = null;
function updateTitle() {
  const title = (docName || 'scene') + (current !== savedState || !docName ? '*' : '');
  document.title = isTauri ? title : `${title} – 3DForge`;
  if (isTauri) window.__TAURI__.window.getCurrentWindow().setTitle(title);
}
function docSaved(name) { commit(); docName = name; savedState = current; updateTitle(); }
function docReset() { docName = null; savedState = null; updateTitle(); }
function commit() {
  syncReferences();
  const s = JSON.stringify(snapshot());
  if (s === current) return;
  if (current !== null) { undoStack.push(current); if (undoStack.length > MAX_HISTORY) undoStack.shift(); }
  current = s;
  redoStack.length = 0;
  updateHistoryUI();
}
function restore(json) {
  const wasEdit = mode === 'edit';
  const idx = selection.map(m => boxes.indexOf(m));
  clearAll();
  for (const b of JSON.parse(json)) addBox({ position: new THREE.Vector3(...b.position), size: new THREE.Vector3(...b.size),
    color: b.color, rotation: b.rotation, type: b.type, params: b.params, positions: b.positions, faces: b.faces, faceColors: b.faceColors, name: b.name, hidden: b.hidden, locked: b.locked, refGroup: b.refGroup });
  if (mode !== 'place') {
    idx.filter(i => boxes[i]).forEach(i => select(boxes[i], true));
    if (wasEdit) setMode('edit');
  }
  updateToolbar();
}
function undo() {
  if (!undoStack.length) return;
  commit();
  if (!undoStack.length) return;
  redoStack.push(current);
  current = undoStack.pop();
  restore(current);
  updateHistoryUI();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(current);
  current = redoStack.pop();
  restore(current);
  updateHistoryUI();
}
$('undo').onclick = undo;
$('redo').onclick = redo;
gizmo.addEventListener('dragging-changed', e => { if (!e.value && gizmo.object !== latticeProxy) commit(); });
for (const id of ['px', 'py', 'pz', 'sx', 'sy', 'sz', 'rx', 'ry', 'rz', 'col']) $(id).addEventListener('change', e => { if (!e.scrub) commit(); });
// 3D navigation: pivot = world origin or selection
let pivotMode = 'origin';
let navGoal = null;
let navKey = '';
function selectionCenter() {
  if (!selected) return null;
  if (editor.active && editor.hasSelection() && editor.gizmo.object === editor.pivot) return editor.center.clone();
  return selectionBox().getCenter(new THREE.Vector3());
}
function pivotPoint() { return pivotMode === 'origin' ? new THREE.Vector3(0, 0, 0) : selectionCenter(); }
setZoomCenter(() => pivotPoint());
setRotateBlocked(() => !!gizmo.axis || gizmo.dragging);
function focusPivot() { const p = pivotPoint(); if (p) navGoal = p; }
function setPivotMode(p) {
  pivotMode = p;
  $('pvOrigin').classList.toggle('active', p === 'origin');
  $('pvSel').classList.toggle('active', p === 'selection');
  navKey = selectionKey();
}
$('pvOrigin').onclick = () => setPivotMode('origin');
$('pvSel').onclick = () => setPivotMode('selection');
$('pvFocus').onclick = focusPivot;
function homeView() {
  navGoal = null;
  camera.position.set(6, 5, 8);
  orbit.target.set(0, 0.5, 0);
  camera.up.set(0, 1, 0);
  orbit.update();
}
$('pvHome').onclick = homeView;
setupNumberScrub();
setupNavGizmo({ canvas: $('navGizmo'), zoomBtn: $('navZoom'), panBtn: $('navPan'), camera, navigate });
// In select mode the pivot follows selection changes
// Object list
const listEl = $('objList');
let listKey = '';
function toggleFlag(m, key) {
  if (mode === 'edit') return;
  m.userData[key] = !m.userData[key];
  m.visible = !m.userData.hidden;
  if (!isPickable(m) && selection.includes(m)) select(m, true);
  commit();
}
// Header buttons act on the whole selection: if any selected object is visible/unlocked they hide/lock all, otherwise they show/unlock all
function toggleSelectionFlag(key) {
  if (mode === 'edit' || !selection.length) return;
  const val = selection.some(m => !m.userData[key]);
  selection.slice().forEach(m => { m.userData[key] = val; m.visible = !m.userData.hidden; });
  setSelectionList(selection, true);
  commit();
}
function syncHeadBtns() {
  [['selHide', 'hidden', ['eye', 'eye-off'], 'Hide / show selected objects'], ['selLock', 'locked', ['unlock', 'lock'], 'Lock / unlock selected objects']].forEach(([id, key, icons, title]) => {
    const b = $(id);
    const allOn = selection.length > 0 && selection.every(m => m.userData[key]);
    b.disabled = mode === 'edit' || !selection.length;
    b.classList.toggle('on', allOn);
    b.title = title;
    const html = `<span class="ico" style="--icon:url(../icons/${icons[allOn ? 1 : 0]}.svg)"></span>`;
    if (b.dataset.html !== html) { b.dataset.html = html; b.innerHTML = html; }
  });
}
$('selHide').onclick = () => toggleSelectionFlag('hidden');
$('selLock').onclick = () => toggleSelectionFlag('locked');
function syncList() {
  syncHeadBtns();
  const key = boxes.map(b => b.userData.name + (b.userData.hidden ? '|h' : '') + (b.userData.locked ? '|l' : '')).join('\n');
  if (key === listKey && listEl.children.length === boxes.length) {
    boxes.forEach((b, i) => listEl.children[i].classList.toggle('sel', selection.includes(b)));
    listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (listEl.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && !document.activeElement.readOnly) return;
  listKey = key;
  const top = listEl.scrollTop;
  listEl.replaceChildren(...boxes.map(m => {
    const row = document.createElement('div');
    row.className = 'objRow' + (selection.includes(m) ? ' sel' : '') + (m.userData.hidden || m.userData.locked ? ' off' : '');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = m.userData.name;
    inp.spellcheck = false;
    inp.title = 'Click to select, double-click to rename';
    inp.readOnly = true;
    row.onclick = e => { if (mode === 'edit') return; if (mode === 'place') setMode('select'); select(m, e.shiftKey || e.ctrlKey || e.metaKey, true); };
    inp.ondblclick = () => { inp.readOnly = false; inp.focus(); inp.select(); };
    inp.onkeydown = e => {
      if (e.key === 'Enter') inp.blur();
      else if (e.key === 'Escape') { inp.value = m.userData.name; inp.blur(); }
    };
    inp.onblur = () => {
      inp.readOnly = true;
      const v = inp.value.trim();
      if (v && v !== m.userData.name) { const old = m.userData.name; m.userData.name = ''; m.userData.name = uniqueName(v); renameGroups(old, m.userData.name); commit(); }
      inp.value = m.userData.name;
    };
    const flag = (key, icons, title) => {
      const b = document.createElement('button');
      b.className = 'objFlag' + (m.userData[key] ? ' on' : '');
      b.title = title;
      b.innerHTML = `<span class="ico" style="--icon:url(../icons/${icons[m.userData[key] ? 1 : 0]}.svg)"></span>`;
      b.onclick = e => { e.stopPropagation(); toggleFlag(m, key); };
      return b;
    };
    row.append(inp, flag('hidden', ['eye', 'eye-off'], 'Show / hide object'), flag('locked', ['unlock', 'lock'], 'Lock / unlock object (not selectable)'));
    return row;
  }));
  listEl.scrollTop = top;
  listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
// Only the object selection re-centres the camera; sub-object changes in edit mode must not make the view jump
function selectionKey() {
  return selection.map(m => m.uuid).join(',');
}
function trackSelection() {
  syncList();
  syncEditPanel();
  if (pivotMode !== 'selection' || gizmo.dragging) return;
  const key = selectionKey();
  if (key === navKey) return;
  navKey = key;
  focusPivot();
}
function stepNav() {
  if (!navGoal) return;
  camera.position.add(navGoal.clone().sub(orbit.target));
  orbit.target.copy(navGoal);
  navGoal = null;
}
setPivotMode('origin');

// Start in select mode with the initial box selected
setMode('select');
select(boxes[0]);
commit();

// Top menu
const menus = [...document.querySelectorAll('.menu')];
menus.forEach(mn => {
  mn.firstElementChild.onclick = e => { e.stopPropagation(); const o = !mn.classList.contains('open'); menus.forEach(x => x.classList.remove('open')); mn.classList.toggle('open', o); };
  mn.onmouseenter = () => { if (menus.some(x => x.classList.contains('open'))) { menus.forEach(x => x.classList.remove('open')); mn.classList.add('open'); } };
});
document.addEventListener('click', () => menus.forEach(x => x.classList.remove('open')));
$('helpBtn').addEventListener('click', () => $('helpDlg').showModal());
$('helpKeysBtn').addEventListener('click', () => $('helpKeysDlg').showModal());
$('helpEditBtn').addEventListener('click', () => $('helpEditDlg').showModal());
document.querySelectorAll('dialog.help [data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('.subhead').forEach(b => b.addEventListener('click', e => e.stopPropagation()));

registerWebMCP({
  boxes, editor, SHAPES, defaultParams, addBox, select, setSelectionList, setMode, setSub, commit, undo, redo, clearAll,
  deleteSelected, duplicateSelected, renameGroups, syncList, applyColors, baseHex, updateToolbar,
  applyBool, mergeSelected, applyRemesh, applyArray, flipSelected, closeHoles: closeHolesSelected, openLattice, closeLattice, applyLattice,
  mode: () => mode, tool: () => tool, selection: () => selection, refresh: () => { updateToolbar(); syncPanel(); },
});
