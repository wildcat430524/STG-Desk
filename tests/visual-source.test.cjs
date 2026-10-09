const {test}=require('node:test');
const assert=require('node:assert/strict');
const MarkdownIt=require('markdown-it');
const load=()=>import('../src/visual-source.mjs');
const parser=new MarkdownIt({html:true});
function model(parts,withoutOrigins){
  const ledger=new Map();
  const nodes=parts.blocks.map((part,i)=>{const node={type:'paragraph',attrs:{sourceKey:String(i)},content:[{type:'text',text:part.source}]};ledger.set(String(i),{...part,json:JSON.stringify(withoutOrigins(node))});return node;});
  return {ledger,nodes};
}
test('untouched CRLF, BOM, metadata and reference gaps reconstruct byte-for-byte',async()=>{
  const {splitSource,assembleSource,withoutOrigins}=await load();
  const source='\uFEFF---\r\ncourse: Java\r\n---\r\n\r\n# 标题\r\n\r\n<!-- s2g:start -->\r\n\r\n正文 [资料][ref]。\r\n\r\n[ref]: ./资料.md "标题"\r\n\r\n<!-- s2g:end -->\r\n';
  const parts=splitSource(source,parser),{ledger,nodes}=model(parts,withoutOrigins);
  assert.equal(assembleSource(nodes,ledger,parts.tail,'\r\n',()=>{throw Error('untouched block serialized');}),source);
  assert.ok(parts.blocks.some(b=>b.special&&b.source.includes('[ref]:')));
});
test('editing one title preserves all other source bytes and original separators',async()=>{
  const {splitSource,assembleSource,withoutOrigins}=await load();
  const source='# 标题\r\n\r\n<!-- metadata -->\r\n\r\n公式 $x^2$ 与 **加粗**。\r\n\r\n```java\r\nSystem.out.println(21);\r\n```\r\n';
  const parts=splitSource(source,parser),{ledger,nodes}=model(parts,withoutOrigins);
  nodes[0]={...nodes[0],content:[{type:'text',text:'# 标题修改'}]};
  assert.equal(assembleSource(nodes,ledger,parts.tail,'\r\n',n=>n.content[0].text),source.replace('# 标题','# 标题修改'));
});
test('Enter splitting a block never duplicates an inherited original source key',async()=>{
  const {splitSource,assembleSource,withoutOrigins}=await load();
  const parts=splitSource('原段落\n\n后段落\n',parser),{ledger,nodes}=model(parts,withoutOrigins);
  nodes.splice(0,1,{...nodes[0],content:[{type:'text',text:'原'}]},{...nodes[0],content:[{type:'text',text:'段落'}]});
  assert.equal(assembleSource(nodes,ledger,parts.tail,'\n',n=>n.content[0].text),'原\n\n段落\n\n后段落\n');
});
test('deleting every block saves an empty document instead of restoring trailing text',async()=>{
  const {splitSource,assembleSource,withoutOrigins}=await load();
  const parts=splitSource('# 标题\n\n<!-- marker -->\n',parser),{ledger}=model(parts,withoutOrigins);
  assert.equal(assembleSource([{type:'paragraph'}],ledger,parts.tail,'\n',()=>''),'');
});
test('editing a list preserves the blank separator before the following paragraph',async()=>{
  const {splitSource,assembleSource,withoutOrigins}=await load();
  const source='- [ ] 外层\r\n  - [ ] 内层\r\n- [x] 完成\r\n\r\n保留原文 **加粗**。\r\n';
  const parts=splitSource(source,parser),{ledger,nodes}=model(parts,withoutOrigins);
  nodes[0]={...nodes[0],content:[{type:'text',text:'- [x] 外层\n  - [ ] 内层\n- [x] 完成'}]};
  assert.equal(assembleSource(nodes,ledger,parts.tail,'\r\n',n=>n.content[0].text),source.replace('- [ ] 外层','- [x] 外层'));
});
test('a display formula block keeps its own lines and CRLF when other blocks change',async()=>{
  const {splitSource,assembleSource,withoutOrigins}=await load();
  const source='# 公式\r\n\r\n$$\r\nE=mc^2\r\n$$\r\n\r\n公式 $x^2$ 与 **加粗**。\r\n';
  const parts=splitSource(source,parser),{ledger,nodes}=model(parts,withoutOrigins);
  // A mathBlock node serializes back through renderMarkdown; model it as the
  // preserved atom the same way the editor ledger would.
  const mathIndex=parts.blocks.findIndex(b=>b.source.trim().startsWith('$$'));
  assert.ok(mathIndex>=0,'expected a display math block');
  const blockSource=parts.blocks[mathIndex].source;
  nodes[mathIndex]={type:'mathBlock',attrs:{sourceKey:String(mathIndex)},content:null};
  ledger.set(String(mathIndex),{...parts.blocks[mathIndex],json:null});
  nodes[0]={...nodes[0],content:[{type:'text',text:'# 公式修改'}]};
  const out=assembleSource(nodes,ledger,parts.tail,'\r\n',n=>n.type==='mathBlock'?blockSource:n.content[0].text);
  assert.equal(out,source.replace('# 公式','# 公式修改'));
  assert.ok(out.includes('$$\r\nE=mc^2\r\n$$'),'the display formula keeps its original line shape');
});
test('an untouched display formula and its neighbours survive byte-for-byte',async()=>{
  const {splitSource,assembleSource,withoutOrigins}=await load();
  const source='前言。\n\n$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\n后记。\n';
  const parts=splitSource(source,parser),{ledger,nodes}=model(parts,withoutOrigins);
  assert.equal(assembleSource(nodes,ledger,parts.tail,'\n',()=>{throw Error('untouched block serialized');}),source);
});
test('a mixed paragraph using $$ inline is never treated as a block formula',async()=>{
  const {splitSource,assembleSource,withoutOrigins}=await load();
  const {isDisplayMathBlock}=await import('../src/editor-formula.mjs');
  const source='前言 $$x$$ 后文。\n\n$$a$$ 与 $$b$$\n';
  const parts=splitSource(source,parser),{ledger,nodes}=model(parts,withoutOrigins);
  assert.equal(parts.blocks.length,2);
  for(const block of parts.blocks)assert.equal(isDisplayMathBlock(block.source),false,`mixed content misread as a block formula: ${JSON.stringify(block.source)}`);
  assert.equal(assembleSource(nodes,ledger,parts.tail,'\n',()=>{throw Error('untouched block serialized');}),source);
});
