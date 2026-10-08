const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {Workspace}=require('../lib/workspace.cjs');
const attach=require('../electron/dsh-controller.cjs');

class FakeWindow extends EventEmitter{
  constructor(options={}){super();this.options=options;this.webContents={mainFrame:{},send(){},setWindowOpenHandler(){},on(){}};}
  isDestroyed(){return false;}async loadFile(){}show(){this.visible=true;}hide(){this.visible=false;}focus(){}setAlwaysOnTop(value){this.pinned=value;}destroy(){this.emit('closed');}
  minimize(){this.minimized=true;}isMinimized(){return !!this.minimized;}restore(){this.minimized=false;}
}
test('DSH native windows share the draft, hide without losing it, and reject iframe or unrelated IPC',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-dsh-controller-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const workspaceRoot=path.join(root,'workspace');await fs.cp(path.join(__dirname,'../demo/StepsToGreat'),workspaceRoot,{recursive:true});
  const workspace=new Workspace();await workspace.open(workspaceRoot);
  const window=new FakeWindow(),handlers=new Map();
  const app={getPath:()=>root};
  const controller=attach({app,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},BrowserWindow:FakeWindow,workspace,getWindow:()=>window,smokeTest:true});
  const call=(name,...args)=>handlers.get(name)({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args);
  await controller.onWorkspaceOpened(workspace.root);
  await call('dsh-draft','已有的提问草稿');await call('dsh-review-prompt');assert.equal(controller.state.draft,'已有的提问草稿');
  await call('dsh-mode','floating');const floating=controller.floatingWindow;assert.equal(floating.visible,true);assert.equal(floating.options.frame,false);assert.equal(floating.options.webPreferences.nodeIntegration,false);
  const state=await handlers.get('dsh-state')({sender:floating.webContents,senderFrame:floating.webContents.mainFrame});assert.equal(state.draft,'已有的提问草稿');
  await call('dsh-minimize');assert.equal(floating.minimized,true);assert.equal(controller.state.visible,true);
  await call('dsh-visible',true);assert.equal(floating.minimized,false);assert.equal(controller.state.draft,'已有的提问草稿');
  let prevented=false;floating.emit('close',{preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(controller.state.visible,false);assert.equal(controller.state.draft,'已有的提问草稿');
  await call('dsh-visible',true);assert.equal(floating.visible,true);await call('dsh-pin',true);assert.equal(floating.pinned,true);
  await call('dsh-mode','docked');assert.equal(floating.visible,false);assert.equal(controller.state.draft,'已有的提问草稿');
  await assert.rejects(handlers.get('dsh-state')({sender:window.webContents,senderFrame:{}}),/非法/);
  await assert.rejects(handlers.get('dsh-state')({sender:{},senderFrame:{}}),/非法/);
  await assert.rejects(controller.onDocumentSelected('../outside.md'));
  await controller.dispose();
  const saved=JSON.parse(await fs.readFile(path.join(root,'dsh-conversations.json'),'utf8'));assert.equal(saved[workspace.root].draft,'已有的提问草稿');
});
test('DSH controller sends only saved related documents and preserves draft when transport fails',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-dsh-send-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const workspaceRoot=path.join(root,'workspace');await fs.cp(path.join(__dirname,'../demo/StepsToGreat'),workspaceRoot,{recursive:true});
  await fs.writeFile(path.join(workspaceRoot,'无关文档.md'),'不应发送给模型');
  const workspace=new Workspace();await workspace.open(workspaceRoot);const window=new FakeWindow(),handlers=new Map();let emitter,received,fail=false;
  const backend={async getStatus(){return {available:true};},async getModels(){return {models:[{id:'model-a',label:'模型 A'}],selectedModel:'model-a'};},async send(options){received=options;if(fail)throw new Error('连接失败');return {requestId:'r1',sessionId:'s1'};},async cancel(){emitter({type:'done',cwd:workspace.root});},async dispose(){}};
  const controller=attach({app:{getPath:()=>root},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},BrowserWindow:FakeWindow,workspace,getWindow:()=>window,smokeTest:true,serviceFactory:options=>{emitter=options.onEvent;return backend;}});
  const call=(name,...args)=>handlers.get(name)({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args);
  await controller.onWorkspaceOpened(workspace.root);await call('dsh-connect');await call('dsh-draft','请解释当前题目');await call('dsh-send',{text:'请解释当前题目',model:'model-a'});
  assert.equal(received.model,'model-a');assert(!received.context.documents.some(d=>d.path==='无关文档.md'));assert(received.context.documents.some(d=>d.path.endsWith('学生回答.md')));assert.equal(controller.state.busy,true);
  await assert.rejects(call('dsh-send',{text:'重复请求'}),/正在回复/);
  emitter({type:'text',cwd:workspace.root,requestId:'r1',text:'第一段'});emitter({type:'text',cwd:workspace.root,requestId:'r1',text:'第二段'});assert.equal(controller.state.messages.filter(m=>m.role==='assistant').length,1);assert.equal(controller.state.messages.at(-1).text,'第一段第二段');
  emitter({type:'text',cwd:workspace.root,requestId:'r1',channel:'thought',text:'隐藏的推理'});assert(!controller.state.messages.some(m=>m.text.includes('隐藏的推理')));
  emitter({type:'text',cwd:workspace.root,requestId:'r1',messageId:'m2',isSnapshot:true,text:'完整回复'});emitter({type:'text',cwd:workspace.root,requestId:'r1',messageId:'m2',isSnapshot:true,text:'完整回复更新'});assert.equal(controller.state.messages.at(-1).text,'完整回复更新');
  emitter({type:'status',cwd:workspace.root,configOptions:[{id:'model',currentValue:'model-b',options:[{name:'原生提供方',options:[{value:'model-b',name:'模型 B'}]}]}]});assert.equal(controller.state.model,'model-b');assert.deepEqual(controller.state.models,[{id:'model-b',label:'模型 B',provider:'原生提供方'}]);
  emitter({type:'status',cwd:workspace.root,configOptions:[{id:'model',currentValue:'model-a',options:[{value:'model-a',name:'模型 A'}]}]});
  await call('dsh-cancel');assert.equal(controller.state.busy,false);
  fail=true;await assert.rejects(call('dsh-send',{text:'需要保留的请求',model:'model-a'}),/连接失败/);assert.equal(controller.state.draft,'需要保留的请求');assert.equal(controller.state.busy,false);
  await controller.dispose();
});

test('Preparing saved context keeps the sending workspace fixed, and switching folders clears old session identity',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-dsh-switch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const first=path.join(root,'first'),second=path.join(root,'second');
  await fs.cp(path.join(__dirname,'../demo/StepsToGreat'),first,{recursive:true});await fs.cp(first,second,{recursive:true});
  const workspace=new Workspace();await workspace.open(first);const firstRoot=workspace.root;
  const window=new FakeWindow(),handlers=new Map();let sent;
  const backend={async send(options){sent=options;return {sessionId:'first-session',requestId:'first-request'};},async dispose(){}};
  const controller=attach({app:{getPath:()=>root},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},BrowserWindow:FakeWindow,workspace,getWindow:()=>window,smokeTest:true,serviceFactory:()=>backend});
  const call=(name,...args)=>handlers.get(name)({sender:window.webContents,senderFrame:window.webContents.mainFrame},...args);
  await controller.onWorkspaceOpened(workspace.root);
  const read=workspace.read.bind(workspace);let startRead,releaseRead;
  const started=new Promise(resolve=>startRead=resolve),release=new Promise(resolve=>releaseRead=resolve);
  workspace.read=async(...args)=>{startRead();await release;return read(...args);};
  const sending=call('dsh-send',{text:'解释当前题目'});await started;
  try{assert.equal(controller.state.busy,true);await assert.rejects(controller.onWorkspaceOpened(second),/停止 DSH 回复/);await assert.rejects(call('dsh-send',{text:'重复发送'}),/正在回复/);}
  finally{releaseRead();await sending;}
  assert.equal(sent.cwd,firstRoot);assert.equal(controller.state.sessionId,'first-session');
  controller.state.busy=false;controller.state.messages=[{role:'assistant',text:'旧文件夹的回答'}];
  await workspace.open(second);await controller.onWorkspaceOpened(workspace.root);
  assert.equal(controller.state.root,workspace.root);assert.notEqual(controller.state.root,firstRoot);assert.equal(controller.state.sessionId,null);assert.equal(controller.state.replyId,null);assert.deepEqual(controller.state.messages,[]);assert.deepEqual(controller.state.sessions,[]);assert.equal(controller.state.connected,false);
  await controller.dispose();
});
