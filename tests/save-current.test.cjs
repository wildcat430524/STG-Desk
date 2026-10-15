const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Workspace}=require('../lib/workspace.cjs');
const {mergeCurrent}=require('../lib/save-current.cjs');
const {parseQuestions,appendAnswers}=require('../lib/stg.cjs');
const source='# 回答\n\n## 第二轮\n\n### 问题 3：Lambda\n启动线程。\n\n**我的回答**\n\n### 问题 4：Stream\n收集结果。\n\n**我的回答**\n\n## 最终复评结果\n导师填写\n';
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-save-current-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file='01_学生回答.md';await fs.writeFile(path.join(root,file),source);
  const w=new Workspace();await w.open(root);return {root,file,w,doc:await w.read(file)};
}
test('one save includes complete-document edits and answer inputs, remapping shifted question offsets',async t=>{
  const {w,file,doc}=await fixture(t);
  const entries=doc.questions.current.map(q=>({...q,value:'原答 '+q.number+'\n```java\nrun();\n```'}));
  const result=await w.saveCurrent(file,{content:doc.content.replace('# 回答','# 修改后的回答'),baseContent:doc.content,answers:entries});
  assert.ok(result.content.startsWith('# 修改后的回答'));
  for(const q of result.questions.current)assert.ok(result.content.slice(q.start,q.end).includes('原答 '+q.number));
  assert.ok(result.content.endsWith('## 最终复评结果\n导师填写\n'));
  assert.equal((await w.backups(file)).length,1);
});
test('stale answer versions save against latest disk content and retain tutor updates',async t=>{
  const {root,w,file,doc}=await fixture(t);
  const disk=source.replace('# 回答','# 导师更新的标题')+'\n导师追加评估';
  await fs.writeFile(path.join(root,file),disk);
  const result=await w.saveCurrent(file,{content:source,baseContent:source,answers:[{...doc.questions.current[1],value:'结果'}]});
  assert.ok(result.content.startsWith('# 导师更新的标题'));
  assert.ok(result.content.endsWith('导师追加评估'));
  assert.ok(result.content.includes('结果'));
  const [backup]=await w.backups(file);assert.equal(await w.readBackup(file,backup.id),disk);
});
test('visible edits win overlapping changes with the replaced disk content backed up',async t=>{
  const {root,w,file}=await fixture(t);await fs.writeFile(path.join(root,file),'外部的新版本');
  const result=await w.saveCurrent(file,{content:'我正在编辑的版本',baseContent:source});
  assert.equal(result.content,'我正在编辑的版本');
  const [backup]=await w.backups(file);assert.equal(await w.readBackup(file,backup.id),'外部的新版本');
});
test('new or rewritten questions preserve input by refusing to attach it to a different question',async t=>{
  const {root,w,file,doc}=await fixture(t);
  const disk=source.replace('启动线程。','解释线程安全。');await fs.writeFile(path.join(root,file),disk);
  await assert.rejects(w.saveCurrent(file,{content:source,baseContent:source,answers:[{...doc.questions.current[0],value:'旧题的答案'}]}),/题目已更新/);
  assert.equal((await w.read(file)).content,disk);
});
test('save with no changes creates no duplicate backup and can save empty content',async t=>{
  const {w,file}=await fixture(t);
  await w.saveCurrent(file,{content:source,baseContent:source});assert.equal((await w.backups(file)).length,0);
  const result=await w.saveCurrent(file,{content:'',baseContent:source});assert.equal(result.content,'');
});
test('independent windows serialize saves and preserve independent modifications',async t=>{
  const {root,w,file}=await fixture(t),other=new Workspace();await other.open(root);
  await Promise.all([
    w.saveCurrent(file,{content:source.replace('# 回答','# 新标题'),baseContent:source}),
    other.saveCurrent(file,{content:source+'\n第二窗口编辑',baseContent:source})
  ]);
  const result=await w.read(file);assert.ok(result.content.startsWith('# 新标题'));assert.ok(result.content.endsWith('第二窗口编辑'));
});
test('independent edits, identical edits, and a shared insertion point merge deterministically',()=>{
  assert.equal(mergeCurrent('abc','Abc','abc!'),'Abc!');
  assert.equal(mergeCurrent('abc','abc!','Abc'),'Abc!');
  assert.equal(mergeCurrent('abc','abc!','abc!'),'abc!');
  assert.equal(mergeCurrent('abc','abcL','abcD'),'abcLD');
  assert.equal(mergeCurrent('abc','Xbc','Zabc'),'ZXbc');
  assert.equal(mergeCurrent('abc','Zabc','Xbc'),'ZXbc');
});
test('serializer-only escaping cannot restore an outdated lesson over the tutor version',()=>{
  const old='# 17-Lambda与Stream | 01_教学引导\n\n旧教学内容。\n';
  const snapshot=old.replace('01_','01\\_');
  const disk='# Lambda 与 Stream\r\n\r\n导师的新教学内容。\r\n';
  assert.equal(mergeCurrent(old,snapshot,disk),disk);
});
test('saved answers are read as editable values, including nested fences and trailing newlines',()=>{
  const values=['Runnable task = () -> run();\n```java\nstart();\n```\n','**学生作答 · 伪标记**\n\n~~~text\n原文\n~~~'];
  const qs=parseQuestions(source).current;
  const saved=appendAnswers(source,Object.fromEntries(qs.map((q,i)=>[q.id,values[i]])));
  assert.deepEqual(parseQuestions(saved).current.map(q=>q.answer.value),values);
});
test('editing a saved answer replaces its latest block and preserves other questions and tutor feedback',async t=>{
  const {w,file}=await fixture(t);const qs=parseQuestions(source).current;
  const first=await w.saveCurrent(file,{content:source,baseContent:source,answers:qs.map(q=>({...q,value:'原答案'+q.number}))});
  const q=first.questions.current[0];
  const second=await w.saveCurrent(file,{content:first.content,baseContent:first.content,answers:[{...q,value:'修改后的答案'}]});
  assert.equal(second.questions.current[0].answer.value,'修改后的答案');
  assert.equal(second.questions.current[1].answer.value,'原答案4');
  assert.equal((second.content.match(/\*\*学生作答 ·/g)||[]).length,2);
  assert.ok(!second.content.includes('原答案3'));
  assert.ok(second.content.endsWith('## 最终复评结果\n导师填写\n'));
  assert.ok((await w.readBackup(file,(await w.backups(file))[0].id)).includes('原答案3'));
});
test('saving the displayed value again leaves document bytes and backups unchanged',async t=>{
  const {w,file}=await fixture(t);const q=parseQuestions(source).current[0];
  const first=await w.saveCurrent(file,{content:source,baseContent:source,answers:[{...q,value:'已保存答案'}]});
  const second=await w.saveCurrent(file,{content:first.content,baseContent:first.content,answers:[{...first.questions.current[0],value:'已保存答案'}]});
  assert.equal(second.content,first.content);assert.equal((await w.backups(file)).length,1);
});
test('clearing and saving an answer stays empty on reload without exposing earlier records',async t=>{
  const {root,w,file}=await fixture(t),q=parseQuestions(source).current[0];
  let content=appendAnswers(source,{[q.id]:'较早的历史答案'});
  content=appendAnswers(content,{[parseQuestions(content).current[0].id]:'最近的答案'});
  await fs.writeFile(path.join(root,file),content);
  const result=await w.saveCurrent(file,{content,baseContent:content,answers:[{...parseQuestions(content).current[0],value:''}]});
  assert.equal((await w.read(file)).questions.current[0].answer.value,'');
  assert.ok(result.content.includes('较早的历史答案'));assert.ok(!result.content.includes('最近的答案'));
});
test('legacy plain text and fenced code display as answer values while placeholders remain empty',()=>{
  for(const [body,expected] of [['我的解释。','我的解释。'],['```java\nrun();\n```','run();'],['```java\n// 在这里写出完整代码\n```',''],['```python\n```','']]){
    const text='## 第二轮\n### 问题 3\n题干\n\n**你的代码：**\n\n'+body+'\n\n---\n\n<!-- 后续题 -->\n';
    assert.equal(parseQuestions(text).current[0].answer.value,expected);
  }
});
test('answer markers inside code or comments never become saved answers',()=>{
  const text='## 第二轮\n### 问题 3\n题干\n\n**我的回答**\n\n<!--\n**学生作答 · 隐藏**\n\n```text\n隐藏答案\n```\n-->\n';
  assert.equal(parseQuestions(text).current[0].answer.value,'');
});
test('updating current answers preserves CRLF and earlier round answers',()=>{
  const old='## 第一轮\r\n### 问题 1\r\n原题\r\n**我的回答**\r\n原答案\r\n\r\n';
  const text=old+source.replace(/\n/g,'\r\n');
  const {composeAnswers}=require('../lib/save-current.cjs');
  let updated=composeAnswers(text,[{...parseQuestions(text).current[0],value:'第一行\n第二行'}]);
  updated=composeAnswers(updated,[{...parseQuestions(updated).current[0],value:'已修改\n第二行'}]);
  assert.ok(updated.startsWith(old));assert.ok(!/(?<!\r)\n/.test(updated));
  assert.equal(parseQuestions(updated).current[0].answer.value,'已修改\n第二行');
});
