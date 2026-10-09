// highlight.js glue for the visual editor.
//
// Imported from the SAME `highlight.js/lib/core` singleton that src/main.js uses
// for the read-only Markdown preview, so a token that is `hljs-type` in the
// preview is `hljs-type` in the visual editor too: one stylesheet colours both.
//
// Only additive registration happens here (skipped when a language already
// exists), so this module never changes what the preview can render.
//
// `.mjs` on purpose: unit tests import it directly from Node.

import hljs from 'highlight.js/lib/core';
import plaintext from 'highlight.js/lib/languages/plaintext';
import java from 'highlight.js/lib/languages/java';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import kotlin from 'highlight.js/lib/languages/kotlin';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';

/** Above this size a code block stays editable but is left uncoloured. */
export const HIGHLIGHT_MAX_LENGTH = 20000;

const BUNDLED = {
  plaintext, java, python, javascript, typescript, json, bash, sql,
  xml, css, cpp, csharp, go, rust, kotlin, yaml, markdown, diff,
};

/** Register the bundled languages that are not already present. */
export function registerEditorLanguages(registry = hljs) {
  const added = [];
  for (const [name, language] of Object.entries(BUNDLED)) {
    if (registry.getLanguage(name)) continue;
    registry.registerLanguage(name, language);
    added.push(name);
  }
  return added;
}

registerEditorLanguages();

/** `name -> canonical language name` for the picker's catalog resolution. */
export function languageRegistry(name) {
  const definition=hljs.getLanguage(name);
  return definition?hljs.listLanguages().find(id=>hljs.getLanguage(id)===definition)||name:null;
}

/**
 * Highlight `code`. Returns `null` (never throws) when the language is unknown,
 * the code is empty or too large, or highlight.js reports an illegal parse, so
 * the caller always degrades to plain but fully editable text.
 */
export function highlightCode(code, language) {
  const text = String(code ?? '');
  if (!text || !language) return null;
  if (text.length > HIGHLIGHT_MAX_LENGTH) return null;
  if (!hljs.getLanguage(language)) return null;
  try {
    const result = hljs.highlight(text, { language, ignoreIllegals: true });
    // An illegal-token bailout can leave the parse tree incomplete; skip rather
    // than paint ranges that do not line up with the visible code.
    return result.errorRaised ? null : result;
  } catch {
    return null;
  }
}

/** Languages the visual editor can colour right now. */
export function availableLanguages() {
  return hljs.listLanguages().slice().sort();
}

export { hljs };
