import { type Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

export interface RemotePresence {
  peerId: string;
  name: string;
  color: string;
  from: number;
  to: number;
}

export const setRemotePresences = StateEffect.define<RemotePresence[]>();

const presenceField = StateField.define<RemotePresence[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setRemotePresences)) return e.value;
    }
    return value;
  },
});

class CursorWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string,
  ) {
    super();
  }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'naadi-remote-cursor';
    wrap.style.borderLeft = `2px solid ${this.color}`;
    wrap.style.marginLeft = '-1px';
    wrap.style.position = 'relative';
    wrap.style.height = '1.2em';
    wrap.style.display = 'inline-block';
    wrap.style.verticalAlign = 'text-top';

    const tag = document.createElement('span');
    tag.textContent = this.name;
    tag.style.position = 'absolute';
    tag.style.left = '0';
    tag.style.top = '-1.1em';
    tag.style.background = this.color;
    tag.style.color = '#0a0a0a';
    tag.style.fontSize = '10px';
    tag.style.fontFamily = 'var(--font-display)';
    tag.style.fontWeight = '600';
    tag.style.padding = '1px 4px';
    tag.style.borderRadius = '3px';
    tag.style.whiteSpace = 'nowrap';
    tag.style.pointerEvents = 'none';
    wrap.appendChild(tag);
    return wrap;
  }
  eq(other: CursorWidget): boolean {
    return other.name === this.name && other.color === this.color;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const presences = view.state.field(presenceField, false) ?? [];
  const docLen = view.state.doc.length;
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...presences].sort((a, b) => a.from - b.from);
  for (const p of sorted) {
    const from = Math.max(0, Math.min(p.from, docLen));
    const to = Math.max(0, Math.min(p.to, docLen));
    if (from !== to) {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      builder.add(
        lo,
        hi,
        Decoration.mark({
          class: 'naadi-remote-selection',
          attributes: { style: `background:${hexToRgba(p.color, 0.2)};` },
        }),
      );
    }
    builder.add(
      to,
      to,
      Decoration.widget({
        widget: new CursorWidget(p.name, p.color),
        side: 1,
      }),
    );
  }
  return builder.finish();
}

const presencePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(readonly view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      const presenceChanged =
        u.startState.field(presenceField, false) !== u.state.field(presenceField, false);
      if (u.docChanged || u.viewportChanged || presenceChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function remotePresenceExtension(): Extension {
  return [presenceField, presencePlugin];
}

export interface LocalCursorEvent {
  from: number;
  to: number;
}

export function localCursorEmitter(
  onCursor: (e: LocalCursorEvent) => void,
  throttleMs = 50,
): Extension {
  let lastKey = '';
  let timer: number | undefined;
  return ViewPlugin.define((view) => {
    return {
      update(u: ViewUpdate) {
        if (!u.selectionSet && !u.docChanged) return;
        const sel = u.state.selection.main;
        const key = `${sel.from}:${sel.to}`;
        if (key === lastKey) return;
        lastKey = key;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          onCursor({ from: sel.from, to: sel.to });
        }, throttleMs);
      },
      destroy() {
        window.clearTimeout(timer);
        // reference view so biome doesn't drop it as unused parameter
        void view;
      },
    };
  });
}

function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('#') && (hex.length === 7 || hex.length === 4)) {
    let r: number;
    let g: number;
    let b: number;
    if (hex.length === 4) {
      r = Number.parseInt(hex[1] ?? '0', 16) * 17;
      g = Number.parseInt(hex[2] ?? '0', 16) * 17;
      b = Number.parseInt(hex[3] ?? '0', 16) * 17;
    } else {
      r = Number.parseInt(hex.slice(1, 3), 16);
      g = Number.parseInt(hex.slice(3, 5), 16);
      b = Number.parseInt(hex.slice(5, 7), 16);
    }
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
}
