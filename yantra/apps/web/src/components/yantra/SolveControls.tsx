interface Props {
  running: boolean;
  residual: number | null;
  iters: number;
  onSolve: () => void;
  onReset: () => void;
}

export function SolveControls({ running, residual, iters, onSolve, onReset }: Props) {
  return (
    <div style={{ display: 'grid', gap: '0.5rem', margin: '1rem 0' }}>
      <button onClick={onSolve} disabled={running}>
        {running ? 'Solving…' : 'Solve'}
      </button>
      <button
        onClick={onReset}
        disabled={running}
        style={{ background: '#2c2c38', color: '#e7e7ea' }}
      >
        Reset
      </button>
      <div style={{ fontSize: '0.85em', color: '#9aa' }}>
        <div>iterations: {iters}</div>
        <div>residual: {residual === null ? '—' : residual.toExponential(2)}</div>
      </div>
    </div>
  );
}
