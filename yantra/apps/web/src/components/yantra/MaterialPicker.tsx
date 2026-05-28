import { MATERIALS } from '@yantra/solver';

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function MaterialPicker({ value, onChange }: Props) {
  const current = MATERIALS.find((m) => m.id === value);
  return (
    <div>
      <div className="tabs">
        {MATERIALS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`tab${m.id === value ? ' active' : ''}`}
            onClick={() => onChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {current && (
        <div
          style={{
            marginTop: 'var(--space-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--color-muted)',
          }}
        >
          k = {current.k} W/m·K
        </div>
      )}
      <p
        style={{
          marginTop: 'var(--space-md)',
          marginBottom: 0,
          fontSize: 12,
          color: 'var(--color-muted)',
          lineHeight: 1.55,
        }}
      >
        For the current physics (homogeneous material, Dirichlet-only BCs, no
        source) the temperature field is <strong style={{ color: 'var(--color-body)' }}>independent of k</strong>.
        The material choice only changes the <strong style={{ color: 'var(--color-body)' }}>heat-flow (Q̇)</strong> readout
        below the solver — copper conducts ~3000× more watts than PLA at the same ΔT.
      </p>
    </div>
  );
}
