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
