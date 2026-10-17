const {app,ipcMain,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
process.argv.push('--smoke-test');
const smokePath=require.resolve('../electron/smoke.cjs');
require.cache[smokePath]={id:smokePath,filename:smokePath,loaded:true,exports:async win=>{
  const out=path.join(__dirname,'artifacts/model-picker');await fs.mkdir(out,{recursive:true});
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'stg-model-picker-')));
  await fs.cp(path.join(__dirname,'../demo/EditorShowcase'),root,{recursive:true});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let page=win;
  const js=code=>page.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<160;i++){if(await js(`document.documentElement.dataset.busy!=='true'&&(${code})`))return;await pause(70);}throw Error('UI wait failed: '+code);};
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key=async(name,modifiers=[])=>{page.webContents.sendInputEvent({type:'keyDown',keyCode:name,modifiers});if(name==='Enter')page.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});page.webContents.sendInputEvent({type:'keyUp',keyCode:name,modifiers});await pause(70);};
  const shot=async name=>{await js("document.querySelector('#toast')?.classList.add('hidden')");await pause(200);await fs.writeFile(path.join(out,name),(await page.webContents.capturePage()).toPNG());};
  const bounds=()=>js("(()=>{const r=document.querySelector('#dsh-model-picker').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth}})()");
  const within=async()=>{const r=await bounds();assert.ok(r.left>=10&&r.top>=10&&r.right<=r.width-10&&r.bottom<=r.height-10,JSON.stringify(r));assert.ok(r.scroll<=r.width);};
  const models=[
    {id:'deepseek/flash',label:'DeepSeek-V4.1-Flash',provider:'DeepSeek Account'},
    {id:'deepseek/pro',label:'DeepSeek-V4-Pro',provider:'DeepSeek Account'},
    {id:'fallback/auto',label:'Auto',provider:'FallbacksChain'},
    ...['GLM-5.2','GLM-5.1','GLM-5','glm-5.3-flash','openpangu-2.0-flash','openpangu-2.0-pro','deepseek-v4-flash','deepseek-v4-pro','deepseek-v4.1-flash'].map(label=>({id:'codearts/'+label,label,provider:'CodeArts Agent'})),
    ...['Hy4 preview · x0.29','Hy3 · x0.00→免费','Hy3 · x0.05','DeepSeek-V4.1-Flash · x0.11','DeepSeek-V4-Pro · x0.51'].map((label,i)=>({id:'buddy/'+i,label,provider:'CodeBuddy (腾讯)'}))
  ];
  let feed={visible:true,mode:'docked',connected:true,root,sessionId:'picker-ui',title:'模型选择 · 界面验收',status:'演示模型列表 · 界面验收',draft:'尚未发送的提问会保留。',models,model:'buddy/3',messages:[{id:'demo',role:'assistant',text:'这是模型选择器的界面验收演示。\n\n模型按服务商分组，可搜索名称，也可以通过方向键选择。'}]};
  const emit=async extra=>{feed={...feed,...extra};page.webContents.send('dsh-state',feed);await pause(100);};
  const calls=[],errors=[],evidence=[];let reject=false;
  ipcMain.removeHandler('dsh-model');ipcMain.handle('dsh-model',async(_,model)=>{calls.push(model);await pause(80);if(reject)throw Error('验收用切换失败');feed={...feed,model};return true;});
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  try{
    win.setMinimumSize(640,600);win.setSize(1460,960);win.show();win.focus();
    await wait("!!document.querySelector('#welcome-import')");
    await js(`document.querySelector('#recent').innerHTML='<button id="recent-open">打开验收工作区</button>';document.querySelector('#recent-open').dataset.root=${JSON.stringify(root)};document.querySelector('#recent-open').click()`);
    await wait("!!document.querySelector('.file.selected')&&!!document.querySelector('#editor h1')");await emit({});
    assert.equal(await js("getComputedStyle(document.querySelector('#dsh-model')).display"),'none');
    await click('#dsh-model-trigger');await wait("document.activeElement.id==='dsh-model-search'");await within();
    assert.equal(await js("document.querySelectorAll('#dsh-model-list [role=group]').length"),4);
    assert.equal(await js("document.querySelector('[role=option][aria-selected=true]').dataset.modelId"),'buddy/3');
    assert.equal(await js("document.querySelector('[role=option][aria-selected=true] .model-option-price').textContent"),'x0.11');
    await shot('model-picker-light.png');
    await page.webContents.insertText('CodeBuddy');await pause(70);
    assert.equal(await js("document.querySelectorAll('#dsh-model-list [role=option]').length"),5);
    await shot('model-picker-search.png');
    await key('Home',['control']);await key('A',['control']);await page.webContents.insertText('GLM-5.3');await pause(70);
    assert.equal(await js("document.querySelectorAll('#dsh-model-list [role=option]').length"),1);
    await key('Enter');await wait("document.querySelector('#dsh-model-picker').hidden");
    assert.equal(calls.at(-1),'codearts/glm-5.3-flash');
    assert.equal(await js('document.activeElement.id'),'dsh-model-trigger');
    assert.ok(await js("document.querySelector('#dsh-model-trigger').textContent.includes('glm-5.3-flash')"));
    assert.equal(await js("document.querySelector('#dsh-input').value"),'尚未发送的提问会保留。');
    evidence.push('Provider groups, current checkmark, separate price badges, case-insensitive model/provider search and native IPC selection');

    await click('#dsh-model-trigger');await key('Home');await key('Down');await key('Enter');await wait("document.querySelector('#dsh-model-picker').hidden");assert.equal(calls.at(-1),'deepseek/pro');
    await click('#dsh-model-trigger');await page.webContents.insertText('no-such-model');await pause(60);
    assert.equal(await js("document.querySelector('.model-picker-empty').hidden"),false);
    const before=calls.length;await key('Enter');assert.equal(calls.length,before);
    await key('Escape');assert.equal(await js('document.activeElement.id'),'dsh-model-trigger');
    await click('#dsh-model-trigger');await js("document.querySelector('#dsh-model-search').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('#dsh-model-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    assert.equal(calls.length,before);assert.equal(await js("document.querySelector('#dsh-model-picker').hidden"),false);
    await js("document.querySelector('#dsh-model-search').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");await pause(110);await key('Escape');
    await click('#dsh-model-trigger');await key('Tab');assert.equal(await js("document.querySelector('#dsh-model-picker').hidden"),true);
    evidence.push('Arrow/Home/End and Enter navigation, Escape focus restoration, empty result, IME protection and Tab dismissal');

    reject=true;await click('#dsh-model-trigger');await key('Home');await key('Enter');await wait("document.querySelector('.model-picker-feedback').textContent.includes('切换失败')");
    assert.equal(await js("document.querySelector('#dsh-model').value"),'deepseek/pro');assert.equal(await js('document.activeElement.id'),'dsh-model-search');reject=false;
    await emit({busy:true});assert.equal(await js("document.querySelector('#dsh-model-picker').hidden"),true);assert.equal(await js("document.querySelector('#dsh-model-trigger').disabled"),true);
    await emit({busy:false});await click('#dsh-model-trigger');await emit({connected:false});assert.equal(await js("document.querySelector('#dsh-model-picker').hidden"),true);
    await emit({connected:true});await click('#dsh-model-trigger');await emit({sessionId:'picker-second'});assert.equal(await js("document.querySelector('#dsh-model-picker').hidden"),true);
    evidence.push('Failed selection rolls back; busy/disconnected state disables and closes; changing session dismisses stale selection');

    await click('#app-theme-toggle');await click('#dsh-model-trigger');await within();await shot('model-picker-dark.png');await key('Escape');await click('#app-theme-toggle');
    win.setSize(1050,760);win.webContents.setZoomFactor(1.25);await pause(170);await click('#dsh-model-trigger');await within();await shot('model-picker-125-percent.png');await key('Escape');win.webContents.setZoomFactor(1);
    win.setSize(1460,960);await pause(120);await click('#dsh-detach');await pause(550);
    const floating=BrowserWindow.getAllWindows().find(w=>w!==win&&w.webContents.getURL().includes('dsh'));assert.ok(floating);page=floating;floating.show();floating.focus();
    floating.setMinimumSize(320,480);floating.setSize(390,720);await emit({mode:'floating'});await click('#dsh-model-trigger');await within();await shot('model-picker-floating.png');
    await key('Escape');floating.setSize(330,510);floating.webContents.setZoomFactor(1.25);await pause(130);await click('#dsh-model-trigger');await within();await shot('model-picker-floating-small.png');
    const clickPoint=await js("(()=>{const r=document.querySelector('.dsh-model-icon').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    clickPoint.x=Math.round(clickPoint.x*floating.webContents.getZoomFactor());clickPoint.y=Math.round(clickPoint.y*floating.webContents.getZoomFactor());
    floating.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...clickPoint});floating.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...clickPoint});await pause(80);
    assert.equal(await js("document.querySelector('#dsh-model-picker').hidden"),true);
    evidence.push('Light/dark screenshots, 125% zoom, 390px floating and 330px/125% floating stay within window; native outside click dismisses');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,evidence,calls,errors},null,2));console.log(JSON.stringify({passed:true,out,evidence}));app.exit(0);
  }catch(error){await shot('failure.png').catch(()=>{});await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:false,error:error.stack,evidence,calls,errors},null,2));console.error(error);app.exit(1);}
}};
require('../electron/main.cjs');
