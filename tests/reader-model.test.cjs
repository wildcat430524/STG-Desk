const test=require('node:test');
const assert=require('node:assert/strict');
const MarkdownIt=require('markdown-it');
const taskLists=require('markdown-it-task-lists');
const md=new MarkdownIt().use(taskLists,{enabled:false});
test('task source maps preserve nested, quoted, ordered and CRLF markers without touching examples',async()=>{
  const {mappedTasks}=await import('../src/reader-model.mjs');
  const content='# 清单\r\n\r\n- [ ] 父项\r\n  - [X] 子项\r\n\r\n> - [ ] 引用\r\n\r\n1. [x] 有序项\r\n\r\n```md\r\n- [ ] 示例\r\n```\r\n\r\n    - [ ] 缩进代码\r\n';
  const tasks=mappedTasks(md.parse(content,{}),content);
  assert.equal(tasks.length,4);
  assert.deepEqual(tasks.map(t=>t.checked),[false,true,false,true]);
  assert.deepEqual(tasks.map(t=>t.line),[3,4,6,8]);
  for(const t of tasks){assert.equal(content[t.offset-1],'[');assert.equal(content[t.offset+1],']');}
  const updated=content.slice(0,tasks[2].offset)+'x'+content.slice(tasks[2].offset+1);
  assert.equal(updated,content.replace('> - [ ] 引用','> - [x] 引用'));
});
test('scroll progress is bounded and handles short documents and overscroll',async()=>{
  const {scrollPercent}=await import('../src/reader-model.mjs');
  assert.equal(scrollPercent(0,300,600),100);
  assert.equal(scrollPercent(200,1000,600),50);
  assert.equal(scrollPercent(-30,1000,600),0);
  assert.equal(scrollPercent(800,1000,600),100);
});
test('loose lists with the marker on the next line remain editable and aligned',async()=>{
  const {mappedTasks}=await import('../src/reader-model.mjs');
  const content='-\n  [ ] 首项\n- [x] 次项\n\n> -\n>   [X] 引用项\n';
  const tasks=mappedTasks(md.parse(content,{}),content);
  assert.equal(tasks.length,3);
  assert.deepEqual(tasks.map(t=>t.checked),[false,true,true]);
  for(const task of tasks)assert.match(content.slice(task.offset-1,task.offset+2),/^\[[ xX]\]$/);
});
