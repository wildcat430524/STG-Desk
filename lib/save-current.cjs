const {parseQuestions}=require('./stg.cjs');
const markdown=new (require('markdown-it'))({html:true});

// Carry independent external edits forward. When both sides changed the same
// passage, Save uses the visible edit; Workspace keeps the disk version in history.
function changedRange(base,value){
  let start=0,end=base.length,valueEnd=value.length;
  while(start<end&&start<valueEnd&&base[start]===value[start])start++;
  while(end>start&&valueEnd>start&&base[end-1]===value[valueEnd-1]){end--;valueEnd--;}
  return {start,end,value:value.slice(start,valueEnd)};
}
function mergeCurrent(base,local,disk){
  if(local===base)return disk;
  // Old editor snapshots can differ only by serializer-added escapes. They
  // must not resurrect a stale lesson over a newer version from the tutor.
  if(disk!==base&&markdown.render(local)===markdown.render(base))return disk;
  if(disk===base||disk===local)return local;
  const a=changedRange(base,local),b=changedRange(base,disk);
  if(a.end<=b.start||b.end<=a.start){
    let result=base;
    for(const edit of [b,a].sort((x,y)=>y.start-x.start||y.end-x.end))result=result.slice(0,edit.start)+edit.value+result.slice(edit.end);
    return result;
  }
  return local;
}
function composeAnswers(content,entries=[]){
  if(!entries.length)return content;
  const current=parseQuestions(content).current;
  const updates=[];
  for(const entry of entries){
    const matches=current.filter(q=>q.round===entry.round&&q.number===entry.number&&q.title===entry.title&&q.prompt===entry.prompt);
    if(matches.length!==1)throw Error('题目已更新，输入仍保留。请查看当前题目后再保存。');
    const q=matches[0];
    if(typeof entry.value!=='string')throw Error('回答内容无效。');
    if(entry.value===q.answer.value)continue;
    const nl=content.includes('\r\n')?'\r\n':'\n';
    const fence='`'.repeat(Math.max(3,...[...entry.value.matchAll(/`+/g)].map(m=>m[0].length+1)));
    const block=`**学生作答 · ${new Date().toLocaleString('zh-CN',{hour12:false})}**\n\n${fence}text\n${entry.value}\n${fence}\n`.replace(/\r?\n/g,nl);
    if(q.answer.kind==='saved')updates.push({start:q.answer.start,end:q.answer.end,value:block});
    else{
      const section=content.slice(q.start,q.end),trailing=section.match(/(?:\r?\n)[ \t]*---[ \t]*(?:\r?\n|\s)*$/);
      const at=trailing?q.end-trailing[0].length:q.end;
      updates.push({start:at,end:at,value:nl+nl+block+nl});
    }
  }
  for(const update of updates.sort((a,b)=>b.start-a.start))content=content.slice(0,update.start)+update.value+content.slice(update.end);
  return content;
}
module.exports={mergeCurrent,composeAnswers};
