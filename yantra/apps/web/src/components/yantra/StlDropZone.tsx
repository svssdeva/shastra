import { useCallback, useState } from 'preact/hooks';

interface Props {
  onStl: (buf: ArrayBuffer, name: string) => void;
}

export function StlDropZone({ onStl }: Props) {
  const [hover, setHover] = useState(false);
  const onDrop = useCallback(
    async (e: DragEvent) => {
      if (!e.dataTransfer) return;
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
      className={`dropzone${hover ? ' hover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
    >
      <span className="caption-uppercase">STL</span>
      <span className="body">Drop a file here, or pick a fixture →</span>
    </div>
  );
}
