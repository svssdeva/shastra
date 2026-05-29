import { expect, test } from 'bun:test';
import { EchoPipeline, INFERENCE_CORE_VERSION, MockBackend } from '../src/index.ts';

test('inference-core package exports version', () => {
  expect(INFERENCE_CORE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test('MockBackend.load reports progress and yields a LoadedModel', async () => {
  const backend = new MockBackend();
  const phases: string[] = [];
  const model = await backend.load(
    {
      id: 'mock/test',
      task: 'echo',
      files: [{ path: 'mock://x', bytes: 100 }],
    },
    { onProgress: (p) => phases.push(p.phase) },
  );
  expect(model.backendId).toBe('mock');
  expect(phases).toEqual(['fetch', 'warmup', 'ready']);
  const out = (await model.run({ ping: 1 })) as { mock: boolean };
  expect(out.mock).toBe(true);
});

test('EchoPipeline.process digests a real File and yields a deterministic output shape', async () => {
  const pipeline = new EchoPipeline();
  const backend = new MockBackend();
  await pipeline.load(backend);
  const file = new File([new TextEncoder().encode('darshan')], 'hello.txt', { type: 'text/plain' });
  const results: unknown[] = [];
  for await (const out of pipeline.process({ file })) {
    results.push(out);
  }
  expect(results.length).toBe(1);
  const out = results[0] as { filename: string; bytes: number; digestPrefix: string };
  expect(out.filename).toBe('hello.txt');
  expect(out.bytes).toBe(7);
  expect(out.digestPrefix).toMatch(/^[0-9a-f]+$/);
  await pipeline.dispose();
});
