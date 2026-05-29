import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import type { LoroText } from '@naadi/doc';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import {
  type LocalCursorEvent,
  localCursorEmitter,
  type RemotePresence,
  remotePresenceExtension,
  setRemotePresences,
} from './awareness-ext';
import { wgsl } from './wgsl-lang';

interface Props {
  text: LoroText;
  extraExtensions?: Extension[];
  remotePresences?: RemotePresence[];
  onLocalCursor?: (e: LocalCursorEvent) => void;
}

const naadiTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'var(--color-surface-soft)',
      color: 'var(--color-body-strong)',
      fontFamily: 'var(--font-mono)',
      fontSize: '14px',
    },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
    '.cm-content': { padding: '16px 0', caretColor: 'var(--color-primary)' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-surface-soft)',
      color: 'var(--color-muted-soft)',
      border: 'none',
      borderRight: '1px solid var(--color-hairline)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.02)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--color-muted)',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(250,255,105,0.18) !important',
    },
    '.cm-cursor': { borderLeftColor: 'var(--color-primary)' },
    '.cm-line': { padding: '0 16px' },
  },
  { dark: true },
);

export default function Editor({
  text,
  extraExtensions,
  remotePresences,
  onLocalCursor,
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onCursorRef = useRef(onLocalCursor);
  onCursorRef.current = onLocalCursor;

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      wgsl(),
      remotePresenceExtension(),
      localCursorEmitter((e) => onCursorRef.current?.(e)),
      naadiTheme,
      EditorView.lineWrapping,
      ...(extraExtensions ?? []),
    ];
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: text.toString(), extensions }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [text]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setRemotePresences.of(remotePresences ?? []) });
  }, [remotePresences]);

  return <div ref={hostRef} class="h-full overflow-hidden" />;
}
