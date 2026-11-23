import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { IfcAPI } from 'web-ifc';
import wasmUrl from 'web-ifc/web-ifc.wasm?url';
import type { BcfCamera, BcfComponents, Vec3 } from './types';

let ifcApiPromise: Promise<IfcAPI> | null = null;
function getIfcApi(): Promise<IfcAPI> {
  if (!ifcApiPromise) {
    ifcApiPromise = (async () => {
      const api = new IfcAPI();
      await api.Init((path) => (path.endsWith('.wasm') ? new URL(wasmUrl, window.location.href).href : path), true);
      return api;
    })();
  }
  return ifcApiPromise;
}

/** BCF uses Z-up, three.js / web-ifc output uses Y-up. */
export const bcfToThree = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);
export const threeToBcf = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: -v.z, z: v.y });

/** Index ranges of one IFC element inside a merged mesh. */
interface ElementRanges {
  /** sorted start offsets into the merged index buffer */
  starts: number[];
  counts: number[];
  guids: string[];
  original: THREE.BufferAttribute;
  material: THREE.Material;
}

const HIGHLIGHT = new THREE.MeshLambertMaterial({
  color: 0xf5c400,
  emissive: 0x6b5500,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

export class BimViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private model = new THREE.Group();
  /** overlay meshes for selected / isolated elements */
  private overlay = new THREE.Group();
  /** IfcGuid → meshes that contain geometry of this element */
  private elements = new Map<string, THREE.Mesh[]>();
  private placeholder: THREE.Object3D;
  private resizeObs: ResizeObserver;
  private frame = 0;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a1d22);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 5000);
    this.camera.position.set(12, 10, 14);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);
    const grid = new THREE.GridHelper(100, 100, 0x3a3f47, 0x2a2e34);
    this.scene.add(grid);
    this.scene.add(this.model);
    this.scene.add(this.overlay);

    this.placeholder = makePlaceholder();
    this.scene.add(this.placeholder);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get hasModel() {
    return this.model.children.length > 0;
  }

  clearModel() {
    this.clearOverlay();
    this.elements.clear();
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.model.clear();
    this.placeholder.visible = true;
  }

  async loadIfc(data: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<number> {
    const api = await getIfcApi();
    const modelId = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false });
    if (modelId < 0) throw new Error('IFC-Datei konnte nicht geöffnet werden');
    const byMaterial = new Map<string, { color: THREE.Color; opacity: number; geoms: THREE.BufferGeometry[]; guids: string[] }>();
    let count = 0;
    try {
      api.StreamAllMeshes(modelId, (mesh, index, total) => {
        const placed = mesh.geometries;
        let guid = '';
        try {
          guid = api.GetLine(modelId, mesh.expressID)?.GlobalId?.value ?? '';
        } catch {
          /* element without GlobalId */
        }
        for (let i = 0; i < placed.size(); i++) {
          const pg = placed.get(i);
          const geom = api.GetGeometry(modelId, pg.geometryExpressID);
          const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
          const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
          const vc = verts.length / 6;
          const pos = new Float32Array(vc * 3);
          const nor = new Float32Array(vc * 3);
          for (let v = 0; v < vc; v++) {
            pos[v * 3] = verts[v * 6];
            pos[v * 3 + 1] = verts[v * 6 + 1];
            pos[v * 3 + 2] = verts[v * 6 + 2];
            nor[v * 3] = verts[v * 6 + 3];
            nor[v * 3 + 1] = verts[v * 6 + 4];
            nor[v * 3 + 2] = verts[v * 6 + 5];
          }
          const bg = new THREE.BufferGeometry();
          bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          bg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
          bg.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
          bg.applyMatrix4(new THREE.Matrix4().fromArray(pg.flatTransformation));
          geom.delete();
          const c = pg.color;
          const key = `${c.x.toFixed(3)}-${c.y.toFixed(3)}-${c.z.toFixed(3)}-${c.w.toFixed(2)}`;
          let bucket = byMaterial.get(key);
          if (!bucket) {
            bucket = { color: new THREE.Color(c.x, c.y, c.z), opacity: c.w, geoms: [], guids: [] };
            byMaterial.set(key, bucket);
          }
          bucket.geoms.push(bg);
          bucket.guids.push(guid);
          count++;
        }
        onProgress?.(index + 1, total);
      });
    } finally {
      api.CloseModel(modelId);
    }

    this.clearModel();
    for (const b of byMaterial.values()) {
      const starts: number[] = [];
      const counts: number[] = [];
      let offset = 0;
      for (const g of b.geoms) {
        const n = g.index?.count ?? 0;
        starts.push(offset);
        counts.push(n);
        offset += n;
      }
      const merged = mergeGeometries(b.geoms, false);
      b.geoms.forEach((g) => g.dispose());
      if (!merged || !merged.index) continue;
      const mat = new THREE.MeshLambertMaterial({
        color: b.color,
        transparent: b.opacity < 1,
        opacity: b.opacity,
        side: THREE.DoubleSide,
        depthWrite: b.opacity >= 1,
      });
      const m = new THREE.Mesh(merged, mat);
      const ranges: ElementRanges = { starts, counts, guids: b.guids, original: merged.index, material: mat };
      m.userData.ranges = ranges;
      for (const g of new Set(b.guids)) {
        if (!g) continue;
        const list = this.elements.get(g);
        if (list) list.push(m);
        else this.elements.set(g, [m]);
      }
      this.model.add(m);
    }
    this.placeholder.visible = !this.hasModel;
    this.fitToModel();
    return count;
  }

  fitToModel() {
    const target = this.hasModel ? this.model : this.placeholder;
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    // fit the bounding sphere into the narrower of the two view angles (portrait phones!)
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = size / 2 / Math.sin(Math.min(vfov, hfov) / 2);
    this.camera.near = Math.max(0.01, size / 1000);
    this.camera.far = size * 20;
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(center).add(new THREE.Vector3(0.6, 0.5, 0.8).normalize().multiplyScalar(dist * 1.05));
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  /** Jump to a BCF perspective camera (position, direction, up vector, field of view). */
  setBcfCamera(cam: BcfCamera) {
    const pos = bcfToThree(cam.viewPoint);
    const dir = bcfToThree(cam.direction).normalize();
    const up = bcfToThree(cam.upVector).normalize();
    // pick an orbit target in front of the camera, inside the model if possible
    let distance = 10;
    if (this.hasModel) {
      const ray = new THREE.Raycaster(pos, dir);
      const hit = ray.intersectObject(this.model, true)[0];
      if (hit) distance = Math.max(0.5, hit.distance);
    }
    this.camera.position.copy(pos);
    this.camera.up.copy(up);
    if (cam.fieldOfView > 1 && cam.fieldOfView < 170) this.camera.fov = cam.fieldOfView;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(pos.clone().add(dir.multiplyScalar(distance)));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  getBcfCamera(): BcfCamera {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return {
      viewPoint: threeToBcf(this.camera.position),
      direction: threeToBcf(dir),
      upVector: threeToBcf(this.camera.up),
      fieldOfView: this.camera.fov,
    };
  }

  /** Number of IFC elements with a GlobalId in the loaded model. */
  get elementCount() {
    return this.elements.size;
  }

  private clearOverlay() {
    this.overlay.children.forEach((o) => (o as THREE.Mesh).geometry.dispose());
    this.overlay.clear();
    this.model.children.forEach((o) => {
      const m = o as THREE.Mesh;
      const r = m.userData.ranges as ElementRanges | undefined;
      if (!r) return;
      if (m.geometry.index !== r.original) m.geometry.setIndex(r.original);
      if (m.material !== r.material) {
        (m.material as THREE.Material).dispose();
        m.material = r.material;
      }
    });
  }

  /** Index buffer of `mesh` restricted to (keep=true) or without (keep=false) the given elements. */
  private subIndex(mesh: THREE.Mesh, guids: Set<string>, keep: boolean): Uint32Array {
    const r = mesh.userData.ranges as ElementRanges;
    const src = r.original.array as Uint32Array;
    let total = 0;
    r.guids.forEach((g, i) => {
      if (guids.has(g) === keep) total += r.counts[i];
    });
    const out = new Uint32Array(total);
    let o = 0;
    r.guids.forEach((g, i) => {
      if (guids.has(g) !== keep) return;
      out.set(src.subarray(r.starts[i], r.starts[i] + r.counts[i]), o);
      o += r.counts[i];
    });
    return out;
  }

  private addOverlay(mesh: THREE.Mesh, guids: Set<string>, material: THREE.Material) {
    const idx = this.subIndex(mesh, guids, true);
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', mesh.geometry.getAttribute('position'));
    g.setAttribute('normal', mesh.geometry.getAttribute('normal'));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.overlay.add(new THREE.Mesh(g, material));
  }

  /**
   * Show the components of a BCF viewpoint: hide / isolate elements and highlight the selection.
   * Returns how many of the referenced elements exist in the loaded model.
   */
  applyComponents(c?: BcfComponents): { found: number; total: number } {
    this.clearOverlay();
    if (!c || !this.hasModel) return { found: 0, total: 0 };
    const selected = new Set(c.selection);
    const exceptions = new Set(c.exceptions);
    const meshes = this.model.children as THREE.Mesh[];

    if (c.defaultVisibility) {
      // everything visible except the exceptions
      if (exceptions.size)
        for (const m of meshes) {
          if (!(m.userData.ranges as ElementRanges).guids.some((g) => exceptions.has(g))) continue;
          m.geometry.setIndex(new THREE.BufferAttribute(this.subIndex(m, exceptions, false), 1));
        }
    } else {
      // only the exceptions (and the selection) are visible, everything else is ghosted
      const visible = new Set([...exceptions, ...selected]);
      for (const m of meshes) {
        const r = m.userData.ranges as ElementRanges;
        if (r.guids.some((g) => visible.has(g))) this.addOverlay(m, visible, r.material);
        const ghost = (r.material as THREE.MeshLambertMaterial).clone();
        ghost.transparent = true;
        ghost.opacity = 0.08;
        ghost.depthWrite = false;
        m.material = ghost;
      }
    }

    if (selected.size)
      for (const m of meshes) {
        if ((m.userData.ranges as ElementRanges).guids.some((g) => selected.has(g))) this.addOverlay(m, selected, HIGHLIGHT);
      }

    const all = new Set([...selected, ...exceptions]);
    let found = 0;
    all.forEach((g) => this.elements.has(g) && found++);
    return { found, total: all.size };
  }

  /** Bounding box of the given elements (empty if none of them is in the model). */
  private boxOf(guids: string[]): THREE.Box3 {
    const box = new THREE.Box3();
    const set = new Set(guids);
    const v = new THREE.Vector3();
    const meshes = new Set(guids.flatMap((g) => this.elements.get(g) ?? []));
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position');
      const idx = this.subIndex(m, set, true);
      for (let i = 0; i < idx.length; i++) box.expandByPoint(v.fromBufferAttribute(pos, idx[i]));
    }
    return box;
  }

  /** Zoom to the given elements (used when a BCF viewpoint has components but no camera). */
  fitToElements(guids: string[]): boolean {
    const box = this.boxOf(guids);
    if (box.isEmpty()) return false;
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
    const center = box.getCenter(new THREE.Vector3());
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = size / 2 / Math.sin(Math.min(vfov, hfov) / 2);
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(center).add(new THREE.Vector3(0.6, 0.5, 0.8).normalize().multiplyScalar(dist * 1.3));
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    return true;
  }

  /** IfcGuid of the element under the given screen position, if any. */
  pick(clientX: number, clientY: number): string | undefined {
    if (!this.hasModel) return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    for (const hit of ray.intersectObjects([...this.model.children, ...this.overlay.children], false)) {
      if (hit.faceIndex == null) continue;
      const mesh = hit.object as THREE.Mesh;
      // ignore ghosted elements
      if ((mesh.material as THREE.Material).opacity < 0.2 && this.model.children.includes(mesh)) continue;
      const pos = hit.faceIndex * 3;
      const vertex = mesh.geometry.index!.getX(pos);
      // map the vertex back to the original mesh / element range
      const source = this.model.children.includes(mesh) ? mesh : this.findSource(mesh);
      if (!source) continue;
      const r = source.userData.ranges as ElementRanges;
      const orig = r.original.array as Uint32Array;
      const inThisMesh = source === mesh && mesh.geometry.index === r.original;
      if (inThisMesh) return this.guidAt(r, pos);
      // filtered / overlay index: search the original index for this face's first vertex
      const a = mesh.geometry.index!.getX(pos + 1);
      const b = mesh.geometry.index!.getX(pos + 2);
      for (let i = 0; i < orig.length; i += 3) {
        if (orig[i] === vertex && orig[i + 1] === a && orig[i + 2] === b) return this.guidAt(r, i);
      }
    }
    return undefined;
  }

  private findSource(overlayMesh: THREE.Mesh): THREE.Mesh | undefined {
    const pos = overlayMesh.geometry.getAttribute('position');
    return (this.model.children as THREE.Mesh[]).find((m) => m.geometry.getAttribute('position') === pos);
  }

  private guidAt(r: ElementRanges, indexPos: number): string | undefined {
    // binary search for the range containing indexPos
    let lo = 0;
    let hi = r.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (r.starts[mid] <= indexPos) lo = mid;
      else hi = mid - 1;
    }
    return r.guids[lo] || undefined;
  }

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/jpeg', 0.9);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObs.disconnect();
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function makePlaceholder(): THREE.Object3D {
  // simple building block so the viewer is not empty without an IFC model
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x8a8f98 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 8), mat);
  slab.position.y = 0.15;
  const slab2 = slab.clone();
  slab2.position.y = 3.15;
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xc9c2b0 });
  const w1 = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 0.25), wallMat);
  w1.position.set(0, 1.65, -3.9);
  const w2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 8), wallMat);
  w2.position.set(-4.9, 1.65, 0);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3, 16), new THREE.MeshLambertMaterial({ color: 0xf5c400 }));
  col.position.set(3, 1.65, 2);
  g.add(slab, slab2, w1, w2, col);
  return g;
}
