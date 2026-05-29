// DataChannel wire framing.
//
//   byte 0 : tag
//   bytes  : payload
//
// Tag 0x01 = full snapshot (Loro snapshot export, raw bytes)
// Tag 0x02 = incremental update (Loro update export, raw bytes)
// Tag 0x03 = awareness (UTF-8 JSON-encoded ephemeral state)

export const TAG_SNAPSHOT = 0x01;
export const TAG_UPDATE = 0x02;
export const TAG_AWARENESS = 0x03;

export type Frame =
  | { kind: 'snapshot'; bytes: Uint8Array }
  | { kind: 'update'; bytes: Uint8Array }
  | { kind: 'awareness'; payload: unknown };

export function encode(frame: Frame): Uint8Array {
  switch (frame.kind) {
    case 'snapshot':
      return prefixed(TAG_SNAPSHOT, frame.bytes);
    case 'update':
      return prefixed(TAG_UPDATE, frame.bytes);
    case 'awareness': {
      const json = new TextEncoder().encode(JSON.stringify(frame.payload));
      return prefixed(TAG_AWARENESS, json);
    }
  }
}

export function decode(buf: ArrayBufferLike): Frame | null {
  const view = new Uint8Array(buf);
  if (view.length < 1) return null;
  const tag = view[0];
  const payload = view.subarray(1);
  switch (tag) {
    case TAG_SNAPSHOT:
      return { kind: 'snapshot', bytes: new Uint8Array(payload) };
    case TAG_UPDATE:
      return { kind: 'update', bytes: new Uint8Array(payload) };
    case TAG_AWARENESS: {
      try {
        const json = new TextDecoder().decode(payload);
        return { kind: 'awareness', payload: JSON.parse(json) };
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

function prefixed(tag: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + body.length);
  out[0] = tag;
  out.set(body, 1);
  return out;
}
