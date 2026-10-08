// Use parser source maps: examples in code fences must never become tasks.
export function mappedTasks(tokens, content) {
  const lines=content.split('\n'), offsets=[];
  let offset=0;
  for(const line of lines){offsets.push(offset);offset+=line.length+1;}
  const tasks=[];
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(t.type!=='list_item_open'||!t.attrGet('class')?.split(' ').includes('task-list-item'))continue;
    // A loose list may put its checkbox on the following paragraph line.
    const candidates=[t.map?.[0],tokens[i+2]?.type==='inline'?tokens[i+2].map?.[0]:undefined];
    let task=null;
    for(const line of candidates){
      const match=lines[line]?.match(/^(\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?\[)([ xX])(\](?:\s|$))/);
      if(match){task={line:line+1,offset:offsets[line]+match[1].length,checked:/x/i.test(match[2])};break;}
    }
    // Keep even unmapped slots in DOM order so later offsets never shift.
    tasks.push(task);
  }
  return tasks;
}

export function scrollPercent(scrollTop, scrollHeight, clientHeight) {
  const distance=scrollHeight-clientHeight;
  return distance<=1?100:Math.round(Math.max(0,Math.min(1,scrollTop/distance))*100);
}
