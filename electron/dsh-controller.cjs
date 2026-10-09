const fs=require('node:fs/promises');
const path=require('node:path');
const {relevantDocuments}=require('../lib/documents.cjs');
const {appIcon}=require('./app-icon.cjs');

module.exports=function attachDsh({app,ipcMain,BrowserWindow,workspace,getWindow,dev,smokeTest,serviceFactory}){
  let floating,service,currentPath=null,connecting=null;
  const conversations=new Map();
  const state={visible:false,mode:'docked',pinned:false,root:null,title:'DSH 导师',status:'导入学习文件夹后连接',draft:'',model:null,models:[],messages:[],busy:false,connected:false,sessions:[],contextLabel:null,contextPath:null};
  const storage=path.join(app.getPath('userData'),'dsh-conversations.json');
  let persistence=Promise.resolve();
  const makeId=()=>require('node:crypto').randomUUID();
  const errorText=e=>String(e?.message||e).replace(/(?:Bearer\s+)[^\s]+/gi,'[已隐藏凭据]');
  const save=()=>{
    if(!state.root)return persistence;
    conversations.set(state.root,{draft:state.draft,model:state.model,title:state.title,sessionId:state.sessionId});
    const data=JSON.stringify(Object.fromEntries(conversations));
    persistence=persistence.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(storage),{recursive:true});const tmp=storage+'.tmp';await fs.writeFile(tmp,data);await fs.rename(tmp,storage);});
    return persistence;
  };
  const restore=fs.readFile(storage,'utf8').then(text=>{for(const [root,value]of Object.entries(JSON.parse(text)))conversations.set(root,value);}).catch(()=>{});
  const broadcast=()=>{for(const w of [getWindow(),floating])if(w&&!w.isDestroyed())w.webContents.send('dsh-state',{...state});};
  const publish=()=>{broadcast();save().catch(e=>{state.status='对话暂未保存：'+errorText(e);broadcast();});};
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
      if(active){state.status=event.status||(state.connected?(state.busy?'DSH 正在回复 · 同步中':'已连接 · DSH 桌面同步'):'打开 DSH 桌面应用后连接');broadcast();if(previousModel!==record.model||previousSession!==record.sessionId||event.busy===false)save().catch(()=>{});}
      return;
    }
    if(event.type==='session')record.sessionId=event.sessionId;
    if(event.type==='status'&&active){
      state.status=event.message||event.text||'DSH 正在处理';
      if(Array.isArray(event.configOptions)){
        const option=event.configOptions.find(o=>o.id==='model');
        if(option){state.models=(option.options||[]).flatMap(group=>Array.isArray(group.options)?group.options.map(o=>({id:o.value,label:o.name,provider:group.name})): [{id:group.value,label:group.name,provider:''}]);state.model=option.currentValue||state.model;}
      }
    }
    if(event.type==='tool'&&active)state.status=event.message||event.text||'正在使用工具';
    if(event.type==='text'){
      if(event.channel==='thought'){if(active){state.status='DSH 正在思考…';broadcast();}return;}
      const id=event.messageId?`${event.requestId||record.replyId}:${event.messageId}`:event.requestId||record.replyId;
      let message=record.messages.find(m=>m.id===id&&m.role==='assistant');
      if(!message){message={id:id||makeId(),role:'assistant',text:''};record.messages.push(message);}
      if(event.isSnapshot)message.text=event.text||'';else message.text+=event.text||'';
    }
    if(event.type==='done'){record.busy=false;if(active){state.status=event.stopReason==='error'?'本次请求失败，请查看连接提示':event.cancelled?'已停止 · DSH':'已连接 · DSH';state.replyId=null;}}
    if(event.type==='error'){record.busy=false;record.messages.push({id:makeId(),role:'error',text:event.message||event.text||'DSH 连接中断'});if(active)state.status='连接需要检查';}
    if(active)publish();else save().catch(()=>{});
  }
  function getService(){if(!service){const options={onEvent,storagePath:path.join(app.getPath('userData'),'dsh-desktop-sessions.json')};if(serviceFactory)service=serviceFactory(options);else{const {DshDesktopService}=require('../lib/dsh-desktop-service.cjs');service=new DshDesktopService(options);}}return service;}
  async function context(){
    if(!workspace.root)throw new Error('请先导入学习文件夹。');
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
    if(!state.connected){state.title=info.learning.lesson||'DSH 导师';
    if(currentPath){const description=require('../lib/learning.cjs').describeFile(currentPath);if(description.lesson)state.title=description.lesson;else if(['guide','answer'].includes(description.kind)&&currentPath.includes('/'))state.title=path.posix.basename(path.posix.dirname(currentPath));}}
    publish();
  }
  async function connect(){
    if(!state.root){state.status='请先导入学习文件夹';broadcast();return state;}
    if(connecting)return connecting;
    const root=state.root;
    connecting=Promise.resolve().then(async()=>{
      try{state.status='正在连接 DSH 桌面端…';broadcast();const backend=getService();const status=await backend.getStatus();if(!status.available)throw new Error(status.message||'请先打开 DSH 桌面应用');const result=await backend.getModels({cwd:root});if(state.root!==root)return;state.models=result.models||[];state.sessions=result.sessions||[];state.sessionId=result.sessionId;state.model=result.selectedModel||state.models[0]?.id||null;state.connected=true;state.status=result.message||'已连接 · DSH 桌面同步';publish();}
      catch(error){if(state.root===root){state.connected=false;state.models=[];state.status=errorText(error);state.busy=false;broadcast();}}
      return {...state};
    }).finally(()=>{connecting=null;if(state.root!==root&&state.visible)connect();});
    return connecting;
  }
  async function ensureFloating(){
    if(floating&&!floating.isDestroyed())return floating;
    floating=new BrowserWindow({width:510,height:740,minWidth:400,minHeight:460,show:false,icon:appIcon(app),title:'DSH · 当前会话',backgroundColor:'#00000000',transparent:true,hasShadow:false,roundedCorners:true,autoHideMenuBar:true,frame:false,resizable:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    floating.webContents.setWindowOpenHandler(()=>({action:'deny'}));floating.webContents.on('will-navigate',e=>e.preventDefault());
    floating.on('close',event=>{if(!app.isQuitting){event.preventDefault();floating.hide();state.visible=false;publish();}});
    floating.on('closed',()=>floating=null);
    if(dev)await floating.loadURL(dev+'?dsh=1');else await floating.loadFile(path.join(__dirname,'../dist/index.html'),{query:{dsh:'1'}});
    floating.setAlwaysOnTop(state.pinned);return floating;
  }
  function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{const owner=[getWindow(),floating].find(w=>w&&!w.isDestroyed()&&w.webContents===event.sender);if(!owner||event.senderFrame!==owner.webContents.mainFrame)throw new Error('非法 DSH 请求。');return fn(...args);});}
  handle('dsh-state',()=>({...state}));
  handle('dsh-visible',async visible=>{state.visible=!!visible;if(visible&&state.mode==='floating'){const w=await ensureFloating();if(w.isMinimized?.())w.restore();w.show();w.focus();}else if(!visible)floating?.hide();publish();if(visible&&state.root&&!state.models.length&&!smokeTest)connect();return {...state};});
  handle('dsh-mode',async mode=>{if(!['docked','floating'].includes(mode))throw new Error('未知窗口模式。');state.mode=mode;state.visible=true;if(mode==='floating'){const w=await ensureFloating();if(w.isMinimized?.())w.restore();w.show();w.focus();}else floating?.hide();publish();return {...state};});
  handle('dsh-pin',pinned=>{state.pinned=!!pinned;floating?.setAlwaysOnTop(state.pinned);publish();});
  handle('dsh-minimize',()=>{if(floating&&!floating.isDestroyed())floating.minimize();});
  handle('dsh-draft',text=>{if(typeof text!=='string')throw new Error('消息必须是文字。');state.draft=text;return save();});
  handle('dsh-review-prompt',()=>{if(!state.draft.trim())state.draft='本轮作答已保存，请按教学规则评估我的回答。';publish();return {...state};});
  handle('dsh-model',async model=>{if(state.busy)throw new Error('请等待当前回复结束后切换模型。');if(!state.models.some(m=>m.id===model))throw new Error('这个模型当前不可用。');await getService().selectModel?.({cwd:state.root,model});state.model=model;publish();});
  handle('dsh-session',async sessionId=>{if(state.busy)throw new Error('请等待当前回复结束后切换会话。');await getService().selectSession({cwd:state.root,sessionId});return {...state};});
  handle('dsh-open-desktop',async()=>{const runtime=process.env.DSH_DESKTOP_HOME||process.env.STG_DSH_RUNTIME||require('../lib/dsh-discovery.cjs')();if(!runtime)throw new Error('未找到 DSH 桌面应用，请先安装或手动打开 DSH。');const executable=runtime.toLowerCase().endsWith('.exe')?runtime:path.join(runtime,'DeepSeek Harness.exe');await fs.access(executable);const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=require('node:child_process').spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:true,env});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return {...state};});
  handle('dsh-connect',connect);
  handle('dsh-quote',async()=>{await updateContext();return {...state};});
  handle('dsh-cancel',async()=>{if(state.busy)await getService().cancel({cwd:state.root});});
  handle('dsh-new',async()=>{if(state.busy)throw new Error('请先停止当前回复。');await getService().newSession({cwd:state.root});state.draft='';publish();await connect();});
  handle('dsh-send',async({text,model}={})=>{
    if(!state.root)throw new Error('请先导入学习文件夹。');if(state.busy)throw new Error('DSH 正在回复，请稍后再发。');if(typeof text!=='string'||!text.trim())throw new Error('请先填写消息。');
    if(!state.connected&&!smokeTest)throw new Error('请先打开 DSH 桌面应用并连接。');
    if(model&&!state.models.some(m=>m.id===model))throw new Error('所选模型当前不可用，请重新连接。');
    if(model)state.model=model;
    const root=state.root;
    state.draft='';state.busy=true;state.status='DSH 正在思考 · 同步中';publish();
    try{const ctx=await context();const result=await getService().send({cwd:root,text,model:model||state.model,context:ctx});state.sessionId=result.sessionId;state.replyId=result.requestId;publish();return result;}
    catch(error){state.draft=text;report(error);throw error;}
  });
  return {
    async onWorkspaceOpened(root){if(state.busy)throw new Error('请先停止 DSH 回复，再切换工作区。');await restore;await save();state.root=root;currentPath=null;const record=conversations.get(root)||{};state.draft=record.draft||'';state.messages=[];state.sessionId=null;state.replyId=null;state.model=null;state.models=[];state.connected=false;state.sessions=[];state.title='DSH 导师';state.busy=false;await updateContext();if(state.visible&&!smokeTest)connect();},
    async onDocumentSelected(p){await workspace.resolve(p);currentPath=p;await updateContext();},
    async dispose(){app.isQuitting=true;await save();await service?.dispose();floating?.destroy();},
    state,
    get floatingWindow(){return floating;}
  };
};
