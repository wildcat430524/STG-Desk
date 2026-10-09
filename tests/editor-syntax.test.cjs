const { test } = require('node:test');
const assert = require('node:assert/strict');
const hljs = require('highlight.js/lib/core');
const java = require('highlight.js/lib/languages/java');
const python = require('highlight.js/lib/languages/python');
const javascript = require('highlight.js/lib/languages/javascript');
const json = require('highlight.js/lib/languages/json');
for (const [name, language] of Object.entries({ java, python, javascript, json })) hljs.registerLanguage(name, language);

const load = () => import('../src/editor-syntax.mjs');

test('highlight.js scopes convert to the same CSS classes the reader emits', async () => {
  const { scopeToClass } = await load();
  assert.equal(scopeToClass('comment'), 'hljs-comment');
  assert.equal(scopeToClass('title.function'), 'hljs-title function_');
  assert.equal(scopeToClass('meta.string'), 'hljs-meta string_');
  assert.equal(scopeToClass('language:json'), 'language-json');
  assert.equal(scopeToClass(''), '');
  // Parity guard: the class string must equal what highlight.js itself writes.
  const html = hljs.highlight('// hi', { language: 'java' }).value;
  assert.ok(html.includes(`class="${scopeToClass('comment')}"`), html);
});

test('token ranges use exact source offsets and never mangle the code', async () => {
  const { tokenRanges, emitterMatchesSource } = await load();
  const code = 'String s = "a<b>&c"; // 注释 & <tag>';
  const result = hljs.highlight(code, { language: 'java', ignoreIllegals: true });
  const ranges = tokenRanges(result);
  assert.ok(ranges.length > 0);
  for (const range of ranges) {
    assert.ok(range.from >= 0 && range.to <= code.length, JSON.stringify(range));
    assert.ok(range.from < range.to, JSON.stringify(range));
    assert.ok(range.className.startsWith('hljs-'), range.className);
  }
  const type = ranges.find(r => r.className === 'hljs-type');
  assert.equal(code.slice(type.from, type.to), 'String');
  const comment = ranges.find(r => r.className === 'hljs-comment');
  assert.equal(code.slice(comment.from, comment.to), '// 注释 & <tag>');
  // Entities and quotes must not shift offsets.
  assert.equal(emitterMatchesSource(result, code), true);
});

test('token ranges stay ordered and inside bounds for CRLF, CJK, tabs and long code', async () => {
  const { tokenRanges, emitterMatchesSource } = await load();
  const samples = [
    ['java', 'int a = 1;\r\nint b = 2;\r\n'],
    ['java', '\tif (x) {\t\ty();\n}'],
    ['java', 'String 中文 = "emoji 🎉";'],
    ['java', ''],
    ['python', 'def f(x):\n    return f"{x!r}"  # 注释\n'],
    ['java', Array.from({ length: 300 }, (_, i) => `int v${i} = ${i}; // c${i}`).join('\n')],
  ];
  for (const [language, code] of samples) {
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    assert.equal(emitterMatchesSource(result, code), true, `emitter drift for ${language}`);
    const ranges = tokenRanges(result);
    for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i].from >= ranges[i - 1].from, 'ranges must be sorted');
    for (const range of ranges) assert.ok(range.to <= code.length, JSON.stringify({ code, range }));
  }
});

test('an unregistered language yields no ranges instead of throwing', async () => {
  const { tokenRanges } = await load();
  assert.equal(hljs.getLanguage('mermaid'), undefined);
  assert.deepEqual(tokenRanges(null), []);
  assert.deepEqual(tokenRanges(undefined), []);
  assert.deepEqual(tokenRanges({ value: '' }), []);
  assert.deepEqual(tokenRanges({ _emitter: { rootNode: { children: [] } } }), []);
});

test('the language catalog resolves aliases, registry names and unknown fences', async () => {
  const { resolveLanguage, languageOptions, languageLabel, LANGUAGE_CATALOG } = await load();
  // highlight.js resolves aliases to a canonical name (js -> JavaScript).
  const registry = name => hljs.getLanguage(name)?.name;
  assert.equal(registry('js'), 'JavaScript');
  assert.equal(resolveLanguage('java', registry), 'java');
  assert.equal(resolveLanguage('JAVA', registry), 'java');
  assert.equal(resolveLanguage('plaintext', registry), 'plaintext');
  assert.equal(resolveLanguage('', registry), null);
  assert.equal(resolveLanguage(null, registry), null);
  // A canonical registry name that no catalog entry claims keeps the raw id.
  assert.equal(resolveLanguage('python', registry), 'python');
  assert.equal(languageLabel('python'), 'Python');
  assert.equal(languageLabel('mermaid'), 'mermaid');
  assert.equal(languageLabel(''), '纯文本');
  const options = languageOptions('python', registry);
  assert.equal(options.filter(o => o.active).length, 1);
  assert.equal(options.find(o => o.active).id, 'python');
  const unknown = languageOptions('mermaid', registry);
  assert.equal(unknown.find(o => o.active)?.id, 'mermaid');
  const bare = languageOptions('', registry);
  assert.equal(bare[0].id, 'plaintext');
  assert.equal(bare[0].active, true);
  assert.ok(LANGUAGE_CATALOG.length >= 10);
});

test('a language picker never loses the currently saved fence language', async () => {
  const { languageOptions } = await load();
  const registry = name => hljs.getLanguage(name)?.name;
  for (const current of ['java', 'python', 'mermaid', 'fortran', 'JSON']) {
    const options = languageOptions(current, registry);
    const active = options.find(o => o.active);
    assert.ok(active, `no active option for ${current}`);
    assert.equal(active.id.toLowerCase(), current.toLowerCase(), `active option for ${current} was ${active.id}`);
  }
});

test('highlight goes through the shared hljs singleton the preview renderer uses', async () => {
  const { default: shared } = await import('highlight.js/lib/core');
  const editor = await import('../src/editor-highlight.mjs');
  assert.equal(editor.hljs, shared, 'editor and preview must share one hljs instance');
  assert.ok(editor.availableLanguages().includes('java'));
  // A language registered by main.js is visible to the editor and vice versa.
  assert.ok(shared.getLanguage('java'));
  assert.ok(shared.getLanguage('markdown'), 'preview language must remain registered');
  assert.equal(editor.languageRegistry('mermaid'), null);
  assert.equal(editor.languageRegistry('cs'),'csharp');
  assert.equal(editor.languageRegistry('c++'),'cpp');
  assert.equal(editor.languageRegistry('html'),'xml');
  assert.equal(editor.highlightCode('List<String> v = stream.toList();', 'java') !== null, true);
  assert.equal(editor.highlightCode('x = 1', 'mermaid'), null);
  assert.equal(editor.highlightCode('x = 1', ''), null);
  assert.equal(editor.highlightCode('', 'java'), null);
  assert.equal(editor.highlightCode('x'.repeat(30000), 'java'), null);
  assert.deepEqual(editor.registerEditorLanguages(), [], 'registering twice must be a no-op');
  assert.equal(shared.getLanguage('Java').name, 'Java');
});
