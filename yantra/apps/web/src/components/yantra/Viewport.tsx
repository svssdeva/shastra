import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface GridLike {
  dims: [number, number, number];
  h: number;
  mask: Uint8Array;
}

interface Props {
  grid: GridLike | null;
  temperatures?: Float32Array | null;
  autoRotate?: boolean;
}

type ViewState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  axes: THREE.AxesHelper;
  instanced: THREE.InstancedMesh | null;
  voxelToInstance: Int32Array | null;
  colorAttr: THREE.InstancedBufferAttribute | null;
  raf: number;
};

export function Viewport({ grid, temperatures, autoRotate = true }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ViewState | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.001,
      100,
    );
    camera.position.set(1.4, 1.4, 1.4);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 4, 5);
    scene.add(dir);

    // Origin axes: red = +X, green = +Y, blue = +Z (three.js convention).
    // Size 0.6 fits inside the unit-ish voxel grid view without dominating it.
    const axes = new THREE.AxesHelper(0.6);
    scene.add(axes);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.8;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.7;
    controls.minDistance = 0.4;
    controls.maxDistance = 8;
    controls.target.set(0, 0, 0);
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;

    const tick = () => {
      const s = stateRef.current;
      if (!s) return;
      s.controls.update();
      renderer.render(s.scene, s.camera);
      s.raf = requestAnimationFrame(tick);
    };
    stateRef.current = {
      renderer,
      scene,
      camera,
      controls,
      axes,
      instanced: null,
      voxelToInstance: null,
      colorAttr: null,
      raf: requestAnimationFrame(tick),
    };

    const onResize = () => {
      if (!stateRef.current || !mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      stateRef.current.camera.aspect = w / h;
      stateRef.current.camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      const s = stateRef.current;
      if (s) {
        cancelAnimationFrame(s.raf);
        s.controls.dispose();
        s.axes.dispose();
        if (s.instanced) {
          s.scene.remove(s.instanced);
          s.instanced.geometry.dispose();
          (s.instanced.material as THREE.Material).dispose();
        }
      }
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      try {
        mount.removeChild(renderer.domElement);
      } catch {
        /* node may already be gone in HMR */
      }
      stateRef.current = null;
    };
  }, []);

  // Track the autoRotate prop without re-initialising the renderer.
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  // Rebuild the InstancedMesh only when the grid itself changes.
  useEffect(() => {
    const s = stateRef.current;
    if (!s || !grid) return;
    if (s.instanced) {
      s.scene.remove(s.instanced);
      s.instanced.geometry.dispose();
      (s.instanced.material as THREE.Material).dispose();
      s.instanced = null;
      s.voxelToInstance = null;
      s.colorAttr = null;
    }
    const [Nx, Ny, Nz] = grid.dims;
    let count = 0;
    for (let v = 0; v < grid.mask.length; v++) if (grid.mask[v] !== 0) count++;
    if (count === 0) return;
    const longest = Math.max(Nx, Ny, Nz) * grid.h;
    const scale = 1 / longest;
    const cubeSize = grid.h * scale * 0.92;
    const geom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const mat = new THREE.MeshLambertMaterial();
    const inst = new THREE.InstancedMesh(geom, mat, count);
    const m = new THREE.Matrix4();
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    inst.instanceColor = colorAttr;
    const voxelToInstance = new Int32Array(grid.mask.length).fill(-1);
    let n = 0;
    const cx = (Nx * grid.h * scale) / 2;
    const cy = (Ny * grid.h * scale) / 2;
    const cz = (Nz * grid.h * scale) / 2;
    for (let k = 0; k < Nz; k++) {
      for (let j = 0; j < Ny; j++) {
        for (let i = 0; i < Nx; i++) {
          const v = i + Nx * (j + Ny * k);
          if (grid.mask[v] === 0) continue;
          m.makeTranslation(
            i * grid.h * scale - cx + (grid.h * scale) / 2,
            j * grid.h * scale - cy + (grid.h * scale) / 2,
            k * grid.h * scale - cz + (grid.h * scale) / 2,
          );
          inst.setMatrixAt(n, m);
          voxelToInstance[v] = n;
          n++;
        }
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    s.scene.add(inst);
    s.instanced = inst;
    s.voxelToInstance = voxelToInstance;
    s.colorAttr = colorAttr;
  }, [grid]);

  // Hot path: T changes ~400× per Solve. Only mutate the color attribute.
  useEffect(() => {
    const s = stateRef.current;
    if (!s || !s.colorAttr || !s.voxelToInstance) return;
    const map = s.voxelToInstance;
    const arr = s.colorAttr.array as Float32Array;
    if (temperatures) {
      for (let v = 0; v < map.length; v++) {
        const n = map[v]!;
        if (n < 0) continue;
        const t = temperatures[v]!;
        const x = t < 0 ? 0 : t > 1 ? 1 : t;
        const r = 1.5 * x - 0.25;
        const g = 1 - Math.abs(2 * x - 1);
        const b = 1.25 - 1.5 * x;
        const o = n * 3;
        arr[o] = r < 0 ? 0 : r > 1 ? 1 : r;
        arr[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
        arr[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
      }
    } else {
      arr.fill(0);
    }
    s.colorAttr.needsUpdate = true;
  }, [temperatures]);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#0a0a0a',
      }}
    />
  );
}
