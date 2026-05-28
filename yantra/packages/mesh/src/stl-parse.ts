export interface Triangle {
  v0: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
  normal: [number, number, number];
}

export function parseStl(buf: ArrayBuffer): Triangle[] {
  if (buf.byteLength === 0) throw new Error('empty STL buffer');
  const head = new Uint8Array(buf, 0, Math.min(256, buf.byteLength));
  const headStr = new TextDecoder('utf-8', { fatal: false }).decode(head);
  const isAscii = /^solid/i.test(headStr) && /facet/i.test(headStr);
  return isAscii ? parseAscii(buf) : parseBinary(buf);
}

function parseBinary(buf: ArrayBuffer): Triangle[] {
  if (buf.byteLength < 84) throw new Error('STL too short for binary header');
  const dv = new DataView(buf);
  const count = dv.getUint32(80, true);
  const need = 84 + count * 50;
  if (buf.byteLength < need) {
    throw new Error(`binary STL truncated: need ${need}, got ${buf.byteLength}`);
  }
  const tris: Triangle[] = new Array(count);
  let o = 84;
  for (let i = 0; i < count; i++) {
    const n: [number, number, number] = [
      dv.getFloat32(o, true),
      dv.getFloat32(o + 4, true),
      dv.getFloat32(o + 8, true),
    ];
    const v0: [number, number, number] = [
      dv.getFloat32(o + 12, true),
      dv.getFloat32(o + 16, true),
      dv.getFloat32(o + 20, true),
    ];
    const v1: [number, number, number] = [
      dv.getFloat32(o + 24, true),
      dv.getFloat32(o + 28, true),
      dv.getFloat32(o + 32, true),
    ];
    const v2: [number, number, number] = [
      dv.getFloat32(o + 36, true),
      dv.getFloat32(o + 40, true),
      dv.getFloat32(o + 44, true),
    ];
    tris[i] = { normal: n, v0, v1, v2 };
    o += 50;
  }
  return tris;
}

function parseAscii(buf: ArrayBuffer): Triangle[] {
  const text = new TextDecoder().decode(buf);
  const tris: Triangle[] = [];
  const re =
    /facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)\s+outer\s+loop\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+endloop\s+endfacet/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((m = re.exec(text)) !== null) {
    const f = m.slice(1).map(Number);
    tris.push({
      normal: [f[0]!, f[1]!, f[2]!],
      v0: [f[3]!, f[4]!, f[5]!],
      v1: [f[6]!, f[7]!, f[8]!],
      v2: [f[9]!, f[10]!, f[11]!],
    });
  }
  if (tris.length === 0) throw new Error('ASCII STL contained no facets');
  return tris;
}
