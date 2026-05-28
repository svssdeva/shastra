import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface GridLike {
  dims: [number, number, number];
  h: number;
  mask: Uint8Array;
}

interface Props {
  grid: GridLike | null;
  temperatures?: Float32Array | null;
}

export function Viewport({ grid, temperatures }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    instanced: THREE.InstancedMesh | null;
    raf: number;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0b10);
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

    const tick = () => {
      const s = stateRef.current;
      if (!s) return;
      const t = performance.now() * 0.00025;
      s.camera.position.x = Math.cos(t) * 2.2;
      s.camera.position.z = Math.sin(t) * 2.2;
      s.camera.position.y = 1.4;
      s.camera.lookAt(0, 0, 0);
      renderer.render(s.scene, s.camera);
      s.raf = requestAnimationFrame(tick);
    };
    stateRef.current = {
      renderer,
      scene,
      camera,
      instanced: null,
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
      if (stateRef.current) cancelAnimationFrame(stateRef.current.raf);
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

  useEffect(() => {
    const s = stateRef.current;
    if (!s || !grid) return;
    if (s.instanced) {
      s.scene.remove(s.instanced);
      s.instanced.geometry.dispose();
      (s.instanced.material as THREE.Material).dispose();
      s.instanced = null;
    }
    const [Nx, Ny, Nz] = grid.dims;
    let count = 0;
    for (let v = 0; v < grid.mask.length; v++) if (grid.mask[v] !== 0) count++;
    if (count === 0) return;
    const longest = Math.max(Nx, Ny, Nz) * grid.h;
    const scale = 1 / longest; // fit unit-ish view
    const cubeSize = grid.h * scale * 0.92;
    const geom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const inst = new THREE.InstancedMesh(geom, mat, count);
    const m = new THREE.Matrix4();
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    inst.instanceColor = colorAttr;
    let n = 0;
    const cx = (Nx * grid.h * scale) / 2;
    const cy = (Ny * grid.h * scale) / 2;
    const cz = (Nz * grid.h * scale) / 2;
    for (let k = 0; k < Nz; k++) {
      for (let j = 0; j < Ny; j++) {
        for (let i = 0; i < Nx; i++) {
          const idx = i + Nx * (j + Ny * k);
          if (grid.mask[idx] === 0) continue;
          m.makeTranslation(
            i * grid.h * scale - cx + (grid.h * scale) / 2,
            j * grid.h * scale - cy + (grid.h * scale) / 2,
            k * grid.h * scale - cz + (grid.h * scale) / 2,
          );
          inst.setMatrixAt(n, m);
          const t = temperatures ? temperatures[idx]! : 0;
          const c = colorize(t);
          colorAttr.setXYZ(n, c[0], c[1], c[2]);
          n++;
        }
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
    s.scene.add(inst);
    s.instanced = inst;
  }, [grid, temperatures]);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '0.5rem',
        overflow: 'hidden',
        background: '#0b0b10',
      }}
    />
  );
}

function colorize(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  // Blue → cyan → yellow → red
  const r = Math.min(1, Math.max(0, 1.5 * x - 0.25));
  const g = Math.min(1, Math.max(0, 1 - Math.abs(2 * x - 1)));
  const b = Math.min(1, Math.max(0, 1.25 - 1.5 * x));
  return [r, g, b];
}
