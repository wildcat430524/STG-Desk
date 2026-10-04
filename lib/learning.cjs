'use strict';
// 独立学习导航：从 StepsToGreat 学习档案识别「现在学到哪」。
// 单一事实来源 = 00-学习档案.md 的 🚦 当前交接状态区块。
// 本模块只读、不写、不引用 AI；路径必须真实存在于工作区内。
const fs = require('node:fs/promises');
const path = require('node:path');

const POSIX = path.posix;

// ── 学习档案定位 ────────────────────────────────────────────────────────────
// 标准布局：<root>/我的学习/00-学习档案.md；也容忍档案直接放在根目录。
const PROFILE_CANDIDATES = ['我的学习/00-学习档案.md', '00-学习档案.md'];

// ── 🚦 交接状态字段别名（真实档案里同一含义有多种写法） ──────────────────────
const FIELD_ALIASES = {
  subject: ['当前学科', '当前科目', '学科'],
  lesson: ['当前课次', '当前课程', '课次', '课程'],
  round: ['当前轮次', '轮次', '当前轮'],
  guide: ['教学文档', '教学引导', '教学引导文档'],
  answer: ['回答文档', '学生回答', '学生回答文档', '作答文档'],
  status: ['当前进度', '当前状态', '状态', '进展'],
};
// 「其他在学学科」不是当前学科，必须排除。
const PARALLEL_LABEL = /其他|并行/;

// ── describeFile 的分类表 ───────────────────────────────────────────────────
const KIND_LABEL = {
  guide: '教学',
  answer: '回答',
  route: '路线',
  profile: '档案',
  rules: '规则',
  material: '资料',
  document: '文档',
};

const ROLE_PATTERN = {
  guide: /教学引导\.(?:md|markdown)$/i,
  answer: /学生回答\.(?:md|markdown)$/i,
};
const ROLE_LABEL = { guide: '教学文档', answer: '回答文档' };
const DOC_EXTENSION = /\.(?:md|markdown|txt)$/i;

const HEADING = /^(#{1,6})[ \t]*(.+?)[ \t]*#*[ \t]*$/;
const MARKDOWN_LINK = /!?\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

// ── 小工具 ──────────────────────────────────────────────────────────────────
const toPosix = value => String(value).replace(/\\/g, '/');
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const truncate = (value, max = 60) => {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

function assertWorkspace(workspace) {
  if (!workspace || typeof workspace.resolve !== 'function' || typeof workspace.read !== 'function') {
    throw new TypeError('getLearningState 需要 lib/workspace.cjs 的 Workspace 实例。');
  }
}

// 去掉盘符 / 前导斜杠 / ./，统一成正斜杠的相对写法。
function normalizeRelative(value) {
  let text = toPosix(String(value)).trim();
  text = text.replace(/^file:\/\/+/i, '');
  text = text.replace(/^\/[a-zA-Z]:\//, ''); // /E:/x → E:/x
  text = text.replace(/^[a-zA-Z]:\//, '');   // E:/x  → x
  text = text.replace(/^\/+/, '');
  text = text.replace(/^\.\//, '');
  return text;
}

// 单元格里的链接目标：去掉尖括号、片段、查询、尾随标点、百分号编码。
function cleanTarget(raw) {
  let text = String(raw == null ? '' : raw).trim();
  if (/^<[\s\S]*>$/.test(text)) text = text.slice(1, -1).trim();
  text = text.replace(/^["']|["']$/g, '').trim();
  text = toPosix(text);
  text = text.replace(/[?#].*$/, '');
  try { text = decodeURI(text); } catch { /* 非法转义按原样保留 */ }
  text = text.replace(/[，。；、）)】》]+$/, '').trim();
  return text;
}

// 从一个单元格里按优先级抽取所有候选路径：Markdown 链接 → 尖括号 → 反引号 → 裸相对路径。
function extractTargets(cell) {
  const found = [];
  let rest = String(cell == null ? '' : cell);
  rest = rest.replace(MARKDOWN_LINK, (_all, label, dest) => {
    found.push({ raw: dest, via: 'link', label: String(label || '').trim() });
    return ' ';
  });
  rest = rest.replace(/<([^<>\n]+)>/g, (_all, inner) => { found.push({ raw: inner, via: 'angle' }); return ' '; });
  rest = rest.replace(/`([^`\n]+)`/g, (_all, inner) => { found.push({ raw: inner, via: 'code' }); return ' '; });
  // 裸路径：相对（./x）或绝对（E:\x），只要以文档扩展名结尾就收作候选。
  for (const match of rest.matchAll(/(?:^|[\s（(【|])([^\s|，。；：、）)】"'`]+\.(?:md|markdown|txt))/gi)) {
    found.push({ raw: match[1], via: 'bare' });
  }
  for (const match of rest.matchAll(/(?:^|[\s（(【|])((?:\.{1,2}\/)[^\s，。；：、）)】"'`]+)/g)) {
    found.push({ raw: match[1], via: 'bare' });
  }
  return found.map(item => ({ ...item, raw: cleanTarget(item.raw) })).filter(item => item.raw);
}

// 占位内容：—、`<路径>`、（#2 尚未发布）、（整课所有轮次通过后由导师填写）……
function isBlankText(value) {
  const text = String(value == null ? '' : value).replace(/[`*\s\u3000]/g, '').trim();
  if (!text) return true;
  if (/^[-–—－~～·•]+$/.test(text)) return true;
  const wrapped = text.match(/^[（(【\[《]([\s\S]*?)[）)】\]》]$/);
  if (wrapped) return isBlankText(wrapped[1]);
  return /^(?:尚未开始|尚未发布|尚未进行|尚未编写|未开始|待定|待填写|待补充|待建|暂无|暂缺|无|空|n\/a|tbd|todo)$/i.test(text);
}

function isPlaceholderCell(cell) {
  const text = String(cell == null ? '' : cell).replace(/`/g, '').trim();
  if (!text) return true;
  if (isBlankText(text)) return true;
  if (/^<[^>]*>$/.test(text)) return true;
  if (!/[\/\\]/.test(text) && /尚未|待发布|待补充|待填|未填|未编写|由导师填写|在此作答|尚未开始/.test(text)) return true;
  return false;
}

// ── 档案解析 ────────────────────────────────────────────────────────────────
// 只切出 🚦 区块：其他区块（📊 掌握表 / 📚 索引 / 引言里的模板链接）一律不参与判断。
function handoffSection(content) {
  const lines = String(content == null ? '' : content).split(/\r?\n/);
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(HEADING);
    if (!match) continue;
    if (/🚦|当前交接状态|当前交接/.test(match[2])) { start = i; level = match[1].length; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const match = lines[i].match(HEADING);
    if (match && match[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  const cells = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '|') { current += '|'; i++; continue; }
    if (char === '|') { cells.push(current.trim()); current = ''; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

const normalizeLabel = value => String(value == null ? '' : value).replace(/[`*_\s\u3000]/g, '').replace(/[：:]+$/, '');
const isSeparatorRow = cells => cells.length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(cell.replace(/[\s\u3000]/g, '')));

function readFields(section) {
  const rows = [];
  for (const line of String(section == null ? '' : section).split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith('|')) continue;
    const cells = splitRow(text);
    if (cells.length < 2 || isSeparatorRow(cells)) continue;
    rows.push([normalizeLabel(cells[0]), cells.slice(1).join('|').trim()]);
  }
  const fields = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const usable = rows.filter(([label]) => !PARALLEL_LABEL.test(label));
    let hit = null;
    for (const alias of aliases) { hit = usable.find(([label]) => label === alias); if (hit) break; }
    if (!hit) for (const alias of aliases) { hit = usable.find(([label]) => label.includes(alias)); if (hit) break; }
    fields[field] = hit ? hit[1] : null;
  }
  return fields;
}

function cleanValue(raw) {
  if (raw == null) return null;
  const text = String(raw).replace(/`/g, '').replace(/^\*+|\*+$/g, '').trim();
  if (!text || isBlankText(text)) return null;
  return text;
}

// 空模板里的「🆕 **尚未开始** —— 请导师执行首次流程…」是指令文字，不是当前进度。
function cleanStatus(raw) {
  const value = cleanValue(raw);
  if (!value) return null;
  const bare = value.replace(/[*_`~🆕\s\u3000]/g, '');
  if (bare.startsWith('尚未开始')) return null;
  return value;
}

// 课程名：剥掉「#2」「英语 #1」「Python #2」这类交叉引用前缀，保留真实目录名（如 01-认识变量）。
function cleanLesson(raw, subject) {
  const value = cleanValue(raw);
  if (!value) return null;
  let text = value;
  if (subject) {
    const prefixed = new RegExp(`^${escapeRegExp(subject)}\\s*#\\d+\\s+`);
    if (prefixed.test(text)) text = text.replace(prefixed, '').trim();
  }
  text = text.replace(/^#\d+\s*/, '').trim();
  text = text.replace(/^\S{1,12}\s+#\d+\s+/, '').trim();
  return text || null;
}

// ── 真实存在性 + 角色校验 ───────────────────────────────────────────────────
async function verifyTarget(workspace, candidate, role) {
  if (!DOC_EXTENSION.test(candidate)) return { ok: false, reason: 'notdoc' };
  let real;
  try {
    real = await workspace.resolve(candidate);
  } catch (error) {
    const message = String((error && error.message) || '');
    if (/越出|文件夹之外|必须位于导入|无效文件路径/.test(message)) return { ok: false, reason: 'outside' };
    return { ok: false, reason: 'missing' };
  }
  let stat;
  try { stat = await fs.stat(real); } catch { return { ok: false, reason: 'missing' }; }
  if (!stat.isFile()) return { ok: false, reason: 'notfile' };
  if (role && ROLE_PATTERN[role] && !ROLE_PATTERN[role].test(candidate)) return { ok: false, reason: 'role' };
  return { ok: true, path: toPosix(path.relative(workspace.root, real)) };
}

// 绝对路径：先按字面相对化，再对真实路径（realpath）相对化，容忍 Windows 短名/大小写。
async function relativizeAbsolute(root, raw) {
  const candidate = path.resolve(toPosix(raw).trim());
  const attempts = [candidate];
  try { attempts.push(await fs.realpath(candidate)); } catch { /* 文件不存在时只按字面比较 */ }
  for (const attempt of attempts) {
    const rel = toPosix(path.relative(root, attempt));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    return rel;
  }
  return null;
}

// 链接可相对档案目录，也可相对工作区根目录；绝对路径必须先落在工作区内。
async function locate(workspace, raw, baseDir, role) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) && !/^[a-zA-Z]:[\\/]/.test(text)) return { ok: false, reason: 'external' };

  let candidate = toPosix(text).trim();
  if (/^file:\/\//i.test(candidate)) {
    try {
      candidate = decodeURIComponent(new URL(candidate).pathname);
      candidate = candidate.replace(/^\/([a-zA-Z]:)/, '$1');
    } catch { /* 保留原文本，交给后面的越界判断 */ }
  }

  if (POSIX.isAbsolute(candidate) || path.win32.isAbsolute(candidate)) {
    const relative = await relativizeAbsolute(workspace.root, candidate);
    if (!relative) return { ok: false, reason: 'outside' };
    return verifyTarget(workspace, POSIX.normalize(relative), role);
  }

  const ordered = [];
  const seen = new Set();
  for (const attempt of [baseDir ? POSIX.join(baseDir, candidate) : candidate, candidate]) {
    const normalized = POSIX.normalize(attempt);
    if (!seen.has(normalized)) { seen.add(normalized); ordered.push(normalized); }
  }

  // 候选路径依次尝试；保留信息量最大的失败原因（角色/越界 > 缺失）。
  const RANK = { role: 4, outside: 3, notfile: 2, notdoc: 2, external: 1, missing: 0 };
  const attempts = [];
  const keep = reason => { if (reason && !attempts.includes(reason)) attempts.push(reason); };

  for (const attempt of ordered) {
    if (attempt.startsWith('..') || POSIX.isAbsolute(attempt)) { keep('outside'); continue; }
    const result = await verifyTarget(workspace, attempt, role);
    if (result.ok) return result;
    keep(result.reason);
  }
  const best = attempts.sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0))[0];
  return { ok: false, reason: best || 'missing' };
}

function warningFor(label, result, raw) {
  switch (result && result.reason) {
    case 'outside': return `${label}越出工作区范围，已忽略：${truncate(raw)}`;
    case 'role': return `${label}不是协议约定的文件名，已忽略：${truncate(raw)}`;
    case 'notfile': return `${label}指向的是文件夹，不是文档：${truncate(raw)}`;
    case 'notdoc': return `${label}不是 Markdown/TXT 文档，已忽略：${truncate(raw)}`;
    case 'external': return `${label}指向外部链接，已忽略：${truncate(raw)}`;
    default: return `${label}指向的文件不存在：${truncate(raw)}`;
  }
}

async function resolveRole(workspace, cell, role, baseDir, warnings, started) {
  const label = ROLE_LABEL[role];
  if (cell == null || !String(cell).trim()) {
    if (started) warnings.push(`${label}一栏为空。`);
    return null;
  }
  const targets = extractTargets(cell);
  if (!targets.length) {
    if (started) {
      if (isPlaceholderCell(cell)) warnings.push(`${label}暂未提供路径（占位内容：${truncate(cell)}）。`);
      else warnings.push(`${label}一栏里没有可识别的文件路径：${truncate(cell)}`);
    }
    return null;
  }
  let last = null;
  for (const target of targets) {
    const result = await locate(workspace, target.raw, baseDir, role);
    if (result.ok) return result.path;
    last = result;
  }
  if (started || (last && last.reason !== 'missing')) warnings.push(warningFor(label, last, targets[0].raw));
  return null;
}

async function findProfile(workspace, warnings) {
  for (const candidate of PROFILE_CANDIDATES) {
    try {
      const real = await workspace.resolve(candidate);
      if ((await fs.stat(real)).isFile()) return toPosix(path.relative(workspace.root, real));
    } catch { /* 继续尝试下一个候选 */ }
  }
  let found = null;
  try {
    const info = await workspace.tree();
    const walk = (nodes, depth) => {
      for (const node of nodes || []) {
        if (node.children) { if (depth < 6) walk(node.children, depth + 1); continue; }
        if (/学习档案\.md$/i.test(node.name)) {
          if (!found || node.path.length < found.length) found = node.path;
        }
      }
    };
    walk(info && info.children, 0);
  } catch (error) {
    warnings.push(`读取工作区目录失败：${truncate((error && error.message) || error)}`);
  }
  if (found) warnings.push(`未找到标准的「我的学习/00-学习档案.md」，改用 ${found}。`);
  return found;
}

/**
 * 读取当前学习状态。唯一依据是 00-学习档案.md 的 🚦 当前交接状态区块。
 * @param {import('./workspace.cjs').Workspace} workspace
 * @returns {Promise<{profilePath:string|null,subject:string|null,lesson:string|null,round:string|null,guidePath:string|null,answerPath:string|null,status:string|null,warnings:string[]}>}
 */
async function getLearningState(workspace) {
  assertWorkspace(workspace);
  const warnings = [];
  const empty = { profilePath: null, subject: null, lesson: null, round: null, guidePath: null, answerPath: null, status: null, warnings };

  const profilePath = await findProfile(workspace, warnings);
  if (!profilePath) {
    warnings.push('未找到学习档案（00-学习档案.md），无法确定当前学习状态。');
    return empty;
  }
  empty.profilePath = profilePath;

  let content;
  try {
    content = (await workspace.read(profilePath)).content;
  } catch (error) {
    warnings.push(`无法读取学习档案：${truncate((error && error.message) || error)}`);
    return empty;
  }

  const section = handoffSection(content);
  if (section == null) {
    warnings.push('学习档案里没有找到 🚦 当前交接状态区块。');
    return empty;
  }

  const fields = readFields(section);
  const subject = cleanValue(fields.subject);
  const lesson = cleanLesson(fields.lesson, subject);
  const round = cleanValue(fields.round);
  const status = cleanStatus(fields.status);
  const baseDir = POSIX.dirname(profilePath) === '.' ? '' : POSIX.dirname(profilePath);
  const started = Boolean(subject || lesson);

  const guidePath = await resolveRole(workspace, fields.guide, 'guide', baseDir, warnings, started);
  const answerPath = await resolveRole(workspace, fields.answer, 'answer', baseDir, warnings, started);

  if (guidePath && answerPath && POSIX.dirname(guidePath) !== POSIX.dirname(answerPath)) {
    warnings.push('教学文档与回答文档不在同一课目录下，请核对学习档案。');
  }
  if (!started && !warnings.length) warnings.push('学习档案尚未开始（🚦 交接状态为空模板）。');

  return {
    profilePath,
    subject,
    lesson,
    round,
    guidePath,
    answerPath,
    status: typeof status === 'string' ? status : null,
    warnings: [...new Set(warnings)],
  };
}

// ── 单个文件的分类 ──────────────────────────────────────────────────────────
function detectKind(segments, name) {
  const stem = name.replace(DOC_EXTENSION, '');
  // 只有「学习档案.md / 00-学习档案.md」是当前档案；模板/说明保持为普通文档。
  if (/^(?:00[-_])?学习档案$/.test(stem)) return 'profile';
  if (/我的规则/.test(stem)) return 'rules';
  if (/课程路线/.test(stem)) return 'route';
  if (/教学引导/.test(stem)) return 'guide';
  if (/学生回答/.test(stem)) return 'answer';
  if (segments.slice(0, -1).includes('资料') || /资料/.test(stem)) return 'material';
  return 'document';
}

// 课程名只从真实的「学科/<学科>/<课程>/」父目录提取，绝不凭文件名判断是否已掌握。
function lessonOf(segments, name) {
  const index = segments.lastIndexOf('学科');
  if (index < 0) return null;
  if (segments.length - index < 4) return null;
  const candidate = segments[index + 2];
  if (!candidate || candidate === name) return null;
  return candidate;
}

function displayNameOf(stem, name) {
  // 只剥掉 1–3 位课次序号前缀；日期之类的长数字保持原样。
  const text = stem.replace(/^\d{1,3}[-_.\s]+/, '').trim();
  return text || stem || name;
}

/**
 * 描述一个工作区相对路径的用途分类。
 * @param {string} relativePath 工作区相对路径（接受 / 与 \ 分隔）
 * @returns {{kind:'guide'|'answer'|'route'|'profile'|'rules'|'material'|'document',label:string,lesson:string|null,displayName:string}}
 */
function describeFile(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new TypeError('describeFile 需要一个工作区相对路径。');
  }
  const normalized = normalizeRelative(relativePath);
  const segments = normalized.split('/').filter(Boolean);
  const name = segments.length ? segments[segments.length - 1] : normalized;
  const stem = name.replace(/\.[^./\\]+$/, '') || name;
  const kind = detectKind(segments, name);
  return {
    kind,
    label: KIND_LABEL[kind],
    lesson: lessonOf(segments, name),
    displayName: displayNameOf(stem, name),
  };
}

module.exports = { getLearningState, describeFile };
