const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Workspace}=require('../lib/workspace.cjs');
const {parseQuestions,appendAnswers}=require('../lib/stg.cjs');
const answer='我的学习/学科/Python/01-认识变量/01_学生回答.md';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.cp(path.join(__dirname,'../demo/StepsToGreat'),root,{recursive:true});const w=new Workspace();await w.open(root);return {root,w};}
test('real document questions, current round, fenced pseudo-headings',()=>{
  const text='# 回答\n## 第一轮\n### 问题 1\n第一题\n**我的回答**\n```md\n## 第二轮\n### 问题 99\n```\n## 第三轮\n### 问题 2\n第二题\n**我的回答**\n## 第三轮评估\n历史评估\n## 最终复评结果\n保留';
  const p=parseQuestions(text);assert.equal(p.questions.length,2);assert.equal(p.current[0].number,'2');assert.equal(p.round,'第三轮');
  const result=appendAnswers(text,{[p.current[0].id]:'原文\n```python\nprint(1)\n```'});
  assert.ok(result.includes('历史评估\n## 最终复评结果\n保留'));assert.ok(result.includes('````text'));assert.ok(result.indexOf('学生作答')<result.indexOf('## 第三轮评估'));
});
test('append saves original answers, final assessment, and backups',async t=>{
  const {root,w}=await fixture(t);const before=await w.read(answer);const q=before.questions.current;assert.equal(q.length,2);
  const after=await w.submit(answer,{[q[0].id]:'price 是变量名，25 是值。',[q[1].id]:'age = 21\nprint(age)'},before.version);
  assert.ok(after.content.includes('price 是变量名'));assert.ok(after.content.includes('（整课所有轮次通过后由导师填写）'));
  const backups=await fs.readdir(path.join(root,'.stg-desk/backups'));assert.equal(backups.length,1);assert.equal(await fs.readFile(path.join(root,'.stg-desk/backups',backups[0]),'utf8'),before.content);
  const again=await w.submit(answer,{[after.questions.current[0].id]:'补充理解'},after.version);assert.ok(again.content.includes('price 是变量名'));assert.ok(again.content.includes('补充理解'));
});
test('external changes block both document save and answer submission',async t=>{
  const {root,w}=await fixture(t);const doc=await w.read(answer);await fs.appendFile(path.join(root,answer),'\n导师新评估');
  await assert.rejects(w.save(answer,'overwrite',doc.version),/其他程序修改/);
  await assert.rejects(w.submit(answer,{[doc.questions.current[0].id]:'answer'},doc.version),/已变化/);
  assert.ok((await w.read(answer)).content.endsWith('导师新评估'));
});
test('reject traversal, absolute paths and non-UTF8',async t=>{
  const {root,w}=await fixture(t);await assert.rejects(w.read('../outside.md'));await assert.rejects(w.read(path.join(root,answer)));
  await fs.writeFile(path.join(root,'bad.md'),Buffer.from([0xff,0xfe,0x00]));await assert.rejects(w.read('bad.md'),/UTF-8/);
});
test('CRLF remains intact outside appended blocks',()=>{const s='# 回答\r\n## 第一轮\r\n### 问题 1\r\n题目\r\n**我的回答**\r\n\r\n---\r\n\r\n## 最终复评结果\r\n未评估\r\n';const id=parseQuestions(s).current[0].id;const result=appendAnswers(s,{[id]:'第一行\n第二行'});assert.ok(!/(?<!\r)\n/.test(result));assert.ok(result.endsWith('## 最终复评结果\r\n未评估\r\n'));});
test('do not allow answering a guide or an unpublished/mismatched question',async t=>{const {w}=await fixture(t);const d=await w.read(answer);await assert.rejects(w.submit(answer.replace('学生回答','教学引导'),{'1':'foo'},d.version),/只能写入/);await assert.rejects(w.submit(answer,{'fake':'foo'},d.version),/题目已变化/);});
