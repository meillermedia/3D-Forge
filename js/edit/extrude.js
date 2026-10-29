// Editor mixin: face extrusion and dissolving faces/edges/vertices.
import * as THREE from 'three';

export class ExtrudeMethods {
  // Extrudes the selected faces and their mirrored counterparts (each along its own normal); only the edited side stays selected
  extrudeMirrored() {
    const primary = new Set(this.selF);
    const groups = [primary];
    if (this.anyMirror()) {
      const m = this.model, taken = new Set(primary), partners = this.mirrorPartners();
      const byKey = new Map();
      m.faces.forEach((f, id) => byKey.set([...f.vids].sort((x, y) => x - y).join(','), id));
      for (const p of partners) {
        const g = new Set();
        primary.forEach(f => {
          const ids = [...m.faces.get(f).vids].map(i => p[i]);
          if (ids.some(i => i < 0)) return;
          const id = byKey.get(ids.sort((x, y) => x - y).join(','));
          if (id !== undefined && !taken.has(id)) { g.add(id); taken.add(id); }
        });
        if (g.size) groups.push(g);
      }
    }
    for (const g of groups) { this.selF = new Set(g); this.extrudeFaces(); }
    this.selF = primary;
    this.refreshSelection();
  }

  extrudeFaces() {
    const m = this.model;
    if (!this.selF.size) return;
    const T = this.topo();
    const idx = [];
    T.tris.forEach((_, i) => { if (this.selF.has(T.face[i])) idx.push(i); });
    const n = new THREE.Vector3();
    idx.forEach(i => {
      const [a, b, c] = T.tris[i].map(v => new THREE.Vector3().fromArray(T.verts, 3 * v));
      n.add(new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)));
    });
    if (n.lengthSq() < 1e-12) return;
    const sc = this.mesh.scale;
    n.normalize().multiplyScalar((this.extrudeOffset ? this.extrudeOffset() : 0.5) / ((sc.x + sc.y + sc.z) / 3 || 1));
    const copy = new Map();
    for (const i of idx) for (const v of T.tris[i]) {
      if (!copy.has(v)) {
        copy.set(v, T.verts.length / 3);
        T.verts.push(T.verts[3 * v] + n.x, T.verts[3 * v + 1] + n.y, T.verts[3 * v + 2] + n.z);
      }
    }
    const directed = new Set();
    for (const i of idx) { const [a, b, c] = T.tris[i]; directed.add(a + '>' + b); directed.add(b + '>' + c); directed.add(c + '>' + a); }
    let nextFace = Math.max(...T.face) + 1;
    const walls = [], strips = [];
    directed.forEach(d => {
      const [a, b] = d.split('>').map(Number);
      if (directed.has(b + '>' + a)) return;
      const a2 = copy.get(a), b2 = copy.get(b), f = nextFace++;
      walls.push([[a, b, b2], f], [[a, b2, a2], f]);
      const e = new THREE.Vector3().fromArray(T.verts, 3 * b).sub(new THREE.Vector3().fromArray(T.verts, 3 * a));
      strips.push({ a, b, f, n: e.cross(n).normalize() });
    });
    // Consecutive walls with less than 30° between them (straight or curved outlines) share one face, so no extra edges appear
    const root = new Map(strips.map(w => [w.f, w.f]));
    const find = f => { while (root.get(f) !== f) f = root.get(f); return f; };
    const byStart = new Map();
    strips.forEach(w => { if (!byStart.has(w.a)) byStart.set(w.a, []); byStart.get(w.a).push(w); });
    for (const w of strips) for (const o of byStart.get(w.b) || []) {
      if (w.n.dot(o.n) > 0.866) root.set(find(o.f), find(w.f));
    }
    for (const w of walls) w[1] = find(w[1]);
    for (const i of idx) T.tris[i] = T.tris[i].map(v => copy.get(v));
    for (const [tri, f] of walls) { T.tris.push(tri); T.face.push(f); }
    const faces = new Set(this.selF);
    this.rebuild(T);
    faces.forEach(f => this.selF.add(f));
    this.refreshSelection();
  }

  deleteFaces() {
    if (!this.selF.size) return;
    const T = this.topo();
    const keep = T.tris.map((_, i) => !this.selF.has(T.face[i]));
    if (!keep.some(Boolean)) return;
    T.tris = T.tris.filter((_, i) => keep[i]);
    T.face = T.face.filter((_, i) => keep[i]);
    this.rebuild(T);
    this.refreshSelection();
  }

  // Remove edge: the two adjacent faces are merged into one
  dissolveEdges() {
    const m = this.model;
    const parent = new Map();
    const find = f => { while (parent.has(f) && parent.get(f) !== f) f = parent.get(f); return f; };
    let any = false;
    this.selE.forEach(k => {
      const fs = [...m.edgeByKey.get(k).faces];
      for (let i = 1; i < fs.length; i++) {
        const r1 = find(fs[0]), r2 = find(fs[i]);
        if (r1 !== r2) { parent.set(r2, r1); any = true; }
      }
    });
    if (!any) return;
    const T = this.topo();
    T.face = T.face.map(find);
    this.rebuild(T);
    this.refreshSelection();
  }

  // Remove vertex: the surrounding triangles are rebuilt as one face without the vertex
  dissolveVertices() {
    if (!this.selV.size) return;
    const T = this.topo();
    for (const v of this.selV) this.dissolveVertex(T, v);
    if (!T.tris.length) return;
    this.rebuild(T);
    this.refreshSelection();
  }

  dissolveVertex(T, v) {
    const fan = [];
    T.tris.forEach((tr, i) => { if (tr.includes(v)) fan.push(i); });
    if (!fan.length) return;
    const next = new Map();
    let ok = true;
    for (const i of fan) {
      const tr = T.tris[i], k = tr.indexOf(v);
      const a = tr[(k + 1) % 3], b = tr[(k + 2) % 3];
      if (next.has(a)) ok = false;
      next.set(a, b);
    }
    let ring = [];
    if (ok) {
      const targets = new Set(next.values());
      const starts = [...next.keys()].filter(a => !targets.has(a));
      if (starts.length > 1) ok = false;
      else {
        const open = starts.length === 1;
        const start = open ? starts[0] : next.keys().next().value;
        ring = [start];
        let cur = next.get(start);
        while (cur !== undefined && cur !== start && ring.length <= next.size + 1) { ring.push(cur); cur = next.get(cur); }
        ok = ring.length === (open ? next.size + 1 : next.size);
      }
    }
    const face = T.face[fan[0]];
    const gone = new Set(fan);
    const rest = [], restF = [];
    T.tris.forEach((tr, i) => { if (!gone.has(i)) { rest.push(tr); restF.push(T.face[i]); } });
    if (ok && ring.length >= 3) for (const tr of this.earClip(T, ring)) { rest.push(tr); restF.push(face); }
    T.tris = rest;
    T.face = restF;
  }

  earClip(T, ring) {
    const P = i => new THREE.Vector3().fromArray(T.verts, 3 * i);
    const N = new THREE.Vector3();
    ring.forEach((a, i) => {
      const p = P(a), q = P(ring[(i + 1) % ring.length]);
      N.x += (p.y - q.y) * (p.z + q.z); N.y += (p.z - q.z) * (p.x + q.x); N.z += (p.x - q.x) * (p.y + q.y);
    });
    const out = [];
    const r = ring.slice();
    const side = (a, b, p) => new THREE.Vector3().crossVectors(b.clone().sub(a), p.clone().sub(a)).dot(N);
    while (r.length > 3) {
      let cut = -1;
      for (let i = 0; i < r.length && cut < 0; i++) {
        const a = P(r[(i + r.length - 1) % r.length]), b = P(r[i]), c = P(r[(i + 1) % r.length]);
        if (side(a, b, c) <= 0) continue;
        const inside = r.some((id, j) => {
          if (j === i || j === (i + 1) % r.length || j === (i + r.length - 1) % r.length) return false;
          const p = P(id);
          return side(a, b, p) >= 0 && side(b, c, p) >= 0 && side(c, a, p) >= 0;
        });
        if (!inside) cut = i;
      }
      if (cut < 0) cut = 0;
      out.push([r[(cut + r.length - 1) % r.length], r[cut], r[(cut + 1) % r.length]]);
      r.splice(cut, 1);
    }
    out.push([r[0], r[1], r[2]]);
    return out;
  }
}
