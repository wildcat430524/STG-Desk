import {i18n, normalizeLocale, readLocalePreference} from './i18n.js';

// Bridge the renderer preference and the native process.
//
// Startup priority, highest first:
//   1. a choice the user makes in this window while initialization is running;
//   2. a broadcast from another window (its choice already reached native);
//   3. the preference this renderer saved in localStorage;
//   4. the preference the native process saved in settings.json;
//   5. Chinese (the i18n default).
//
// The initial read is asynchronous, so a window must never push its default
// locale before that read resolves: doing so would overwrite a native English
// preference with Chinese on every start. A failed push is also not recorded as
// confirmed, so a later switch retries instead of being silently deduplicated.
const SOURCE_INIT = 'native-init';

export function createNativeLanguageSync(instance = i18n, api, options = {}) {
  if (!instance || !api?.uiLanguage) return null;
  const storage = options.storage ?? (() => {
    try { return options.window?.localStorage ?? globalThis.localStorage; } catch { return null; }
  })();
  const storageKey = instance.storageKey;
  let lastConfirmed = null;   // last locale the native process acknowledged
  let inFlight = null;        // locale of the current native write
  const pendingLocales = new Map(); // number of queued + in-flight writes per locale
  let manual = false;         // this window chose while the initial read ran
  let broadcastSeen = false;  // another window's choice arrived first
  let readSettled = false;
  let disposed = false;
  let queue = Promise.resolve();

  const storedLocale = () => readLocalePreference(storage, storageKey);

  // Serialize native writes so two quick clicks cannot finish out of order and
  // leave settings.json on the older language. Superseded values are skipped.
  function push(locale) {
    const normalized = normalizeLocale(locale);
    // A pending write can still change native away from lastConfirmed. Queue a
    // return to that locale too, so the final click wins after the write settles.
    if (disposed || (normalized === lastConfirmed && pendingLocales.size === 0)) return queue;
    pendingLocales.set(normalized, (pendingLocales.get(normalized) ?? 0) + 1);
    queue = queue.catch(() => {}).then(async () => {
      try {
        if (disposed || normalized === lastConfirmed) return;
        if (normalizeLocale(instance.locale) !== normalized) return;
        inFlight = normalized;
        try {
          const confirmed = await api.uiLanguage(normalized);
          // Track what native actually saved, even if the UI has moved on:
          // a queued return to the previous language must still be persisted.
          lastConfirmed = normalizeLocale(confirmed ?? normalized);
        } catch {
          // Leave lastConfirmed untouched: the next language change must retry.
        } finally {
          if (inFlight === normalized) inFlight = null;
        }
      } finally {
        const remaining = pendingLocales.get(normalized) - 1;
        if (remaining) pendingLocales.set(normalized, remaining);
        else pendingLocales.delete(normalized);
      }
    });
    return queue;
  }

  const unsubscribe = instance.subscribe((locale, meta = {}) => {
    if (disposed) return;
    const source = meta.source ?? 'local';
    if (source === 'local') {
      manual = true;
      push(locale);
    } else if (source === 'storage') {
      // Another renderer saved it; that window owns the native write.
      broadcastSeen = true;
    } else if (source === 'native') {
      broadcastSeen = true;
    }
  });

  // A native broadcast is the shared, already-persisted choice. Record it in
  // this renderer without echoing it back to the native process. A broadcast
  // that merely echoes a write still pending here, while this window has moved
  // on to another language, is stale and must not undo the newer local choice.
  api.onUiLanguage?.(locale => {
    if (disposed) return;
    const normalized = normalizeLocale(locale);
    if (pendingLocales.has(normalized) && normalizeLocale(instance.locale) !== normalized) return;
    broadcastSeen = true;
    lastConfirmed = normalized;
    try {
      instance.setLocale(normalized, {persist: true, source: 'native', announce: normalized !== instance.locale});
    } catch { /* one window must not break the others */ }
  });

  // Decide what the native read means. If the user or another window chose in
  // the meantime, the late result is stale and must not overwrite that choice.
  function applyNativeLocale(locale) {
    readSettled = true;
    if (manual || broadcastSeen) return;
    const normalized = normalizeLocale(locale);
    const saved = storedLocale();
    if (saved) {
      // The renderer's own saved preference is authoritative for its UI.
      if (normalized === saved) lastConfirmed = normalized;
      else push(saved);
      return;
    }
    lastConfirmed = normalized;
    // Remember the adopted value so a later reload starts in the right language
    // without waiting for the asynchronous native read.
    if (normalized !== instance.locale) {
      instance.setLocale(normalized, {persist: true, source: SOURCE_INIT});
    } else {
      try { storage?.setItem?.(storageKey, normalized); } catch { /* storage unavailable */ }
    }
  }

  const reading = Promise.resolve()
    .then(() => api.uiLanguage())
    .then(locale => {
      if (disposed || !locale || readSettled) return;
      applyNativeLocale(locale);
    })
    .catch(() => { /* keep the restored/default renderer locale; pushes still retry */ });

  return {
    ready: reading,
    push,
    dispose() {
      disposed = true;
      unsubscribe?.();
    },
    get confirmed() { return lastConfirmed; },
    get inFlight() { return inFlight; },
  };
}

// Persist the renderer choice through the native process as well, so Electron
// window titles and OS dialogs use the same language after a restart.
export function mountNativeLanguageSync(api) {
  return createNativeLanguageSync(i18n, api);
}

// Keep the window/tab title in the active language. The main window is titled
// by the app; the floating DSH window names the current session.
export function watchDocumentTitle() {
  const dshOnly = document.body.classList.contains('dsh-only');
  const paint = () => {
    document.title = i18n.t(dshOnly ? 'app.dshWindowTitle' : 'app.title');
    const subtitle = document.querySelector('.native-titlebar span');
    if (subtitle) subtitle.textContent = i18n.t('app.nativeSubtitle');
  };
  paint();
  return i18n.subscribe(paint);
}
