import { LoroDoc, type LoroText } from 'loro-crdt';

export const TEXT_CONTAINER_ID = 'shader';

// Deterministic peer ID reserved for seeding the empty-room default text.
// Every replica that seeds uses this same ID so the resulting Loro ops have
// identical (peer, counter) tuples and merge as a no-op when peers sync.
// Without this, two browsers both calling seedIfEmpty produce two separate
// insertions at position 0 (different peer IDs → not deduped), and the
// merged doc ends up with the default shader appearing twice.
const SEED_PEER_ID = 0n;

export interface NaadiDoc {
  doc: LoroDoc;
  text: LoroText;
}

export function createDoc(): NaadiDoc {
  const doc = new LoroDoc();
  const text = doc.getText(TEXT_CONTAINER_ID);
  return { doc, text };
}

export function seedIfEmpty(d: NaadiDoc, initial: string): void {
  if (d.text.length !== 0) return;
  // Swap to the deterministic seed peer, write, commit, then restore the
  // real (random) peer ID for all subsequent local edits.
  const realPeer = d.doc.peerIdStr;
  d.doc.setPeerId(SEED_PEER_ID);
  d.text.insert(0, initial);
  d.doc.commit();
  d.doc.setPeerId(realPeer);
}
