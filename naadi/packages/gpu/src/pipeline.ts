import { NAADI_PRELUDE } from './prelude';

export interface CompileDiagnostic {
  message: string;
  line?: number;
  column?: number;
  type: 'error' | 'warning' | 'info';
}

export interface CompileResult {
  pipeline: GPURenderPipeline | null;
  diagnostics: CompileDiagnostic[];
}

export interface PipelineDeps {
  device: GPUDevice;
  format: GPUTextureFormat;
  bindGroupLayout: GPUBindGroupLayout;
}

export function makeBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'naadi-uniform-bgl',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  });
}

export async function compilePipeline(
  deps: PipelineDeps,
  userSource: string,
): Promise<CompileResult> {
  const fullSource = NAADI_PRELUDE + userSource;
  const module = deps.device.createShaderModule({
    label: 'naadi-user-module',
    code: fullSource,
  });

  const info = await module.getCompilationInfo();
  const diagnostics: CompileDiagnostic[] = info.messages.map((m) => ({
    message: m.message,
    line: m.lineNum,
    column: m.linePos,
    type: m.type,
  }));

  if (diagnostics.some((d) => d.type === 'error')) {
    return { pipeline: null, diagnostics };
  }

  try {
    const layout = deps.device.createPipelineLayout({
      label: 'naadi-pipeline-layout',
      bindGroupLayouts: [deps.bindGroupLayout],
    });
    const pipeline = deps.device.createRenderPipeline({
      label: 'naadi-render-pipeline',
      layout,
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: deps.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
    return { pipeline, diagnostics };
  } catch (e) {
    return {
      pipeline: null,
      diagnostics: [
        ...diagnostics,
        {
          message: e instanceof Error ? e.message : String(e),
          type: 'error',
        },
      ],
    };
  }
}
