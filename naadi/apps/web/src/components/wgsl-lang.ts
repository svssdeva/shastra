import {
  HighlightStyle,
  StreamLanguage,
  type StreamParser,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const KEYWORDS = new Set([
  'fn',
  'var',
  'let',
  'const',
  'struct',
  'return',
  'if',
  'else',
  'for',
  'while',
  'loop',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'discard',
  'true',
  'false',
  'override',
  'enable',
  'requires',
  'alias',
  'private',
  'workgroup',
  'uniform',
  'storage',
  'read',
  'write',
  'read_write',
  'function',
]);

const TYPES = new Set([
  'f32',
  'f16',
  'u32',
  'i32',
  'bool',
  'vec2',
  'vec3',
  'vec4',
  'mat2x2',
  'mat3x3',
  'mat4x4',
  'mat2x3',
  'mat3x2',
  'mat2x4',
  'mat4x2',
  'mat3x4',
  'mat4x3',
  'array',
  'atomic',
  'ptr',
  'sampler',
  'sampler_comparison',
  'texture_1d',
  'texture_2d',
  'texture_2d_array',
  'texture_3d',
  'texture_cube',
  'texture_cube_array',
  'texture_multisampled_2d',
  'texture_storage_1d',
  'texture_storage_2d',
  'texture_storage_2d_array',
  'texture_storage_3d',
]);

interface State {
  inBlockComment: number; // depth (WGSL allows nesting)
}

const wgslParser: StreamParser<State> = {
  startState: () => ({ inBlockComment: 0 }),
  token(stream, state) {
    if (state.inBlockComment > 0) {
      while (!stream.eol()) {
        if (stream.match('/*')) {
          state.inBlockComment += 1;
          continue;
        }
        if (stream.match('*/')) {
          state.inBlockComment -= 1;
          if (state.inBlockComment === 0) break;
          continue;
        }
        stream.next();
      }
      return 'comment';
    }

    if (stream.eatSpace()) return null;

    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.inBlockComment = 1;
      return 'comment';
    }

    // attributes like @fragment, @group, @binding
    if (stream.match(/^@[A-Za-z_][A-Za-z0-9_]*/)) return 'meta';

    // numeric literals (incl. hex, floats, suffixes)
    if (stream.match(/^0x[0-9a-fA-F]+[uifh]?/)) return 'number';
    if (stream.match(/^\d+\.\d*([eE][+-]?\d+)?[fh]?/)) return 'number';
    if (stream.match(/^\.\d+([eE][+-]?\d+)?[fh]?/)) return 'number';
    if (stream.match(/^\d+[uif]?/)) return 'number';

    // identifier
    const idMatch = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/, true);
    if (idMatch) {
      const word = Array.isArray(idMatch) ? (idMatch[0] ?? '') : '';
      if (KEYWORDS.has(word)) return 'keyword';
      if (TYPES.has(word)) return 'typeName';
      if (/^[A-Z]/.test(word)) return 'typeName';
      // call-like
      if (stream.peek() === '(') return 'function';
      return 'variableName';
    }

    if (stream.match(/^[<>!=]=?|^[+\-*/%&|^~]=?|^->|^::|^[?:]/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
};

export const wgslLanguage = StreamLanguage.define(wgslParser);

export const wgslHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--color-primary)' },
  { tag: t.meta, color: 'var(--color-primary)', fontWeight: '600' },
  { tag: t.comment, color: 'var(--color-muted-soft)', fontStyle: 'italic' },
  { tag: t.number, color: '#b78cff' },
  { tag: t.typeName, color: 'var(--color-accent-blue)' },
  { tag: t.function(t.variableName), color: 'var(--color-on-dark)' },
  { tag: t.variableName, color: 'var(--color-body-strong)' },
  { tag: t.operator, color: 'var(--color-muted)' },
]);

export const wgsl = () => [wgslLanguage, syntaxHighlighting(wgslHighlightStyle)];
