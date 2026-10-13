const test=require('node:test');
const assert=require('node:assert/strict');
const {getLearningProgress}=require('../lib/learning-progress.cjs');
const guidePath='我的学习/学科/Python/01-变量/01_教学引导.md';
const profilePath='我的学习/00-学习档案.md',routePath='我的学习/学科/Python/00-课程路线.md';
function fixture(files={},overrides={}){return {workspace:{read:async p=>{if(!(p in files))throw Error('missing');return {content:files[p]};}},options:{guidePath,routePath,learning:{guidePath,profilePath,subject:'Python',round:'第一轮',status:'等待学生作答',...overrides}}};}
async function run(files,overrides){const {workspace,options}=fixture(files,overrides);return getLearningProgress(workspace,options);}
test('chapter uses current handoff, overall counts explicit route completion without counting submission',async()=>{
  const p=await run({[routePath]:'## 逐课规划表\n### #1 变量（状态：已完成）\n### #2 循环（状态：未掌握）\n### #3 函数（状态：进行中）\n### #4 类（状态：未评估）\n### #5 `<课名>`（状态：`<未开始 / 进行中 / 已完成>`）'});
  assert.equal(p.chapter,'第一轮 · 等待学生作答');assert.equal(p.overall,'Python · 1 / 4 课已掌握');
});
test('mastery table fallback excludes placeholders, other tables, fenced and quoted examples',async()=>{
  const p=await run({[profilePath]:'## 📊 掌握表\n| 单元 | 状态 |\n| --- | --- |\n| 变量 | ✅ 已掌握 |\n| 循环 | 未掌握 |\n| 函数 | 未评估 |\n| `<单元>` | 已掌握 |\n\n```md\n## 掌握表\n| 单元 | 状态 |\n| --- | --- |\n| 假 | 已掌握 |\n```\n\n> ## 掌握表\n> | 单元 | 状态 |\n> | --- | --- |\n> | 假 | 已掌握 |\n\n## ⏳ 待办表\n| 单元 | 状态 |\n| --- | --- |\n| 假 | 已掌握 |'});
  assert.equal(p.overall,'学习档案 · 1 / 3 课已掌握');
});
test('different selected chapter uses its own round and status, ignores current handoff',async()=>{
  const {workspace,options}=fixture({[guidePath]:'## 第二轮\n\n| 字段 | 内容 |\n| --- | --- |\n| 课程状态 | 待复评 |\n\n```md\n## 第九轮\n```'},{guidePath:'我的学习/学科/Python/02-循环/01_教学引导.md'});
  assert.equal((await getLearningProgress(workspace,options)).chapter,'第二轮 · 待复评');
});
test('missing records and untouched templates never produce invented progress',async()=>{
  const p=await run({[routePath]:'### #1 `<课名>`（状态：`<未开始>`）',[profilePath]:'## 📊 掌握表\n| 知识点 | 状态 |\n| --- | --- |\n| `<知识点>` | ⏳ 待作答 |'},{round:null,status:null});
  assert.deepEqual(p,{chapter:'尚未记录',overall:'尚未记录'});
});
test('route status tables and unknown statuses retain the actual planned denominator',async()=>{
  const p=await run({[routePath]:'## 课程\n| 课次 | 状态 |\n| --- | --- |\n| #1 | 已掌握 |\n| #2 | — |\n| #3 | 部分掌握 |'});
  assert.equal(p.overall,'Python · 1 / 3 课已掌握（1 课待记录）');
});
// 「当前章节进度」的轮次/状态来自文档扫描，而学习档案的 round 为空时才会走这条回退分支
// （17-Lambda与Stream 一课正是如此），所以下面几条用 round/status:null 覆盖真实情形。
test('注释里预留的轮次标题不被当成当前轮次，注释原文与其它轮次不受影响',async()=>{
  const hidden='<!-- 第三轮（第二轮全通过后由导师追加）\n## 第三轮 · 问题 5：Stream 综合练习\n-->';
  const guide='## 第二轮 · 问题 3：Lambda\n\n| 字段 | 内容 |\n| --- | --- |\n| 课程状态 | 待复评 |\n\n'+hidden+'\n';
  assert.equal((await run({[guidePath]:guide},{round:null,status:null})).chapter,'第二轮 · 待复评');
});
test('注释里预留的状态行不被当成真实课程状态',async()=>{
  const guide='## 第一轮\n\n| 字段 | 内容 |\n| --- | --- |\n| 课程状态 | 待复评 |\n\n<!--\n| 字段 | 内容 |\n| --- | --- |\n| 课程状态 | 已全部通过（预留草稿） |\n-->\n';
  assert.equal((await run({[guidePath]:guide},{round:null,status:null})).chapter,'第一轮 · 待复评');
});
test('注释里预留的掌握表不进入 overall，注释后紧邻的真实轮次与表格仍然生效',async()=>{
  const profile='## 📊 掌握表\n| 单元 | 状态 |\n| --- | --- |\n| 变量 | ✅ 已掌握 |\n| 循环 | 未掌握 |\n\n<!--\n## 📊 掌握表（预留）\n| 单元 | 状态 |\n| --- | --- |\n| 假A | 已掌握 |\n| 假B | 已掌握 |\n-->\n';
  assert.equal((await run({[profilePath]:profile})).overall,'学习档案 · 1 / 2 课已掌握');
  const guide='## 第一轮\n\n<!-- 预留\n## 第九轮 · 问题 99\n-->\n\n## 第二轮 · 问题 3\n\n| 字段 | 内容 |\n| --- | --- |\n| 课程状态 | 待复评 |\n';
  assert.equal((await run({[guidePath]:guide},{round:null,status:null})).chapter,'第二轮 · 待复评');
});
test('注释里预留的路线单元不进入分母，fence 与引用块示例仍被忽略',async()=>{
  const route='## 逐课规划表\n### #1 变量（状态：已完成）\n### #2 循环（状态：未掌握）\n\n<!--\n### #9 未发布单元（状态：已完成）\n### #10 未发布单元（状态：已完成）\n-->\n';
  assert.equal((await run({[routePath]:route})).overall,'Python · 1 / 2 课已掌握');
  const profile='## 📊 掌握表\n| 单元 | 状态 |\n| --- | --- |\n| 变量 | ✅ 已掌握 |\n\n```md\n<!--\n## 📊 掌握表\n| 假 | 已掌握 |\n-->\n```\n\n> <!--\n> | 假 | 已掌握 |\n> -->\n';
  assert.equal((await run({[profilePath]:profile})).overall,'学习档案 · 1 / 1 课已掌握');
});
