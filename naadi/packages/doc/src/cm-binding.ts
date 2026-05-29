import { Annotation, type Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { LoroDoc, LoroText } from 'loro-crdt';

// Annotation marking transactions that originate from a remote Loro update,
// so the local-change handler skips re-applying them back into Loro.
export const loroSync = Annotation.define<'remote'>();

export function loroExtension(doc: LoroDoc, text: LoroText): Extension {
  return ViewPlugin.define((view) => {
    // Subscribe to *all* doc updates and reconcile the editor with the
    // canonical Loro string. Local CM-originated commits no-op via the
    // equality check (CM has already applied the change by the time the
    // event fires). Local non-CM mutations (e.g. loading a preset) take the
    // dispatch path so the editor reflects them.
    const unsubscribe = doc.subscribe((_event) => {
      const remote = text.toString();
      const localStr = view.state.doc.toString();
      if (remote === localStr) return;
      view.dispatch({
        changes: { from: 0, to: localStr.length, insert: remote },
        annotations: loroSync.of('remote'),
      });
    });

    return {
      update(u) {
        if (!u.docChanged) return;
        // Skip transactions that *we* dispatched as remote-applies.
        for (const tr of u.transactions) {
          if (tr.annotation(loroSync) === 'remote') return;
        }
        // Translate CodeMirror change set into Loro insert/delete ops.
        u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          if (fromA < toA) text.delete(fromA, toA - fromA);
          if (inserted.length > 0) text.insert(fromA, inserted.toString());
        });
        doc.commit();
      },
      destroy() {
        unsubscribe();
      },
    };
  });
}

export function loroTextValue(text: LoroText): string {
  return text.toString();
}
