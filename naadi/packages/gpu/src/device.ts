export interface DeviceBundle {
  adapter: GPUAdapter;
  device: GPUDevice;
  format: GPUTextureFormat;
}

export class WebGPUUnavailable extends Error {
  constructor(reason: string) {
    super(`WebGPU unavailable: ${reason}`);
    this.name = 'WebGPUUnavailable';
  }
}

export async function acquireDevice(): Promise<DeviceBundle> {
  if (!('gpu' in navigator)) {
    throw new WebGPUUnavailable('navigator.gpu is undefined (browser lacks WebGPU)');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new WebGPUUnavailable('no GPUAdapter (driver/GPU did not satisfy the request)');
  }
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  return { adapter, device, format };
}
