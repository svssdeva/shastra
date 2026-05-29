import { useEffect, useRef, useState } from 'preact/hooks';

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrRegion {
  bbox: BBox;
  recognized: string;
  translated: string;
}

export interface OcrCanvasProps {
  file: File;
  imageWidth: number;
  imageHeight: number;
  regions: OcrRegion[];
}

/**
 * Renders the source image with saffron-accent bbox overlays for each recognized region. Click
 * a box to reveal the recognized + translated text in the side panel.
 */
export function OcrCanvas({ file, imageWidth, imageHeight, regions }: OcrCanvasProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const activeRegion = active != null ? regions[active] : undefined;

  return (
    <div class="ocr-canvas">
      <div class="ocr-canvas__stage">
        {url && (
          <img
            ref={imgRef}
            src={url}
            alt={file.name}
            class="ocr-canvas__img"
            width={imageWidth}
            height={imageHeight}
          />
        )}
        <svg
          class="ocr-canvas__svg"
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          aria-label="Detected text regions"
        >
          <title>Detected text regions</title>
          {regions.map((r, i) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG rect — keyboard nav lives in the <button> list below the canvas
            <rect
              key={`${r.bbox.x}-${r.bbox.y}-${r.bbox.width}`}
              class={`ocr-canvas__region${active === i ? ' is-active' : ''}`}
              x={r.bbox.x}
              y={r.bbox.y}
              width={r.bbox.width}
              height={r.bbox.height}
              fill="transparent"
              stroke="var(--color-accent)"
              stroke-width={Math.max(2, imageWidth / 600)}
              onClick={() => setActive(i)}
            />
          ))}
        </svg>
      </div>
      <aside class="ocr-canvas__side">
        <header class="caption-uppercase">
          {regions.length} region{regions.length === 1 ? '' : 's'}
        </header>
        {activeRegion ? (
          <div class="ocr-canvas__detail">
            <div class="ocr-canvas__label">Recognized</div>
            <p class="ocr-canvas__text" lang="hi">
              {activeRegion.recognized || <span class="muted">(empty)</span>}
            </p>
            <div class="ocr-canvas__label">Translated</div>
            <p class="ocr-canvas__text" lang="en">
              {activeRegion.translated || <span class="muted">(empty)</span>}
            </p>
          </div>
        ) : (
          <p class="ocr-canvas__hint">Click a region to view recognized + translated text.</p>
        )}
        <ol class="ocr-canvas__list">
          {regions.map((r, i) => (
            <li key={`${r.bbox.x}-${r.bbox.y}-${r.bbox.width}`}>
              <button
                type="button"
                class={`ocr-canvas__item${active === i ? ' is-active' : ''}`}
                onClick={() => setActive(i)}
              >
                <span class="ocr-canvas__num">{i + 1}</span>
                <span class="ocr-canvas__snip" lang="hi">
                  {r.recognized.slice(0, 32) || '—'}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
