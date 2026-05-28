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
  report?: { hotCount: number; coldCount: number };
}

// Cube-net cell layout (standard cross):
//
//             [ +Y ]
//   [ -X ] [ +Z ] [ +X ] [ -Z ]
//             [ -Y ]
//
// Each cell is one face of the bounding box. Cells are positioned on a 4-col
// × 3-row grid; the column/row indices below feed the CSS `grid-area`.
const CELLS: { face: Face; label: string; row: number; col: number }[] = [
  { face: '+y', label: '+Y', row: 1, col: 2 }, // top
  { face: '-x', label: '-X', row: 2, col: 1 },
  { face: '+z', label: '+Z', row: 2, col: 2 }, // front (toward viewer at start)
  { face: '+x', label: '+X', row: 2, col: 3 },
  { face: '-z', label: '-Z', row: 2, col: 4 }, // back
  { face: '-y', label: '-Y', row: 3, col: 2 }, // bottom
];

export function BcEditor({ config, onChange, report }: Props) {
  // Click cycles: none → hot → cold → none.
  // If a face is already assigned to hot or cold, clicking it advances its role.
  // If a face is unassigned, clicking it becomes the next available role
  // (hot first, then cold, then it replaces hot).
  const onCellClick = (face: Face) => {
    const isHot = config.hotFace === face;
    const isCold = config.coldFace === face;
    if (isHot) {
      // hot → cold (replaces existing cold if any)
      onChange({ ...config, hotFace: null, coldFace: face });
      return;
    }
    if (isCold) {
      // cold → none
      onChange({ ...config, coldFace: null });
      return;
    }
    // unassigned → hot. If hot is already used, becomes cold.
    if (!config.hotFace) {
      onChange({ ...config, hotFace: face });
    } else {
      onChange({ ...config, coldFace: face });
    }
  };

  const roleOf = (face: Face): 'hot' | 'cold' | null => {
    if (config.hotFace === face) return 'hot';
    if (config.coldFace === face) return 'cold';
    return null;
  };

  const clearHot = () => onChange({ ...config, hotFace: null });
  const clearCold = () => onChange({ ...config, coldFace: null });

  return (
    <div className="bc">
      <p className="bc-help">
        Pin a face of the bounding box to a fixed temperature. The solver fills in
        the interior. Click a face to assign it: <strong>none → hot → cold → none</strong>.
      </p>

      <div className="bc-net" role="group" aria-label="Bounding-box face picker">
        {CELLS.map((c) => {
          const role = roleOf(c.face);
          return (
            <button
              key={c.face}
              type="button"
              className={`bc-cell${role ? ` ${role}` : ''}`}
              style={{ gridRow: c.row, gridColumn: c.col }}
              onClick={() => onCellClick(c.face)}
              title={`${c.label} face`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="bc-rows">
        <div className={`bc-row hot${config.hotFace ? '' : ' empty'}`}>
          <span className="bc-row-dot" />
          <span className="bc-row-label">Hot</span>
          <span className="bc-row-face">
            {config.hotFace ? config.hotFace.toUpperCase() : '— pick a face above —'}
            {config.hotFace && report ? (
              <span className="bc-row-count">
                {report.hotCount.toLocaleString()} vox
              </span>
            ) : null}
          </span>
          <div className="bc-row-temp">
            <input
              type="number"
              value={config.hotT}
              disabled={!config.hotFace}
              onChange={(e) =>
                onChange({
                  ...config,
                  hotT: Number((e.target as HTMLInputElement).value),
                })
              }
            />
            <span className="bc-unit">°C</span>
          </div>
          <button
            type="button"
            className="bc-row-clear"
            onClick={clearHot}
            disabled={!config.hotFace}
            title="Remove hot BC"
          >
            ×
          </button>
        </div>

        <div className={`bc-row cold${config.coldFace ? '' : ' empty'}`}>
          <span className="bc-row-dot" />
          <span className="bc-row-label">Cold</span>
          <span className="bc-row-face">
            {config.coldFace ? config.coldFace.toUpperCase() : '— pick a face above —'}
            {config.coldFace && report ? (
              <span className="bc-row-count">
                {report.coldCount.toLocaleString()} vox
              </span>
            ) : null}
          </span>
          <div className="bc-row-temp">
            <input
              type="number"
              value={config.coldT}
              disabled={!config.coldFace}
              onChange={(e) =>
                onChange({
                  ...config,
                  coldT: Number((e.target as HTMLInputElement).value),
                })
              }
            />
            <span className="bc-unit">°C</span>
          </div>
          <button
            type="button"
            className="bc-row-clear"
            onClick={clearCold}
            disabled={!config.coldFace}
            title="Remove cold BC"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

// Paint the outermost interior voxel in the direction of `face` along each
// column perpendicular to that face. That is, for face `+Z` we sweep each
// (i, j) column from k = Nz-1 inward and pin the first non-empty voxel we
// hit — the model's "top surface" as seen from above. This gives meaningful
// boundary conditions on any geometry, not just on parts whose bounding box
// already coincides with the model (e.g. a cube fixture).
//
// Returns the number of voxels that were actually pinned, so the UI can warn
// the user when a chosen face has zero surface voxels.
export function paintFace(grid: SimGrid, face: Face, T: number): number {
  const [Nx, Ny, Nz] = grid.dims;
  let painted = 0;

  const pinIfInside = (i: number, j: number, k: number): boolean => {
    const v = idx(grid.dims, i, j, k);
    if (grid.mask[v] === 0) return false;
    grid.mask[v] = 2;
    grid.T[v] = T;
    painted++;
    return true;
  };

  if (face === '+z' || face === '-z') {
    const start = face === '+z' ? Nz - 1 : 0;
    const step = face === '+z' ? -1 : 1;
    const end = face === '+z' ? -1 : Nz;
    for (let j = 0; j < Ny; j++) {
      for (let i = 0; i < Nx; i++) {
        for (let k = start; k !== end; k += step) {
          if (pinIfInside(i, j, k)) break;
        }
      }
    }
  } else if (face === '+y' || face === '-y') {
    const start = face === '+y' ? Ny - 1 : 0;
    const step = face === '+y' ? -1 : 1;
    const end = face === '+y' ? -1 : Ny;
    for (let k = 0; k < Nz; k++) {
      for (let i = 0; i < Nx; i++) {
        for (let j = start; j !== end; j += step) {
          if (pinIfInside(i, j, k)) break;
        }
      }
    }
  } else {
    // +x / -x
    const start = face === '+x' ? Nx - 1 : 0;
    const step = face === '+x' ? -1 : 1;
    const end = face === '+x' ? -1 : Nx;
    for (let k = 0; k < Nz; k++) {
      for (let j = 0; j < Ny; j++) {
        for (let i = start; i !== end; i += step) {
          if (pinIfInside(i, j, k)) break;
        }
      }
    }
  }

  return painted;
}

export interface BcApplyReport {
  hotCount: number;
  coldCount: number;
}

export function applyBcs(grid: SimGrid, c: BcConfig): BcApplyReport {
  const hotCount = c.hotFace ? paintFace(grid, c.hotFace, c.hotT) : 0;
  const coldCount = c.coldFace ? paintFace(grid, c.coldFace, c.coldT) : 0;
  return { hotCount, coldCount };
}
