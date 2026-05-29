import { describe, expect, test } from 'bun:test';
import { decode, encode } from '../src/codec';

describe('codec frame roundtrip', () => {
  test('snapshot', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const wire = encode({ kind: 'snapshot', bytes });
    const got = decode(wire.buffer);
    expect(got).toEqual({ kind: 'snapshot', bytes });
  });

  test('update', () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const wire = encode({ kind: 'update', bytes });
    const got = decode(wire.buffer);
    expect(got).toEqual({ kind: 'update', bytes });
  });

  test('awareness JSON', () => {
    const payload = { name: 'AmberOtter', color: '#faff69', from: 10, to: 12 };
    const wire = encode({ kind: 'awareness', payload });
    const got = decode(wire.buffer);
    expect(got).toEqual({ kind: 'awareness', payload });
  });

  test('unknown tag rejected', () => {
    const buf = new Uint8Array([0xff, 1, 2, 3]).buffer;
    expect(decode(buf)).toBeNull();
  });

  test('empty frame rejected', () => {
    expect(decode(new ArrayBuffer(0))).toBeNull();
  });
});
