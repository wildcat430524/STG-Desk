const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('../src/i18n.js');

const SRC = path.join(__dirname, '../src');

/** Read every renderer module so dictionary keys can be cross-checked. */
function rendererSources() {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(SRC);
  return files;
}

test('every message has both Chinese and English copy with matching placeholders', async () => {
  const { MESSAGES } = await load();
  const keys = Object.keys(MESSAGES);
  assert.ok(keys.length >= 150, `expected a full dictionary, got ${keys.length} keys`);
  for (const key of keys) {
    const entry = MESSAGES[key];
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'zh'], `${key} must define exactly zh and en`);
    for (const locale of ['zh', 'en']) {
      assert.equal(typeof entry[locale], 'string', `${key}.${locale} must be a string`);
      assert.ok(entry[locale].trim().length > 0, `${key}.${locale} must not be empty`);
    }
    const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(placeholders(entry.en), placeholders(entry.zh),
      `${key} translates a different set of {placeholders} in English`);
  }
});

test('translation never returns a key for a missing entry and interpolates safely', async () => {
  const { translate, interpolate } = await load();
  assert.equal(translate('en', 'dsh.copy'), 'Copy');
  assert.equal(translate('zh-CN', 'dsh.copy'), '复制');
  assert.equal(translate('en', 'not.a.real.key'), 'not.a.real.key');
  assert.equal(translate('zh-CN', 'answer.charCount', { n: 12 }), '12 字');
  assert.equal(translate('en', 'answer.charCount', { n: 12 }), '12 characters');
  // A placeholder with no supplied value stays visible rather than becoming "undefined".
  assert.equal(interpolate('{a} / {b}', { a: 1 }), '1 / {b}');
  assert.equal(interpolate('no placeholders', {}), 'no placeholders');
});

test('unknown or malformed locales fall back to Chinese', async () => {
  const { normalizeLocale, translate, DEFAULT_LOCALE } = await load();
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  for (const value of [undefined, null, '', 'zh', 'zh-CN', 'fr-FR', 'de']) assert.equal(normalizeLocale(value), 'zh-CN');
  for (const value of ['en', 'EN', 'en-US', 'en-GB']) assert.equal(normalizeLocale(value), 'en');
  assert.equal(translate('fr-FR', 'dsh.copy'), '复制');
});

test('the stored preference is restored, defaulted, and survives malformed storage', async () => {
  const { readStoredLocale, createI18n, STORAGE_KEY } = await load();
  const storageOf = initial => {
    const map = new Map(Object.entries(initial || {}));
    return {
      getItem: key => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
    };
  };
  assert.equal(readStoredLocale(storageOf({ [STORAGE_KEY]: 'en' })), 'en');
  assert.equal(readStoredLocale(storageOf({})), 'zh-CN');
  assert.equal(readStoredLocale(storageOf({ [STORAGE_KEY]: 'bogus' })), 'zh-CN');
  // A throwing/absent storage must not prevent the app from starting.
  assert.equal(readStoredLocale({ getItem() { throw new Error('blocked'); } }), 'zh-CN');
  assert.equal(readStoredLocale(null), 'zh-CN');

  const storage = storageOf({ [STORAGE_KEY]: 'en' });
  const i18n = createI18n({ storage, locale: undefined });
  assert.equal(i18n.locale, 'en', 'a restored English preference is used on startup');
  assert.equal(i18n.t('doc.saved'), 'Saved');

  const fresh = createI18n({ storage: storageOf({}) });
  assert.equal(fresh.locale, 'zh-CN', 'no saved preference keeps Chinese behaviour');

  fresh.setLocale('en');
  assert.equal(storage.getItem(STORAGE_KEY), 'en', 'the choice is saved locally');
  assert.equal(fresh.locale, 'en');
  assert.equal(fresh.t('doc.saved'), 'Saved');

  // Selecting the language already active still repaints but must not lose state.
  let repaints = 0;
  fresh.subscribe(() => { repaints += 1; });
  fresh.setLocale('en');
  assert.equal(repaints, 1);
  fresh.setLocale('zh-CN');
  assert.equal(repaints, 2);
  assert.equal(fresh.t('doc.saved'), '已保存');
});

test('a language change propagates to other windows through the storage event', async () => {
  const { createI18n, STORAGE_KEY } = await load();
  let stored = 'zh-CN';
  // Each window has its own event listeners, like real BrowserWindows: a window
  // never receives its own storage event.
  const makeWindow = () => {
    const listeners = new Map();
    return {
      localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = String(value); } },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      dispatchEvent(event) {
        for (const listener of listeners.get(event.type) || []) listener(event);
        return true;
      },
      emit(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    };
  };
  const firstWindow = makeWindow();
  const secondWindow = makeWindow();
  const first = createI18n({ window: firstWindow, storage: firstWindow.localStorage });
  const second = createI18n({ window: secondWindow, storage: { getItem: () => stored, setItem: () => {} } });

  const seen = [];
  second.subscribe(locale => seen.push(locale));
  first.setLocale('en');
  assert.equal(stored, 'en');
  assert.equal(first.locale, 'en');
  assert.equal(second.locale, 'zh-CN', 'another window is untouched until the browser delivers the storage event');
  // The browser delivers a storage event to the other window, which restores the
  // same preference without writing it back.
  secondWindow.emit({ type: 'storage', key: STORAGE_KEY, newValue: 'en' });
  assert.equal(second.locale, 'en');
  assert.deepEqual(seen, ['en'], 'subscribers repaint exactly once');
  assert.equal(stored, 'en');

  // An unrelated storage key is ignored.
  secondWindow.emit({ type: 'storage', key: 'stg-app-theme', newValue: 'dark' });
  assert.equal(second.locale, 'en');
  assert.deepEqual(seen, ['en']);
});

test('static markup is translated through explicit keys, and unknown elements are untouched', async () => {
  const { createI18n } = await load();
  const makeElement = (text, attrs = {}) => {
    const map = new Map(Object.entries(attrs));
    return {
      textContent: text,
      getAttribute: name => (map.has(name) ? map.get(name) : null),
      setAttribute: (name, value) => map.set(name, value),
      attrs: map,
    };
  };
  const textNode = makeElement('导入学习文件夹', { 'data-i18n': 'header.import' });
  const titleNode = makeElement('', { 'data-i18n-title': 'header.refreshTitle' });
  const ariaNode = makeElement('', { 'data-i18n-aria-label': 'language.label' });
  const placeholder = makeElement('', { 'data-i18n-placeholder': 'answer.placeholder' });
  const userContent = makeElement('用户的真实文档内容');
  const missing = makeElement('保留原文', { 'data-i18n': 'no.such.key' });
  const paramsNode = makeElement('', { 'data-i18n': 'answer.charCount', 'data-i18n-params': '{"n":7}' });

  const doc = {
    documentElement: { lang: '', dataset: {} },
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return [textNode, missing, paramsNode];
      if (selector === '[data-i18n-title]') return [titleNode];
      if (selector === '[data-i18n-placeholder]') return [placeholder];
      if (selector === '[data-i18n-aria-label]') return [ariaNode];
      return [];
    },
  };
  const i18n = createI18n({ document: doc, storage: { getItem: () => null, setItem: () => {} } });
  i18n.apply();
  assert.equal(textNode.textContent, '导入学习文件夹');
  assert.equal(missing.textContent, '保留原文', 'a key typo leaves copy rather than blanking the UI');
  assert.equal(paramsNode.textContent, '7 字');
  assert.equal(titleNode.attrs.get('title'), '刷新当前文档和学习进度');
  assert.equal(ariaNode.attrs.get('aria-label'), '界面语言');
  assert.equal(placeholder.attrs.get('placeholder'), '写下你的理解，或粘贴代码…');
  assert.equal(userContent.textContent, '用户的真实文档内容');
  assert.equal(doc.documentElement.lang, 'zh-CN');

  i18n.setLocale('en');
  assert.equal(textNode.textContent, 'Import learning folder');
  assert.equal(paramsNode.textContent, '7 characters');
  assert.equal(placeholder.attrs.get('placeholder'), 'Write your understanding, or paste code…');
  assert.equal(userContent.textContent, '用户的真实文档内容', 'unkeyed user text is never translated');
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(doc.documentElement.dataset.language, 'en');
});

test('every data-i18n key in renderer markup and every literal t() key exists in the dictionary', async () => {
  const { MESSAGES } = await load();
  const missing = [];
  for (const file of rendererSources()) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(SRC, file);
    for (const match of source.matchAll(/data-i18n(?:-title|-placeholder|-aria-label|-alt)?="([^"]+)"/g)) {
      if (!Object.hasOwn(MESSAGES, match[1])) missing.push(`${relative}: ${match[1]}`);
    }
    // Literal keys only; template/derived keys are listed explicitly below.
    for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z][\w.-]*)'/g)) {
      if (!Object.hasOwn(MESSAGES, match[1])) missing.push(`${relative}: ${match[1]}`);
    }
  }
  // Dynamic key families are built from these prefixes at runtime.
  const derived = ['kind.', 'language.'];
  const derivedKeys = ['guide', 'answer', 'route', 'profile', 'rules', 'material', 'document'];
  for (const prefix of derived.slice(0, 1)) for (const suffix of derivedKeys) {
    assert.ok(Object.hasOwn(MESSAGES, prefix + suffix), `missing derived key ${prefix}${suffix}`);
  }
  assert.ok(derived.includes('language.'));
  assert.deepEqual(missing, [], `dictionary is missing keys used by the UI:\n${missing.join('\n')}`);
});

test('formula diagnostics are localized without rewriting generated KaTeX text', async () => {
  const { localizeFormulaError } = await load();
  const t = key => ({ 'formula.empty': 'Formula is empty', 'formula.tooLong': 'Formula is too long' }[key] ?? key);
  assert.equal(localizeFormulaError('公式内容为空', t), 'Formula is empty');
  assert.equal(localizeFormulaError('公式过长，已跳过渲染', t), 'Formula is too long');
  // A KaTeX parse error is generated text, not application chrome.
  assert.equal(localizeFormulaError('Expected \'}\', got \'EOF\'', t), 'Expected \'}\', got \'EOF\'');
  assert.equal(localizeFormulaError('公式内容为空'), '公式内容为空');
});

test('only fixed context-role labels are translated; document link text is kept', async () => {
  const { localizeRoleLabel } = await load();
  const t = key => ({
    'role.teachingGuide': 'Teaching guide',
    'role.studentAnswers': 'Student answers',
    'role.profile': 'Learning profile',
  }[key] ?? key);
  assert.equal(localizeRoleLabel('教学引导', t), 'Teaching guide');
  assert.equal(localizeRoleLabel('学生回答', t), 'Student answers');
  assert.equal(localizeRoleLabel('学习档案', t), 'Learning profile');
  // A guide's own link label or a file name is document content, not a role.
  assert.equal(localizeRoleLabel('第 2 轮补充材料', t), '第 2 轮补充材料');
  assert.equal(localizeRoleLabel('01_教学引导.md', t), '01_教学引导.md');
  assert.equal(localizeRoleLabel('教学引导'), '教学引导', 'no translator keeps the source label');
});

test('the native process shares the same stored language preference', () => {
  const localization = require('../electron/localization.cjs');
  assert.equal(localization.normalize('en-US'), 'en');
  assert.equal(localization.normalize('zh-CN'), 'zh-CN');
  assert.equal(localization.normalize(undefined), 'zh-CN');
  assert.equal(localization.translate('en', 'app.title'), 'STG Desk · Learning Workspace');
  assert.equal(localization.translate('zh-CN', 'app.title'), 'STG Desk · 学习工作台');
  assert.equal(localization.translate('en', 'app.documentWindowTitle', { kind: 'Teaching document', name: '01_教学引导.md' }),
    'Teaching document · 01_教学引导.md');
  assert.equal(localization.translate('en', 'dialog.importTitle'), 'Import a StepsToGreat folder');
  assert.equal(localization.translate('zh-CN', 'dialog.importTitle'), '导入 StepsToGreat 文件夹');
  // Unknown keys fall back to the Chinese source string instead of an empty dialog.
  assert.equal(localization.translate('en', 'dialog.unknownKey'), 'dialog.unknownKey');
  assert.equal(localization.readLocale('{"language":"en"}'), 'en');
  assert.equal(localization.readLocale('{"language":"fr"}'), 'zh-CN');
  assert.equal(localization.readLocale('not json'), 'zh-CN');
  assert.equal(localization.readLocale(''), 'zh-CN');
  // zh and en tables expose the same keys, so the main process cannot drift.
  assert.deepEqual(Object.keys(localization.EN).sort(), Object.keys(localization.ZH).sort());
});
