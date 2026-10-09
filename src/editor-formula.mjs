// Pure formula helpers for the visual editor.
//
// Kept DOM-free and KaTeX-injected so the round-trip and error-visibility rules
// can be unit tested in plain Node, and so the reader (markdown-it + texmath)
// and the visual editor can agree on exactly what counts as display math.
//
// Delimiter contract (identical to main.js's `dollars` texmath delimiters):
//   `$...$`   -> inline math
//   `$$...$$` -> display math, whether or not it sits on its own lines.
// A block becomes a real block-math node only when the WHOLE block is one
// `$$...$$` formula, so mixed content keeps flowing through the inline path.

import MarkdownIt from 'markdown-it';
import backticks from 'markdown-it/lib/rules_inline/backticks.mjs';

export const FORMULA_MAX_LENGTH = 20000;

// Reuse CommonMark's code-span rule so literal dollars inside code never become
// formulas. Masking keeps UTF-16 offsets and allows math elsewhere in the same
// paragraph to stay editable, including code spans with unmatched dollars.
const codeParser=new MarkdownIt({html:false});
codeParser.inline.ruler.at('backticks',(state,silent)=>{
  const from=state.pos,count=state.tokens.length;
  const matched=backticks(state,silent);
  if(matched&&!silent&&state.src===state.env.mathSource&&state.tokens.length>count&&state.tokens.at(-1)?.type==='code_inline')state.env.codeRanges.push({from,to:state.pos});
  return matched;
});
export function replaceMathOutsideCode(source,replace){
  const env={mathSource:source,codeRanges:[]};codeParser.parseInline(source,env);
  const chunks=[];let cursor=0;
  for(const {from,to} of env.codeRanges.sort((a,b)=>a.from-b.from)){
    if(to<=cursor)continue;
    const start=Math.max(cursor,from);
    chunks.push(source.slice(cursor,start),source.slice(start,to).replace(/[^\r\n]/g,'\0'));cursor=to;
  }
  chunks.push(source.slice(cursor));
  const pattern=/\$\$[\s\S]+?\$\$|(?<![\\$])\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$(?!\$)/g;
  const result=[];cursor=0;
  for(const match of chunks.join('').matchAll(pattern)){
    const end=match.index+match[0].length;
    result.push(source.slice(cursor,match.index),replace(source.slice(match.index,end),match.index));cursor=end;
  }
  result.push(source.slice(cursor));return result.join('');
}

/**
 * Extract the LaTeX body of a formula, dropping the `$`/`$$` delimiters.
 *
 * Surrounding layout whitespace is removed as well, so an indented or
 * newline-padded display block yields exactly its LaTeX. This affects only what
 * is rendered and pre-filled in the dialog; the stored Markdown source is never
 * rewritten. KaTeX ignores math-mode whitespace, so trimming cannot change the
 * rendered formula.
 */
export function formulaBody(source) {
  const text = String(source ?? '').trim();
  let start = 0;
  let end = text.length;
  if (text.startsWith('$$')) start = 2;
  else if (text.startsWith('$')) start = 1;
  if (end - start >= 2 && text.endsWith('$$')) end -= 2;
  else if (end - start >= 1 && text.endsWith('$')) end -= 1;
  return text.slice(start, end).trim();
}

/** True when the source is written with display (`$$`) delimiters. */
export function isDisplaySource(source) {
  return String(source ?? '').trimStart().startsWith('$$');
}

/**
 * True when an entire Markdown block is exactly one `$$...$$` formula.
 * `$$a$$ and $$b$$`, `$$` alone and unterminated blocks are rejected so they
 * fall through to the inline/paragraph path (or to preservation) unchanged.
 */
export function isDisplayMathBlock(source) {
  const text = String(source ?? '').trim();
  if (text.length < 5 || !text.startsWith('$$') || !text.endsWith('$$')) return false;
  const body = text.slice(2, -2);
  if (!body.trim()) return false;
  return body.indexOf('$$') < 0;
}

/** Build Markdown source for a formula, matching the delimiters above. */
export function wrapFormula(value, display = false) {
  const body = String(value ?? '').trim();
  return display ? `$$\n${body}\n$$` : `$${body}$`;
}

/**
 * Render one formula. Never throws: a KaTeX parse failure is returned as a
 * visible `error` string so the editor can show the problem instead of an
 * empty box, and the caller keeps the original source for editing.
 */
export function renderFormula(source, katex, options = {}) {
  const body = formulaBody(source);
  const displayMode = options.display ?? isDisplaySource(source);
  if (!body.trim()) return { html: '', error: '公式内容为空', displayMode, body };
  if (body.length > (options.maxLength ?? FORMULA_MAX_LENGTH)) {
    return { html: '', error: '公式过长，已跳过渲染', displayMode, body };
  }
  if (!katex || typeof katex.renderToString !== 'function') {
    return { html: '', error: '公式渲染器不可用', displayMode, body };
  }
  try {
    const html = katex.renderToString(body, {
      displayMode,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
    });
    return { html, error: null, displayMode, body };
  } catch (thrown) {
    const message = String(thrown?.message ?? thrown)
      .replace(/^KaTeX parse error:\s*/, '')
      .replace(/\s+at position \d+.*$/, '');
    return { html: '', error: message || '公式语法有误', displayMode, body };
  }
}

/** Remove one or two leading/trailing dollar delimiters and trim the result. */
function stripDollars(text) {
  let body = text;
  if (body.startsWith('$$')) body = body.slice(2);
  else if (body.startsWith('$')) body = body.slice(1);
  if (body.endsWith('$$')) body = body.slice(0, -2);
  else if (body.endsWith('$')) body = body.slice(0, -1);
  return body.trim();
}

/**
 * Normalize an edited formula into the delimiter style its node requires.
 *
 * The node type is the source of truth: an `mathInline` node must serialize to
 * `$...$` and a `mathBlock` node to `$$...$$`, otherwise the read-only preview
 * would render a different kind of math than the editor showed. A display block
 * keeps its original fences verbatim when it already looks like one, so editing
 * does not reformat an untouched `$$E=mc^2$$` into multiple lines.
 */
export function normalizeFormula(value, display = false) {
  const text = String(value ?? '').trim();
  if (display && /^\$\$[\s\S]*\$\$$/.test(text) && text.length >= 4) return text;
  const body = stripDollars(text);
  if (!body) return display ? '$$\n$$' : '$ $';
  return display ? `$$\n${body}\n$$` : `$${body}$`;
}
