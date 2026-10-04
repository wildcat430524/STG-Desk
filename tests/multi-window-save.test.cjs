const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {Workspace}=require('../lib/workspace.cjs');
test('two independent window workspaces cannot both overwrite the same file version',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-window-write-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,'01_学生回答.md'),'# 原记录\n');
 const main=new Workspace(),child=new Workspace();await main.open(root);await child.open(root);
 const doc=await main.read('01_学生回答.md');
 const results=await Promise.allSettled([main.save(doc.path,'# 主窗口\n',doc.version),child.save(doc.path,'# 独立窗口\n',doc.version)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const failure=results.find(r=>r.status==='rejected');assert.match(failure.reason.message,/其他程序修改/);
 const saved=await child.read(doc.path);assert.equal(saved.content,results.find(r=>r.status==='fulfilled').value.content);
 const backups=await child.backups(doc.path);assert.equal(backups.length,1);assert.equal(await child.readBackup(doc.path,backups[0].id),doc.content);
});
