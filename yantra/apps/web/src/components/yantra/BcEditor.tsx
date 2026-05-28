import type { SimGrid } from '@yantra/solver';
import { idx } from '@yantra/solver';

export type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export interface BcConfig {
  hotFace: Face | null;
  hotT: number;
  coldFace: Face | null;
  coldT: number;
}

interface Props {
  config: BcConfig;
  onChange: (c: BcConfig) => void;
}

const FACES: Face[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

export function BcEditor({ config, onChange }: Props) {
  return (
    <div style={{ display: 'grid', gap: '0.5rem', margin: '1rem 0' }}>
      <strong style={{ color: '#e7e7ea' }}>Boundary conditions</strong>
      <label>
        Hot face
        <select
          value={config.hotFace ?? ''}
          onChange={(e) =>
            onChange({ ...config, hotFace: (e.target.value || null) as Face | null })
          }
        >
          <option value="">— none —</option>
          {FACES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label>
        Hot T (°C)
        <input
          type="number"
          value={config.hotT}
          onChange={(e) => onChange({ ...config, hotT: Number(e.target.value) })}
        />
      </label>
      <label>
        Cold face
        <select
          value={config.coldFace ?? ''}
          onChange={(e) =>
            onChange({ ...config, coldFace: (e.target.value || null) as Face | null })
          }
        >
          <option value="">— none —</option>
          {FACES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cold T (°C)
        <input
          type="number"
          value={config.coldT}
          onChange={(e) => onChange({ ...config, coldT: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

export function applyBcs(grid: SimGrid, c: BcConfig): void {
  const [Nx, Ny, Nz] = grid.dims;
  const paintFace = (face: Face, T: number) => {
    const isOnFace = (i: number, j: number, k: number) =>
      (face === '-x' && i === 0) ||
      (face === '+x' && i === Nx - 1) ||
      (face === '-y' && j === 0) ||
      (face === '+y' && j === Ny - 1) ||
      (face === '-z' && k === 0) ||
      (face === '+z' && k === Nz - 1);
    for (let k = 0; k < Nz; k++)
      for (let j = 0; j < Ny; j++)
        for (let i = 0; i < Nx; i++) {
          if (!isOnFace(i, j, k)) continue;
          const v = idx(grid.dims, i, j, k);
          if (grid.mask[v] === 0) continue;
          grid.mask[v] = 2;
          grid.T[v] = T;
        }
  };
  if (c.hotFace) paintFace(c.hotFace, c.hotT);
  if (c.coldFace) paintFace(c.coldFace, c.coldT);
}
