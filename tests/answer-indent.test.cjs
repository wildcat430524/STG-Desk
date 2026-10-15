const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../src/answer-indent.mjs');
const apply=(value,edit)=>value.slice(0,edit.from)+edit.text+value.slice(edit.to);
test('Tab inserts four spaces at the caret or replaces a single-line selection',async()=>{
  const {answerIndent}=await load();
  const edit=answerIndent('abc',1,1);assert.equal(apply('abc',edit),'a    bc');assert.equal(edit.start,5);assert.equal(edit.end,5);
  assert.equal(apply('abc',answerIndent('abc',0,3)),'    ');
});
test('multiline indentation excludes an unselected following line and Shift Tab reverses it',async()=>{
  const {answerIndent}=await load();const value='one\ntwo\nthree';
  const edit=answerIndent(value,0,8);const indented=apply(value,edit);
  assert.equal(indented,'    one\n    two\nthree');
  const undo=answerIndent(indented,edit.start,edit.end,true);assert.equal(apply(indented,undo),value);assert.equal(undo.start,0);assert.equal(undo.end,8);
});
test('Shift Tab removes a leading tab or up to four spaces and keeps caret within the line',async()=>{
  const {answerIndent}=await load();
  for(const value of ['\tcode','  code','    code']){const edit=answerIndent(value,value.length,value.length,true);assert.equal(apply(value,edit),'code');assert.equal(edit.start,4);}
  const edit=answerIndent('  code',1,1,true);assert.equal(edit.start,0);assert.equal(apply('  code',edit),'code');
  assert.equal(apply('code',answerIndent('code',2,2,true)),'code');
});
