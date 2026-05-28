import { useCallback, useState } from 'react';

interface Props {
  onStl: (buf: ArrayBuffer, name: string) => void;
}

export function StlDropZone({ onStl }: Props) {
  const [hover, setHover] = useState(false);
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setHover(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.stl')) {
        alert('Please drop an .stl file.');
        return;
      }
      const buf = await file.arrayBuffer();
      onStl(buf, file.name);
    },
    [onStl],
  );
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
      style={{
        border: `2px dashed ${hover ? '#fce459' : '#444'}`,
        background: hover ? '#1a1a25' : '#15151c',
        padding: '1.5rem',
        borderRadius: '0.4rem',
        textAlign: 'center',
        color: '#9aa',
        margin: '0.5rem 0 1rem',
        transition: 'all 80ms',
      }}
    >
      Drop an STL here
    </div>
  );
}
