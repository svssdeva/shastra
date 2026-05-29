import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type Identity, PALETTE, randomColor } from '../lib/identity';

interface Props {
  initial?: Partial<Identity>;
  onSave: (id: Identity) => void;
}

const MAX_NAME = 24;

export default function NicknameModal({ initial, onSave }: Props): JSX.Element {
  const [name, setName] = useState<string>(initial?.name ?? '');
  const [color, setColor] = useState<string>(initial?.color ?? randomColor());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (e?: Event) => {
    e?.preventDefault();
    const trimmed = name.trim().slice(0, MAX_NAME);
    if (trimmed.length === 0) return;
    onSave({ name: trimmed, color });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      class="fixed inset-0 z-50 flex items-center justify-center"
      style="background: rgba(0,0,0,0.75);"
    >
      <form
        onSubmit={submit as (e: Event) => void}
        class="surface-card flex flex-col gap-4"
        style="padding: var(--space-xl); width: min(420px, 90vw);"
      >
        <div>
          <h2 class="title-md mb-1">Pick a name</h2>
          <p class="text-sm" style="color: var(--color-muted);">
            Other peers in this room will see your cursor and edits tagged with this.
          </p>
        </div>
        <label class="flex flex-col gap-2">
          <span class="caption-uppercase">Nickname</span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            maxLength={MAX_NAME}
            placeholder="e.g. AmberOtter"
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            class="text-sm"
            style={
              'background: var(--color-surface-elevated); color: var(--color-on-dark); ' +
              'border: 1px solid var(--color-hairline-strong); border-radius: var(--radius-md); ' +
              'padding: 10px 14px; height: 40px; font-family: var(--font-display); outline: none;'
            }
          />
        </label>
        <div class="flex flex-col gap-2">
          <span class="caption-uppercase">Color</span>
          <div class="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`color ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                style={
                  `background:${c};width:28px;height:28px;border-radius:9999px;border:0;cursor:pointer;` +
                  `box-shadow:${color === c ? '0 0 0 2px var(--color-on-dark)' : 'inset 0 0 0 1px var(--color-hairline)'};`
                }
              />
            ))}
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-2">
          <button type="submit" class="btn-primary" disabled={name.trim().length === 0}>
            Save →
          </button>
        </div>
      </form>
    </div>
  );
}
