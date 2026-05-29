import { describe, expect, test } from 'bun:test';
import { createDoc, seedIfEmpty } from '../src/schema';

describe('Loro doc + text roundtrip', () => {
  test('seedIfEmpty inserts only when empty', () => {
    const d = createDoc();
    seedIfEmpty(d, 'hello');
    expect(d.text.toString()).toBe('hello');
    seedIfEmpty(d, 'world');
    expect(d.text.toString()).toBe('hello');
  });

  test('snapshot export → fresh doc import preserves text', () => {
    const a = createDoc();
    seedIfEmpty(a, '@fragment fn fs_main() {}');
    a.text.insert(a.text.length, '\n// edit');
    a.doc.commit();
    const snapshot = a.doc.export({ mode: 'snapshot' });

    const b = createDoc();
    b.doc.import(snapshot);
    expect(b.text.toString()).toBe(a.text.toString());
  });

  test('two replicas seeding independently merge into ONE seed, not two', () => {
    // Regression: previously both peers' seedIfEmpty produced concurrent
    // inserts at offset 0 with different peer IDs → text contained the seed
    // twice after merge ("redeclaration of fs_main"). Fix: deterministic
    // SEED_PEER_ID so the ops dedupe.
    const SEED = '@fragment fn fs_main() {}\n';
    const a = createDoc();
    const b = createDoc();
    seedIfEmpty(a, SEED);
    seedIfEmpty(b, SEED);

    a.doc.import(b.doc.export({ mode: 'snapshot' }));
    b.doc.import(a.doc.export({ mode: 'snapshot' }));

    expect(a.text.toString()).toBe(SEED);
    expect(b.text.toString()).toBe(SEED);
    expect(a.text.toString()).toBe(b.text.toString());
  });

  test('incremental update applied to peer converges', () => {
    const a = createDoc();
    const b = createDoc();
    seedIfEmpty(a, 'init');
    b.doc.import(a.doc.export({ mode: 'snapshot' }));

    a.text.insert(a.text.length, '+A');
    a.doc.commit();
    const delta = a.doc.export({ mode: 'update' });
    b.doc.import(delta);

    expect(b.text.toString()).toBe('init+A');
  });
});
