const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {DshDesktopService,desktopCookie,localUrl,messagesFromEvents}=require('../lib/dsh-desktop-service.cjs');
const message=(seq,type,text)=>({seq,type,surfaceOp:'append',data:{message:{content:[{type:'text',text},{type:'reasoning',text:'private thought'}]}}});
test('Closed Desktop cannot connect or send; no background agent is launched',async()=>{
  let calls=0;const s=new DshDesktopService({running:async()=>false,fetch:async()=>{calls++;}});
  assert.equal((await s.getStatus()).available,false);
  await assert.rejects(s.send({cwd:os.tmpdir(),text:'hello'}),/未打开/);
  assert.equal(calls,0);await s.dispose();
});
test('Only loopback Desktop addresses are accepted',()=>{
  assert.equal(localUrl('http://127.0.0.1:19387'),'http://127.0.0.1:19387');
  for(const u of ['https://127.0.0.1','http://example.com','http://user:password@localhost','http://localhost?token=x'])assert.throws(()=>localUrl(u));
});
test('Human transcript keeps original messages through compaction and hides thoughts/context',()=>{
  const events=[message(1,'user/message','问题\n\n<STG学习上下文>saved docs</STG学习上下文>'),message(2,'assistant/message','回答'),{...message(3,'assistant/message','模型摘要'),surfaceOp:{kind:'replace',seqs:[1,2]}}];
  assert.deepEqual(messagesFromEvents(events).map(m=>m.text),['问题','回答']);
});
test('Native catalog, session history and model changes share Desktop RPC and retain reasoning',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'stg-native-test-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const secret=Buffer.alloc(32,7).toString('base64url');await fs.writeFile(path.join(home,'.credentials.yaml'),JSON.stringify({version:1,records:{'client-connection/browser-session':{kind:'grant',payload:{version:1,secret}}}}));
  const storage=path.join(home,'sessions.json'),calls=[],updates=[];
  await fs.writeFile(storage,JSON.stringify({[home]:{version:2,sessionId:'native-existing'}}));
  class Socket extends EventEmitter{
    constructor(){super();queueMicrotask(()=>this.emit('open'));}
    send(data){const d=JSON.parse(data);assert.equal(d.endpoint,'session/follow');assert.equal(d.payload.args.request.address.sessionId,'native-existing');queueMicrotask(()=>this.emit('message',Buffer.from(JSON.stringify({type:'item',streamId:d.streamId,value:{type:'snapshot',records:[{type:'event',event:message(1,'user/message','桌面端原来的问题')}],projections:{values:{modelSelection:{next:{provider:'buddy',model:'glm-5.3',reasoningEffort:'high'}}}}}}))));}
    close(){this.emit('close');}
  }
  const catalog={default:{provider:'buddy',model:'glm-5.3',reasoningEffort:'high'},groups:[{id:'buddy',name:'CodeBuddy',models:[{id:'glm-5.3',name:'GLM 5.3',reasoning:{efforts:[{id:'high'}],defaultEffort:'high'}},{id:'deepseek-v4-pro',reasoning:{efforts:[{id:'high'}],defaultEffort:'high'}}]},{id:'custom-provider',name:'自定义',models:[{id:'custom-model'}]}]};
  const fetch=async(url,options)=>{const request=JSON.parse(options.body);calls.push(request);const args=request.payload.args;const value=request.method==='session/modelCatalog'?catalog:request.method==='workspace/create'?{workspace:{workspaceId:'learning-workspace',path:home,sessionIds:['native-existing']}}:request.method==='session/list'?{items:[{sessionId:'native-existing',cwd:home,projections:{values:{title:'当前学习'}}},{sessionId:'child',cwd:home,origin:'subagent',parentSessionId:'native-existing'}]}:request.method==='session/projections'?{values:{modelSelection:{next:catalog.default}}}:request.method==='session/selectModel'?{selected:args.request}:{accepted:true};return {ok:true,json:async()=>({result:{ok:true,value}})};};
  const s=new DshDesktopService({home,storagePath:storage,running:async()=>true,fetch,WebSocket:Socket,onEvent:e=>updates.push(e)});t.after(()=>s.dispose());
  const r=await s.getModels({cwd:home});assert.equal(r.sessionId,'native-existing');assert.equal(r.models.length,3);assert(!calls.some(c=>c.method==='session/create'));assert.equal(updates.at(-1).messages[0].text,'桌面端原来的问题');
  await s.selectModel({cwd:home,model:'["buddy","deepseek-v4-pro"]'});const selection=calls.find(c=>c.method==='session/selectModel').payload.args.request;assert.equal(selection.sessionId,'native-existing');assert.equal(selection.reasoningEffort,'high');
  await s.send({cwd:home,text:'继续学习',model:'["buddy","deepseek-v4-pro"]'});assert.equal(calls.at(-1).method,'session/prompt');assert.equal(calls.at(-1).payload.args.request.mode,'queue');assert.equal(calls.at(-1).payload.args.request.sessionId,'native-existing');
  assert(!(await fs.readFile(storage,'utf8')).includes(secret));assert(!(await desktopCookie('http://127.0.0.1:19387',home)).includes(secret));
  await assert.rejects(s.selectSession({cwd:home,sessionId:'child'}),/当前学习文件夹/);
});
test('Streaming and messages sent in Desktop arrive once without reasoning leakage',async()=>{
  const updates=[],s=new DshDesktopService({onEvent:e=>updates.push(e)});
  s.accept({type:'snapshot',records:[],projections:{values:{}}});
  s.accept({type:'event',event:message(1,'user/message','从 DSH 发来的消息')});
  s.accept({type:'event',event:{seq:2,type:'turn/start'}});
  s.accept({type:'assistant-stream',frame:{type:'start',attemptId:'a'}});
  s.accept({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',chunk:{type:'reasoning-delta',text:'隐藏思考'}}});
  s.accept({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',chunk:{type:'text-delta',text:'同步回复'}}});
  assert.equal(updates.at(-1).messages.at(-1).text,'同步回复');
  s.accept({type:'event',event:message(3,'assistant/message','同步回复')});s.accept({type:'event',event:message(3,'assistant/message','同步回复')});s.accept({type:'event',event:{seq:4,type:'turn/end'}});
  assert.equal(updates.at(-1).messages.length,2);assert.equal(updates.at(-1).busy,false);assert(!JSON.stringify(updates).includes('隐藏思考'));await s.dispose();
});
