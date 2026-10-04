'use strict';
// lib/answer-records.cjs 的纯数据层测试。
// 只吃字符串、只吐数据：不读写真实学习目录，不碰用户应用、Git 或网络。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const records = require('../lib/answer-records.cjs');
const { analyzeAnswerRecords } = records;

const LP = '```';

// 通用不变式 1：区块表必须首尾铺满整篇文档，且每块 content 都是 source 的精确切片。
function assertExactDeck(source, blocks) {
  assert.ok(blocks.length > 0, '区块表不能为空');
  assert.equal(blocks[0].start, 0, '第一块必须从下标 0 开始');
  assert.equal(blocks.at(-1).end, source.length, '最后一块必须到文档末尾');
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    assert.equal(source.slice(block.start, block.end), block.content, `第 ${i} 块 content 必须是原文切片`);
    if (i) assert.equal(block.start, blocks[i - 1].end, `第 ${i} 块必须紧接上一块，不能有缝隙或重叠`);
  }
}

// 通用不变式 2：preamble + 轮次 + 普通栏目 + 导师尾部栏目按顺序拼起来就是完整原文。
function assertCleanDeck(source, result) {
  const deck = [result.preamble, ...result.rounds, ...result.sections, ...result.finalSections]
    .filter(block => block.end > block.start)
    .sort((a, b) => a.start - b.start);
  assertExactDeck(source, deck);
  assert.deepEqual(deck.map(b => source.slice(b.start, b.end)), deck.map(b => b.content));
}

function assertOrderedRounds(result) {
  const indexes = result.rounds.map(r => r.index);
  assert.deepEqual(indexes, result.rounds.map((_, i) => i + 1), 'index 必须是文档顺序 1..n');
  for (let i = 1; i < result.rounds.length; i++) {
    assert.ok(result.rounds[i].start > result.rounds[i - 1].start, '轮次必须保持原始文档顺序');
  }
}

test('导师标题与轮次词重叠时：导师反馈留在本轮，不另开轮次', () => {
  const source = [
    '# 学生回答',
    '',
    '## 第一轮',
    '',
    '### 问题 1：先说说你的直觉',
    '',
    '**我的回答**',
    '',
    '第一轮回答。',
    '',
    '## 第一轮总结',
    '',
    '本轮表现稳定，可以进入下一轮。',
    '',
    '### 导师评估 · 第一轮回顾',
    '',
    '回顾：变量名与变量值区分正确。',
    '',
    '## 第二轮',
    '',
    '**我的回答**',
    '',
    '第二轮回答。',
    '',
    '## 答案解析与讲解',
    '',
    '解析正文，属于导师栏目。',
    '',
  ].join('\n');

  const result = analyzeAnswerRecords(source);
  assert.deepEqual(result.rounds.map(r => r.round), ['第一轮', '第二轮'], '带导师措辞的轮次标题不能造出多余轮次');
  assertOrderedRounds(result);
  const first = result.rounds[0];
  assert.ok(first.content.includes('## 第一轮总结'));
  assert.ok(first.content.includes('本轮表现稳定，可以进入下一轮。'));
  assert.ok(first.content.includes('### 导师评估 · 第一轮回顾'));
  assert.ok(first.content.includes('回顾：变量名与变量值区分正确。'));
  assert.equal(first.markers.mentorHeading, 2);
  assert.equal(first.markers.originalAnswer, 1);
  // 解析类导师栏目留在第二轮区块内
  assert.ok(result.rounds[1].content.includes('## 答案解析与讲解'));
  assert.ok(result.rounds[1].content.includes('解析正文，属于导师栏目。'));
  assertCleanDeck(source, result);
  assertExactDeck(source, result.blocks);
});

// 主样板：轮次 + 同级嵌套导师标题 + 围栏/引用/表格假标题 + setext 干扰 + 未知栏目 + 尾部导师栏目。
const SOURCE = [
  '# Python · 认识变量 · 学生回答',
  '',
  '> 演示工作区。下面引用里的假标题不是轮次。',
  '> ## 摸底轮',
  '> ### 问题 9：引用里的假问题',
  '',
  '## **第一轮**',
  '',
  '### 问题 1：变量名与变量值',
  '',
  '在 `price = 25` 中，哪个是变量名，哪个是变量值？',
  '',
  '**我的回答**',
  '',
  'price 是变量名，25 是变量值。',
  '',
  '## 导师评估反馈',
  '',
  '理解正确。掌握度：已掌握。',
  '',
  '### 问题 2：写一段代码',
  '',
  '把顾客年龄记录为 21，并打印这个年龄。',
  '',
  '**我的回答**',
  '',
  `${LP}python`,
  'age = 21',
  'print(age)',
  LP,
  '',
  '#### 导师补充说明',
  '',
  '缩进无需调整。',
  '',
  `${LP}md`,
  '## 第二轮',
  '## 最终复评结果',
  '## 费曼轮',
  LP,
  '',
  '| 标记 | 说明 |',
  '| --- | --- |',
  '| `## 摸底轮` | 表格里的假标题 |',
  '| `### 费曼诊断轮` | 单元格里的假标题 |',
  '',
  '这是一段没有轮次词的说明',
  '---',
  '',
  '## 第二轮',
  '',
  '**学生作答 · 2026/2/3 09:00:00**',
  '',
  '第二轮回答：变量名在前，变量值在后。',
  '',
  '### 导师评估反馈',
  '',
  '第二轮已通过。',
  '',
  '## 摸底轮',
  '',
  '### 问题 1：先说说你的直觉',
  '',
  '**我的回答**',
  '',
  '摸底回答。',
  '',
  '## 费曼诊断轮',
  '',
  '### 问题 1：讲给同桌听',
  '',
  '**我的回答**',
  '',
  '费曼诊断回答。',
  '',
  '## 费曼轮',
  '',
  '### 问题 1：用一句话总结',
  '',
  '**我的回答**',
  '',
  '费曼回答。',
  '',
  '## 未知栏目',
  '',
  '这一段不属于任何已知轮次。',
  '',
  '## 最终复评结果',
  '',
  '全部通过，掌握度：熟练。',
  '',
  '## 正确答案与解析',
  '',
  '1. 变量名是 `price`，变量值是 `25`。',
  '',
  `${LP}python`,
  'age = 21',
  'print(age)',
  LP,
  '',
].join('\n');

test('按原始文档顺序保留轮次区块，含第一轮/第二轮/摸底轮/费曼诊断轮/费曼轮', () => {
  const result = analyzeAnswerRecords(SOURCE);
  assert.deepEqual(
    result.rounds.map(r => r.round),
    ['第一轮', '第二轮', '摸底轮', '费曼诊断轮', '费曼轮'],
  );
  assert.equal(result.hasRounds, true);
  assertOrderedRounds(result);
  assert.equal(result.rounds[0].title, '第一轮', '加粗标题要还原成纯文本标题');
  assert.equal(result.rounds[0].rawTitle, '## **第一轮**', 'rawTitle 必须是原始标题行');
  assert.equal(result.rounds[0].level, 2);
  assert.equal(result.length, SOURCE.length);
});

test('轮次区块原文完整：学生作答、原有回答、导师评估反馈都留在切片里', () => {
  const result = analyzeAnswerRecords(SOURCE);
  const first = result.rounds[0];
  const second = result.rounds[1];

  // 第一轮：两处回答标记 + 同级嵌套导师标题 + 嵌套补充标题 + 三处代码围栏
  assert.equal(first.markers.originalAnswer, 2);
  assert.equal(first.markers.studentAnswer, 0);
  assert.equal(first.markers.mentorHeading, 2, '导师评估反馈 + 导师补充说明都算导师栏目');
  assert.ok(first.content.includes('**我的回答**'));
  assert.ok(first.content.includes('price 是变量名，25 是变量值。'));
  assert.ok(first.content.includes('## 导师评估反馈'));
  assert.ok(first.content.includes('理解正确。掌握度：已掌握。'), '原有评估反馈必须原文保留');
  assert.ok(first.content.includes('#### 导师补充说明'));
  assert.ok(first.content.includes('### 问题 2：写一段代码'));
  assert.ok(first.content.includes(`${LP}python`));
  assert.ok(first.content.includes('age = 21'));

  // 第二轮：追加式作答标记，导师评估反馈同样在内
  assert.equal(second.markers.studentAnswer, 1);
  assert.equal(second.markers.originalAnswer, 0);
  assert.ok(second.content.includes('**学生作答 · 2026/2/3 09:00:00**'));
  assert.ok(second.content.includes('### 导师评估反馈'));
  assert.ok(second.content.includes('第二轮已通过。'));

  // 导师评估若是独立子标题，额外给出不下钻的 mentorSections，索引仍是全文下标
  assert.deepEqual(first.mentorSections.map(s => s.title), ['导师评估反馈'], '嵌套导师标题不再单列，避免区间重叠');
  assert.equal(first.mentorSections[0].title, '导师评估反馈');
  assert.equal(SOURCE.slice(first.mentorSections[0].start, first.mentorSections[0].end), first.mentorSections[0].content);
  assert.ok(first.mentorSections[0].content.includes('掌握度：已掌握。'));
  assert.ok(first.mentorSections[0].content.includes('#### 导师补充说明'), '嵌套导师小标题必须留在父段内，原文不丢');
  assert.ok(first.mentorSections[0].content.includes('缩进无需调整。'));
  assert.equal(first.markers.mentorHeading, 2, '嵌套导师标题仍计入 markers');
});

test('围栏、引用、表格里的假标题不会造出多余轮次，也不丢原文', () => {
  const result = analyzeAnswerRecords(SOURCE);
  assert.equal(result.rounds.length, 5, '只有 5 个真实顶层轮次标题');

  const first = result.rounds[0];
  // 围栏里的假标题原文必须还在第一轮切片里（切片是原文事实，不做去重或清理）
  assert.ok(first.content.includes(`${LP}md`));
  assert.ok(first.content.includes('## 第二轮'), '围栏里的假标题文本不能丢');
  assert.ok(first.content.includes('## 最终复评结果'), '围栏里的假标题文本不能丢');
  assert.ok(first.content.includes('| `## 摸底轮` | 表格里的假标题 |'));
  assert.ok(first.content.includes('| `### 费曼诊断轮` | 单元格里的假标题 |'));
  // 引用块里的假标题归 preamble（原文顺序不变）
  assert.ok(result.preamble.content.includes('> ## 摸底轮'));
  assert.ok(result.preamble.content.includes('> ### 问题 9：引用里的假问题'));
  assert.equal(SOURCE.lastIndexOf('## 第二轮'), result.rounds[0].end, '第一轮正好结束在真实的第二轮标题');
});

test('CRLF 与 BOM 文档：下标仍是 UTF-16，切片保留 \\r\\n 原文', () => {
  const crlf = [
    '\ufeff# Python · 认识变量 · 学生回答',
    '',
    '> ## 费曼轮',
    '',
    '## 摸底轮',
    '',
    '### 问题 1：先说说你的直觉',
    '',
    '**我的回答**',
    '',
    '摸底回答第一行',
    '摸底回答第二行',
    '',
    `${LP}md`,
    '## 费曼轮',
    LP,
    '',
    '## 费曼轮',
    '',
    '**学生作答 · 2026/2/3 09:00:00**',
    '',
    '费曼回答。',
    '',
    '## 最终复评结果',
    '',
    '通过。',
  ].join('\r\n');

  const result = analyzeAnswerRecords(crlf);
  assert.deepEqual(result.rounds.map(r => r.round), ['摸底轮', '费曼轮'], 'BOM 与引用假标题不能干扰轮次识别');
  assert.equal(result.rounds.length, 2);
  assert.ok(result.preamble.content.startsWith('\ufeff# Python'), 'BOM 必须原样保留在 preamble 切片里');
  assert.ok(result.preamble.content.includes('> ## 费曼轮'));
  assert.ok(result.rounds[0].content.includes('\r\n'), '切片必须保留 CRLF 原文');
  assert.ok(result.rounds[0].content.includes('摸底回答第二行'));
  assert.equal(result.rounds[1].markers.studentAnswer, 1);
  assert.equal(result.finalReview?.title, '最终复评结果');
  assertCleanDeck(crlf, result);
  assertExactDeck(crlf, result.blocks);
});

test('没有可识别轮次时返回空轮次，但完整正文仍可拿到', () => {
  const source = [
    '# 学生回答',
    '',
    '## 一些说明',
    '',
    '这份文档还没有轮次标题。',
    '',
    `${LP}md`,
    '## 第一轮',
    LP,
    '',
    '也还没有导师评估。',
    '',
  ].join('\n');

  const result = analyzeAnswerRecords(source);
  assert.deepEqual(result.rounds, []);
  assert.equal(result.hasRounds, false);
  assert.equal(result.preamble.content, source, '完整正文必须原样可读');
  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.finalSections, []);
  assert.equal(result.finalReview, null);
  assert.equal(result.answerKey, null);
  assertExactDeck(source, result.blocks);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].kind, 'preamble');
});

test('不伪造评估与掌握度：没有写评估的轮次里不会凭空出现评估文字', () => {
  const result = analyzeAnswerRecords(SOURCE);
  for (const round of result.rounds.slice(2)) {
    assert.equal(round.markers.finalReview, 0);
    assert.equal(round.markers.answerKey, 0);
    assert.ok(!/掌握度/.test(round.content), `${round.round} 原文没有掌握度，结果里也不能有`);
    assert.ok(!/评估/.test(round.content), `${round.round} 原文没有评估，结果里也不能有`);
  }
  // 模块只输出原文事实，不产出题目、分数或掌握度结论
  assert.ok(!('questions' in result));
  assert.deepEqual(Object.keys(records), ['analyzeAnswerRecords']);
  assert.throws(() => analyzeAnswerRecords(undefined), TypeError);
  assert.throws(() => analyzeAnswerRecords(null), TypeError);
});

test('文档尾部导师栏目原文单独返回，且与轮次区块不重叠', () => {
  const result = analyzeAnswerRecords(SOURCE);
  assert.deepEqual(result.finalSections.map(s => s.title), ['最终复评结果', '正确答案与解析']);
  assert.equal(result.finalReview.title, '最终复评结果');
  assert.equal(result.answerKey.title, '正确答案与解析');
  assert.equal(SOURCE.slice(result.finalReview.start, result.finalReview.end), result.finalReview.content);
  assert.ok(result.finalReview.content.includes('全部通过，掌握度：熟练。'));
  assert.ok(result.answerKey.content.startsWith('## 正确答案与解析'));
  assert.ok(result.answerKey.content.includes('1. 变量名是 `price`，变量值是 `25`。'));
  assert.ok(result.answerKey.content.includes('age = 21'), '解析里的代码围栏必须完整');
  assert.ok(!SOURCE.slice(result.rounds.at(-1).start, result.rounds.at(-1).end).includes('正确答案'));
  assert.equal(result.sections.map(s => s.title).includes('未知栏目'), true, '未知同级标题不吞原文');
  assertCleanDeck(SOURCE, result);
  assertExactDeck(SOURCE, result.blocks);
});

test('不改写原文：同样输入结果完全一致，源文一个字符都不变', () => {
  const before = SOURCE;
  const first = analyzeAnswerRecords(before);
  const second = analyzeAnswerRecords(before);
  assert.equal(before, SOURCE, '源文必须保持原样');
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)), '同输入必须同输出');
  assert.deepEqual(first.blocks.map(b => b.end - b.start).reduce((a, b) => a + b, 0), SOURCE.length, '区块总长等于原文长度');
  for (const round of first.rounds) {
    assert.equal(round.content, SOURCE.slice(round.start, round.end));
  }
  // 输出里除 blocks 外不允许存在重复正文副本字段（content 只来自原文切片）
  assert.deepEqual(Object.keys(first).sort(), [
    'answerKey', 'blocks', 'finalReview', 'finalSections', 'hasRounds', 'length', 'preamble', 'rounds', 'sections',
  ]);
});

test('demo 学生回答文档：区块首尾铺满全文，尾部导师栏目可读', () => {
  const demo = path.join(__dirname, '..', 'demo', 'StepsToGreat', '我的学习', '学科', 'Python', '01-认识变量', '01_学生回答.md');
  const source = fs.readFileSync(demo, 'utf8');
  const result = analyzeAnswerRecords(source);
  assertExactDeck(source, result.blocks);
  assertCleanDeck(source, result);
  assert.deepEqual(result.rounds.map(r => r.round), ['第一轮']);
  assert.equal(result.rounds[0].markers.originalAnswer, 2, 'demo 里两道题都带 **我的回答** 标记');
  assert.ok(result.rounds[0].content.includes('### 问题 1：变量名与变量值'));
  assert.ok(result.rounds[0].content.includes(`${LP}python`));
  assert.equal(result.finalReview.title, '最终复评结果');
  assert.ok(result.finalReview.content.includes('（整课所有轮次通过后由导师填写）'));
  assert.equal(result.answerKey.title, '正确答案与解析');
  assert.ok(result.answerKey.content.includes('（评估完成后由导师填写）'));
});
