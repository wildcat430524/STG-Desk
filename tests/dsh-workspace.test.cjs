const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {EventEmitter}=require('node:events');
const {DshDesktopService}=require('../lib/dsh-desktop-service.cjs');

async function desktop(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-workspace-binding-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const storagePath=path.join(root,'binding.json'),calls=[],followed=[],items=[];
  const workspace={workspaceId:'learning-workspace',path:root,sessionIds:[]};
  const selection={provider:'buddy',model:'configured-model',reasoningEffort:'high'};
  const catalog={default:selection,groups:[{id:'buddy',models:[{id:selection.model}]}]};
  class Socket extends EventEmitter{
    constructor(){super();queueMicrotask(()=>this.emit('open'));}
    send(text){const request=JSON.parse(text),id=request.payload.args.request.address.sessionId;followed.push(id);queueMicrotask(()=>this.emit('message',JSON.stringify({type:'item',value:{type:'snapshot',records:[],projections:{values:{modelSelection:{next:selection}}}}})));}
    close(){this.emit('close');}
  }
  let created=0;
  const makeService=()=>{
    const service=new DshDesktopService({storagePath,WebSocket:Socket});
    service.auth=async()=>{service.cookie='test';};
    service.rpc=async(method,args={})=>{
      calls.push({method,args});
      if(method==='session/list')return {items};
      if(method==='session/modelCatalog')return catalog;
      if(method==='workspace/create'){assert.equal(args.request.path,root);return {workspace,created:false};}
      if(method==='session/create'){
        const request=args.request;assert.equal(request.workspaceId,workspace.workspaceId);assert.equal(request.cwd,undefined);
        const sessionId=request.sessionId||'session-learning-'+ ++created;
        if(!items.some(s=>s.sessionId===sessionId))items.push({sessionId,cwd:root});
        if(!workspace.sessionIds.includes(sessionId))workspace.sessionIds.push(sessionId);
        return {sessionId};
      }
      if(method==='session/projections')return {values:{modelSelection:{next:selection}}};
      if(method==='session/prompt')return {accepted:true};
      throw new Error('Unexpected RPC: '+method);
    };
    t.after(()=>service.dispose());return service;
  };
  return {root,storagePath,workspace,calls,followed,items,makeService};
}

test('First connection creates a dedicated session in the native folder workspace rather than adopting a project task',async t=>{
  const d=await desktop(t),s=d.makeService();
  d.items.push({sessionId:'session-project-task',cwd:d.root},{sessionId:'other-folder',cwd:path.join(d.root,'other')},{sessionId:'missing-cwd'},{sessionId:'relative-cwd',cwd:'.'},{sessionId:'child',cwd:d.root,parentSessionId:'session-project-task'});
  const result=await s.getModels({cwd:d.root});
  assert.equal(result.sessionId,'session-learning-1');
  assert.deepEqual(result.sessions.map(s=>s.id),['session-project-task','session-learning-1']);
  assert.deepEqual(d.followed,['session-learning-1']);
  assert(d.workspace.sessionIds.includes(result.sessionId));
  assert.equal(result.selectedModel,'["buddy","configured-model"]');
  const binding=JSON.parse(await fs.readFile(d.storagePath,'utf8'));
  assert.equal(binding[d.root].version,2);assert.equal(binding[d.root].sessionId,result.sessionId);
});

test('Legacy and foreign-folder bindings are replaced; a verified dedicated binding survives restart',async t=>{
  const d=await desktop(t);
  d.items.push({sessionId:'session-old-task',cwd:d.root},{sessionId:'session-foreign',cwd:path.join(d.root,'other')});
  await fs.writeFile(d.storagePath,JSON.stringify({[d.root]:'session-old-task'}));
  let s=d.makeService(),result=await s.getModels({cwd:d.root});
  assert.equal(result.sessionId,'session-learning-1');await s.dispose();
  s=d.makeService();assert.equal((await s.getModels({cwd:d.root})).sessionId,'session-learning-1');await s.dispose();
  await fs.writeFile(d.storagePath,JSON.stringify({[d.root]:{version:2,sessionId:'session-foreign'}}));
  s=d.makeService();result=await s.getModels({cwd:d.root});assert.equal(result.sessionId,'session-learning-2');
  assert(!d.followed.includes('session-foreign'));assert(!d.followed.includes('session-old-task'));
});

test('Explicitly selected folder history is registered to its native workspace and restored',async t=>{
  const d=await desktop(t),s=d.makeService();d.items.push({sessionId:'session-chosen-history',cwd:d.root});
  await s.selectSession({cwd:d.root,sessionId:'session-chosen-history'});
  assert(d.workspace.sessionIds.includes('session-chosen-history'));
  assert.deepEqual(d.calls.find(c=>c.method==='session/create').args.request,{workspaceId:d.workspace.workspaceId,sessionId:'session-chosen-history'});
  await s.dispose();const restarted=d.makeService();
  assert.equal((await restarted.getModels({cwd:d.root})).sessionId,'session-chosen-history');
  assert.equal(d.calls.filter(c=>c.method==='session/create').length,1);
});

test('Foreign sessions and relative roots are rejected before attaching or persisting',async t=>{
  const d=await desktop(t),s=d.makeService();d.items.push({sessionId:'foreign',cwd:path.join(d.root,'other')});
  await assert.rejects(s.attach(d.root,'foreign'),/当前学习文件夹/);
  await assert.rejects(s.selectSession({cwd:d.root,sessionId:'foreign'}),/当前学习文件夹/);
  await assert.rejects(s.newSession({cwd:'.'}),/绝对路径/);
  await assert.rejects(s.getModels({cwd:''}),/绝对路径/);
  assert.equal(d.followed.length,0);assert.equal(s.sessions.size,0);
  assert(!d.calls.some(c=>c.method==='workspace/create'||c.method==='session/create'));
});

test('New sessions register immediately; a moved session cannot receive the next prompt',async t=>{
  const d=await desktop(t),s=d.makeService();const result=await s.newSession({cwd:d.root});
  assert(d.workspace.sessionIds.includes(result.sessionId));
  await s.send({cwd:d.root,text:'继续学习'});
  const prompts=d.calls.filter(c=>c.method==='session/prompt');assert.equal(prompts.length,1);assert.equal(prompts[0].args.request.sessionId,result.sessionId);
  d.items.find(item=>item.sessionId===result.sessionId).cwd=path.join(d.root,'other');
  await assert.rejects(s.send({cwd:d.root,text:'下一题'}),/不属于学习文件夹/);
  assert.equal(d.calls.filter(c=>c.method==='session/prompt').length,1);
});

test('A native workspace with the wrong path is rejected before session creation',async t=>{
  const d=await desktop(t),s=d.makeService();d.workspace.path=path.join(d.root,'other');
  await assert.rejects(s.newSession({cwd:d.root}),/工作区路径/);
  assert(!d.calls.some(c=>c.method==='session/create'));assert.equal(d.followed.length,0);
});
