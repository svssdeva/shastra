import type { ModelSpec } from './types.ts';

/**
 * Thin wrapper around the browser Cache API for model weights. transformers.js v3 uses Cache API
 * natively when available; this wrapper exists to expose inspect/evict for the UI and to be the
 * single seam that a future OPFS-backed implementation can drop into.
 */
const CACHE_NAME = 'darshan-models-v1';

export interface CachedModel {
  spec: ModelSpec;
  bytes: number;
  cachedAt: number;
}

function isCachesAvailable(): boolean {
  return typeof caches !== 'undefined';
}

export async function listCached(): Promise<string[]> {
  if (!isCachesAvailable()) return [];
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  return keys.map((r) => r.url);
}

export async function evictAll(): Promise<void> {
  if (!isCachesAvailable()) return;
  await caches.delete(CACHE_NAME);
}

export async function evictModel(spec: ModelSpec): Promise<void> {
  if (!isCachesAvailable()) return;
  const cache = await caches.open(CACHE_NAME);
  for (const file of spec.files) {
    await cache.delete(file.path);
  }
}

export const CACHE_KEY = CACHE_NAME;
