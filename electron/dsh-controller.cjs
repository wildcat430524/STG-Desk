const fs=require('node:fs/promises');
const path=require('node:path');
const {relevantDocuments}=require('../lib/documents.cjs');
const {appIcon}=require('./app-icon.cjs');
const localization=require('./localization.cjs');

module.exports=function attachDsh({app,ipcMain,BrowserWindow,workspace,getWindow,dev,smokeTest,serviceFactory,translate}){
  const tr=(key,params)=>translate?translate(key,params):localization.translate('zh-CN',key,params);
  let floating,service,currentPath=null,connecting=null;
  const conversations=new Map();
  const state={visible:false,mode:'docked',pinned:false,root:null,title:tr('dsh.title.default'),status:tr('dsh.status.importFirst'),draft:'',model:null,models:[],messages:[],busy:false,connected:false,sessions:[],contextLabel:null,contextPath:null};
  const storage=path.join(app.getPath('userData'),'dsh-conversations.json');
  let persistence=Promise.resolve();
  const makeId=()=>require('node:crypto').randomUUID();
  const errorText=e=>String(e?.message||e).replace(/(?:Bearer\s+)[^\s]+/gi,tr('dsh.error.credentialsHidden'));
  const save=()=>{
    if(!state.root)return persistence;
    conversations.set(state.root,{draft:state.draft,model:state.model,title:state.title,sessionId:state.sessionId});
    const data=JSON.stringify(Object.fromEntries(conversations));
    persistence=persistence.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(storage),{recursive:true});const tmp=storage+'.tmp';await fs.writeFile(tmp,data);await fs.rename(tmp,storage);});
    return persistence;
  };
  const restore=fs.readFile(storage,'utf8').then(text=>{for(const [root,value]of Object.entries(JSON.parse(text)))conversations.set(root,value);}).catch(()=>{});
  const broadcast=()=>{for(const w of [getWindow(),floating])if(w&&!w.isDestroyed())w.webContents.send('dsh-state',{...state});};
  const publish=()=>{broadcast();save().catch(e=>{state.status=tr('dsh.status.notSaved',{error:errorText(e)});broadcast();});};
  const report=e=>{state.status=errorText(e);state.busy=false;state.messages.push({id:makeId(),role:'error',text:state.status});publish();};
  function onEvent(event){
    const root=event.cwd||state.root;
    const active=root===state.root;
    const record=active?state:conversations.get(root);
    if(!record)return;
    if(event.type==='sync'){
      const previousModel=record.model,previousSession=record.sessionId;
      if(Array.isArray(event.messages))record.messages=event.messages;
      for(const key of ['sessionId','model','busy','connected'])if(event[key]!==undefined)record[key]=event[key];
      if(event.title)record.title=event.title;
      if(active){state.status=event.status||(state.connected?(state.busy?tr('dsh.status.replying'):tr('dsh.status.connected')):tr('dsh.status.openDesktop'));broadcast();if(previousModel!==record.model||previousSession!==record.sessionId||event.busy===false)save().catch(()=>{});}
      return;
    }
    if(event.type==='session')record.sessionId=event.sessionId;
    if(event.type==='status'&&active){
      state.status=event.message||event.text||tr('dsh.status.working');
      if(Array.isArray(event.configOptions)){
        const option=event.configOptions.find(o=>o.id==='model');
        if(option){state.models=(option.options||[]).flatMap(group=>Array.isArray(group.options)?group.options.map(o=>({id:o.value,label:o.name,provider:group.name})): [{id:group.value,label:group.name,provider:''}]);state.model=option.currentValue||state.model;}
      }
    }
    if(event.type==='tool'&&active)state.status=event.message||event.text||tr('dsh.status.usingTool');
    if(event.type==='text'){
      if(event.channel==='thought'){if(active){state.status=tr('dsh.status.thinking');broadcast();}return;}
      const id=event.messageId?`${event.requestId||record.replyId}:${event.messageId}`:event.requestId||record.replyId;
      let message=record.messages.find(m=>m.id===id&&m.role==='assistant');
      if(!message){message={id:id||makeId(),role:'assistant',text:''};record.messages.push(message);}
      if(event.isSnapshot)message.text=event.text||'';else message.text+=event.text||'';
    }
    if(event.type==='done'){record.busy=false;if(active){state.status=event.stopReason==='error'?tr('dsh.status.requestFailed'):event.cancelled?tr('dsh.status.stopped'):tr('dsh.status.connected');state.replyId=null;}}
    if(event.type==='error'){record.busy=false;record.messages.push({id:makeId(),role:'error',text:event.message||event.text||tr('dsh.error.interrupted')});if(active)state.status=tr('dsh.status.check');}
    if(active)publish();else save().catch(()=>{});
  }
  function getService(){if(!service){const options={onEvent,storagePath:path.join(app.getPath('userData'),'dsh-desktop-sessions.json')};if(serviceFactory)service=serviceFactory(options);else{const {DshDesktopService}=require('../lib/dsh-desktop-service.cjs');service=new DshDesktopService(options);}}return service;}
  async function context(){
    if(!workspace.root)throw new Error(tr('error.importFirst'));
    const info=await relevantDocuments(workspace,{currentPath});
    const documents=[];
    const roles={answer:'submitted-answer',guide:'teaching-guide',profile:'learning-profile',rules:'learning-rules',route:'course-route',material:'reference',document:'reference'};
    for(const d of info.documents){try{const doc=await workspace.read(d.path);documents.push({path:d.path,role:roles[d.kind]||'reference',access:d.access,content:doc.content});}catch{}}
    return {documents,subject:info.learning.subject,lesson:info.learning.lesson,round:info.learning.round};
  }
  async function updateContext(){
    if(!workspace.root)return;
    const info=await relevantDocuments(workspace,{currentPath});
    state.contextPath=currentPath||info.learning.guidePath||info.learning.profilePath;
    state.contextLabel=info.documents.find(d=>d.path===state.contextPath)?.label||null;
    if(!state.connected){state.title=info.learning.lesson||tr('dsh.title.default');
    if(currentPath){const description=require('../lib/learning.cjs').describeFile(currentPath);if(description.lesson)state.title=description.lesson;else if(['guide','answer'].includes(description.kind)&&currentPath.includes('/'))state.title=path.posix.basename(path.posix.dirname(currentPath));}}
    publish();
  }
  async function connect(){
    if(!state.root){state.status=tr('error.importFirst');broadcast();return state;}
    if(connecting)return connecting;
    const root=state.root;
    connecting=Promise.resolve().then(async()=>{
      try{state.status=tr('dsh.status.connecting');broadcast();const backend=getService();const status=await backend.getStatus();if(!status.available)throw new Error(status.message||tr('dsh.status.desktopRequired'));const result=await backend.getModels({cwd:root});if(state.root!==root)return;state.models=result.models||[];state.sessions=result.sessions||[];state.sessionId=result.sessionId;state.model=result.selectedModel||state.models[0]?.id||null;state.connected=true;state.status=result.message||tr('dsh.status.connected');publish();}
      catch(error){if(state.root===root){state.connected=false;state.models=[];state.status=errorText(error);state.busy=false;broadcast();}}
      return {...state};
    }).finally(()=>{connecting=null;if(state.root!==root&&state.visible)connect();});
    return connecting;
  }
  async function ensureFloating(){
    if(floating&&!floating.isDestroyed())return floating;
    floating=new BrowserWindow({width:510,height:740,minWidth:400,minHeight:460,show:false,icon:appIcon(app),title:tr('app.dshWindowTitle'),backgroundColor:'#00000000',transparent:true,hasShadow:false,roundedCorners:true,autoHideMenuBar:true,frame:false,resizable:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    floating.webContents.setWindowOpenHandler(()=>({action:'deny'}));floating.webContents.on('will-navigate',e=>e.preventDefault());
    floating.on('close',event=>{if(!app.isQuitting){event.preventDefault();floating.hide();state.visible=false;publish();}});
    floating.on('closed',()=>floating=null);
    if(dev)await floating.loadURL(dev+'?dsh=1');else await floating.loadFile(path.join(__dirname,'../dist/index.html'),{query:{dsh:'1'}});
    floating.setAlwaysOnTop(state.pinned);return floating;
  }
  function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{const owner=[getWindow(),floating].find(w=>w&&!w.isDestroyed()&&w.webContents===event.sender);if(!owner||event.senderFrame!==owner.webContents.mainFrame)throw new Error(tr('error.illegalDsh'));return fn(...args);});}
  handle('dsh-state',()=>({...state}));
  handle('dsh-visible',async visible=>{state.visible=!!visible;if(visible&&state.mode==='floating'){const w=await ensureFloating();if(w.isMinimized?.())w.restore();w.show();w.focus();}else if(!visible)floating?.hide();publish();if(visible&&state.root&&!state.models.length&&!smokeTest)connect();return {...state};});
  handle('dsh-mode',async mode=>{if(!['docked','floating'].includes(mode))throw new Error(tr('error.unknownWindowMode'));state.mode=mode;state.visible=true;if(mode==='floating'){const w=await ensureFloating();if(w.isMinimized?.())w.restore();w.show();w.focus();}else floating?.hide();publish();return {...state};});
  handle('dsh-pin',pinned=>{state.pinned=!!pinned;floating?.setAlwaysOnTop(state.pinned);publish();});
  handle('dsh-minimize',()=>{if(floating&&!floating.isDestroyed())floating.minimize();});
  handle('dsh-draft',text=>{if(typeof text!=='string')throw new Error(tr('error.messageText'));state.draft=text;return save();});
  handle('dsh-review-prompt',()=>{if(!state.draft.trim())state.draft=tr('dsh.reviewPrompt');publish();return {...state};});
  handle('dsh-model',async model=>{if(state.busy)throw new Error(tr('error.modelBusy'));if(!state.models.some(m=>m.id===model))throw new Error(tr('error.modelUnavailable'));await getService().selectModel?.({cwd:state.root,model});state.model=model;publish();});
  handle('dsh-session',async sessionId=>{if(state.busy)throw new Error(tr('error.sessionBusy'));await getService().selectSession({cwd:state.root,sessionId});return {...state};});
  handle('dsh-open-desktop',async()=>{const runtime=process.env.DSH_DESKTOP_HOME||process.env.STG_DSH_RUNTIME||require('../lib/dsh-discovery.cjs')();if(!runtime)throw new Error(tr('error.dshMissing'));const executable=runtime.toLowerCase().endsWith('.exe')?runtime:path.join(runtime,'DeepSeek Harness.exe');await fs.access(executable);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=require('node:child_process').spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:true,env});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return {...state};});
  handle('dsh-connect',connect);
  handle('dsh-quote',async()=>{await updateContext();return {...state};});
  handle('dsh-cancel',async()=>{if(state.busy)await getService().cancel({cwd:state.root});});
  handle('dsh-new',async()=>{if(state.busy)throw new Error(tr('error.stopFirst'));await getService().newSession({cwd:state.root});state.draft='';publish();await connect();});
  handle('dsh-send',async({text,model}={})=>{
    if(!state.root)throw new Error(tr('error.importFirst'));if(state.busy)throw new Error(tr('error.dshBusy'));if(typeof text!=='string'||!text.trim())throw new Error(tr('error.messageEmpty'));
    if(!state.connected&&!smokeTest)throw new Error(tr('error.connectFirst'));
    if(model&&!state.models.some(m=>m.id===model))throw new Error(tr('error.modelStale'));
    if(model)state.model=model;
    const root=state.root;
    state.draft='';state.busy=true;state.status=tr('dsh.status.thinking');publish();
    try{const ctx=await context();const result=await getService().send({cwd:root,text,model:model||state.model,context:ctx});state.sessionId=result.sessionId;state.replyId=result.requestId;publish();return result;}
    catch(error){state.draft=text;report(error);throw error;}
  });
  return {
    async onWorkspaceOpened(root){if(state.busy)throw new Error(tr('error.busyWorkspace'));await restore;await save();state.root=root;currentPath=null;const record=conversations.get(root)||{};state.draft=record.draft||'';state.messages=[];state.sessionId=null;state.replyId=null;state.model=null;state.models=[];state.connected=false;state.sessions=[];state.title=tr('dsh.title.default');state.busy=false;await updateContext();if(state.visible&&!smokeTest)connect();},
    async onDocumentSelected(p){await workspace.resolve(p);currentPath=p;await updateContext();},
    // The floating DSH window must be able to read/update the shared UI language,
    // exactly like the main window and detached document windows.
    ownsWindow(event){
      return !!floating&&!floating.isDestroyed()&&floating.webContents===event.sender&&event.senderFrame===event.sender.mainFrame;
    },
    async dispose(){app.isQuitting=true;await save();await service?.dispose();floating?.destroy();},
    applyLanguage(){
      if(floating&&!floating.isDestroyed())floating.setTitle(tr('app.dshWindowTitle'));
      // Republish so the renderer re-reads the localized fallback status/title.
      if(!state.title||state.title===localization.translate('zh-CN','dsh.title.default'))state.title=tr('dsh.title.default');
      if(!state.root)state.status=tr('dsh.status.importFirst');
      else if(!state.connected)state.status=tr('dsh.status.openDesktop');
      broadcast();
    },
    state,
    get floatingWindow(){return floating;}
  };
};
