const {parseQuestions,appendAnswers}=require('./stg.cjs');
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
  const values={};
  for(const entry of entries){
    const matches=current.filter(q=>q.round===entry.round&&q.number===entry.number&&q.title===entry.title&&q.prompt===entry.prompt);
    if(matches.length!==1)throw Error('题目已更新，输入仍保留。请查看当前题目后再保存。');
    values[matches[0].id]=entry.value;
  }
  return appendAnswers(content,values);
}
module.exports={mergeCurrent,composeAnswers};
