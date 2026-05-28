interface Props {
  running: boolean;
  residual: number | null;
  iters: number;
  heatFlux: number | null;
  onSolve: () => void;
  onReset: () => void;
}

function formatWatts(w: number): string {
  const abs = Math.abs(w);
  if (abs >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  if (abs >= 1) return `${w.toFixed(2)} W`;
  if (abs >= 0.001) return `${(w * 1000).toFixed(2)} mW`;
  return `${(w * 1e6).toFixed(1)} µW`;
}

export function SolveControls({
  running,
  residual,
  iters,
  heatFlux,
  onSolve,
  onReset,
}: Props) {
  const converged = residual !== null && residual < 1e-4;
  return (
    <div>
      <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
        <button
          type="button"
          className="btn-primary btn-block"
          onClick={onSolve}
          disabled={running}
        >
          {running ? 'Solving…' : 'Solve'}
        </button>
        <button
          type="button"
          className="btn-secondary btn-block"
          onClick={onReset}
          disabled={running}
        >
          Reset
        </button>
      </div>
      <div className="solver-stats">
        <div className="stat">
          <div className="num">{iters}</div>
          <div className="label">Iterations</div>
        </div>
        <div className="stat">
          <div className="num">{residual === null ? '—' : residual.toExponential(2)}</div>
          <div className="label">Residual</div>
        </div>
      </div>
      <div className="solver-stats">
        <div className="stat">
          <div className="num">{heatFlux === null ? '—' : formatWatts(heatFlux)}</div>
          <div className="label">Heat flow (Q̇)</div>
        </div>
        <div className="stat-hint">
          Conductive power leaving the hot surface. Scales linearly with material k.
        </div>
      </div>
      {converged && (
        <div className="converged">
          <span className="badge-yellow">Converged</span>
        </div>
      )}
    </div>
  );
}
