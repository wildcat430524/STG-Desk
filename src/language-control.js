import {i18n, LOCALES} from './i18n.js';

// Language selector for every window: the main workspace header, the detached
// document toolbar, and the floating DSH menu. It is created after the other
// modules so their initial render can already read the restored preference, and
// it never reloads the page: switching only repaints labels through i18n
// subscribers. Drafts, unsaved answers and the active session stay in memory.
export function mountLanguageControl({dshOnly = false, documentOnly = false} = {}) {
  const doc = document;
  const group = doc.createElement('div');
  group.className = 'language-switch';
  group.id = 'app-language';
  group.setAttribute('role', 'group');

  const buttons = new Map();
  for (const locale of LOCALES) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'language-option';
    button.dataset.locale = locale;
    button.setAttribute('lang', locale === 'en' ? 'en' : 'zh-CN');
    button.setAttribute('aria-pressed', String(i18n.locale === locale));
    button.addEventListener('click', () => {
      const same = i18n.locale === locale;
      i18n.setLocale(locale);
      if (!same) buttons.get(locale)?.focus({preventScroll: true});
    });
    buttons.set(locale, button);
    group.append(button);
  }

  function sync() {
    for (const [locale, button] of buttons) {
      button.setAttribute('aria-pressed', String(i18n.locale === locale));
      const key = locale === 'en' ? 'language.en' : 'language.zh';
      button.textContent = i18n.t(key);
    }
    group.setAttribute('aria-label', i18n.t('language.label'));
    group.title = i18n.t('language.label');
  }

  // A single host per window: the workspace header (always present, so the
  // choice is available before any folder is imported), the detached document
  // toolbar, or the floating DSH overflow menu.
  const host = dshOnly
    ? doc.querySelector('#dsh-more-menu')
    : documentOnly
      ? doc.querySelector('.header-actions') || doc.querySelector('.topbar')
      : doc.querySelector('.workspace-header');
  if (host) {
    if (dshOnly) host.prepend(group); else host.append(group);
  }
  group.dataset.placement = dshOnly ? 'menu' : documentOnly ? 'detached' : 'header';

  i18n.subscribe(sync);
  sync();
  return {element: group, sync};
}
