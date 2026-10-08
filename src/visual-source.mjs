// DOM-free source ledger. Native editing never rewrites untouched blocks.
export function withoutOrigins(node){
  const copy={...node};
  if(copy.attrs){copy.attrs={...copy.attrs};delete copy.attrs.sourceKey;if(!Object.keys(copy.attrs).length)delete copy.attrs;}
  if(copy.content)copy.content=copy.content.map(withoutOrigins);
  return copy;
}
export function splitSource(content,parser){
  const lines=[0];for(let i=0;i<content.length;i++)if(content[i]==='\n')lines.push(i+1);
  const blocks=[];let cursor=0;
  const front=content.match(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?=\r?\n|$)/);
  const add=(from,to,kind,special=false)=>{
    if(from<cursor||to<=from)return;
    const gap=content.slice(cursor,from);
    if(gap.trim())blocks.push({from:cursor,to:from,before:'',source:gap,kind:'metadata',special:true});
    blocks.push({from,to,before:gap.trim()?'':gap,source:content.slice(from,to),kind,special});cursor=to;
  };
  if(front)add(content.startsWith('\uFEFF')?1:0,front[0].length,'frontmatter',true);
  for(const token of parser.parse(content,{})){
    if(token.level!==0||token.nesting===-1||!token.map)continue;
    let from=lines[token.map[0]]??content.length;const after=lines[token.map[1]]??content.length;
    if(from===0&&content.startsWith('\uFEFF')&&!front)from=1;
    let to=after>from?after-(content[after-1]==='\n'?(content[after-2]==='\r'?2:1):0):after;
    // List token maps may absorb the following blank line. Keep separators
    // outside editable blocks, so serializing a list cannot join the next paragraph.
    const blanks=content.slice(from,to).match(/(?:\r?\n[\t ]*)+$/);if(blanks)to-=blanks[0].length;
    add(from,to,token.type);
  }
  let tail=content.slice(cursor);
  if(tail.trim()){blocks.push({from:cursor,to:content.length,before:'',source:tail,kind:'metadata',special:true});tail='';}
  return {blocks,tail};
}
export function assembleSource(nodes,ledger,tail,eol,serialize,onBlock){
  const bom=ledger.values().next().value?.before.startsWith('\uFEFF')?'\uFEFF':'';
  const seen=new Set();let result='';
  for(const [index,node] of nodes.entries()){
    const key=node.attrs?.sourceKey,entry=!seen.has(key)?ledger.get(key):null;seen.add(key);
    const same=entry&&entry.json===JSON.stringify(withoutOrigins(node));
    const source=same?entry.source:node.type==='preservedBlock'?node.attrs.source:serialize(withoutOrigins(node)).replace(/\r?\n/g,eol);
    if(!source&&!entry)continue;
    const before=entry?entry.before.replace(/^\uFEFF/,''):(result?eol+eol:'');
    const separator=result&&before===''&&!/[\r\n]$/.test(result)&&!/^\s*[\r\n]/.test(source)?eol+eol:before;
    onBlock?.({index,from:bom.length+result.length+separator.length,to:bom.length+result.length+separator.length+source.length});
    result+=separator+source;
  }
  return result.trim()?bom+result+tail:'';
}
