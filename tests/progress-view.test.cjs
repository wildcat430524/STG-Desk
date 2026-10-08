const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../src/progress-view.js'),'utf8')).toString('base64'));
test('progress only draws a meter for explicit recorded mastery counts',async()=>{
  const {renderProgressSummary:render}=await modulePromise;
  for(const status of ['尚未记录','第一轮 · 等待学生作答','第二轮 · 已提交作答','Python · 1 / 0 课已掌握','Python · 5 / 4 课已掌握'])assert.doesNotMatch(render({status}),/role="progressbar"/);
  const html=render({status:'Python · 1 / 3 课已掌握（1 课待记录）'});
  assert.match(html,/aria-valuenow="1"/);assert.match(html,/aria-valuemax="3"/);assert.match(html,/33.3%/);assert.match(html,/1 课待记录/);
});
test('progress preserves status text and escapes document labels',async()=>{
  const {renderProgressSummary:render}=await modulePromise;
  const status='第一轮 · 等待学生作答';
  const html=render({label:'<img src=x onerror=alert(1)>',status,chapter:true});
  assert.match(html,/id="chapter-progress"/);assert.match(html,/第一轮 · 等待学生作答/);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
test('recorded counts support long subject names and punctuation',async()=>{
  const {renderProgressSummary:render}=await modulePromise;
  const scope='计算机科学 · '.repeat(8)+'专题！';
  const html=render({status:`${scope} · 2 / 4 课已掌握`});
  assert.match(html,/aria-valuenow="2"/);assert.match(html,/50%/);
});
