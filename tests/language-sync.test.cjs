const test = require('node:test');
const assert = require('node:assert/strict');

const loadI18n = () => import('../src/i18n.js');
const loadSync = () => import('../src/language-sync.js');

const tick = () => new Promise(resolve => setImmediate(resolve));

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

// A native bridge double with an explicit, deferred initial read. `calls`
// records every write so an early default push is visible in the assertions.
function nativeBridge() {
  let resolveRead;
  let rejectRead;
  const calls = [];
  const listeners = [];
  const read = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
  return {
    calls,
    resolve(locale) { resolveRead(locale); },
    reject(error) { rejectRead(error); },
    succeed(locale) { calls.push(locale); return Promise.resolve(locale); },
    fail(locale) { calls.push(locale); return Promise.reject(new Error('ipc failed')); },
    uiLanguage(value) {
      if (value === undefined) return read;
      return this._write ? this._write(value) : this.succeed(value);
    },
    onUiLanguage(listener) { listeners.push(listener); },
    broadcast(locale) { for (const listener of listeners) listener(locale); },
  };
}

test('startup adopts the native preference instead of overwriting it with the default', async () => {
  const {createI18n, STORAGE_KEY} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage();
  const window = {localStorage: storage};
  const i18n = createI18n({window, storage});
  const api = nativeBridge('en');
  const sync = createNativeLanguageSync(i18n, api, {window, storage});
  assert.equal(i18n.locale, 'zh-CN', 'renderer default before the asynchronous read');
  // No write may happen while the initial read is outstanding.
  assert.deepEqual(api.calls, [], 'the default locale is not pushed before the native read resolves');
  api.resolve('en');
  await sync.ready;
  await tick();
  assert.equal(i18n.locale, 'en', 'native English is adopted');
  assert.deepEqual(api.calls, [], 'adopting native state does not echo a write back');
  assert.equal(storage.getItem(STORAGE_KEY), 'en', 'the adopted preference is remembered for the next reload');
  sync.dispose();
});

test('the renderer preference wins over a stale native read', async () => {
  const {createI18n, STORAGE_KEY} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage({[STORAGE_KEY]: 'en'});
  const window = {localStorage: storage};
  const i18n = createI18n({window, storage});
  const api = nativeBridge('zh-CN');
  const sync = createNativeLanguageSync(i18n, api, {window, storage});
  assert.equal(i18n.locale, 'en', 'local preference is applied immediately');
  api.resolve('zh-CN');
  await sync.ready;
  await tick();
  assert.equal(i18n.locale, 'en', 'the late native read does not overwrite the local choice');
  assert.deepEqual(api.calls, ['en'], 'the local preference is written back to native');
  assert.equal(storage.getItem(STORAGE_KEY), 'en');
  sync.dispose();
});

test('a manual choice during initialization is not overwritten by the late read', async () => {
  const {createI18n} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage();
  const window = {localStorage: storage};
  const i18n = createI18n({window, storage});
  const api = nativeBridge('en');
  const sync = createNativeLanguageSync(i18n, api, {window, storage});
  i18n.setLocale('zh-CN'); // explicit user selection while the read is pending
  await tick();
  assert.deepEqual(api.calls, ['zh-CN'], 'an explicit choice is persisted immediately');
  api.resolve('en');
  await sync.ready;
  await tick();
  assert.equal(i18n.locale, 'zh-CN', 'the late English read must not undo the user choice');
  assert.equal(storage.getItem('stg-app-language'), 'zh-CN');
  sync.dispose();
});

test('a native broadcast is applied without echoing it back', async () => {
  const {createI18n} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage();
  const window = {localStorage: storage};
  const i18n = createI18n({window, storage});
  const api = nativeBridge('zh-CN');
  const sync = createNativeLanguageSync(i18n, api, {window, storage});
  api.resolve('zh-CN');
  await sync.ready;
  api.calls.length = 0;
  api.broadcast('en');
  await tick();
  assert.equal(i18n.locale, 'en');
  assert.deepEqual(api.calls, [], 'a broadcast is not written back to the native process');
  assert.equal(storage.getItem('stg-app-language'), 'en', 'the broadcast is recorded for reloads');
  api.broadcast('en');
  assert.deepEqual(api.calls, [], 'a repeated broadcast stays silent');
  sync.dispose();
});

test('a failed native write is retried on the next change instead of being deduplicated', async () => {
  const {createI18n} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage();
  const window = {localStorage: storage};
  const i18n = createI18n({window, storage});
  const api = nativeBridge('zh-CN');
  api.resolve('zh-CN');
  const sync = createNativeLanguageSync(i18n, api, {window, storage});
  await sync.ready;
  await tick();
  api.calls.length = 0;

  api._write = locale => api.fail(locale);
  i18n.setLocale('en');
  await tick();
  await tick();
  assert.deepEqual(api.calls, ['en']);
  assert.notEqual(sync.confirmed, 'en', 'a rejected write is not recorded as confirmed');

  // Setting the same locale again must retry, not be suppressed by `last`.
  api._write = locale => api.succeed(locale);
  i18n.setLocale('en');
  await tick();
  await tick();
  assert.deepEqual(api.calls, ['en', 'en'], 'the next attempt retries the failed write');
  assert.equal(sync.confirmed, 'en');
  i18n.setLocale('en');
  await tick();
  assert.deepEqual(api.calls, ['en', 'en'], 'a confirmed locale is not written again');
  sync.dispose();
});

test('rapid switches write only the final language and keep native order', async () => {
  const {createI18n} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage();
  const window = {localStorage: storage};
  const i18n = createI18n({window, storage});
  const api = nativeBridge('zh-CN');
  api.resolve('zh-CN');
  const sync = createNativeLanguageSync(i18n, api, {window, storage});
  await sync.ready;
  await tick();
  api.calls.length = 0;

  let release;
  api._write = locale => {
    api.calls.push(locale);
    return new Promise(resolve => { release = () => resolve(locale); });
  };
  i18n.setLocale('en');
  i18n.setLocale('zh-CN');
  i18n.setLocale('en');
  await tick();
  assert.deepEqual(api.calls, ['en'], 'only the first write is in flight');
  release();
  await tick();
  await tick();
  assert.deepEqual(api.calls, ['en'], 'superseded intermediate choices are skipped, and the already-confirmed final language is not rewritten');
  assert.equal(sync.confirmed, 'en');
  sync.dispose();
});

test('switching back while a write is pending persists the final choice', async () => {
  const {createI18n} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage();
  const instance = createI18n({storage});
  const api = nativeBridge();
  api.resolve('zh-CN');
  const sync = createNativeLanguageSync(instance, api, {storage});
  await sync.ready;
  let release;
  api._write = locale => {
    api.calls.push(locale);
    if (locale === 'en') return new Promise(resolve => {
      release = () => { api.broadcast(locale); resolve(locale); };
    });
    api.broadcast(locale);
    return Promise.resolve(locale);
  };
  instance.setLocale('en');
  await tick();
  instance.setLocale('zh-CN');
  release();
  await tick();
  assert.deepEqual(api.calls, ['en', 'zh-CN']);
  assert.equal(instance.locale, 'zh-CN');
  assert.equal(sync.confirmed, 'zh-CN');
  sync.dispose();
});

test('dispose stops native writes and unsubscribes', async () => {
  const {createI18n} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage();
  const window = {localStorage: storage};
  const i18n = createI18n({window, storage});
  const api = nativeBridge('zh-CN');
  api.resolve('zh-CN');
  const sync = createNativeLanguageSync(i18n, api, {window, storage});
  await sync.ready;
  await tick();
  api.calls.length = 0;
  sync.dispose();
  i18n.setLocale('en');
  await tick();
  assert.deepEqual(api.calls, [], 'no write after dispose');
});

test('a rejected initial read keeps the restored renderer choice and still allows pushes', async () => {
  const {createI18n, STORAGE_KEY} = await loadI18n();
  const {createNativeLanguageSync} = await loadSync();
  const storage = memoryStorage({[STORAGE_KEY]: 'en'});
  const window = {localStorage: storage};
  const i18n = createI18n({window, storage});
  const api = nativeBridge(undefined);
  api.reject(new Error('native unavailable'));
  const sync = createNativeLanguageSync(i18n, api, {window, storage});
  await sync.ready;
  assert.equal(i18n.locale, 'en', 'a failed read cannot reset the saved renderer preference');
  i18n.setLocale('zh-CN');
  await tick();
  assert.deepEqual(api.calls, ['zh-CN'], 'later choices still reach the native process');
  sync.dispose();
});
