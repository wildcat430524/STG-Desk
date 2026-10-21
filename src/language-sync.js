import {i18n} from './i18n.js';

// Persist the renderer choice through the native process as well, so Electron
// window titles and OS dialogs use the same language after a restart. The
// renderer's own localStorage remains the immediate, reload-free source; this
// bridge is best effort and never blocks switching.
export function mountNativeLanguageSync(api) {
  if (!api?.uiLanguage) return;
  let last = null;
  const push = locale => {
    if (locale === last) return;
    last = locale;
    api.uiLanguage(locale).catch(() => {});
  };
  api.uiLanguage().then(locale => {
    if (!locale) return;
    // A saved native preference wins only when this window has never chosen one.
    try {
      if (!localStorage.getItem(i18n.storageKey)) i18n.setLocale(locale, {persist: false});
    } catch { /* storage unavailable */ }
    last = i18n.locale;
  }).catch(() => {});
  i18n.subscribe(push);
  push(i18n.locale);
  // Cross-window synchronization: the native process broadcasts the chosen
  // locale because file:// windows do not reliably receive `storage` events.
  // The receiving window records it locally too, so its own reload keeps the
  // same language even if the storage event never arrives. `last` is updated
  // first so this does not echo the same choice back to the native process.
  api.onUiLanguage?.(locale => {
    try {
      last = locale === 'zh-CN' ? 'zh-CN' : 'en';
      i18n.setLocale(locale);
    } catch { /* one window must not break the others */ }
  });
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
  i18n.subscribe(paint);
}
