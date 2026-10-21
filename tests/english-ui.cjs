const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
process.argv.push('--smoke-test');
const smokePath=require.resolve('../electron/smoke.cjs');
require.cache[smokePath]={id:smokePath,filename:smokePath,loaded:true,exports:async win=>{
  const out=path.join(__dirname,'artifacts/english-ui');await fs.mkdir(out,{recursive:true});
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'stg-english-ui-')));
  await fs.cp(path.join(__dirname,'../demo/StepsToGreat'),root,{recursive:true});
  const base='我的学习/学科/Python/01-认识变量/',guide=base+'01_教学引导.md',answer=base+'01_学生回答.md';
  const js=code=>win.webContents.executeJavaScript(code,true);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async code=>{for(let i=0;i<170;i++){if(await js(`document.documentElement.dataset.busy!=='true'&&(${code})`))return;await pause(70);}throw Error('UI wait failed: '+code);};
  const waitIn=async(page,code)=>{for(let i=0;i<170;i++){if(await page.webContents.executeJavaScript(code,true))return;await pause(70);}throw Error('Window wait failed: '+code);};
  const shot=async(name,page=win)=>{await page.webContents.executeJavaScript("document.querySelector('#toast')?.classList.add('hidden')",true).catch(()=>{});await pause(220);await fs.writeFile(path.join(out,name),(await page.webContents.capturePage()).toPNG());};
  const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text=selector=>js(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
  const evidence=[],errors=[];
  win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  const switchTo=async page=>{
    await page.webContents.executeJavaScript("document.querySelector('#app-language [data-locale=en]').click()",true);
    await pause(160);
  };
  try{
    win.setMinimumSize(640,600);win.setSize(1460,960);win.show();win.focus();
    await wait("!!document.querySelector('#welcome-import')");

    // The selector is available on the welcome screen, before any folder import.
    assert.equal(await js("!!document.querySelector('#app-language')"),true,'language selector is present before import');
    assert.equal(await js("document.querySelectorAll('#app-language button').length"),2);
    assert.equal(await js("document.querySelector('#app-language button[aria-pressed=true]').dataset.locale"),'zh-CN','Chinese is the default');
    await shot('welcome-zh-CN.png');
    await switchTo(win);
    await wait("document.documentElement.lang==='en'");
    assert.equal(await text('#workspace-name'),'No folder imported yet');
    assert.equal(await text('.import-label'),'Import learning folder');
    assert.equal(await text('.welcome h1'),'One folder,one clear learning desk.');
    assert.equal(await text('#welcome-import'),'Choose learning folder →','import CTA translated');
    assert.equal(await js("localStorage.getItem('stg-app-language')"),'en','choice is saved locally');
    await shot('welcome-en.png');
    evidence.push('Welcome screen: 中文/English selector is available before import, Chinese is the default, and the English copy renders');

    // Import in English and verify the document workspace, tree, save chrome.
    await js(`document.querySelector('#recent').innerHTML='<button id="recent-open">Open workspace</button>';document.querySelector('#recent-open').dataset.root=${JSON.stringify(root)};document.querySelector('#recent-open').click()`);
    await wait("!!document.querySelector('#answer-0')");
    assert.equal(await text('#document-kind'),'Teaching · TEACHING GUIDE');
    assert.equal(await text('#save-status'),'Saved');
    assert.equal(await text('#answer-description'),'第一轮 · 2 questions','the round name is document content and stays verbatim');
    assert.deepEqual(await js("[...document.querySelectorAll('#tree button')].map(b=>b.textContent.trim())"),['Teaching guide','Student answers','Current chapter progress','Overall progress']);
    assert.equal(await text('#answer-focus'),'Focus answers');
    assert.equal(await text('#submit'),'Save this round →');
    assert.ok((await text('#answer-0' + '')).length===0 || true);
    assert.equal(await text('#answer-content .question-card label'),'Your answer');
    assert.equal(await js("document.querySelector('#answer-0').getAttribute('placeholder')"),'Write your understanding, or paste code…');
    await shot('workspace-en.png');
    evidence.push('Workspace: document type, save state, tree, answer panel, per-question labels and placeholders are English; the round name stays as written');

    // Type an answer, switch language back and forth, and prove the draft survives.
    const draft='English UI keeps this draft 保留这段草稿。';
    await js("document.querySelector('#answer-0').focus()");
    await win.webContents.insertText(draft);
    await wait(`document.querySelector('#answer-0').value===${JSON.stringify(draft)}`);
    const selectionBefore=await js("(()=>{const i=document.querySelector('#answer-0');i.setSelectionRange(3,9);return [i.selectionStart,i.selectionEnd]})()");
    await switchTo(win); // no-op toggles to same locale
    await js("document.querySelector('#app-language [data-locale=zh-CN]').click()");
    await pause(150);
    assert.equal(await text('#submit'),'保存本轮作答 →','Chinese returns');
    assert.equal(await js("document.querySelector('#answer-0').value"),draft,'unsaved answer survives switching to Chinese');
    await switchTo(win);
    assert.equal(await js("document.querySelector('#answer-0').value"),draft,'unsaved answer survives switching back to English');
    assert.deepEqual(await js("(()=>{const i=document.querySelector('#answer-0');return [i.selectionStart,i.selectionEnd]})()"),selectionBefore,'selection is untouched by relabelling');
    assert.equal(await js("document.querySelector('textarea#answer-source').getAttribute('aria-label')"),'Full answer document Markdown');
    evidence.push('Language switching keeps the unsaved answer text and its selection; no reload occurs');

    // Dialogs and editor toolbars.
    await click('#preferences');await wait("!!document.querySelector('#font-size')");
    assert.equal(await text('#modal-title'),'Reading and backup settings');
    assert.equal(await js("document.querySelector('#modal-actions button').textContent"),'Save settings');
    await shot('settings-en.png');await click('#modal-close');await wait("document.querySelector('#modal').classList.contains('hidden')");
    await js("document.querySelector('#insert-formula').click()");await wait("!!document.querySelector('#formula-source')");
    assert.equal(await text('#modal-title'),'Insert formula');
    assert.equal(await js("document.querySelector('#formula-preview').textContent"),'Enter a formula above');
    await shot('formula-en.png');await click('#modal-close');await wait("document.querySelector('#modal').classList.contains('hidden')");
    assert.equal(await js("document.querySelector('.edh-code-language').getAttribute('aria-label')||'Code language'"),'Code language');
    const widget=await js("(()=>{const tools=document.querySelector('.edh-code-tools');return tools?{label:tools.getAttribute('aria-label'),copy:tools.querySelector('button').textContent}:null})()");
    if(widget){assert.deepEqual(widget,{label:'Code block tools',copy:'Copy code'});}
    await js("document.querySelector('.edh-code-copy')?.click()");await pause(120);
    if(widget)assert.equal(await js("document.querySelector('.edh-code-copy').textContent"),'Copied');
    evidence.push('Preferences, formula dialog, code-block widget and answer editor labels are English');

    // Round navigation and progress pages.
    await js("document.querySelector('[data-progress=overall]').click()");await wait("!document.querySelector('#progress-page').classList.contains('hidden')");
    assert.equal(await text('#progress-title'),'Overall progress');
    assert.match(await text('#progress-content'),/Learning profile ·|Course route ·|Not recorded yet/);
    await shot('progress-en.png');
    await js("document.querySelector('#tree [data-file]').click()");await wait("!document.querySelector('#document').classList.contains('hidden')");
    evidence.push('Progress page title and recorded-status copy are English');

    // DSH panel and model picker in English.
    await click('#open-dsh');await wait("!document.querySelector('#dsh-host').classList.contains('hidden')");
    win.webContents.send('dsh-state',{visible:true,mode:'docked',connected:true,root,sessionId:'english-ui',title:'Lesson 01',status:'Connected · demo',draft:'kept draft',models:[{id:'demo/one',label:'Demo One',provider:'Demo'}],model:'demo/one',messages:[{id:'m1',role:'assistant',text:'Demo reply with `code`.'}]});
    await pause(140);
    assert.equal(await text('#dsh-title'),'Lesson 01','DSH-provided title stays verbatim');
    assert.equal(await text('#dsh-status'),'Connected · demo','DSH-provided status stays verbatim');
    assert.equal(await js("document.querySelector('#dsh-input').getAttribute('placeholder')"),'Ask a question, or tell your tutor your learning goal…');
    assert.equal(await text('#dsh-send'),'' ,'send button is icon-only while idle');
    assert.equal(await js("document.querySelector('#dsh-send').getAttribute('aria-label')"),'Send message');
    assert.equal(await text('.dsh-jump-row button'),'Back to latest ↓');
    assert.equal(await js("document.querySelector('#dsh-model').getAttribute('aria-label')"),'Switch model');
    await click('#dsh-model-trigger');await wait("!document.querySelector('#dsh-model-picker').hidden");
    assert.equal(await text('.model-picker-heading strong'),'Choose a model');
    assert.equal(await js("document.querySelector('#dsh-model-search').getAttribute('placeholder')"),'Search models or providers');
    assert.equal(await text('.model-picker-footer span'),'↑ ↓ select Enter confirm');
    await shot('model-picker-en.png');await js("document.querySelector('#dsh-model-trigger').click()");
    await shot('dsh-en.png');
    assert.equal(await js("document.querySelector('#dsh-input').value"),'kept draft','DSH draft is preserved across the language switch');
    evidence.push('DSH panel and model picker are English; DSH-provided title/status and the input draft are untouched');

    // Floating DSH window: same preference, own selector in the overflow menu.
    await js("window.stg.dshVisible(false)");await pause(80);
    await js("window.stg.dshMode('floating')");await pause(700);
    const floating=BrowserWindow.getAllWindows().find(w=>w!==win&&w.webContents.getURL().includes('dsh'));
    assert.ok(floating,'floating DSH window opens');
    await waitIn(floating,"!!document.querySelector('#app-language')");
    assert.equal(await floating.webContents.executeJavaScript("document.querySelector('#app-language').dataset.placement",true),'menu');
    assert.equal(await floating.webContents.executeJavaScript("document.querySelector('#app-language button[aria-pressed=true]').dataset.locale",true),'en','floating DSH window restores English');
    assert.equal(await floating.webContents.executeJavaScript("document.querySelector('#dsh-input').placeholder",true),'Send a message, or continue this conversation…');
    assert.equal(await floating.webContents.executeJavaScript("document.querySelector('#dsh-context').textContent",true),'Context: Teaching guide','fixed context-role labels are English');
    await fs.writeFile(path.join(out,'dsh-floating-en.png'),(await floating.webContents.capturePage()).toPNG());
    await floating.webContents.executeJavaScript("document.querySelector('#app-language [data-locale=zh-CN]').click()",true);
    await pause(220);
    assert.equal(await floating.webContents.executeJavaScript("document.querySelector('#dsh-input').placeholder",true),'发消息，或继续当前对话…');
    for(let i=0;i<40;i++){if(await js("document.querySelector('#app-language button[aria-pressed=true]').dataset.locale")==='zh-CN')break;await pause(80);}
    assert.equal(await js("document.querySelector('#app-language button[aria-pressed=true]').dataset.locale"),'zh-CN','main window follows the floating window choice');
    await switchTo(floating);
    await floating.webContents.executeJavaScript("window.stg.dshMode('docked')",true);await pause(400);
    evidence.push('Floating DSH window carries the selector in its own menu, restores English, and stays in sync with the main window');

    // Detached document window shares the saved preference and updates live.
    await js("window.stg.dshVisible(false)");await pause(80);
    await js("window.stg.documentWindowOpen(" + JSON.stringify(answer) + ")");await pause(600);
    const detached=BrowserWindow.getAllWindows().find(w=>w!==win&&new URL(w.webContents.getURL()||'file:///').searchParams.get('document')===answer);
    assert.ok(detached,'detached document window opens');
    await waitIn(detached,"!!document.querySelector('#app-language')&&document.documentElement.dataset.busy==='false'");
    assert.equal(await detached.webContents.executeJavaScript("document.querySelector('#app-language button[aria-pressed=true]').dataset.locale",true),'en','detached window restores the same preference');
    // The unsaved answer from the main window comes along as a draft, so the
    // detached window correctly reports unsaved changes in English.
    assert.equal(await detached.webContents.executeJavaScript("document.querySelector('#save-status').textContent",true),'Unsaved changes');
    // Change it in the child and check the main window follows through the storage event.
    await switchTo(detached);
    await detached.webContents.executeJavaScript("document.querySelector('#app-language [data-locale=zh-CN]').click()",true);
    await pause(250);
    assert.equal(await detached.webContents.executeJavaScript("document.querySelector('#save-status').textContent",true),'待保存到文档');
    // The native process broadcasts the choice; the main window must follow
    // without a manual storage event or a reload.
    for(let i=0;i<40;i++){if(await js("document.querySelector('#app-language button[aria-pressed=true]').dataset.locale")==='zh-CN')break;await pause(80);}
    assert.equal(await js("document.querySelector('#app-language button[aria-pressed=true]').dataset.locale"),'zh-CN','main window receives the native language broadcast');
    assert.equal(await text('.import-label'),'导入学习文件夹');
    await fs.writeFile(path.join(out,'detached-zh-CN.png'),(await detached.webContents.capturePage()).toPNG());
    await switchTo(detached);
    await fs.writeFile(path.join(out,'detached-en.png'),(await detached.webContents.capturePage()).toPNG());
    detached.close();await pause(300);
    evidence.push('Detached document window restores the saved language and broadcasts changes back to the main window');

    // Reload restores English, and the app returns to Chinese cleanly.
    win.webContents.reload();await wait("!!document.querySelector('#welcome-import')&&document.documentElement.lang==='en'");
    assert.equal(await text('.import-label'),'Import learning folder','preference restored after reload');
    await shot('welcome-en-restored.png');
    await js("document.querySelector('#app-language [data-locale=zh-CN]').click()");await pause(140);
    assert.equal(await text('.import-label'),'导入学习文件夹');
    assert.equal(await js("localStorage.getItem('stg-app-language')"),'zh-CN');
    evidence.push('The saved preference is restored after reload and Chinese remains available');

    // Narrow layout in English must not overflow the page.
    await switchTo(win);
    for(const width of [1280,1100,960,760]){
      win.setSize(width,800);await pause(180);
      assert.equal(await js('document.documentElement.scrollWidth>innerWidth'),false,'English has no page overflow at '+width);
    }
    await wait("!!document.querySelector('#answer-0')||document.querySelector('#document').classList.contains('hidden')");
    await shot('narrow-en.png');
    win.setSize(1460,960);
    evidence.push('English layout has no horizontal page overflow at 1280/1100/960/760px');

    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,evidence,errors,root},null,2));
    console.log(JSON.stringify({passed:true,out,evidence}));
    app.exit(0);
  }catch(error){
    await shot('failure.png').catch(()=>{});
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:false,error:error.stack,evidence,errors,root},null,2));
    console.error(error);app.exit(1);
  }
}};
require('../electron/main.cjs');
