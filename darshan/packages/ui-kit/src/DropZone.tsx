import { useCallback, useRef, useState } from 'preact/hooks';

export interface DropZoneProps {
  accept: string;
  inputKind: 'image' | 'video' | 'any';
  onFile: (file: File) => void;
  disabled?: boolean;
}

/**
 * File-drop surface using design tokens. Renders a dashed-border card; on hover/drag highlights
 * with the saffron accent. Accepts both drop and click-to-pick.
 */
export function DropZone({ accept, inputKind, onFile, disabled }: DropZoneProps) {
  const [hot, setHot] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setHot(false);
      if (disabled) return;
      const file = e.dataTransfer?.files[0];
      if (file) onFile(file);
    },
    [onFile, disabled],
  );

  const onPick = useCallback(
    (e: Event) => {
      const target = e.currentTarget as HTMLInputElement;
      const file = target.files?.[0];
      if (file) onFile(file);
      target.value = '';
    },
    [onFile],
  );

  const hint =
    inputKind === 'image' ? 'PNG / JPG / WEBP' : inputKind === 'video' ? 'MP4 / WEBM' : 'Any file';

  return (
    <button
      type="button"
      class={`drop-zone${hot ? ' is-hot' : ''}${disabled ? ' is-disabled' : ''}`}
      disabled={disabled}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setHot(true);
      }}
      onDragLeave={() => setHot(false)}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <div class="drop-zone__icon" aria-hidden>
        {'↗'}
      </div>
      <div class="drop-zone__title">Drop a file</div>
      <div class="drop-zone__hint">{hint} · processed locally · never uploaded</div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onPick}
        disabled={disabled}
        hidden
      />
    </button>
  );
}
