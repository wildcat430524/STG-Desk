// Rich rendering for the visual editor, implemented with ProseMirror *decorations*.
//
// Why decorations:
//   A decoration is not document content. Code-block highlighting paints
//   `hljs-*` classes onto existing text ranges and adds a non-editable toolbar
//   widget, so the code text, the caret, the selection, IME composition and the
//   serialized Markdown are all untouched. Nothing in this module can rewrite a
//   document; the only mutations go through explicit commands the caller owns.
//
// Exports:
//   createRichPlugin({highlight, registry, onLanguage, onCopy, labels})
//   copyText(text, options)      -> clipboard helper with a legacy fallback
//   installRichStyles(doc, id)   -> zero-specificity fallback styles
//
// All generated class names are prefixed `edh-` and the fallback stylesheet uses
// `:where()` (specificity 0), so the application stylesheet always wins.
//
// CSS CONTRACT (for whoever owns the stylesheets):
//   Syntax colours reuse the SAME `hljs-*` classes and the same highlight.js
//   instance as the read-only preview (src/editor-highlight.mjs), so one set of
//   rules colours both surfaces. No new token classes are invented.
//
//   .edh-code-tools           flex row widget, anchored before a code block.
//                             `.ProseMirror-widget` supplies contenteditable=false.
//   .edh-code-language-label  plain text tag with the current language name.
//   .edh-code-language        <select> of the language catalog (18 options).
//                             Styling must keep it focusable and clickable:
//                             the widget sets stopEvent, so the editor will not
//                             swallow pointer events inside .edh-code-tools.
//   .edh-code-copy            <button>; shows data-state="copied" | "failed"
//                             for ~1.4s, then resets to the default label.
//   .edh-copy-scratch         off-screen textarea used only during the legacy
//                             clipboard fallback; never persists in the DOM.
//   .edh-math-error           applied to a formula node view whose LaTeX failed
//                             to parse; also carries data-math-error="<message>".
//   .edh-math-block           display-math node view (block-level, scrollable).
//   .visual-math-block        the same node view's editor-facing class (block).
//   .visual-math              inline-math node view (existing class, unchanged).
//
//   The embedded fallback sheet below uses `:where(...)` and no `!important`, so
//   an application rule with any specificity wins; it exists only so the tools
//   are usable before the app stylesheet lands. Import order does not matter.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { tokenRanges, emitterMatchesSource, languageOptions, languageLabel } from './editor-syntax.mjs';

export const richPluginKey = new PluginKey('editorRich');

/** Above this size a code block stays editable but is left uncoloured. */
export const HIGHLIGHT_MAX_LENGTH = 20000;
const CACHE_LIMIT = 200;
const COPY_FEEDBACK_MS = 1400;

const defaultLabels = {
  copy: '复制代码',
  copied: '已复制',
  copyFailed: '复制失败',
  language: '代码语言',
  tools: '代码块工具',
};

/**
 * Build the decoration set for a document: one inline decoration per
 * highlight.js token range, plus one toolbar widget per code block.
 */
export function buildDecorations(doc, rangesFor, config) {
  const decorations = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return undefined;
    const text = node.textContent;
    const language = node.attrs?.language ?? null;

    if (text && text.length <= HIGHLIGHT_MAX_LENGTH) {
      const start = pos + 1;
      for (const range of rangesFor(language, text)) {
        try {
          decorations.push(Decoration.inline(start + range.from, start + range.to, { class: range.className }));
        } catch {
          // A range outside the current document paints nothing; the code text
          // and the saved source are unaffected either way.
        }
      }
    }

    try {
      decorations.push(Decoration.widget(pos, toolsWidget(config), {
        // The language is part of the key so changing it rebuilds the widget
        // with the new selected option instead of reusing the old DOM.
        key: `edh-code-tools:${language ?? ''}`,
        side: -1,
        stopEvent: () => true,
      }));
    } catch {
      // Widget placement can fail at a document boundary; highlighting still applies.
    }
    return undefined;
  });
  // DecorationSet.create consumes the array and re-sorts per node, but sorting
  // here keeps the input deterministic and the widget/range interleaving stable.
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return DecorationSet.create(doc, decorations);
}

/**
 * Toolbar widget for one code block.
 *
 * The widget DOM is reused across edits (same decoration key), so it must never
 * close over a snapshot of the code: `getPos()` resolves the live position and
 * every action re-reads the current node from the view's state.
 */
export function toolsWidget(config) {
  const { labels, registry, onLanguage, onCopy } = config;
  return (view, getPos) => {
    const current = () => {
      try {
        const pos = getPos();
        return { pos, node: view.state.doc.nodeAt(pos) };
      } catch {
        return { pos: null, node: null };
      }
    };

    const bar = document.createElement('div');
    bar.className = 'edh-code-tools';
    bar.contentEditable = 'false';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', labels.tools);
    bar.dataset.language = current().node?.attrs?.language ?? '';

    const tag = document.createElement('span');
    tag.className = 'edh-code-language-label';
    tag.textContent = languageLabel(current().node?.attrs?.language ?? null);

    const select = document.createElement('select');
    select.className = 'edh-code-language';
    select.setAttribute('aria-label', labels.language);
    select.title = labels.language;
    for (const option of languageOptions(current().node?.attrs?.language ?? null, registry)) {
      const item = document.createElement('option');
      item.value = option.id;
      item.textContent = option.label;
      if (option.active) item.selected = true;
      select.append(item);
    }
    select.addEventListener('mousedown', event => event.stopPropagation());
    select.addEventListener('change', () => {
      const { pos } = current();
      if (typeof pos !== 'number') return;
      onLanguage?.({ pos, language: select.value === 'plaintext' ? null : select.value, view });
    });

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'edh-code-copy';
    copy.textContent = labels.copy;
    copy.title = labels.copy;
    copy.setAttribute('aria-label', labels.copy);
    copy.addEventListener('mousedown', event => event.stopPropagation());
    copy.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const copied = await onCopy?.(current().node?.textContent ?? '');
      copy.textContent = copied ? labels.copied : labels.copyFailed;
      copy.dataset.state = copied ? 'copied' : 'failed';
      clearTimeout(copy._resetTimer);
      copy._resetTimer = setTimeout(() => {
        copy.textContent = labels.copy;
        delete copy.dataset.state;
      }, COPY_FEEDBACK_MS);
    });

    bar.append(tag, select, copy);
    return bar;
  };
}

/**
 * Clipboard write that also works when the async Clipboard API is unavailable or
 * the document is not focused. Returns a boolean so the caller can show honest
 * feedback instead of a false success.
 */
export async function copyText(text, options = {}) {
  const value = String(text ?? '');
  if (!value) return false;
  const clipboard = 'clipboard' in options ? options.clipboard : globalThis.navigator?.clipboard;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  const doc = options.document ?? globalThis.document;
  if (!doc?.body) return false;
  const scratch = doc.createElement('textarea');
  scratch.value = value;
  scratch.setAttribute('readonly', '');
  scratch.setAttribute('aria-hidden', 'true');
  scratch.className = 'edh-copy-scratch';
  doc.body.append(scratch);
  try {
    scratch.select();
    const command = options.execCommand ?? doc.execCommand;
    if (typeof command !== 'function') return false;
    return command.call(doc, 'copy') !== false;
  } catch {
    return false;
  } finally {
    scratch.remove();
  }
}

export function createRichPlugin(options = {}) {
  const labels = { ...defaultLabels, ...(options.labels ?? {}) };
  const registry = options.registry ?? (() => null);
  const highlight = options.highlight;
  const cache = new Map();

  function rangesFor(language, text) {
    if (typeof highlight !== 'function') return [];
    const key = `${language ?? ''}\u0000${text}`;
    const cached = cache.get(key);
    if (cached) return cached;
    let ranges = [];
    try {
      const result = highlight(text, language);
      // Only decorate when highlight.js's parse tree reproduces the code
      // exactly; otherwise colours could drift from the visible characters.
      if (result && emitterMatchesSource(result, text)) ranges = tokenRanges(result);
    } catch {
      ranges = [];
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, ranges);
    return ranges;
  }

  const config = { labels, registry, onLanguage: options.onLanguage, onCopy: options.onCopy };
  const build = doc => buildDecorations(doc, rangesFor, config);

  return new Plugin({
    key: richPluginKey,
    state: {
      init(_config, state) {
        return { set: build(state.doc), composing: false };
      },
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(richPluginKey);
        // The composing flag lives in plugin state (not a closure) so it survives
        // the several transactions an IME composition produces.
        const composing = meta?.composing ?? value.composing;
        const mapped = value.set.map(tr.mapping, tr.doc);
        // While an IME composition is active, keep mapping the previous set
        // instead of rebuilding: a rebuild replaces text-wrapping DOM spans and
        // can cancel the composition. compositionend then requests the rebuild.
        if (composing && !meta?.rebuild) return { set: mapped, composing };
        if (!tr.docChanged && !meta?.rebuild) return { set: mapped, composing };
        return { set: build(newState.doc), composing: false };
      },
    },
    props: {
      decorations(state) {
        return richPluginKey.getState(state)?.set ?? null;
      },
      handleDOMEvents: {
        // These run on the editor element itself. Returning false leaves the
        // native IME behaviour (and ProseMirror's own handlers) untouched.
        compositionstart(view) {
          view.dispatch(view.state.tr.setMeta(richPluginKey, { composing: true }));
          return false;
        },
        compositionend(view) {
          view.dispatch(view.state.tr.setMeta(richPluginKey, { composing: false, rebuild: true }));
          return false;
        },
      },
    },
  });
}

/**
 * Fallback styles, written with `:where()` (specificity 0) so any application
 * rule targeting the same classes wins without `!important`. These exist only so
 * the toolbar is usable before the application stylesheet lands.
 */
const FALLBACK_CSS = `
:where(.edh-code-tools){display:flex;align-items:center;gap:8px;justify-content:flex-end;
  font:500 11px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif;letter-spacing:.02em;
  padding:2px 4px 4px;color:#7f8b9c;user-select:none}
:where(.edh-code-tools *){pointer-events:auto}
:where(.edh-code-language-label){margin-right:auto;padding-left:6px;opacity:.85}
:where(.edh-code-language){font:inherit;color:inherit;background:transparent;border:1px solid currentColor;
  border-radius:5px;padding:1px 4px;max-width:190px;opacity:.9}
:where(.edh-code-copy){font:inherit;color:inherit;background:transparent;border:1px solid currentColor;
  border-radius:5px;padding:2px 9px;cursor:pointer}
:where(.edh-code-copy[data-state=copied]){color:#2f8a5b}
:where(.edh-code-copy[data-state=failed]){color:#b4493c}
:where(.edh-copy-scratch){position:fixed;top:-1000px;left:-1000px;opacity:0}
:where(.edh-math-error){color:#b4493c;background:#fdf1ef;border:1px solid #e7c3bd;border-radius:5px;
  padding:1px 6px;font:12px/1.5 Consolas,monospace;white-space:normal;overflow-wrap:anywhere}
:where(.edh-math-block){display:block;overflow-x:auto;padding:4px 0}
:where(.edh-math-block[data-math-error]){padding:0}
`;

export function installRichStyles(doc = globalThis.document, id = 'edh-code-styles') {
  if (!doc?.head || doc.getElementById(id)) return false;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = FALLBACK_CSS;
  doc.head.append(style);
  return true;
}

export const _internals = { FALLBACK_CSS };
