// Pure syntax-highlight helpers shared by the visual editor.
//
// The visual editor must never rewrite code text: highlight.js is used only to
// derive (from,to,className) ranges, which ProseMirror then paints as inline
// decorations. Non-text decorations cannot change the document, so selections,
// IME composition and the saved Markdown stay byte-identical.
//
// The scope -> class mapping mirrors highlight.js's own `scopeToCSSClass`
// (node_modules/highlight.js/lib/core.js) so a range painted here looks exactly
// like the same code rendered by the read-only Markdown preview.

export const CLASS_PREFIX = 'hljs-';

/**
 * Convert a highlight.js scope to its CSS class string, exactly like
 * highlight.js's internal renderer does.
 *   'comment'      -> 'hljs-comment'
 *   'title.function' -> 'hljs-title function_'
 *   'language:json'  -> 'language-json'
 */
export function scopeToClass(scope, prefix = CLASS_PREFIX) {
  const name = String(scope ?? '');
  if (!name) return '';
  if (name.startsWith('language:')) return name.replace('language:', 'language-');
  if (name.includes('.')) {
    const pieces = name.split('.');
    return [`${prefix}${pieces.shift()}`, ...pieces.map((x, i) => `${x}${'_'.repeat(i + 1)}`)].join(' ');
  }
  return `${prefix}${name}`;
}

/** Depth-first walk of a highlight.js emitter node, yielding (node, text, offset). */
function* walk(node, offset = 0) {
  let cursor = offset;
  for (const child of node?.children ?? []) {
    if (typeof child === 'string') {
      if (child) yield { node: null, text: child, offset: cursor };
      cursor += child.length;
      continue;
    }
    const text = nodeText(child);
    yield { node: child, text, offset: cursor };
    yield* walk(child, cursor);
    cursor += text.length;
  }
}

function nodeText(node) {
  let out = '';
  for (const child of node?.children ?? []) out += typeof child === 'string' ? child : nodeText(child);
  return out;
}

/**
 * Extract sorted, non-overlapping-per-sibling class ranges from a
 * `hljs.highlight()` result. Offsets are 0-based positions into `code`, so the
 * caller can offset them by the code block's text start.
 *
 * Returns `[]` for empty input, unknown languages, or any malformed tree: a
 * failed highlight degrades to plain but still fully editable text.
 */
export function tokenRanges(result, options = {}) {
  const max = options.maxLength ?? 200000;
  const prefix = options.prefix ?? CLASS_PREFIX;
  const emitter = result?._emitter;
  if (!emitter?.rootNode) return [];
  const ranges = [];
  for (const { node, text, offset } of walk(emitter.rootNode)) {
    if (!node || !node.scope || !text) continue;
    const from = offset;
    const to = offset + text.length;
    if (to <= from || to - from > max) continue;
    const className = scopeToClass(node.scope, prefix);
    if (className) ranges.push({ from, to, className });
  }
  // Sort outer-before-inner so ProseMirror nests rather than crosses ranges.
  ranges.sort((a, b) => a.from - b.from || b.to - a.to || a.className.localeCompare(b.className));
  return ranges;
}

/**
 * Visible-text length check: highlight.js's emitter tree is required to
 * reproduce the input exactly. When it does not (a future hljs release or a
 * sublanguage surprise), the caller skips decorating rather than risking
 * misaligned colours.
 */
export function emitterMatchesSource(result, code) {
  const emitter = result?._emitter;
  if (!emitter?.rootNode) return false;
  return nodeText(emitter.rootNode) === code;
}

/** Curated languages offered in the code-block language picker. */
export const LANGUAGE_CATALOG = [
  { id: 'plaintext', label: '纯文本' },
  { id: 'java', label: 'Java', focus: true },
  { id: 'python', label: 'Python', focus: true },
  { id: 'javascript', label: 'JavaScript', focus: true },
  { id: 'typescript', label: 'TypeScript', focus: true },
  { id: 'json', label: 'JSON' },
  { id: 'bash', label: 'Shell / Bash', focus: true },
  { id: 'sql', label: 'SQL' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'css', label: 'CSS' },
  { id: 'cpp', label: 'C / C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'diff', label: 'Diff' },
];

/**
 * Canonical language id for a fence info string, using the catalog first and
 * the runtime registry second (so aliases like `js` resolve to a real language).
 * Returns null when nothing can highlight it.
 */
export function resolveLanguage(name, registry) {
  const raw = String(name ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (LANGUAGE_CATALOG.some(entry => entry.id === raw)) return raw;
  const known = registry?.(raw) ?? null;
  if (!known) return null;
  const canonical = String(known).toLowerCase();
  return LANGUAGE_CATALOG.some(entry => entry.id === canonical) ? canonical : raw;
}

/**
 * Language options for the picker: the catalog, annotated with the id each
 * option should be written into Markdown, plus `active` for the current fence.
 * Unknown-but-registered languages are appended so nothing is silently lost.
 */
export function languageOptions(current, registry) {
  const active = resolveLanguage(current, registry) ?? (current ? String(current).toLowerCase() : '');
  const options = LANGUAGE_CATALOG.map(entry => ({ ...entry, active: entry.id === active }));
  if (active && !options.some(entry => entry.id === active)) {
    options.splice(1, 0, { id: active, label: `${active}（当前）`, active: true });
  }
  if (!options.some(entry => entry.active)) options[0] = { ...options[0], active: true };
  return options;
}

/** Display label for a fence language, falling back to the raw string. */
export function languageLabel(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '纯文本';
  const entry = LANGUAGE_CATALOG.find(item => item.id === raw.toLowerCase());
  return entry ? entry.label : raw;
}
