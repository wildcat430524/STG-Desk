'use strict';
// lib/learning.cjs 的行为测试。
// 所有写入只发生在 mkdtemp 临时副本里；E:\StepsToGreat 只读参考，从不改动真实学习记录。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Workspace } = require('../lib/workspace.cjs');
const { getLearningState, describeFile } = require('../lib/learning.cjs');

const DEMO = path.join(__dirname, '../demo/StepsToGreat');
const REAL = 'E:\\StepsToGreat';
const REAL_PROFILE = path.join(REAL, '我的学习', '00-学习档案.md');

// 把 demo 复制到临时目录，永不改动源仓库。
async function demoWorkspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-learning-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(DEMO, root, { recursive: true });
  const workspace = new Workspace();
  await workspace.open(root);
  return { root, workspace };
}

// 用给定档案正文搭一个最小工作区；files 是相对路径 → 内容。
async function synthWorkspace(t, profile, files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-learning-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (relative, content) => {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  };
  await write('我的学习/00-学习档案.md', profile);
  for (const [relative, content] of Object.entries(files)) await write(relative, content);
  const workspace = new Workspace();
  await workspace.open(root);
  return { root, workspace };
}

// 真实档案模板风格：字段名带加粗、反引号路径、含 📊/📚 等干扰区块。
const templateProfile = ({ subject = 'Python', lesson = '#2 循环语句', round = '第一轮', guide = '`学科/Python/02-循环/01_教学引导.md`', answer = '`学科/Python/02-循环/01_学生回答.md`', progress = '教学已发布，等待学生作答' } = {}) => `# 00_学习档案（Learning Profile）

> 教学规则 → [\`../协议/00_导师协议.md\`](../协议/00_导师协议.md)

---

## 📋 学生信息

| 项目 | 内容 |
|------|------|
| **当前学科** | <学科名> |

---

## 🚦 当前交接状态（新会话先读这里）

| 项目 | 当前状态 |
|------|----------|
| **当前学科** | ${subject} |
| **其他在学学科** | Python（暂停） |
| **当前课次** | ${lesson} |
| **当前轮次** | ${round} |
| **最近完成** | #1 变量 |
| **教学文档** | ${guide} |
| **回答文档** | ${answer} |
| **当前进度** | ${progress} |

---

## 📊 知识点掌握情况（权威掌握表）

| 知识点 | 状态 | 评估日期 | 备注 |
|--------|------|----------|------|
| #1 变量 | ✅ 已掌握 | 2026-09-03 | \`学科/Python/99-别的课/01_学生回答.md\` |

---

## 📚 课次 ↔ 文档索引

| 课次 | 知识点 | 教学文档 | 回答文档 |
|------|--------|----------|----------|
| #1 | 变量 | [01_教学引导.md](./学科/Python/01-变量/01_教学引导.md) | [01_学生回答.md](./学科/Python/01-变量/01_学生回答.md) |
`;

const LESSON_FILES = {
  '我的学习/学科/Python/02-循环/01_教学引导.md': '# 教学\n',
  '我的学习/学科/Python/02-循环/01_学生回答.md': '# 回答\n',
};

test('demo 工作区：读取 🚦 表格拿到学科/课程/轮次与两个规范相对路径', async t => {
  const { workspace } = await demoWorkspace(t);
  const state = await getLearningState(workspace);
  assert.equal(state.profilePath, '我的学习/00-学习档案.md');
  assert.equal(state.subject, 'Python');
  assert.equal(state.lesson, '01-认识变量');
  assert.equal(state.round, '第一轮');
  assert.equal(state.guidePath, '我的学习/学科/Python/01-认识变量/01_教学引导.md');
  assert.equal(state.answerPath, '我的学习/学科/Python/01-认识变量/01_学生回答.md');
  assert.equal(state.status, '等待学生作答');
  assert.deepEqual(state.warnings, []);
  // 返回的路径必须是工作区内规范相对路径且真实存在。
  for (const relative of [state.guidePath, state.answerPath]) {
    assert.ok(!path.isAbsolute(relative), '不得返回绝对路径');
    assert.doesNotMatch(relative, /\\/, '必须是正斜杠规范路径');
    assert.ok(await fs.stat(await workspace.resolve(relative)));
  }
});

test('真实模板风格：加粗字段名、反引号路径、占位学科、📊 死链不干扰', async t => {
  const { workspace } = await synthWorkspace(t, templateProfile(), LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.subject, 'Python');
  assert.equal(state.lesson, '循环语句');
  assert.equal(state.round, '第一轮');
  assert.equal(state.guidePath, '我的学习/学科/Python/02-循环/01_教学引导.md');
  assert.equal(state.answerPath, '我的学习/学科/Python/02-循环/01_学生回答.md');
  assert.equal(state.status, '教学已发布，等待学生作答');
  assert.deepEqual(state.warnings, [], '掌握表的死链不得产生警告（只认 🚦）');
});

test('路径可相对档案目录，也可相对工作区根目录', async t => {
  const fromProfile = await synthWorkspace(t, templateProfile({
    guide: '[教学](./学科/Python/02-循环/01_教学引导.md)',
    answer: '[回答](./学科/Python/02-循环/01_学生回答.md)',
  }), LESSON_FILES);
  const a = await getLearningState(fromProfile.workspace);
  assert.equal(a.guidePath, '我的学习/学科/Python/02-循环/01_教学引导.md');
  assert.equal(a.answerPath, '我的学习/学科/Python/02-循环/01_学生回答.md');

  // 根目录相对写法：我的学习/学科/...（不加 ./ 前缀，避免歧义）
  const fromRoot = await synthWorkspace(t, templateProfile({
    guide: '`我的学习/学科/Python/02-循环/01_教学引导.md`',
    answer: '`我的学习/学科/Python/02-循环/01_学生回答.md`',
  }), LESSON_FILES);
  const b = await getLearningState(fromRoot.workspace);
  assert.equal(b.guidePath, '我的学习/学科/Python/02-循环/01_教学引导.md');
  assert.equal(b.answerPath, '我的学习/学科/Python/02-循环/01_学生回答.md');
});

test('尖括号、空格与 Windows 反斜杠路径都能识别', async t => {
  const { workspace } = await synthWorkspace(t, templateProfile({
    guide: '`学科/Python/02-循环/01_教学引导.md`（含附注：见协议第 3 节）',
    answer: '[我的回答](<学科/Python/02-循环/01_学生回答.md>)',
  }), LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.guidePath, '我的学习/学科/Python/02-循环/01_教学引导.md');
  assert.equal(state.answerPath, '我的学习/学科/Python/02-循环/01_学生回答.md');

  const win = await synthWorkspace(t, templateProfile({
    guide: '`学科\\Python\\02-循环\\01_教学引导.md`',
    answer: '`学科\\Python\\02-循环\\01_学生回答.md`',
  }), LESSON_FILES);
  const winState = await getLearningState(win.workspace);
  assert.equal(winState.guidePath, '我的学习/学科/Python/02-循环/01_教学引导.md');
  assert.equal(winState.answerPath, '我的学习/学科/Python/02-循环/01_学生回答.md');
});

test('越界路径被拒绝并给出警告，不返回路径', async t => {
  const { workspace } = await synthWorkspace(t, templateProfile({
    guide: '`../../协议/00_导师协议.md`',
    answer: '`../../协议/01_摸底剧本.md`',
  }), { ...LESSON_FILES, '协议/00_导师协议.md': '# not in root\n', '协议/01_摸底剧本.md': '# not in root\n' });
  const state = await getLearningState(workspace);
  assert.equal(state.guidePath, null);
  assert.equal(state.answerPath, null);
  assert.ok(state.warnings.some(w => w.includes('越出工作区')), state.warnings.join('\n'));
});

test('带 ../ 但净结果仍在工作区内的路径照常接受', async t => {
  const { workspace } = await synthWorkspace(t, templateProfile({
    answer: '`../我的学习/学科/Python/02-循环/01_学生回答.md`',
  }), LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.answerPath, '我的学习/学科/Python/02-循环/01_学生回答.md');
});

test('绝对路径指向工作区之外时被拒绝，指向工作区内时可接受', async t => {
  const outside = await synthWorkspace(t, templateProfile({
    guide: `E:\\somewhere-else\\01_教学引导.md`,
  }), LESSON_FILES);
  const outsideState = await getLearningState(outside.workspace);
  assert.equal(outsideState.guidePath, null);
  assert.ok(outsideState.warnings.some(w => w.includes('越出工作区')), outsideState.warnings.join('\n'));

  const inside = await synthWorkspace(t, templateProfile(), LESSON_FILES);
  const absolute = path.join(inside.root, '我的学习/学科/Python/02-循环/01_教学引导.md').replace(/\//g, '\\');
  const insideProfile = templateProfile({ guide: `\`${absolute}\`` });
  await fs.writeFile(path.join(inside.root, '我的学习/00-学习档案.md'), insideProfile, 'utf8');
  const insideState = await getLearningState(inside.workspace);
  assert.equal(insideState.guidePath, '我的学习/学科/Python/02-循环/01_教学引导.md');
});

test('悬空路径：文件不存在时不返回路径并警告', async t => {
  const { workspace } = await synthWorkspace(t, templateProfile({
    guide: '`学科/Python/09-不存在的一课/01_教学引导.md`',
  }), LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.guidePath, null);
  assert.equal(state.answerPath, '我的学习/学科/Python/02-循环/01_学生回答.md');
  assert.ok(state.warnings.some(w => w.includes('不存在')), state.warnings.join('\n'));
});

test('教学文档一栏指向学生回答文件时按角色拒绝', async t => {
  const { workspace } = await synthWorkspace(t, templateProfile({
    guide: '`学科/Python/02-循环/01_学生回答.md`',
  }), LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.guidePath, null);
  assert.ok(state.warnings.some(w => w.includes('不是协议约定的文件名')), state.warnings.join('\n'));
});

test('占位内容（破折号、空模板占位说明）不产生路径，也不报死链', async t => {
  const stalled = templateProfile({
    subject: '英语语法',
    lesson: '#2 时态呼应',
    guide: '—（#2 尚未发布）',
    answer: '—（#2 尚未发布）',
  });
  const { workspace } = await synthWorkspace(t, stalled, LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.subject, '英语语法');
  assert.equal(state.guidePath, null);
  assert.equal(state.answerPath, null);
  assert.ok(!state.warnings.some(w => w.includes('不存在')), `占位不应报死链：${state.warnings.join(' | ')}`);
  assert.ok(state.warnings.some(w => w.includes('暂未提供路径')), state.warnings.join('\n'));
});

test('出厂空模板：一切为 null/空，并提示尚未开始', async t => {
  const blank = `# 00_学习档案（Learning Profile）

## 🚦 当前交接状态（新会话先读这里）

| 项目 | 当前状态 |
|------|----------|
| **当前学科** | — |
| **当前课次** | — |
| **最近完成** | — |
| **教学文档** | — |
| **回答文档** | — |
| **当前进度** | 🆕 **尚未开始** —— 请导师执行首次流程 |
`;
  const { workspace } = await synthWorkspace(t, blank);
  const state = await getLearningState(workspace);
  assert.equal(state.profilePath, '我的学习/00-学习档案.md');
  assert.equal(state.subject, null);
  assert.equal(state.lesson, null);
  assert.equal(state.guidePath, null);
  assert.equal(state.answerPath, null);
  assert.equal(state.status, null, '「尚未开始」是指令文字，不是当前进度');
  assert.ok(state.warnings.some(w => w.includes('尚未开始')), state.warnings.join('\n'));
});

test('status 保留真实进度文字，但不回显空模板指令', async t => {
  const real = await synthWorkspace(t, templateProfile({ progress: '#1 已复评通过，准备进入 #2' }), LESSON_FILES);
  assert.equal((await getLearningState(real.workspace)).status, '#1 已复评通过，准备进入 #2');

  const templated = await synthWorkspace(t, templateProfile({ progress: '🆕 **尚未开始** —— 请导师执行首次流程（需求收集 → 摸底测试 → 排路线 → 发第一课）' }), LESSON_FILES);
  assert.equal((await getLearningState(templated.workspace)).status, null);
});

test('没有学习档案时返回全空并说明原因', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-learning-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'README.md'), '# 空白文件夹\n', 'utf8');
  const workspace = new Workspace();
  await workspace.open(root);
  const state = await getLearningState(workspace);
  assert.deepEqual(
    { ...state, warnings: undefined },
    { profilePath: null, subject: null, lesson: null, round: null, guidePath: null, answerPath: null, status: null, warnings: undefined },
  );
  assert.ok(state.warnings.some(w => w.includes('未找到学习档案')), state.warnings.join('\n'));
});

test('缺少 🚦 区块时返回空并警告', async t => {
  const noHandoff = '# 档案\n\n## 📊 掌握表\n\n| 单元 | 状态 |\n| --- | --- |\n| 变量 | 未评估 |\n';
  const { workspace } = await synthWorkspace(t, noHandoff);
  const state = await getLearningState(workspace);
  assert.equal(state.profilePath, '我的学习/00-学习档案.md');
  assert.equal(state.subject, null);
  assert.equal(state.guidePath, null);
  assert.ok(state.warnings.some(w => w.includes('🚦')), state.warnings.join('\n'));
});

test('学科名不带 #N 前缀时课程名照样提取；带前缀则剥离', async t => {
  const plain = await synthWorkspace(t, templateProfile({
    lesson: '01-变量与数据类型',
    guide: '`学科/Python/01-变量/01_教学引导.md`',
    answer: '`学科/Python/01-变量/01_学生回答.md`',
  }), { '我的学习/学科/Python/01-变量/01_教学引导.md': '# t\n', '我的学习/学科/Python/01-变量/01_学生回答.md': '# a\n' });
  const a = await getLearningState(plain.workspace);
  assert.equal(a.lesson, '01-变量与数据类型');

  const prefixed = await synthWorkspace(t, templateProfile({ lesson: '#2 循环语句' }), LESSON_FILES);
  const b = await getLearningState(prefixed.workspace);
  assert.equal(b.lesson, '循环语句');

  const subjectPrefixed = await synthWorkspace(t, templateProfile({ subject: '英语语法', lesson: '英语 #1 现在完成时', guide: '`学科/英语语法/01-现在完成时/01_教学引导.md`', answer: '`学科/英语语法/01-现在完成时/01_学生回答.md`' }),
    { '我的学习/学科/英语语法/01-现在完成时/01_教学引导.md': '# t\n', '我的学习/学科/英语语法/01-现在完成时/01_学生回答.md': '# a\n' });
  const c = await getLearningState(subjectPrefixed.workspace);
  assert.equal(c.subject, '英语语法');
  assert.equal(c.lesson, '现在完成时');
});

test('「其他在学学科」不会被误当成当前学科', async t => {
  const { workspace } = await synthWorkspace(t, templateProfile(), LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.subject, 'Python');
});

test('不存在于工作区的档案路径 → 全空但保留 profilePath=null', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-learning-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '我的学习', '学科'), { recursive: true });
  const workspace = new Workspace();
  await workspace.open(root);
  const state = await getLearningState(workspace);
  assert.equal(state.profilePath, null);
  assert.equal(state.guidePath, null);
  assert.ok(state.warnings.length > 0);
});

test('缺少 🚦 字段只警告不抛错（档案被裁剪过）', async t => {
  const partial = `# 档案

## 🚦 当前交接状态

| 项目 | 当前状态 |
|------|----------|
| **当前学科** | Python |
| **教学文档** | \`学科/Python/02-循环/01_教学引导.md\` |
`;
  const { workspace } = await synthWorkspace(t, partial, LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.subject, 'Python');
  assert.equal(state.lesson, null);
  assert.equal(state.round, null);
  assert.equal(state.status, null);
  assert.equal(state.guidePath, '我的学习/学科/Python/02-循环/01_教学引导.md');
  assert.equal(state.answerPath, null);
  assert.ok(state.warnings.some(w => w.includes('回答文档一栏为空')), state.warnings.join('\n'));
});

test('非 Workspace 参数直接拒绝', async () => {
  await assert.rejects(() => getLearningState(null), TypeError);
  await assert.rejects(() => getLearningState({}), TypeError);
  await assert.rejects(() => getLearningState({ read: () => {} }), TypeError);
});

// ── describeFile ───────────────────────────────────────────────────────────

test('describeFile：七种 kind 与对应中文 label', () => {
  assert.equal(describeFile('我的学习/学科/Python/02-循环/01_教学引导.md').kind, 'guide');
  assert.equal(describeFile('我的学习/学科/Python/02-循环/01_学生回答.md').kind, 'answer');
  assert.equal(describeFile('我的学习/学科/Python/00-课程路线.md').kind, 'route');
  assert.equal(describeFile('我的学习/00-学习档案.md').kind, 'profile');
  assert.equal(describeFile('我的学习/我的规则.md').kind, 'rules');
  assert.equal(describeFile('资料/参考/教材.md').kind, 'material');
  assert.equal(describeFile('README.md').kind, 'document');

  const labels = Object.fromEntries(['guide', 'answer', 'route', 'profile', 'rules', 'material', 'document']
    .map(kind => [kind, describeFile(`x/${kind}_教学引导.md`).label]));
  assert.equal(describeFile('a/01_教学引导.md').label, '教学');
  assert.equal(describeFile('a/01_学生回答.md').label, '回答');
  assert.equal(describeFile('a/00-课程路线.md').label, '路线');
  assert.equal(describeFile('a/00-学习档案.md').label, '档案');
  assert.equal(describeFile('a/我的规则.md').label, '规则');
  assert.equal(describeFile('资料/a.md').label, '资料');
  assert.equal(describeFile('a.md').label, '文档');
  assert.equal(Object.keys(labels).length, 7);
});

test('describeFile：模板/说明类文件名不会被误认成当前档案', () => {
  assert.equal(describeFile('我的学习/00-学习档案.md').kind, 'profile');
  assert.equal(describeFile('我的学习/学习档案.md').kind, 'profile');
  assert.equal(describeFile('模板/学习档案模板.md').kind, 'document');
  assert.equal(describeFile('模板/学习档案模板.md').label, '文档');
});

test('describeFile：课程名来自实际课程父目录，不凭文件名标已掌握', () => {
  assert.equal(describeFile('我的学习/学科/Python/02-循环/01_教学引导.md').lesson, '02-循环');
  assert.equal(describeFile('我的学习/学科/英语语法/01-现在完成时/01_学生回答.md').lesson, '01-现在完成时');
  // 直接放在课程目录里的文件同样取该课程目录。
  assert.equal(describeFile('我的学习/学科/Python/02-循环/随堂笔记.md').lesson, '02-循环');
  // 不在 学科/<学科>/<课程>/ 结构里的文件不编造课程名。
  assert.equal(describeFile('我的学习/00-学习档案.md').lesson, null);
  assert.equal(describeFile('我的学习/学科/Python/00-课程路线.md').lesson, null, '学科级文件没有课程父目录');
  assert.equal(describeFile('README.md').lesson, null);
  assert.equal(describeFile('资料/参考/教材.md').lesson, null);
  // 文件名里出现「已掌握」只是名字，不改变分类与标签。
  const sneaky = describeFile('我的学习/学科/Python/02-循环/已掌握_01_学生回答.md');
  assert.equal(sneaky.kind, 'answer');
  assert.equal(sneaky.label, '回答');
  assert.equal(sneaky.lesson, '02-循环');
});

test('describeFile：展示名去掉课次序号前缀，Windows 分隔符同样可用', () => {
  assert.equal(describeFile('我的学习/学科/Python/02-循环/01_教学引导.md').displayName, '教学引导');
  assert.equal(describeFile('我的学习/学科/Python/02-循环/01_学生回答.md').displayName, '学生回答');
  assert.equal(describeFile('我的学习/00-学习档案.md').displayName, '学习档案');
  assert.equal(describeFile('我的学习/学科/Python/02-循环/01_教学引导.md').kind,
    describeFile('我的学习\\学科\\Python\\02-循环\\01_教学引导.md').kind);
  assert.equal(describeFile('我的学习\\学科\\Python\\02-循环\\01_教学引导.md').lesson, '02-循环');
});

test('describeFile：非法输入抛 TypeError', () => {
  for (const bad of [undefined, null, '', '   ', 42, {}]) {
    assert.throws(() => describeFile(bad), TypeError);
  }
});

// ── 对真实参考仓库的只读校验 ────────────────────────────────────────────────
// 参考仓库是只读的：只读取，不写入，也不修改任何真实学习记录。
test('真实 StepsToGreat 档案（只读）：若存在则可解析出模板结构，且路径不越界', async t => {
  let exists = true;
  try { await fs.stat(REAL_PROFILE); } catch { exists = false; }
  if (!exists) { t.skip('本机没有 E:\\StepsToGreat，跳过只读参考校验。'); return; }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stg-learning-real-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // 只复制档案与它引用的少量文件，避免触碰真实目录的写权限。
  const learning = path.join(root, '我的学习');
  await fs.mkdir(learning, { recursive: true });
  await fs.copyFile(REAL_PROFILE, path.join(learning, '00-学习档案.md'));
  const workspace = new Workspace();
  await workspace.open(root);

  const state = await getLearningState(workspace);
  assert.equal(state.profilePath, '我的学习/00-学习档案.md');
  // 出厂真实档案是空模板：不得凭空造出学科、课次或路径。
  assert.equal(state.subject, null);
  assert.equal(state.lesson, null);
  assert.equal(state.guidePath, null);
  assert.equal(state.answerPath, null);
  assert.equal(state.status, null);
  assert.ok(Array.isArray(state.warnings) && state.warnings.length > 0);
  // 真实档案原文未改动（只读参考）。
  assert.equal(await fs.readFile(REAL_PROFILE, 'utf8'), await fs.readFile(path.join(learning, '00-学习档案.md'), 'utf8'));

  const described = describeFile('我的学习/00-学习档案.md');
  assert.equal(described.kind, 'profile');
  assert.equal(described.label, '档案');
});

test('真实 fixture 形状：🚦 用反引号路径 + 📚 用 Markdown 链接时，只采信 🚦', async t => {
  // 复刻 tests/fixtures/00-valid-progress 的形状（链接样式），但掌握表故意指向死链，
  // 断言结果只会来自 🚦，不会从掌握表推断。
  const profile = templateProfile({
    guide: '`学科/Python/02-循环/01_教学引导.md`',
    answer: '`学科/Python/02-循环/01_学生回答.md`',
  }).replace('`学科/Python/99-别的课/01_学生回答.md`', '`学科/Python/77-不存在的课/01_学生回答.md`');
  const { workspace } = await synthWorkspace(t, profile, LESSON_FILES);
  const state = await getLearningState(workspace);
  assert.equal(state.guidePath, '我的学习/学科/Python/02-循环/01_教学引导.md');
  assert.equal(state.answerPath, '我的学习/学科/Python/02-循环/01_学生回答.md');
  assert.deepEqual(state.warnings, []);
});
