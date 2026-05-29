import type { PipelineProgress } from '@darshan/inference-core';

export interface ProgressMeterProps {
  progress: PipelineProgress;
}

export function ProgressMeter({ progress }: ProgressMeterProps) {
  if (progress.phase === 'idle') return null;
  if (progress.phase === 'error') {
    return (
      <div class="progress-meter is-error">
        <span class="progress-meter__label">Error</span>
        <span class="progress-meter__message">{progress.message}</span>
      </div>
    );
  }
  if (progress.phase === 'done') {
    return (
      <div class="progress-meter is-done">
        <span class="progress-meter__label">Done</span>
        <span class="progress-meter__message">{progress.message}</span>
      </div>
    );
  }
  const pct = progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : 0;
  return (
    <div class="progress-meter">
      <div class="progress-meter__row">
        <span class="progress-meter__label">{progress.phase}</span>
        <span class="progress-meter__message">{progress.message}</span>
        <span class="progress-meter__pct">{Math.round(pct * 100)}%</span>
      </div>
      <div class="progress-meter__bar">
        <div class="progress-meter__fill" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
