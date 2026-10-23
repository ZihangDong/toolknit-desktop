import { defaultHighlightStyle, HighlightStyle } from '@codemirror/language';

// Preserve CodeMirror's tags/emphasis while adapting its white-paper palette.
// CSS variables also update existing tokens when the application theme changes.
export const markdownHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => ({
  ...spec,
  ...(spec.color ? { color: `color-mix(in srgb, ${spec.color} var(--md-syntax-weight), var(--md-syntax-tint))` } : {})
})));
