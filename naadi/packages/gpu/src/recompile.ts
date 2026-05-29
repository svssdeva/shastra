import { type CompileResult, compilePipeline, type PipelineDeps } from './pipeline';

// Single-flight compile: if a recompile is requested while one is running,
// queue the latest source and run it once the current call finishes.
export class Recompiler {
  private deps: PipelineDeps;
  private pending: string | null = null;
  private running = false;
  private onResult: (r: CompileResult) => void;

  constructor(deps: PipelineDeps, onResult: (r: CompileResult) => void) {
    this.deps = deps;
    this.onResult = onResult;
  }

  request(source: string): void {
    this.pending = source;
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending !== null) {
        const src = this.pending;
        this.pending = null;
        const result = await compilePipeline(this.deps, src);
        this.onResult(result);
      }
    } finally {
      this.running = false;
    }
  }
}
