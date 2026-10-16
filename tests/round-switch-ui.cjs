const {app}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
process.argv.push('--smoke-test');
const smokePath=require.resolve('../electron/smoke.cjs');
require.cache[smokePath]={id:smokePath,filename:smokePath,loaded:true,exports:async window=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-round-switch-'));
  const output=path.join(__dirname,'artifacts/round-switch');
  await fs.mkdir(output,{recursive:true});
  const dir='我的学习/学科/Python/01-认识变量/';
  const index=dir+'01_教学引导.md',answer=dir+'01_学生回答.md';
  const first=dir+'第1轮_教学引导.md',second=dir+'第2轮_教学引导.md';
  const js=code=>window.webContents.executeJavaScript(code,true);
  const wait=async condition=>{for(let i=0;i<150;i++){if(await js(`document.documentElement.dataset.busy!=='true'&&(${condition})`))return;await new Promise(r=>setTimeout(r,80));}throw Error('UI wait failed: '+condition);};
  try{
    await fs.cp(path.join(__dirname,'../demo/StepsToGreat'),root,{recursive:true});
    await fs.writeFile(path.join(root,index),'# 本章教学总入口\n\n- [第一轮](第1轮_教学引导.md)\n- [第二轮](第2轮_教学引导.md)\n');
    await fs.writeFile(path.join(root,first),'# 第一轮教学\n\n旧轮完整讲解。\n');
    await fs.writeFile(path.join(root,second),'# 第二轮教学\n\n当前轮完整讲解。\n');
    await fs.writeFile(path.join(root,answer),'# 学生回答\n\n## 第一轮\n\n### 问题 1\n\n旧轮题目。\n\n**我的回答**\n\n旧轮原答。\n\n## 第二轮\n\n### 问题 2\n\n当前轮题目。\n\n**我的回答**\n');
    await wait("!!document.querySelector('#welcome-import')");
    await js(`document.querySelector('#recent').innerHTML='<button id="recent-open">打开测试文件夹</button>';document.querySelector('#recent-open').dataset.root=${JSON.stringify(root)};document.querySelector('#recent-open').click()`);
    await wait("document.querySelector('#round-select option')?.value!==undefined&&!document.querySelector('#round-switch').classList.contains('hidden')");
    assert.deepEqual(await js("[...document.querySelectorAll('#round-select option')].map(o=>o.textContent)"),['选择教学轮次','教学总入口','第1轮教学','第2轮教学']);
    assert.equal(await js("document.querySelectorAll('#tree [data-file]').length"),2);
    assert.deepEqual(await js("[...document.querySelectorAll('#tree button')].map(b=>b.textContent.trim())"),['教学引导','学生回答','当前章节进度','总体进度']);
    assert.equal(await js("!!document.querySelector('.document-heading .document-title-wrap #round-select')"),true);
    assert.equal(await js("!!document.querySelector('.document-access #round-switch')"),false);
    assert.equal(await js("(()=>{const title=document.querySelector('#document-title').getBoundingClientRect(),select=document.querySelector('#round-select').getBoundingClientRect();return select.left<=title.left&&select.right>=title.right&&select.top<=title.top&&select.bottom>=title.bottom})()"),true);
    await js(`document.querySelector('#round-select').value=${JSON.stringify(first)};document.querySelector('#round-select').dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait(`document.querySelector('#status-left').textContent===${JSON.stringify(first)}`);
    assert.ok(await js("document.querySelector('#editor').textContent.includes('旧轮完整讲解')"));
    assert.deepEqual(await js("[...document.querySelectorAll('#tree button')].map(b=>b.textContent.trim())"),['教学引导','学生回答','当前章节进度','总体进度']);
    assert.equal(await js("document.querySelector('[data-answer-tab=records]').getAttribute('aria-pressed')"),'true');
    assert.equal(await js("document.querySelector('#answer-document-name').textContent"),'01_学生回答.md');
    assert.ok(await js("[...document.querySelectorAll('#answer-records details')].some(d=>d.open&&d.textContent.includes('旧轮原答'))"));
    window.show();await new Promise(r=>setTimeout(r,250));await fs.writeFile(path.join(output,'old-round.png'),(await window.webContents.capturePage()).toPNG());
    await js(`document.querySelector('#round-select').value=${JSON.stringify(second)};document.querySelector('#round-select').dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait(`document.querySelector('#status-left').textContent===${JSON.stringify(second)}`);
    assert.ok(await js("document.querySelector('#editor').textContent.includes('当前轮完整讲解')"));
    assert.equal(await js("document.querySelector('[data-answer-tab=current]').getAttribute('aria-pressed')"),'true');
    await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true},null,2));
    app.exit(0);
  }catch(error){await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:false,error:error.stack},null,2));console.error(error);app.exit(1);}
  finally{await fs.rm(root,{recursive:true,force:true}).catch(()=>{});}
}};
require('../electron/main.cjs');
