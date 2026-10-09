const path=require('node:path');
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const chokidar=require('chokidar');
const {dialog,shell,screen}=require('electron');
const {Workspace}=require('../lib/workspace.cjs');
const {DraftStore}=require('../lib/drafts.cjs');
const {appIcon}=require('./app-icon.cjs');

function createDocumentWindows({app,BrowserWindow,workspace,drafts,dev,smokeTest,onStateChange}){
  const contexts=new Map(),opened=new Map(),records=new Map();
  function handles(event){return contexts.has(event.sender.id);}
  function context(event){const c=contexts.get(event.sender.id);if(!c||c.window.isDestroyed()||event.sender!==c.window.webContents||event.senderFrame!==event.sender.mainFrame)throw Error('非法文档窗口请求。');return c;}
  // Only windows that finished loading successfully count as a snapshot or notify.
  const loaded=c=>c.ready&&!c.failed&&!c.window.isDestroyed();
  function list(baseWorkspace=workspace){
    if(!baseWorkspace||typeof baseWorkspace.root!=='string')return [];
    return [...records.values()].filter(c=>loaded(c)&&c.root===baseWorkspace.root).map(c=>({root:c.root,path:c.path,kind:c.kind}));
  }
  // A failing listener must never break window opening or closing.
  function notify(state){if(typeof onStateChange!=='function')return;try{onStateChange(state);}catch{}}
  async function open(relative,baseWorkspace=workspace){
    if(typeof relative!=='string'||!/(教学引导|学生回答)\.md$/i.test(relative))throw Error('独立窗口仅用于教学引导或学生回答文档。');
    await baseWorkspace.read(relative);
    const root=baseWorkspace.root,key=root+'\0'+relative;
    const existing=opened.get(key);if(existing&&!existing.window.isDestroyed()){if(existing.window.isMinimized())existing.window.restore();existing.window.show();existing.window.focus();return {opened:true,root,path:relative,kind:existing.kind,windows:list(baseWorkspace)};}
    const own=new Workspace();await own.open(root);own.retention=baseWorkspace.retention;
    const kind=/学生回答\.md$/i.test(relative)?'answer':'guide';
    const namespace=crypto.createHash('sha256').update(key).digest('hex');
    const localDrafts=new DraftStore(path.join(app.getPath('userData'),'document-drafts',namespace));
    if(!await localDrafts.get(root,relative)){const previous=await drafts.get(root,relative);if(previous)await localDrafts.put(root,relative,previous);}
    const available=screen.getPrimaryDisplay().workAreaSize;
    const w=new BrowserWindow({width:Math.min(kind==='answer'?760:960,available.width),height:Math.min(900,available.height),minWidth:Math.min(550,available.width),minHeight:Math.min(600,available.height),icon:appIcon(app),title:`${kind==='answer'?'学生文档':'教学文档'} · ${path.basename(relative)}`,titleBarStyle:'hidden',titleBarOverlay:{color:'#f1f2f4',symbolColor:'#58616e',height:34},autoHideMenuBar:true,backgroundColor:'#f1f2f4',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:!smokeTest}});
    const contentsId=w.webContents.id,assetHost='document-'+contentsId;
    const c={window:w,workspace:own,drafts:localDrafts,root,path:relative,kind,assetHost,closing:false,closeRequested:false,dirty:false,ready:false,failed:false};
    contexts.set(w.webContents.id,c);opened.set(key,c);records.set(key,c);
    c.watcher=chokidar.watch(root,{ignoreInitial:true,ignored:p=>/(?:^|[\\/])(?:\.[^\\/]+|node_modules|vendor|release)(?:[\\/]|$)/.test(p),depth:24,awaitWriteFinish:{stabilityThreshold:350,pollInterval:100}});
    c.watcher.on('all',(_event,file)=>{if(!/\.(md|markdown|txt)$/i.test(file))return;clearTimeout(c.timer);c.timer=setTimeout(()=>{if(!w.isDestroyed())w.webContents.send('workspace-changed');},200);});
    c.watcher.on('error',e=>{if(!w.isDestroyed())w.webContents.send('workspace-warning',e.message);});
    w.webContents.on('before-input-event',(event,input)=>{if(input.type!=='keyDown')return;if(input.key==='F11'){event.preventDefault();w.setFullScreen(!w.isFullScreen());return;}if(!(input.control||input.meta)||input.alt)return;const key=input.key.toLowerCase();if(key==='s'){event.preventDefault();w.webContents.send('shortcut','save');}else if(['+','=','-','0'].includes(key)){event.preventDefault();w.webContents.setZoomFactor(key==='0'?1:Math.max(.5,Math.min(2,w.webContents.getZoomFactor()*(key==='-'?1/1.1:1.1))));}});
    w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
    w.on('close',event=>{if(c.closing||w.webContents.isCrashed()||w.webContents.isDestroyed())return;event.preventDefault();if(!c.closeRequested){c.closeRequested=true;w.webContents.send('prepare-close');}});
    w.on('closed',()=>{clearTimeout(c.timer);c.watcher.close();contexts.delete(contentsId);opened.delete(key);if(records.get(key)===c){records.delete(key);if(c.ready&&!c.failed)notify({type:'closed',root:c.root,path:c.path,kind:c.kind,windows:list(own)});}});
    const query={document:relative,asset:assetHost};
    try{if(dev){const url=new URL(dev);Object.entries(query).forEach(([k,v])=>url.searchParams.set(k,v));await w.loadURL(url.toString());}else await w.loadFile(path.join(__dirname,'../dist/index.html'),{query});}
    catch(e){c.failed=true;w.destroy();throw e;}
    if(w.isDestroyed()||c.failed)throw Error('独立文档窗口已关闭。');
    c.ready=true;
    const snapshot={opened:true,root,path:relative,kind,windows:list(baseWorkspace)};
    notify({type:'opened',root,path:relative,kind,windows:list(baseWorkspace)});
    return snapshot;
  }
  async function invoke(event,name,args){
    const c=context(event),[p,a,v]=args,ws=c.workspace;
    const methods={tree:()=>ws.tree(),read:()=>ws.read(p),save:()=>ws.save(p,a,v),companion:()=>ws.companion(p),submit:()=>ws.submit(p,a,v),search:()=>ws.search(p),learning:()=>require('../lib/learning.cjs').getLearningState(ws),documents:()=>require('../lib/documents.cjs').relevantDocuments(ws,p),describe:()=>require('../lib/learning.cjs').describeFile(p),'document-context':()=>null,'last-root':()=>c.root,'document-window-info':()=>({root:c.root,path:c.path,kind:c.kind,assetHost:c.assetHost}),'document-window-list':()=>list(ws),'document-window-open':()=>open(p,ws),'open-root':async()=>{if(typeof p!=='string'||path.resolve(p)!==path.resolve(c.root))throw Error('独立文档窗口不能切换学习文件夹。');return ws.tree();},'draft-get':()=>c.drafts.get(c.root,p),'draft-put':()=>c.drafts.put(c.root,p,a),'draft-remove':()=>c.drafts.remove(c.root,p),'draft-list':()=>c.drafts.list(c.root),backups:()=>ws.backups(p),'backup-read':()=>ws.readBackup(p,a),'backup-restore':()=>ws.restoreBackup(p,a,v),dirty:()=>{c.dirty=!!p;},reveal:async()=>shell.showItemInFolder(await ws.resolve(p)),external:async()=>{if(typeof p==='string'&&/^https?:\/\//i.test(p))await shell.openExternal(p);},'export-draft':async()=>{const r=await dialog.showSaveDialog(c.window,{title:'另存文档草稿',defaultPath:path.basename(c.path),filters:[{name:'Markdown',extensions:['md']}]});if(!r.canceled){await fs.writeFile(r.filePath,p,'utf8');return true;}return false;},'close-ready':async()=>{c.closeRequested=false;if(!p){await dialog.showMessageBox(c.window,{type:'error',message:'草稿尚未保存成功，请保留窗口并重试。'});return;}c.closing=true;c.window.close();},'confirm-leave':async()=>false,preferences:async()=>{
      const settingsFile=path.join(app.getPath('userData'),'settings.json');let settings={};try{settings=JSON.parse(await fs.readFile(settingsFile,'utf8'));}catch{}
      const current={fontSize:16,lineHeight:1.9,readingWidth:820,backupRetention:20,...settings.preferences};if(!p)return current;
      const next={fontSize:Math.max(13,Math.min(24,Number(p.fontSize)||16)),lineHeight:Math.max(1.4,Math.min(2.4,Number(p.lineHeight)||1.9)),readingWidth:Math.max(540,Math.min(1200,Number(p.readingWidth)||820)),backupRetention:Math.max(5,Math.min(100,Number(p.backupRetention)||20))};ws.retention=next.backupRetention;await fs.writeFile(settingsFile,JSON.stringify({...settings,backupRetention:next.backupRetention,preferences:next},null,2));return next;
    }};
    if(!Object.hasOwn(methods,name))throw Error('独立文档窗口不支持这个操作。');return methods[name]();
  }
  return {open,list,handles,invoke,assetWorkspace:host=>[...contexts.values()].find(c=>c.assetHost===host)?.workspace||null,dispose:()=>{for(const c of contexts.values()){clearTimeout(c.timer);c.watcher.close();}}};
}
module.exports={createDocumentWindows};
