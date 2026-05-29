import type { ComponentChildren } from 'preact';

export interface ResultPanelProps {
  title?: string;
  empty?: boolean;
  children?: ComponentChildren;
}

export function ResultPanel({ title = 'Result', empty, children }: ResultPanelProps) {
  return (
    <section class="result-panel">
      <header class="result-panel__head">
        <span class="caption-uppercase">{title}</span>
      </header>
      <div class="result-panel__body">
        {empty ? <p class="result-panel__empty">No result yet. Drop a file to begin.</p> : children}
      </div>
    </section>
  );
}
