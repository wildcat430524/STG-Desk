'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_PREFERENCES,
  clampPreferences,
  readSettings,
  updateSettings,
} = require('../lib/settings-store.cjs');

test('clampPreferences applies defaults and bounds safely', () => {
  assert.deepEqual(clampPreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(
    clampPreferences({ fontSize: 99, lineHeight: 0.5, readingWidth: 200, backupRetention: 500 }),
    { fontSize: 24, lineHeight: 1.4, readingWidth: 540, backupRetention: 100 },
  );
  assert.deepEqual(
    clampPreferences({ fontSize: 'bad', lineHeight: 2.0 }, { fontSize: 18 }),
    { fontSize: 18, lineHeight: 2.0, readingWidth: 820, backupRetention: 20 },
  );
});

test('concurrent updateSettings writes serialize atomically without losing keys or leaving temp files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-settings-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');

  await Promise.all([
    updateSettings(file, cur => ({ ...cur, language: 'en' })),
    updateSettings(file, cur => ({ ...cur, lastRoot: 'E:\\Learning' })),
    updateSettings(file, cur => ({ ...cur, preferences: clampPreferences({ fontSize: 18 }) })),
  ]);

  const saved = await readSettings(file);
  assert.equal(saved.language, 'en');
  assert.equal(saved.lastRoot, 'E:\\Learning');
  assert.equal(saved.preferences.fontSize, 18);

  const entries = await fs.readdir(dir);
  assert.deepEqual(entries, ['settings.json']);
});
