const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Workspace}=require('../lib/workspace.cjs');
const {DraftStore}=require('../lib/drafts.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-recovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'a.md'),'# 初始\n需要搜索的内容\n');await fs.writeFile(path.join(root,'b.md'),'其他文档');const w=new Workspace();await w.open(root);return {root,w};}
test('drafts survive a new store instance without modifying formal documents and isolate workspaces',async t=>{
 const {root,w}=await fixture(t),store=new DraftStore(path.join(root,'drafts')),doc=await w.read('a.md');
 await store.put(root,'a.md',{content:'未保存编辑',baseContent:doc.content,baseVersion:doc.version,answers:{stable:'未提交回答'}});
 const reopened=new DraftStore(path.join(root,'drafts'));assert.equal((await reopened.get(root,'a.md')).answers.stable,'未提交回答');assert.equal((await w.read('a.md')).content,doc.content);assert.equal(await reopened.get(root+'other','a.md'),null);
 assert.equal((await reopened.list(root))[0].path,'a.md');await reopened.remove(root,'a.md');assert.equal(await reopened.get(root,'a.md'),null);
});
test('queued draft writes preserve latest content and corrupted records never silently vanish',async t=>{
 const {root}=await fixture(t),store=new DraftStore(path.join(root,'drafts'));await Promise.all(['first','last'].map(content=>store.put(root,'a.md',{content,baseVersion:'v'})));assert.equal((await store.get(root,'a.md')).content,'last');await fs.writeFile(store.file(root,'a.md'),'{bad');await assert.rejects(store.get(root,'a.md'),/无法读取/);
});
test('backup preview, restore, conflict guard and retention work per document',async t=>{
 const {root,w}=await fixture(t);w.retention=5;const initial=await w.read('a.md');let current=initial;
 for(let i=0;i<7;i++)current=await w.save('a.md','版本'+i,current.version);
 const backups=await w.backups('a.md');assert.equal(backups.length,5);assert.equal(await w.readBackup('a.md',backups[0].id),'版本5');assert.equal((await w.backups('b.md')).length,0);
 await assert.rejects(w.readBackup('b.md',backups[0].id),/标识无效/);await assert.rejects(w.readBackup('a.md','../a.md'),/标识无效/);
 await fs.writeFile(path.join(root,'a.md'),'外部修改');await assert.rejects(w.restoreBackup('a.md',backups[0].id,current.version),/其他程序修改/);assert.equal((await w.read('a.md')).content,'外部修改');
 const disk=await w.read('a.md');const restored=await w.restoreBackup('a.md',backups[0].id,disk.version);assert.equal(restored.content,'版本5');assert.ok((await Promise.all((await w.backups('a.md')).map(b=>w.readBackup('a.md',b.id)))).includes('外部修改'));
});
test('full-text search locates lines, excludes app backups and caps results',async t=>{
 const {root,w}=await fixture(t);const result=await w.search('需要搜索');assert.deepEqual(result.results,[{path:'a.md',line:2,text:'需要搜索的内容'}]);const a=await w.read('a.md');await w.save('a.md','无匹配',a.version);assert.equal((await w.search('需要搜索')).results.length,0);
 await fs.writeFile(path.join(root,'b.md'),Array(250).fill('HELLO').join('\n'));const many=await w.search('hello');assert.equal(many.results.length,200);assert.equal(many.truncated,true);await assert.rejects(w.search('x'.repeat(201)),/过长/);
});
