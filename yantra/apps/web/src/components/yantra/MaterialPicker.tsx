import { MATERIALS } from '@yantra/solver';

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function MaterialPicker({ value, onChange }: Props) {
  return (
    <label style={{ display: 'block', margin: '1rem 0' }}>
      Material
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {MATERIALS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} (k={m.k} W/m·K)
          </option>
        ))}
      </select>
    </label>
  );
}
