'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_PREFERENCES = Object.freeze({
  fontSize: 16,
  lineHeight: 1.9,
  readingWidth: 820,
  backupRetention: 20,
});

const queues = new Map();

function isTransientRenameError(error) {
  return Boolean(error && (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES'));
}

async function atomicRename(source, target, { retries = 4, baseDelayMs = 25 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      if (attempt >= retries || !isTransientRenameError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * (attempt + 1)));
    }
  }
}

function clampPreferences(value, current = DEFAULT_PREFERENCES) {
  const base = { ...DEFAULT_PREFERENCES, ...(current && typeof current === 'object' ? current : {}) };
  if (!value || typeof value !== 'object') return base;
  return {
    fontSize: Math.max(13, Math.min(24, Number(value.fontSize) || base.fontSize)),
    lineHeight: Math.max(1.4, Math.min(2.4, Number(value.lineHeight) || base.lineHeight)),
    readingWidth: Math.max(540, Math.min(1200, Number(value.readingWidth) || base.readingWidth)),
    backupRetention: Math.max(5, Math.min(100, Number(value.backupRetention) || base.backupRetention)),
  };
}

async function readSettings(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function updateSettings(filePath, updater) {
  const key = path.resolve(filePath);
  const previous = queues.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const current = await readSettings(filePath);
    const next = typeof updater === 'function' ? await updater(current) : { ...current, ...updater };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
      await atomicRename(tmp, filePath);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
    return next;
  });
  queues.set(key, task);
  return task.finally(() => {
    if (queues.get(key) === task) queues.delete(key);
  });
}

module.exports = {
  DEFAULT_PREFERENCES,
  atomicRename,
  clampPreferences,
  readSettings,
  updateSettings,
};
