const { test } = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');
const MarkdownIt = require('markdown-it');
const texmath = require('markdown-it-texmath');

const load = () => import('../src/editor-formula.mjs');

// The reader pipeline from src/main.js, so visual and read-only modes agree.
const reader = new MarkdownIt({ html: false }).use(texmath, {
  engine: katex,
  delimiters: 'dollars',
  katexOptions: { throwOnError: false, trust: false },
});

test('formula bodies strip one or two dollar delimiters without eating real dollars', async () => {
  const { formulaBody } = await load();
  assert.equal(formulaBody('$x^2$'), 'x^2');
  assert.equal(formulaBody('$$\nE=mc^2\n$$'), 'E=mc^2');
  assert.equal(formulaBody('$$E=mc^2$$'), 'E=mc^2');
  assert.equal(formulaBody('$\\$5$'), '\\$5');
  assert.equal(formulaBody(''), '');
  assert.equal(formulaBody(null), '');
  assert.equal(formulaBody('x^2'), 'x^2');
  // Layout whitespace around a block must not leak into the LaTeX body, which
  // is what the node view renders and the dialog pre-fills.
  assert.equal(formulaBody('$$\nE=mc^2\n$$   '), 'E=mc^2');
  assert.equal(formulaBody('   $$\n   E=mc^2\n   $$'), 'E=mc^2');
  assert.equal(formulaBody('$$ E=mc^2 $$'), 'E=mc^2');
  // Delimiter edge cases must not throw or silently swallow content.
  assert.equal(formulaBody('$'), '');
  assert.equal(formulaBody('$$'), '');
  assert.equal(formulaBody('$a$'), 'a');
});

test('only a whole-block display formula becomes a block node', async () => {
  const { isDisplayMathBlock, isDisplaySource } = await load();
  assert.equal(isDisplayMathBlock('$$\nE=mc^2\n$$'), true);
  assert.equal(isDisplayMathBlock('$$E=mc^2$$'), true);
  assert.equal(isDisplayMathBlock('  $$\n\\sum_{i=1}^{n} i\n$$  '), true);
  assert.equal(isDisplayMathBlock('$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$'), true);
  // Mixed or malformed content must stay inline/preserved, never a block atom.
  assert.equal(isDisplayMathBlock('前言 $$x$$'), false);
  assert.equal(isDisplayMathBlock('$$a$$ 与 $$b$$'), false);
  assert.equal(isDisplayMathBlock('$$'), false);
  assert.equal(isDisplayMathBlock('$$$$'), false);
  assert.equal(isDisplayMathBlock('$$\n$$'), false);
  assert.equal(isDisplayMathBlock('公式 $x^2$ 与 **加粗**。'), false);
  assert.equal(isDisplayMathBlock('# 标题'), false);
  assert.equal(isDisplayMathBlock(''), false);
  assert.equal(isDisplayMathBlock(null), false);
  assert.equal(isDisplaySource('$$E=mc^2$$'), true);
  assert.equal(isDisplaySource('$x^2$'), false);
});

test('wrapFormula round-trips through the reader renderer as display math', async () => {
  const { wrapFormula, formulaBody } = await load();
  const inline = wrapFormula('x^2');
  const display = wrapFormula('E=mc^2', true);
  assert.equal(inline, '$x^2$');
  assert.equal(display, '$$\nE=mc^2\n$$');
  // Reader parity: exactly one display formula and no inline duplicate.
  const html = reader.render(display);
  assert.equal((html.match(/katex-display/g) || []).length, 1);
  assert.equal((html.match(/class="katex"/g) || []).length, 1);
  // Body survives the round trip so editing never mutates the formula text.
  assert.equal(formulaBody(display).trim(), 'E=mc^2');
  assert.equal(formulaBody(inline), 'x^2');
  assert.equal(wrapFormula('', true), '$$\n\n$$');
});

test('rendered formulas carry no error markup and are sanitizer-safe', async () => {
  const { renderFormula } = await load();
  const ok = renderFormula('$\\frac{a}{b}$', katex);
  assert.equal(ok.error, null);
  assert.ok(ok.html.includes('katex'));
  assert.equal(ok.displayMode, false);
  const display = renderFormula('$$\n\\sum_{i=1}^{n} i\n$$', katex);
  assert.equal(display.error, null);
  assert.equal(display.displayMode, true);
  assert.ok(display.html.includes('katex-display'));
  // No scripts or event handlers may come out of KaTeX.
  for (const rendered of [ok, display]) {
    assert.equal(/<script|onerror=|onload=/i.test(rendered.html), false);
  }
  // `trust:false` keeps \href/\includegraphics from producing any URL or image sink.
  const hostile = renderFormula('$\\href{javascript:alert(1)}{x}$', katex);
  assert.equal(hostile.error, null);
  assert.equal(/\shref=|<img|<script|onerror=/i.test(hostile.html), false);
  // The raw TeX is echoed inside KaTeX's MathML annotation, so assert on sinks
  // rather than on the presence of the word: that annotation is the user's own text.
  assert.ok(hostile.html.includes('annotation'));
});

test('a broken formula reports a visible error and never throws', async () => {
  const { renderFormula } = await load();
  const broken = renderFormula('$\\frac{$', katex);
  assert.ok(broken.error, 'expected a parse error message');
  assert.equal(broken.html, '');
  assert.equal(broken.body, '\\frac{');
  const unclosed = renderFormula('$\\begin{aligned} a &= b$', katex);
  assert.ok(unclosed.error);
  assert.equal(renderFormula('$\\left($', katex).error !== null, true);
  // Empty and oversized formulas are reported rather than rendered blank.
  const empty = renderFormula('$$', katex);
  assert.equal(empty.error, '公式内容为空');
  const huge = renderFormula(`$${'x'.repeat(50)}$$`, katex, { maxLength: 10 });
  assert.equal(huge.error, '公式过长，已跳过渲染');
  assert.equal(renderFormula('$x$', null).error, '公式渲染器不可用');
});

test('complex formulas produce the full MathML structure KaTeX emits', async () => {
  const { renderFormula } = await load();
  // These exercise the tags an over-restrictive sanitize allow-list would drop:
  // munderover, mroot, mtable, menclose, mpadded, mstyle and \left..\right.
  // NOTE: this asserts renderFormula's raw KaTeX output. Sanitizer fidelity
  // (the same tags surviving DOMPurify in the real app) is covered by the
  // Electron acceptance test, which is the only place a DOM exists.
  const formulas = [
    '\\sum_{i=1}^{n} i',
    '\\int_{0}^{\\infty} e^{-x^2}\\,dx',
    '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
    '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}',
    '\\underbrace{a+b}_{sum}',
    '\\overbrace{x+y}^{n}',
    '\\sqrt[3]{x}',
    '\\frac{\\partial f}{\\partial x}',
    '\\left\\| \\frac{a}{b} \\right\\|',
    '\\hat{y} = \\arg\\max_{\\theta} L(\\theta)',
    '\\mathbb{R}^n \\to \\mathbb{C}',
    '\\overline{z} \\cdot \\vec{v}',
    'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}',
    '\\binom{n}{k} = \\frac{n!}{k!(n-k)!}',
  ];
  for (const tex of formulas) {
    const rendered = renderFormula(`$$\n${tex}\n$$`, katex);
    assert.equal(rendered.error, null, `${tex}: ${rendered.error}`);
    assert.ok(rendered.html.includes('katex-display'), tex);
    // The MathML annotation must survive sanitization, since it is both the
    // accessibility fallback and the round-trip record of the TeX source.
    assert.ok(rendered.html.includes('annotation'), tex);
    assert.ok(rendered.html.includes('semantics'), tex);
  }
  // Widening the allow-list is unnecessary: DOMPurify already keeps MathML tags,
  // so the editor's sanitize options can stay identical to the preview's.
  const nested = renderFormula('$$\\sum_{i=1}^{n} \\frac{x_i}{2}$$', katex);
  for (const tag of ['munderover', 'mfrac', 'mrow', 'mo', 'mi', 'mn']) {
    assert.ok(nested.html.includes(`<${tag}`), `missing ${tag} in KaTeX output`);
  }
});

test('normalizeFormula keeps an edited formula stable and preserves display mode', async () => {
  const { normalizeFormula, renderFormula, formulaBody } = await load();
  assert.equal(normalizeFormula('x^3'), '$x^3$');
  assert.equal(normalizeFormula('x^3', true), '$$\nx^3\n$$');
  assert.equal(normalizeFormula('$x^3$'), '$x^3$');
  assert.equal(normalizeFormula('$$x^3$$', true), '$$x^3$$');
  assert.equal(normalizeFormula('$$\nx^3\n$$', true), '$$\nx^3\n$$');
  assert.equal(normalizeFormula('  E=mc^2  ', true), '$$\nE=mc^2\n$$');
  // A single-character inline formula keeps its single delimiters: widening it
  // to `$$x$$` would turn inline math into display math.
  assert.equal(normalizeFormula('$x$'), '$x$');
  assert.equal(normalizeFormula('$a$', false), '$a$');
  // The node type is authoritative: an inline node must never serialize a
  // display fence, and vice versa. The reader would otherwise render different
  // math than the editor showed.
  assert.equal(normalizeFormula('$$x$$', false), '$x$');
  assert.equal(normalizeFormula('$$\nx\n$$', false), '$x$');
  assert.equal(normalizeFormula('$x$', true), '$$\nx\n$$');
  assert.equal(normalizeFormula('$$x$$', true), '$$x$$');
  // Wrapping a bare single character still works.
  assert.equal(normalizeFormula('x'), '$x$');
  // Normalizing twice must be a no-op, so repeated dialog edits do not drift.
  for (const [value, display] of [['x^2', false], ['x^2', true], ['$x$', false], ['$$x$$', true], ['$$\ny\n$$', false], ['$$x$$', false]]) {
    const once = normalizeFormula(value, display);
    assert.equal(normalizeFormula(once, display), once, `unstable normalization for ${value}/${display}`);
  }
  // Editing a block formula must not silently demote it to inline.
  const edited = normalizeFormula('\\sum_{i=1}^{n} i', true);
  assert.equal(renderFormula(edited, katex).displayMode, true);
  assert.equal(formulaBody(edited), '\\sum_{i=1}^{n} i');
  // Every normalized value still renders (no expression is lost to trimming).
  for (const [value, display] of [['$x$', false], ['$$x$$', true], ['$$x$$', false], ['$x$', true]]) {
    const normalized = normalizeFormula(value, display);
    const rendered = renderFormula(normalized, katex);
    assert.equal(rendered.error, null, `${value}/${display} -> ${normalized}: ${rendered.error}`);
    assert.equal(rendered.displayMode, display);
    assert.equal(rendered.body, 'x');
  }
});

test('math stays editable beside code spans without interpreting literal code dollars',async()=>{
  const {replaceMathOutsideCode}=await load();
  for(const source of ['代码 `$x$` 与 $y^2$。','金额 `$price`，公式 $y^2$。','代码 ``a`$x$`` 与 $y^2$。','代码 `😀$x$` 与 $y^2$。']){
    const found=[];
    const output=replaceMathOutsideCode(source,value=>{found.push(value);return 'MATH';});
    assert.deepEqual(found,['$y^2$']);
    assert.equal(output,source.replace('$y^2$','MATH'));
  }
});
