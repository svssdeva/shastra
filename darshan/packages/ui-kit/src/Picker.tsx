export interface PickerOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface PickerProps<T extends string> {
  label: string;
  value: T;
  options: readonly PickerOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * Compact segmented picker for backend/pipeline selection. Active option uses the brand-yellow
 * surface; disabled options dim with the muted token.
 */
export function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: PickerProps<T>) {
  return (
    <div class="picker">
      <span class="caption-uppercase picker__label">{label}</span>
      <div class="picker__row" role="tablist">
        {options.map((opt) => {
          const active = opt.value === value;
          const off = disabled || opt.disabled;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={off}
              class={`picker__btn${active ? ' is-active' : ''}`}
              onClick={() => onChange(opt.value)}
              title={opt.hint}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
