import { remesh, skinOnly } from './tools/remesh.js';
import { parse3ds, write3ds } from './tools/three-ds.js';

const threeBase = new URL(self.location.href).searchParams.get('threeBase');
let threePromise;
const addonPromises = new Map();

function getThree() {
  if (!threePromise) {
    if (!threeBase) throw new Error('Three.js worker URL is not configured');
    threePromise = import(`${threeBase}build/three.module.js`);
  }
  return threePromise;
}

function getAddon(path) {
  if (!addonPromises.has(path)) addonPromises.set(path, (async () => {
    const rootUrl = new URL(`examples/jsm/${path}`, threeBase).href;
    const blobUrls = new Map();
    const compiling = new Set();
    const load = async url => {
      if (blobUrls.has(url)) return blobUrls.get(url);
      if (compiling.has(url)) throw new Error(`Cyclic Three.js module dependency: ${url}`);
      compiling.add(url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load Three.js module: ${url}`);
      const source = await response.text();
      const imports = [...source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
      for (const specifier of imports) if (specifier.startsWith('.')) await load(new URL(specifier, url).href);
      const rewritten = source.replace(/((?:from\s*|import\s*)['"])([^'"]+)(['"])/g, (match, prefix, specifier, suffix) => {
        if (specifier === 'three') return `${prefix}${new URL('build/three.module.js', threeBase).href}${suffix}`;
        if (specifier.startsWith('.')) return `${prefix}${blobUrls.get(new URL(specifier, url).href)}${suffix}`;
        if (specifier.startsWith('three/')) return `${prefix}${new URL(specifier.slice(6), threeBase).href}${suffix}`;
        return match;
      });
      const blobUrl = URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
      blobUrls.set(url, blobUrl);
      compiling.delete(url);
      return blobUrl;
    };
    const rootBlobUrl = await load(rootUrl);
    try {
      return await import(rootBlobUrl);
    } finally {
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
    }
  })());
  return addonPromises.get(path);
}

function meshesOf(THREE, root) {
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
      if (typeof OffscreenCanvas === 'undefined') throw new Error('Texture sampling is not available in this browser worker');
      const canvas = new OffscreenCanvas(width, height);
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
    const positions = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      positions[3 * i] = pos.getX(i);
      positions[3 * i + 1] = pos.getY(i);
      positions[3 * i + 2] = pos.getZ(i);
    }
    const entry = { name: o.name, color: '#' + (materials[0]?.color ?? fallback).getHexString(), positions, triColors: [] };
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

async function importMesh(operation, payload) {
  const THREE = await getThree();
  let root;
  if (operation === 'import-obj') {
    const { OBJLoader } = await getAddon('loaders/OBJLoader.js');
    root = new OBJLoader().parse(payload);
  } else if (operation === 'import-stl') {
    const { STLLoader } = await getAddon('loaders/STLLoader.js');
    const geometry = new STLLoader().parse(payload);
    root = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#4c8bf5' }));
  } else {
    const { GLTFLoader } = await getAddon('loaders/GLTFLoader.js');
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(payload.data, payload.resourcePath, resolve, reject));
    root = gltf.scene;
  }
  return meshesOf(THREE, root);
}

async function exportMesh(format, objects) {
  const THREE = await getThree();
  const group = new THREE.Group();
  for (const object of objects) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(object.positions, 3));
    for (const [name, attribute] of Object.entries(object.attributes)) {
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(attribute.array, attribute.itemSize));
    }
    geometry.applyMatrix4(new THREE.Matrix4().fromArray(object.matrix));
    const material = new THREE.MeshStandardMaterial({
      color: object.color, roughness: 0.6, vertexColors: object.vertexColors
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = object.name;
    group.add(mesh);
  }
  try {
    if (format === 'obj') {
      const { OBJExporter } = await getAddon('exporters/OBJExporter.js');
      return { result: new OBJExporter().parse(group), transfer: [] };
    }
    if (format === 'stl') {
      const { STLExporter } = await getAddon('exporters/STLExporter.js');
      const view = new STLExporter().parse(group, { binary: true });
      const result = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer;
      return { result, transfer: [result] };
    }
    const { GLTFExporter } = await getAddon('exporters/GLTFExporter.js');
    const result = await new Promise((resolve, reject) => new GLTFExporter().parse(group, resolve, reject, { binary: true }));
    return { result, transfer: [result] };
  } finally {
    group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  }
}

self.onmessage = async ({ data: { id, operation, payload } }) => {
  try {
    let result, transfer = [];
    if (operation === 'parse-json') result = JSON.parse(payload);
    else if (operation === 'stringify-json') {
      const data = {
        ...payload,
        objects: payload.objects.map(object => object.positions instanceof Float32Array
          ? { ...object, positions: Array.from(object.positions, v => Math.round(v * 1e4) / 1e4), faces: Array.from(object.faces) }
          : object)
      };
      result = JSON.stringify(data, null, 2);
    }
    else if (operation === 'parse-3ds') {
      result = parse3ds(payload);
      transfer = result.map(object => object.positions.buffer);
    } else if (operation === 'write-3ds') {
      result = write3ds(payload);
      transfer = [result];
    } else if (operation === 'import-obj' || operation === 'import-stl' || operation === 'import-gltf') {
      result = await importMesh(operation, payload);
      transfer = result.map(object => object.positions.buffer);
    } else if (operation === 'export-mesh') {
      ({ result, transfer } = await exportMesh(payload.format, payload.objects));
    } else if (operation === 'remesh') {
      const skin = skinOnly(payload.positions);
      const resultMesh = remesh(skin.positions, payload.edgeLength);
      result = resultMesh && { positions: resultMesh.positions, src: resultMesh.src, skinMap: skin.map };
      if (result) transfer = [result.positions.buffer, result.src.buffer, result.skinMap.buffer];
    } else throw new Error(`Unknown worker operation: ${operation}`);
    self.postMessage({ id, result }, transfer);
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
