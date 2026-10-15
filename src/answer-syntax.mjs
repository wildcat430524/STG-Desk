import { highlightCode, languageRegistry } from './editor-highlight.mjs';

const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inferLanguage(text, context) {
  if (/^\s*(?:import\s+java\.|package\s+[\w.]+;)|\b(?:System\.out\.|public\s+(?:static|class|void)|Runnable\b|List<)/m.test(text)) return 'java';
  if (/^\s*(?:def\s+\w+\(|from\s+\w+\s+import\b|print\s*\(|if\s+__name__)/m.test(text)) return 'python';
  if (/^\s*(?:const|let|var|function)\s+|=>|console\.(?:log|error)\(/m.test(text)) return 'javascript';
  if (/^\s*(?:SELECT\b.+\bFROM|INSERT\s+INTO|CREATE\s+TABLE)/im.test(text)) return 'sql';
  // A question's explicit code language is more useful than guessing from a
  // short, unfinished answer. Plain explanations still remain plain text.
  const fence = context.match(/^\s*(?:`{3,}|~{3,})\s*([\w#+.-]+)/m);
  const hinted = fence && languageRegistry(fence[1]);
  if (hinted && /[{};]|^\s*(?:import|class|return|for|while|if|new)\b|\w+\([^\n]*\)/m.test(text)) return hinted;
  return null;
}

/** Colour presentation only: no Markdown rendering or change to answer text. */
export function answerSyntax(value, { language = 'auto', context = '' } = {}) {
  const text = String(value ?? '');
  const inferred = language === 'auto' ? inferLanguage(text, context) : languageRegistry(language);
  let hasCode = language !== 'auto' && language !== 'plaintext';
  const colour = (code, name) => highlightCode(code, name)?.value ?? escape(code);
  if (language === 'plaintext') return { html: escape(text), language: null, code: false };
  // Preserve every delimiter and newline, including an unfinished fence while
  // typing. Never feed answer HTML to the Markdown renderer.
  const lines = text.split('\n');
  let fence = null, block = [], outside = '', html = '';
  const flush = () => { html += colour(block.join(''), fence.language); block = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], ending = i < lines.length - 1 ? '\n' : '';
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})\s*([\w#+.-]*)[^\n]*$/);
    if (!fence && opening) {
      html += colour(outside, inferred); outside = '';
      hasCode = true;
      fence = { mark: opening[1][0], length: opening[1].length, language: opening[2] ? languageRegistry(opening[2]) : inferred };
      html += escape(line + ending);
    } else if (fence) {
      const closing = line.trim();
      if (closing.length >= fence.length && [...closing].every(c => c === fence.mark)) {
        flush(); html += escape(line + ending); fence = null;
      } else block.push(line + ending);
    } else outside += line + ending;
  }
  if (fence) flush();
  html += colour(outside, inferred);
  return { html, language: inferred, code: hasCode || !!inferred };
}
