import { answerSyntax } from './answer-syntax.mjs';
import { LANGUAGE_CATALOG, languageLabel } from './editor-syntax.mjs';import { answerIndent } from './answer-indent.mjs';
import { i18n } from './i18n.js';

// The native textarea owns input, selection, IME, undo and answer persistence.
// An inaccessible mirror only paints the same text beneath it.
export function mountAnswerEditor(input, { context = '', language = 'auto', onLanguage } = {}) {
  const t = (key, params) => i18n.t(key, params);
  const shell = document.createElement('div');
  shell.className = 'answer-editor';
  input.before(shell); shell.append(input);
  const mirror = document.createElement('pre');
  mirror.className = 'answer-input-highlight';
  mirror.setAttribute('aria-hidden', 'true');
  shell.prepend(mirror);
  const tools = input.closest('.question-card').querySelector('.answer-input-tools');
  const picker = document.createElement('select');
  picker.className = 'answer-code-language';
  picker.setAttribute('aria-label', t('editor.answerLanguageAria'));
  for (const item of [{ id: 'auto', label: t('editor.auto') }, ...LANGUAGE_CATALOG]) {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = item.id === 'plaintext' ? t('editor.plainText') : item.label; picker.append(option);
  }
  picker.value = language; tools.prepend(picker);
  const sync = () => {
    // Match the textarea's inner viewport, including space reserved for its
    // scrollbar; long lines and resize handles stay under native control.
    const style = getComputedStyle(input);
    for (const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','textIndent','tabSize','wordBreak','overflowWrap']) mirror.style[key] = style[key];
    mirror.style.width = input.clientWidth + 'px';
    mirror.style.height = input.clientHeight + 'px';
    mirror.style.top = input.clientTop + 'px'; mirror.style.left = input.clientLeft + 'px';
    mirror.scrollTop = input.scrollTop; mirror.scrollLeft = input.scrollLeft;
  };
  const paint = () => {
    const result = answerSyntax(input.value, { context, language: picker.value });
    shell.classList.toggle('answer-code', result.code);
    // An extra newline gives the mirror the same final empty line as textarea.
    mirror.innerHTML = result.html + '\n';
    picker.options[0].textContent = result.language ? t('editor.autoDetected', { language: languageLabel(result.language) }) : t('editor.auto');
    sync();
  };
  picker.addEventListener('change', () => { onLanguage?.(picker.value); paint(); });
  const indent = event => {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    const edit = answerIndent(input.value, input.selectionStart, input.selectionEnd, event.shiftKey);
    if (input.value.slice(edit.from, edit.to) === edit.text) return;
    const top = input.scrollTop, left = input.scrollLeft, direction = input.selectionDirection;
    input.setSelectionRange(edit.from, edit.to);
    // Chromium's native edit command preserves the textarea's undo history.
    if (!document.execCommand('insertText', false, edit.text)) {
      input.setRangeText(edit.text, edit.from, edit.to, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.setSelectionRange(edit.start, edit.end, direction);
    input.scrollTop = top; input.scrollLeft = left; sync();
  };
  input.addEventListener('keydown', indent);
  input.addEventListener('input', paint);
  input.addEventListener('scroll', sync);
  const resize = new ResizeObserver(sync); resize.observe(input);
  const preferences = new MutationObserver(sync);
  preferences.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-app-theme'] });
  // Language changes relabel the picker only; the answer text and the textarea's
  // selection/undo history are not touched.
  i18n.subscribe(() => {
    picker.setAttribute('aria-label', t('editor.answerLanguageAria'));
    picker.options[0].textContent = t('editor.auto');
    const plain = picker.querySelector('option[value="plaintext"]');
    if (plain) plain.textContent = t('editor.plainText');
    paint();
  });
  paint();
  return () => { resize.disconnect(); preferences.disconnect(); input.removeEventListener('keydown', indent); input.removeEventListener('input', paint); input.removeEventListener('scroll', sync); };
}
