// Static 3D stage setup.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Creates the static 3D stage: scene, camera, lights, ground grid, renderer and orbit controls.
export function createStage(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e2127);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(6, 5, 8);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
  scene.add(sun);

  const grid = new THREE.GridHelper(40, 40, 0x6b7385, 0x3a404b);
  scene.add(grid);
  scene.add(new THREE.AxesHelper(2));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.25 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const orbit = new OrbitControls(camera, renderer.domElement);
  // Zooming scales the view about the pivot point (set by the app), so the pivot stays fixed on screen
  let zoomCenter = null, rotateBlocked = null;
  const zoomBy = f => {
    const c = zoomCenter?.() ?? orbit.target;
    const dist = camera.position.distanceTo(c);
    if (dist < 1e-6) return;
    const k = Math.min(300, Math.max(0.3, dist * f)) / dist;
    camera.position.sub(c).multiplyScalar(k).add(c);
    orbit.target.sub(c).multiplyScalar(k).add(c);
  };
  // Blender-style navigation with the middle mouse button: drag orbits, Shift+drag pans, Ctrl+drag zooms
  const el = renderer.domElement;
  orbit.enableRotate = false;
  orbit.enablePan = false;
  const UP = new THREE.Vector3(0, 1, 0);
  let nav = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    nav = { x: e.clientX, y: e.clientY, mode: e.shiftKey ? 'pan' : e.ctrlKey ? 'zoom' : 'orbit' };
    el.setPointerCapture(e.pointerId);
  }, true);
  const panBy = (dx, dy) => {
    const dist = camera.position.distanceTo(orbit.target);
    const k = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / el.clientHeight;
    const m = camera.matrixWorld.elements;
    const move = new THREE.Vector3(m[0], m[1], m[2]).multiplyScalar(-dx * k)
      .addScaledVector(new THREE.Vector3(m[4], m[5], m[6]), dy * k);
    camera.position.add(move);
    orbit.target.add(move);
  };
  const orbitBy = (dx, dy) => {
    const c = zoomCenter?.() ?? orbit.target, k = 2 * Math.PI / el.clientHeight;
    const yaw = -dx * k;
    let pitch = -dy * k;
    const view = camera.position.clone().sub(orbit.target);
    const polar = Math.acos(THREE.MathUtils.clamp(view.y / view.length(), -1, 1));
    pitch = THREE.MathUtils.clamp(polar + pitch, 0.01, Math.PI - 0.01) - polar;
    const right = new THREE.Vector3().crossVectors(UP, view).normalize();
    const turn = v => v.sub(c).applyAxisAngle(UP, yaw).applyAxisAngle(right.clone().applyAxisAngle(UP, yaw), pitch).add(c);
    turn(camera.position);
    turn(orbit.target);
  };
  const zoomDragBy = dy => zoomBy(Math.exp(dy * 0.008));
  // Look along -dir from the current distance (dir points from the target to the camera)
  const viewFrom = dir => {
    const d = dir.clone();
    if (Math.abs(d.y) > 0.999) d.z += d.y > 0 ? 0.0001 : -0.0001;
    const dist = camera.position.distanceTo(orbit.target);
    camera.position.copy(orbit.target).addScaledVector(d.normalize(), dist);
    camera.up.set(0, 1, 0);
    orbit.update();
  };
  el.addEventListener('pointermove', e => {
    if (!nav) return;
    const dx = e.clientX - nav.x, dy = e.clientY - nav.y;
    nav.x = e.clientX; nav.y = e.clientY;
    if (nav.mode === 'zoom') zoomDragBy(dy);
    else if (nav.mode === 'pan') panBy(dx, dy);
    else orbitBy(dx, dy);
  });
  const endNav = e => { if (nav) { nav = null; el.releasePointerCapture(e.pointerId); } };
  el.addEventListener('pointerup', endNav);
  el.addEventListener('pointercancel', endNav);
  el.addEventListener('auxclick', e => e.preventDefault());

  orbit.enableDamping = false;
  // Fixed zoom step per wheel event (independent of device-specific delta values)
  orbit.enableZoom = false;
  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? 1.06 : 1 / 1.06);
  }, { passive: false });
  orbit.target.set(0, 0.5, 0);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  return { scene, camera, renderer, orbit, ground, resize, navigate: { orbit: orbitBy, pan: panBy, zoom: zoomDragBy, viewFrom }, setZoomCenter: fn => { zoomCenter = fn; }, setRotateBlocked: fn => { rotateBlocked = fn; } };
}
