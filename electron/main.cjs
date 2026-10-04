const {app,BrowserWindow,ipcMain,dialog,protocol,net,shell,Menu,screen}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs/promises');
const chokidar=require('chokidar');
const {Workspace}=require('../lib/workspace.cjs');
const {DraftStore}=require('../lib/drafts.cjs');
const workspace=new Workspace();
let window,watcher,dirty=false,closing=false;
let drafts,closeRequested=false;
let dsh;
const dev=process.env.STG_DEV_URL;
const smokeTest=process.argv.includes('--smoke-test');
if(smokeTest) app.setPath('userData',path.join(app.getPath('temp'),'stg-desktop-smoke-profile'));
if(smokeTest) app.disableHardwareAcceleration();
if(smokeTest) app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
protocol.registerSchemesAsPrivileged([{scheme:'stg-asset',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const settingsPath=()=>path.join(app.getPath('userData'),'settings.json');
async function settings() { try { return JSON.parse(await fs.readFile(settingsPath(),'utf8')); } catch {return {}; } }
async function open(root) {
  if(dsh?.state.busy)throw new Error('请先停止 DSH 回复，再切换工作区。');
  const info=decorateTree(await workspace.open(root));
  if(watcher) await watcher.close();
  watcher=chokidar.watch(root,{ignoreInitial:true,ignored:p=>/(?:^|[\\/])(?:\.[^\\/]+|node_modules|vendor|release)(?:[\\/]|$)/.test(p),depth:24,awaitWriteFinish:{stabilityThreshold:350,pollInterval:100}});
  let timer;
  watcher.on('all',(_event,file)=>{
    if(!/\.(md|markdown|txt)$/i.test(file)) return;
    clearTimeout(timer); timer=setTimeout(()=>window?.webContents.send('workspace-changed'),300);
  });
  watcher.on('error',error=>window?.webContents.send('workspace-warning',error.message));
  await fs.writeFile(settingsPath(),JSON.stringify({...await settings(),lastRoot:info.root},null,2));
  await dsh?.onWorkspaceOpened(info.root);
  return info;
}
function decorateTree(info){const {describeFile}=require('../lib/learning.cjs');const walk=nodes=>{for(const n of nodes){if(n.children)walk(n.children);else n.description=describeFile(n.path);}};walk(info.children);return info;}
function handle(name,fn) {
  ipcMain.handle(name,async(event,...args)=>{
    if(event.sender!==window?.webContents || event.senderFrame!==window.webContents.mainFrame) throw new Error('非法请求。');
    return fn(...args);
  });
}
app.whenReady().then(async()=>{
  drafts=new DraftStore(path.join(app.getPath('userData'),'drafts'));
  dsh=require('./dsh-controller.cjs')({app,ipcMain,BrowserWindow,workspace,getWindow:()=>window,dev,smokeTest});
  workspace.retention=(await settings()).backupRetention||20;
  protocol.handle('stg-asset',async request=>{
    try {
      const url=new URL(request.url);
      if(url.hostname!=='workspace') return new Response('Forbidden',{status:403});
      const relative=decodeURIComponent(url.pathname.slice(1));
      if(!/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(relative)) return new Response('Unsupported',{status:403});
      const file=await workspace.resolve(relative);
      // SVG is served only into image tags; scripts cannot access the app bridge.
      return net.fetch(pathToFileURL(file).toString());
    } catch {return new Response('Not found',{status:404});}
  });
  handle('open-dialog',async()=>{
    const result=await dialog.showOpenDialog(window,{title:'导入 StepsToGreat 文件夹',properties:['openDirectory']});
    return result.canceled?null:open(result.filePaths[0]);
  });
  handle('open-root',open);
  handle('open-demo',async()=>{
    const root=path.join(app.getPath('userData'),'演示工作区');
    try {await fs.access(root);}catch {await fs.cp(app.isPackaged?path.join(process.resourcesPath,'demo/StepsToGreat'):path.join(__dirname,'../demo/StepsToGreat'),root,{recursive:true});}
    return open(root);
  });
  handle('tree',async()=>decorateTree(await workspace.tree()));
  handle('read',p=>workspace.read(p));
  handle('save',(p,c,v)=>workspace.save(p,c,v));
  handle('companion',p=>workspace.companion(p));
  handle('submit',(p,a,v)=>workspace.submit(p,a,v));
  handle('learning',()=>require('../lib/learning.cjs').getLearningState(workspace));
  handle('documents',options=>require('../lib/documents.cjs').relevantDocuments(workspace,options));
  handle('document-context',p=>dsh.onDocumentSelected(p));
  handle('describe',p=>require('../lib/learning.cjs').describeFile(p));
  handle('search',query=>workspace.search(query));
  handle('draft-get',p=>drafts.get(workspace.root,p));
  handle('draft-put',(p,data)=>drafts.put(workspace.root,p,data));
  handle('draft-remove',p=>drafts.remove(workspace.root,p));
  handle('draft-list',()=>drafts.list(workspace.root));
  handle('backups',p=>workspace.backups(p));
  handle('backup-read',(p,id)=>workspace.readBackup(p,id));
  handle('backup-restore',(p,id,version)=>workspace.restoreBackup(p,id,version));
  handle('preferences',async value=>{
    const current=await settings();
    if(!value)return {fontSize:16,lineHeight:1.9,readingWidth:820,backupRetention:20,...current.preferences};
    const next={fontSize:Math.max(13,Math.min(24,Number(value.fontSize)||16)),lineHeight:Math.max(1.4,Math.min(2.4,Number(value.lineHeight)||1.9)),readingWidth:Math.max(540,Math.min(1200,Number(value.readingWidth)||820)),backupRetention:Math.max(5,Math.min(100,Number(value.backupRetention)||20))};
    workspace.retention=next.backupRetention;
    await fs.writeFile(settingsPath(),JSON.stringify({...current,backupRetention:next.backupRetention,preferences:next},null,2));return next;
  });
  handle('close-ready',async ok=>{
    closeRequested=false;
    if(!ok){await dialog.showMessageBox(window,{type:'error',message:'草稿尚未成功保存，请继续编辑或另存文档草稿。'});return;}
    await dsh.dispose();closing=true;window.close();
  });
  handle('last-root',async()=>(await settings()).lastRoot||null);
  handle('dirty',value=>{dirty=!!value;});
  handle('confirm-leave',async()=>{
    const result=await dialog.showMessageBox(window,{type:'question',title:'保留未保存内容',message:'当前文档或答案草稿尚未保存。',buttons:['继续编辑','放弃本次修改'],defaultId:0,cancelId:0});
    return result.response===1;
  });
  handle('external',async url=>{if(/^https?:\/\//i.test(url)) await shell.openExternal(url);});
  handle('reveal',async p=>shell.showItemInFolder(await workspace.resolve(p)));
  handle('export-draft',async content=>{
    const result=await dialog.showSaveDialog(window,{title:'另存草稿',defaultPath:'STG-草稿.md',filters:[{name:'Markdown',extensions:['md']}]});
    if(!result.canceled) {await fs.writeFile(result.filePath,content,'utf8');return true;} return false;
  });
  const available=screen.getPrimaryDisplay().workAreaSize;
  window=new BrowserWindow({width:Math.min(1460,available.width),height:Math.min(960,available.height),minWidth:Math.min(1050,available.width),minHeight:Math.min(720,available.height),title:'STG Desk · 学习工作台',titleBarStyle:'hidden',titleBarOverlay:{color:'#f1f2f4',symbolColor:'#58616e',height:34},autoHideMenuBar:true,backgroundColor:'#f1f2f4',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:!smokeTest}});
  Menu.setApplicationMenu(null);
  window.webContents.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown')return;
    if(input.key==='F11'){event.preventDefault();window.setFullScreen(!window.isFullScreen());return;}
    if(!(input.control||input.meta)||input.alt)return;
    const key=input.key.toLowerCase();
    if(key==='s'||key==='o'){event.preventDefault();window.webContents.send('shortcut',key==='s'?'save':'import');}
    else if(['+','=','-','0'].includes(key)){event.preventDefault();const current=window.webContents.getZoomFactor();window.webContents.setZoomFactor(key==='0'?1:Math.max(.5,Math.min(2,current*(key==='-'?1/1.1:1.1))));}
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(e)=>e.preventDefault());
  window.on('close',event=>{
    if(window.webContents.isCrashed()||window.webContents.isDestroyed())return;
    if(!closing){event.preventDefault();if(!closeRequested){closeRequested=true;window.webContents.send('prepare-close');}}
  });
  if(dev) await window.loadURL(dev); else await window.loadFile(path.join(__dirname,'../dist/index.html'));
  if(smokeTest) await require('./smoke.cjs')(window,app);
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>watcher?.close());
