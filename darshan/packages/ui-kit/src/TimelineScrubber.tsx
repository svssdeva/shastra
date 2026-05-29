import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

export interface IncidentMark {
  start: number;
  end: number;
  kind: 'looming-vehicle' | 'pedestrian-close' | 'traffic-control';
  label: string;
}

export interface TimelineScrubberProps {
  src: string;
  duration: number;
  incidents: IncidentMark[];
}

const KIND_COLORS: Record<IncidentMark['kind'], string> = {
  'looming-vehicle': 'var(--color-accent)',
  'pedestrian-close': 'var(--color-rose)',
  'traffic-control': 'var(--color-primary)',
};

/**
 * Video player + scrubber bar with incident marks. Click a mark to seek the video to the start
 * of the incident; the active mark highlights as playback progresses through it.
 */
export function TimelineScrubber({ src, duration, incidents }: TimelineScrubberProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    const onTime = () => setTime(v.currentTime);
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, []);

  useEffect(() => {
    const idx = incidents.findIndex((i) => time >= i.start && time <= i.end);
    setActive(idx >= 0 ? idx : null);
  }, [time, incidents]);

  const sortedIncidents = useMemo(
    () => incidents.slice().sort((a, b) => a.start - b.start),
    [incidents],
  );

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  return (
    <div class="timeline">
      <video ref={videoRef} src={src} controls class="timeline__video">
        <track kind="captions" label="No captions" />
      </video>
      <div class="timeline__bar">
        {sortedIncidents.map((i, idx) => {
          const left = duration > 0 ? (i.start / duration) * 100 : 0;
          const width = duration > 0 ? Math.max(0.5, ((i.end - i.start) / duration) * 100) : 1;
          return (
            <button
              key={`${i.start}-${i.kind}`}
              type="button"
              class={`timeline__mark${active === idx ? ' is-active' : ''}`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: KIND_COLORS[i.kind],
              }}
              title={`${i.label} · ${i.start.toFixed(1)}s → ${i.end.toFixed(1)}s`}
              onClick={() => seek(i.start)}
            />
          );
        })}
        <div
          class="timeline__cursor"
          style={{ left: `${duration > 0 ? (time / duration) * 100 : 0}%` }}
          aria-hidden
        />
      </div>
      <ol class="timeline__list">
        {sortedIncidents.map((i, idx) => (
          <li key={`${i.start}-${i.kind}`}>
            <button
              type="button"
              class={`timeline__item${active === idx ? ' is-active' : ''}`}
              onClick={() => seek(i.start)}
            >
              <span class="timeline__dot" style={{ background: KIND_COLORS[i.kind] }} aria-hidden />
              <span class="timeline__time">
                {fmt(i.start)} → {fmt(i.end)}
              </span>
              <span class="timeline__label">{i.label}</span>
            </button>
          </li>
        ))}
        {sortedIncidents.length === 0 && (
          <li class="timeline__empty">No incidents detected on this clip.</li>
        )}
      </ol>
    </div>
  );
}

function fmt(t: number): string {
  const mm = Math.floor(t / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(t % 60)
    .toString()
    .padStart(2, '0');
  return `${mm}:${ss}`;
}
