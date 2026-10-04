'use strict';
/**
 * 右侧「作答记录」视图的纯数据层（只读）。
 *
 * 目标：让右侧作答区完全替代「单独打开学生回答文档」——
 * 一次调用就拿到按原始文档顺序排列的轮次区块，以及文档尾部导师栏目的原文。
 *
 * 硬性约束：
 * - 只读：不改写、不规范化、不补全任何原文。每个区块的 content 都是 source 的精确切片，
 *   满足 source.slice(start, end) === content；所有区块按顺序首尾相接铺满整篇文档（无缝隙、无重叠）。
 * - 不猜题目：不识别、不生成、不归属任何「问题 N」，也不产出掌握度、评估结论或分数。
 * - 不伪造评估：markers 只统计原文里字面出现的标记次数，含义是「原文有/没有」，不是学习评价。
 * - markdown-it token 地图：只认顶层标题（token.level === 0）。代码围栏、引用块、表格单元格、
 *   列表里的「## 第一轮」都不会被当成区块标题（与 lib/stg.cjs 的 parseQuestions 同一策略）。
 * - 无法识别轮次时：rounds 为空数组，preamble.content 仍是完整正文，
 *   UI 可退回到「完整文档」标签页展示。
 *
 * 与 lib/stg.cjs 对齐：ROUND_PATTERN 与 TAIL_PATTERN 逐字沿用 parseQuestions 的
 * /第[一二三四五六七八九十\d]+轮|费曼(?:诊断)?轮|摸底轮/ 与 /最终复评|正确答案/，
 * 保证右侧「作答记录」的轮次名与作答区 parsed.current 的 round 名完全一致。
 *
 * 下标（start / end）一律是 JavaScript 字符串下标，即 UTF-16 code unit 偏移，
 * 用代理对（emoji 等）时可直接用于 String.prototype.slice。
 */

const MarkdownIt = require('markdown-it');

const md = new MarkdownIt();

// 轮次词表：与 lib/stg.cjs parseQuestions 完全一致。
const ROUND_PATTERN = /第[一二三四五六七八九十\d]+轮|费曼(?:诊断)?轮|摸底轮/;
// 文档尾部导师栏目：parseQuestions 遇到这些标题就停止收集题目。
const TAIL_PATTERN = /最终复评|正确答案/;
// 导师评估/反馈类标题：即使与轮次标题同级，也必须留在本轮区块内（不另开区块）。
// 词表对齐 lib/stg.cjs parseQuestions 的 /评估|解析|复评/（它把这些标题视作导师栏目、不再收题），
// 并补上常见的导师反馈措辞。注意顺序：轮次标题先判定，TAIL 标题（最终复评/正确答案）最先判定，
// 所以「费曼轮总结」「正确答案与解析」不会被这里的规则吃掉。
const MENTOR_PATTERN = /导师|评估|评价|解析|讲解|答疑|反馈|点评|批注|评注|复核|评审|复评|总评|总结|小结/;
// ATX 标题（`#` 开头，允许最多三个前导空格）。
// Setext 标题（正文行紧跟 `---` / `===`）不算「结构性标题」：本项目的 `---` 常作分隔线，
// 紧贴正文时会被 Markdown 解析成 setext 标题，不能让它把轮次切碎。
const ATX_TITLE = /^ {0,3}#{1,6}(?:\s|$)/;

// 字面标记：只统计原文里真的出现了几次，用于 UI 徽标，不做任何推断。
const MARKER_PATTERNS = {
  // lib/stg.cjs appendAnswers 追加的格式：**学生作答 · 2025/1/1 12:00:00**
  studentAnswer: /\*\*\s*学生作答/,
  // parseQuestions 识别的既有回答标记：**我的回答** / **你的回答** / **学生回答** / **回答**
  originalAnswer: /\*\*\s*(?:我的|你的|学生)?回答/,
  finalReview: /最终复评/,
  answerKey: /正确答案/,
};

/** 每行行首在 source 中的 UTF-16 下标；starts[line] 即该行起点。 */
function lineStarts(source) {
  const starts = [0];
  for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
}

function countMatches(text, pattern) {
  const found = text.match(new RegExp(pattern.source, 'g'));
  return found ? found.length : 0;
}

/** 标题纯文本：优先用 inline token 的 children（去掉 **、`` 等标记），退化时才做正则清理。 */
function headingLabel(inlineToken, rawLine) {
  if (inlineToken && Array.isArray(inlineToken.children) && inlineToken.children.length) {
    const text = inlineToken.children.map(child => child.content || '').join('').trim();
    if (text) return text;
  }
  return rawLine.replace(/^#{1,6}\s*/, '').replace(/\*\*|__|[*_`]/g, '').replace(/\s+/g, ' ').trim();
}

/** 只收顶层标题（level === 0）：围栏、引用、表格、列表里的假标题天然被排除。 */
function collectHeadings(source, tokens, starts) {
  const headings = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading_open' || token.level !== 0 || !token.map) continue;
    const from = starts[token.map[0]] ?? 0;
    const to = starts[token.map[1]] ?? source.length;
    const newline = source.indexOf('\n', from);
    const lineEnd = newline === -1 ? source.length : newline;
    const rawLine = source.slice(from, lineEnd).replace(/\r$/, '');
    const label = headingLabel(tokens[i + 1], rawLine);
    const round = label.match(ROUND_PATTERN);
    headings.push({
      start: from,        // 标题行起点（setext 标题是正文行起点，下划线包含在区块内）
      end: to,            // 标题块结束（ATX 为下一行，setext 为下划线之后）
      tagLevel: Number(token.tag.slice(1)),
      atx: ATX_TITLE.test(rawLine),
      label,
      rawTitle: rawLine,
      round: round ? round[0] : null,
      tail: TAIL_PATTERN.test(label),
      mentor: MENTOR_PATTERN.test(label),
    });
  }
  return headings;
}

/**
 * 在 [from, to) 内切出导师反馈子区块，供 UI 单独高亮。
 * 只列「不再嵌在另一个导师标题下」的顶层导师标题，因此各段范围互不重叠、也不互相包含；
 * 嵌套的导师小标题（如 `#### 导师补充说明`）留在其父段 content 里，原文一字不少。
 * 索引仍是整篇文档的 UTF-16 下标，content 仍是 source 的精确切片。
 */
function mentorSections(source, headings, from, to) {
  const inside = headings.filter(h => h.start >= from && h.start < to && h.mentor);
  const result = [];
  for (const heading of inside) {
    const parent = result.at(-1);
    if (parent && heading.tagLevel > parent.level) continue; // 嵌套：已包含在父段内
    const end = inside.find(other => other.start > heading.start && other.tagLevel <= heading.tagLevel)?.start ?? to;
    result.push({ title: heading.label, level: heading.tagLevel, content: source.slice(heading.start, end), start: heading.start, end });
  }
  return result;
}

function blockFrom(source, kind, heading, start) {
  return {
    kind,
    title: heading ? heading.label : '',
    rawTitle: heading ? heading.rawTitle : '',
    level: heading ? heading.tagLevel : 0,
    start,
    end: source.length,
    content: '',
  };
}

function finishBlock(source, block, end) {
  block.end = end;
  block.content = source.slice(block.start, end);
  return block;
}

/**
 * 分析「学生回答」文档原文，产出右侧作答记录视图需要的纯数据。
 *
 * @param {string} source Markdown 原文（学生回答文档的完整内容）
 * @returns {{
 *   rounds: Array<{title:string, round:string, rawTitle:string, level:number, index:number,
 *     content:string, start:number, end:number, markers:object,
 *     mentorSections:Array<{title:string, content:string, start:number, end:number}>}>,
 *   finalSections: Array<{title:string, content:string, start:number, end:number, rawTitle:string, level:number}>,
 *   sections: Array<{title:string, content:string, start:number, end:number, rawTitle:string, level:number}>,
 *   preamble: {title:string, content:string, start:number, end:number},
 *   finalReview: {title:string, content:string, start:number, end:number}|null,
 *   answerKey: {title:string, content:string, start:number, end:number}|null,
 *   blocks: Array<{kind:'preamble'|'round'|'final'|'section', title:string, content:string, start:number, end:number}>,
 *   hasRounds: boolean,
 *   length: number
 * }}
 */
function analyzeAnswerRecords(source) {
  if (typeof source !== 'string') throw new TypeError('analyzeAnswerRecords 需要学生回答文档的 Markdown 原文（字符串）。');

  const starts = lineStarts(source);
  const headings = collectHeadings(source, md.parse(source, {}), starts);

  const blocks = [];
  // 文档开头到第一个可识别区块之间的原文（含文件标题、说明、引用）永远是第一个区块。
  let current = blockFrom(source, 'preamble', null, 0);
  let currentLevel = Infinity;
  let currentRound = null;

  const close = end => {
    blocks.push(finishBlock(source, current, end));
    current = null;
  };

  for (const heading of headings) {
    // 1) 导师栏目（最终复评 / 正确答案与解析）：parseQuestions 到此为止，这里也一律开新区块。
    if (heading.tail) {
      if (current) close(heading.start);
      current = blockFrom(source, 'final', heading, heading.start);
      currentLevel = heading.tagLevel;
      currentRound = null;
      continue;
    }
    // 2) 轮次标题：同级/更浅，或换了另一个轮次名，才算新的一轮。
    //    同一轮里的「### 第一轮小结」这类嵌套标题不会把本轮切开。
    //    只有「轮次词打头」的标题才算轮次标题：`## 第一轮` / `## 费曼诊断轮` 是轮次，
    //    而 `### 导师评估 · 第一轮回顾` 是导师反馈（留在此前轮次里，不另开轮次）。
    //    已是本轮、又带导师措辞的 `## 第二轮总结` 也只算本轮的小结，不另开新区块。
    const pureRound = heading.round !== null && heading.label.startsWith(heading.round);
    const sameRoundSummary = heading.mentor && current.kind === 'round' && heading.round === currentRound;
    if (heading.round && pureRound && !sameRoundSummary) {
      const startsNewRound = current.kind !== 'round' || heading.tagLevel <= currentLevel || heading.round !== currentRound;
      if (startsNewRound) {
        if (current) close(heading.start);
        current = blockFrom(source, 'round', heading, heading.start);
        currentLevel = heading.tagLevel;
        currentRound = heading.round;
      }
      continue;
    }
    // 3) 导师评估/反馈标题：留在当前轮次区块内（含同级），不新开区块、不改写顺序。
    if (heading.mentor) continue;
    // 4) 其他标题：只有在当前已进入轮次区块、且同级或更浅时才切出普通区块。
    //    文件头（preamble）里的说明性标题不切块，保持整段原文。
    //    只认 ATX 标题（#）：`---` / `===` 紧贴正文行会被 Markdown 解析成 setext 标题，
    //    而项目里 `---` 常被当作分隔线使用，所以不让它把轮次切开，原文仍然完整保留在区块内。
    if (current && current.kind !== 'preamble' && heading.atx && heading.tagLevel <= currentLevel) {
      close(heading.start);
      current = blockFrom(source, 'section', heading, heading.start);
      currentLevel = heading.tagLevel;
      currentRound = null;
    }
  }
  if (current) close(source.length);

  const rounds = [];
  const finalSections = [];
  const sections = [];
  for (const block of blocks) {
    if (block.kind === 'round') {
      const markers = {
        studentAnswer: countMatches(block.content, MARKER_PATTERNS.studentAnswer),
        originalAnswer: countMatches(block.content, MARKER_PATTERNS.originalAnswer),
        mentorHeading: headings.filter(h => h.start >= block.start && h.start < block.end && h.mentor).length,
        finalReview: countMatches(block.content, MARKER_PATTERNS.finalReview),
        answerKey: countMatches(block.content, MARKER_PATTERNS.answerKey),
      };
      rounds.push({
        title: block.title,
        round: block.title.match(ROUND_PATTERN)?.[0] ?? block.title,
        rawTitle: block.rawTitle,
        level: block.level,
        index: rounds.length + 1,
        content: block.content,
        start: block.start,
        end: block.end,
        markers,
        mentorSections: mentorSections(source, headings, block.start, block.end),
      });
    } else if (block.kind === 'final') {
      finalSections.push({ title: block.title, rawTitle: block.rawTitle, level: block.level, content: block.content, start: block.start, end: block.end });
    } else if (block.kind === 'section') {
      sections.push({ title: block.title, rawTitle: block.rawTitle, level: block.level, content: block.content, start: block.start, end: block.end });
    }
  }

  const preamble = blocks.find(block => block.kind === 'preamble');
  const pick = pattern => {
    const found = finalSections.find(section => pattern.test(section.title));
    return found ? { title: found.title, content: found.content, start: found.start, end: found.end } : null;
  };

  return {
    rounds,
    finalSections,
    sections,
    // 未被轮次/导师栏目覆盖的原文（含文件头）；没有轮次时它就是完整正文。
    preamble: { title: preamble?.title ?? '', content: preamble?.content ?? '', start: preamble?.start ?? 0, end: preamble?.end ?? 0 },
    // 文档尾部导师栏目原文快捷入口，供 UI 直接渲染，不改一个字。
    finalReview: pick(/最终复评/),
    answerKey: pick(/正确答案/),
    // 顺序铺满整篇文档的完整区块表（含 preamble / section），便于 UI 做完整时间线。
    blocks: blocks.map(block => ({ kind: block.kind, title: block.title, content: block.content, start: block.start, end: block.end })),
    hasRounds: rounds.length > 0,
    length: source.length,
  };
}

module.exports = { analyzeAnswerRecords };
