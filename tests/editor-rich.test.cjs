const { test } = require('node:test');
const assert = require('node:assert/strict');
const hljs = require('highlight.js/lib/core');
const java = require('highlight.js/lib/languages/java');
const python = require('highlight.js/lib/languages/python');
hljs.registerLanguage('java', java);
hljs.registerLanguage('python', python);

const loadRich = () => import('../src/editor-rich.js');

// The plugin imports ProseMirror through `@tiptap/pm/*`, which resolves to the
// ESM build. Requiring prosemirror-view from a .cjs file would load the CJS
// build, giving a different `DecorationSet` class identity than the plugin
// produces. Import the same specifiers the application uses so identity holds.
let pm;
const loadPm = async () => {
  pm ??= {
    ...(await import('@tiptap/pm/model')),
    ...(await import('@tiptap/pm/state')),
    ...(await import('@tiptap/pm/view')),
  };
  return pm;
};

// A minimal node set matching the editor's code block: paragraph + codeBlock.
const makeSchema = Schema => new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    codeBlock: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      attrs: { language: { default: null } },
      toDOM: () => ['pre', ['code', 0]],
    },
    text: { group: 'inline' },
  },
});

const codeDoc = (schema, language, text) => schema.node('doc', null, [
  schema.node('codeBlock', { language }, text ? [schema.text(text)] : []),
]);

function highlight(code, language) {
  if (!language || !hljs.getLanguage(language)) return null;
  return hljs.highlight(code, { language, ignoreIllegals: true });
}
const registry = name => hljs.getLanguage(name)?.name ?? null;
const config = () => ({ labels: { copy: 'c', copied: 'ok', copyFailed: 'no', language: 'lang', tools: 'tools' }, registry, onLanguage: () => {}, onCopy: () => true });

/** Decorations introduced by the plugin, split by kind. */
const split = set => {
  const inline = [];
  const widgets = [];
  for (const decoration of set.find()) {
    if (typeof decoration.type?.attrs?.class === 'string') inline.push(decoration);
    else widgets.push(decoration);
  }
  return { inline, widgets };
};

/** Shared harness: one plugin plus schema/state factories from the ESM modules. */
const harness = async (pluginOptions = {}) => {
  const { createRichPlugin, richPluginKey } = await loadRich();
  const { Schema, EditorState, DecorationSet, TextSelection } = await loadPm();
  const schema = makeSchema(Schema);
  const plugin = createRichPlugin({ highlight, ...config(), ...pluginOptions });
  return {
    schema, EditorState, DecorationSet, TextSelection, plugin, richPluginKey,
    doc: (language, text) => codeDoc(schema, language, text),
  };
};
const decorations = (h, state) => h.richPluginKey.getState(state).set;

test('code decorations are highlight ranges plus exactly one toolbar widget', async () => {
  const h = await harness();
  const doc = h.doc('java', 'String s = "a<b>&c"; // 注释');
  const state = h.EditorState.create({ doc, plugins: [h.plugin] });
  const set = decorations(h, state);
  assert.ok(set instanceof h.DecorationSet, 'decorations must be a DecorationSet');
  const { inline, widgets } = split(set);
  assert.ok(inline.length >= 3, `expected several token ranges, got ${inline.length}`);
  assert.equal(widgets.length, 1);
  // Every range paints an hljs class and stays inside the code block.
  const codeStart = 1;
  const codeEnd = codeStart + doc.firstChild.textContent.length;
  for (const decoration of inline) {
    assert.match(decoration.type.attrs.class, /^hljs-/);
    assert.ok(decoration.from >= codeStart && decoration.to <= codeEnd, JSON.stringify(decoration));
  }
  // A range wraps the literal 'String', so offsets are character-exact.
  const text = doc.firstChild.textContent;
  const type = inline.find(d => d.type.attrs.class === 'hljs-type');
  assert.equal(text.slice(type.from - codeStart, type.to - codeStart), 'String');
  // Entities, quotes and CJK must not shift the comment range either.
  const comment = inline.find(d => d.type.attrs.class === 'hljs-comment');
  assert.equal(text.slice(comment.from - codeStart, comment.to - codeStart), '// 注释');
});

test('a code block with no language stays editable and uncoloured', async () => {
  const h = await harness();
  const state = h.EditorState.create({ doc: h.doc(null, 'SELECT 1'), plugins: [h.plugin] });
  const { inline, widgets } = split(decorations(h, state));
  assert.equal(inline.length, 0);
  assert.equal(widgets.length, 1, 'the toolbar is still offered for an unlabelled block');
});

test('an unknown language and huge code never produce decorations or throw', async () => {
  const h = await harness();
  for (const [language, text] of [['mermaid', 'graph TD;'], ['java', 'x'.repeat(30000)], ['java', '']]) {
    const state = h.EditorState.create({ doc: h.doc(language, text), plugins: [h.plugin] });
    assert.equal(split(decorations(h, state)).inline.length, 0, `unexpected decorations for ${language}/${text.length}`);
  }
  // Without a highlight function the toolbar still works and nothing is painted.
  const plain = await harness({ highlight: undefined });
  const state = plain.EditorState.create({ doc: plain.doc('java', 'int a = 1;'), plugins: [plain.plugin] });
  assert.equal(split(decorations(plain, state)).inline.length, 0);
  assert.equal(split(decorations(plain, state)).widgets.length, 1);
});

test('typing inside a code block re-derives colours from the new text', async () => {
  const h = await harness();
  let state = h.EditorState.create({ doc: h.doc('java', 'int a = 1;'), plugins: [h.plugin] });
  const before = split(decorations(h, state)).inline.map(d => d.type.attrs.class);
  assert.equal(before.includes('hljs-comment'), false);
  const end = state.doc.firstChild.nodeSize - 1;
  state = state.apply(state.tr.insertText(' // note', end));
  const after = split(decorations(h, state)).inline.map(d => d.type.attrs.class);
  assert.ok(after.includes('hljs-comment'), JSON.stringify(after));
  assert.notDeepEqual(after, before);
  assert.equal(state.doc.firstChild.textContent, 'int a = 1; // note');
});

test('a selection-only transaction keeps decorations mapped and cheap', async () => {
  const h = await harness();
  let state = h.EditorState.create({ doc: h.doc('java', 'int a = 1;'), plugins: [h.plugin] });
  const before = decorations(h, state);
  state = state.apply(state.tr.setSelection(h.TextSelection.create(state.doc, 2)));
  const after = decorations(h, state);
  // An equal decoration set lets the view skip all DOM work on caret moves.
  assert.equal(after.eq(before), true);
  assert.equal(state.doc.firstChild.textContent, 'int a = 1;');
});

test('decorations track an edit that shifts later code blocks', async () => {
  const h = await harness();
  const doc = h.schema.node('doc', null, [
    h.schema.node('paragraph', null, [h.schema.text('前言')]),
    h.schema.node('codeBlock', { language: 'java' }, [h.schema.text('int a = 1;')]),
  ]);
  let state = h.EditorState.create({ doc, plugins: [h.plugin] });
  const codePos = state.doc.firstChild.nodeSize;
  state = state.apply(state.tr.insertText('新增', codePos - 1));
  const { inline } = split(decorations(h, state));
  const text = state.doc.lastChild.textContent;
  assert.equal(text, 'int a = 1;');
  const type = inline.find(d => d.type.attrs.class === 'hljs-type');
  const codeStart = state.doc.firstChild.nodeSize + 1;
  assert.equal(text.slice(type.from - codeStart, type.to - codeStart), 'int');
});

test('an IME composition defers the rebuild until the composition ends', async () => {
  // Counting highlight calls makes "did a rebuild happen?" directly observable:
  // a mapped set must not invoke highlight.js at all.
  let highlightCalls = 0;
  const h = await harness({ highlight: (code, language) => { highlightCalls++; return highlight(code, language); } });
  let state = h.EditorState.create({ doc: h.doc('java', 'int a = 1;'), plugins: [h.plugin] });
  const callsAfterInit = highlightCalls;
  assert.ok(callsAfterInit > 0, 'the initial build highlights');
  // Enter composition and type: a rebuild here would replace the text DOM node
  // and can cancel the composition.
  state = state.apply(state.tr.setMeta(h.richPluginKey, { composing: true }));
  const end = state.doc.firstChild.nodeSize - 1;
  state = state.apply(state.tr.insertText('中', end));
  assert.equal(highlightCalls, callsAfterInit, 'typing mid-composition must not re-highlight');
  assert.equal(state.doc.firstChild.textContent, 'int a = 1;中');
  // The mapped set still paints something, shifted along with the insertion.
  assert.ok(decorations(h, state).find().length > 0);
  // compositionend requests a rebuild that reflects the committed text.
  state = state.apply(state.tr.setMeta(h.richPluginKey, { composing: false, rebuild: true }));
  assert.ok(highlightCalls > callsAfterInit, 'compositionend must re-highlight the committed text');
  const text = state.doc.firstChild.textContent;
  const type = decorations(h, state).find().find(d => d.type.attrs?.class === 'hljs-type');
  assert.equal(text.slice(type.from - 1, type.to - 1), 'int');
});

test('multiple code blocks each get their own toolbar and language key', async () => {
  const h = await harness();
  const doc = h.schema.node('doc', null, [
    h.schema.node('codeBlock', { language: 'java' }, [h.schema.text('int a = 1;')]),
    h.schema.node('paragraph', null, [h.schema.text('中间段落')]),
    h.schema.node('codeBlock', { language: 'python' }, [h.schema.text('def f(): pass')]),
    h.schema.node('codeBlock', { language: null }, []),
  ]);
  const state = h.EditorState.create({ doc, plugins: [h.plugin] });
  const { inline, widgets } = split(decorations(h, state));
  assert.equal(widgets.length, 3);
  assert.ok(inline.length > 0);
  // Each toolbar widget is anchored to a code block position, and every colour
  // range lies inside the code text of the block that owns it.
  const blocks = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') blocks.push({ pos, start: pos + 1, end: pos + 1 + node.textContent.length });
  });
  assert.equal(blocks.length, 3);
  for (const widget of widgets) assert.ok(blocks.some(b => b.pos === widget.from), `widget at ${widget.from} is not a code block start`);
  for (const decoration of inline) {
    assert.match(decoration.type.attrs.class, /^hljs-/);
    assert.ok(blocks.some(b => decoration.from >= b.start && decoration.to <= b.end), `range outside code: ${JSON.stringify(decoration)}`);
  }
  // Ranges belong to the language of the block that contains them.
  const javaClasses = inline.filter(d => d.from < blocks[1].pos).map(d => d.type.attrs.class);
  const pyClasses = inline.filter(d => d.from > blocks[1].pos).map(d => d.type.attrs.class);
  assert.ok(javaClasses.includes('hljs-type'), JSON.stringify(javaClasses));
  assert.ok(pyClasses.includes('hljs-keyword'), JSON.stringify(pyClasses));
});

test('copyText reports failure honestly and falls back to execCommand', async () => {
  const { copyText } = await loadRich();
  assert.equal(await copyText(''), false);
  assert.equal(await copyText('code', { clipboard: null, document: null }), false);
  // Async clipboard API works.
  let written = null;
  assert.equal(await copyText('hello', { clipboard: { writeText: async v => { written = v; } } }), true);
  assert.equal(written, 'hello');
  // A rejecting clipboard API falls back to the legacy document path.
  const doc = fakeDocument(() => true);
  const ok = await copyText('legacy', { clipboard: { writeText: async () => { throw new Error('denied'); } }, document: doc });
  assert.equal(ok, true);
  assert.equal(doc._selected, 'legacy');
  assert.equal(doc.body.children.length, 0, 'the scratch textarea must be removed');
  // An explicitly disabled clipboard must be honoured even when the runtime
  // also exposes a global clipboard.
  const explicit = fakeDocument(() => true);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => { throw new Error('must not be used'); } } },
    configurable: true,
  });
  try {
    assert.equal(await copyText('x', { clipboard: null, document: explicit }), true);
    assert.equal(explicit._selected, 'x');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
  // execCommand reporting failure must not be reported as success.
  const failing = fakeDocument(() => false);
  assert.equal(await copyText('nope', { clipboard: null, document: failing }), false);
  assert.equal(failing.body.children.length, 0);
});

function fakeDocument(execResult) {
  const doc = {
    _selected: null,
    body: {
      children: [],
      append(node) { this.children.push(node); node.parentNode = this; },
    },
    createElement() {
      return {
        className: '', value: '', parentNode: null,
        setAttribute() {},
        remove() { const i = doc.body.children.indexOf(this); if (i >= 0) doc.body.children.splice(i, 1); },
        select() { doc._selected = this.value; },
      };
    },
    execCommand(command) { assert.equal(command, 'copy'); return execResult(); },
  };
  return doc;
}

test('installRichStyles injects exactly one idempotent fallback stylesheet', async () => {
  const { installRichStyles, _internals } = await loadRich();
  const head = { children: [], append(node) { this.children.push(node); } };
  const doc = { head, getElementById: id => head.children.find(node => node.id === id) ?? null, createElement: () => ({ id: '', textContent: '' }) };
  assert.equal(installRichStyles(doc, 'edh-test'), true);
  assert.equal(head.children.length, 1);
  assert.equal(installRichStyles(doc, 'edh-test'), false);
  assert.equal(head.children.length, 1);
  assert.equal(installRichStyles(null, 'edh-none'), false);
  // The fallback sheet must be zero-specificity so the app stylesheet wins.
  assert.equal(/:where\(/.test(_internals.FALLBACK_CSS), true);
  assert.equal(/!important/.test(_internals.FALLBACK_CSS), false);
  for (const className of ['edh-code-tools', 'edh-code-language', 'edh-code-copy', 'edh-math-error', 'edh-math-block']) {
    assert.ok(_internals.FALLBACK_CSS.includes(className), `missing fallback for ${className}`);
  }
});

test('the toolbar widget re-reads live code instead of a stale snapshot', async () => {
  // The widget DOM is reused across edits, so copy must resolve the current text.
  const { toolsWidget } = await loadRich();
  const doc = fakeWidgetDocument();
  const previousDocument = globalThis.document;
  globalThis.document = doc;
  try {
    let copied = null;
    const widget = toolsWidget({
      labels: { copy: 'copy', copied: 'ok', copyFailed: 'no', language: 'lang', tools: 'tools' },
      registry, onLanguage: () => {}, onCopy: text => { copied = text; return true; },
    });
    let text = 'first';
    const dom = widget({ state: { doc: { nodeAt: () => ({ attrs: { language: 'java' }, textContent: text }) } } }, () => 0);
    assert.equal(dom.className, 'edh-code-tools');
    assert.equal(dom.contentEditable, 'false');
    text = 'second';
    for (const handler of dom.querySelector('.edh-code-copy')._listeners.click) {
      handler({ preventDefault() {}, stopPropagation() {} });
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(copied, 'second', 'copy must read the current node text');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

function fakeWidgetDocument() {
  const make = tag => {
    const el = {
      tagName: tag, className: '', children: [], _listeners: {}, dataset: {}, style: {}, selected: false,
      textContent: '', title: '', type: '', value: '',
      contentEditable: '', parentNode: null,
      setAttribute(name, value) { this[name] = value; },
      getAttribute(name) { return this[name]; },
      append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } },
      addEventListener(type, handler) { (this._listeners[type] ||= []).push(handler); },
      querySelector(selector) {
        const wanted = selector.replace(/^\./, '');
        for (const child of this.children) {
          if (String(child.className).split(/\s+/).includes(wanted)) return child;
          const nested = child.querySelector?.(selector);
          if (nested) return nested;
        }
        return null;
      },
      remove() {},
    };
    return el;
  };
  return { createElement: make, body: make('body'), head: make('head'), getElementById: () => null };
}
