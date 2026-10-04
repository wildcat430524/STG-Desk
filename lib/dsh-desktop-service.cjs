const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const yaml=require('js-yaml');
const WebSocket=require('ws');

const modelId=s=>s?JSON.stringify([s.provider,s.model]):null;
const sameCwd=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function localUrl(value){const u=new URL(value||'http://127.0.0.1:19387');if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw new Error('DSH 桌面连接地址必须是本机 HTTP 地址。');return u.origin;}
// Reuse the local user's Desktop browser grant. Never export, log or persist it.
async function desktopCookie(base,home){
  let document;try{document=yaml.load(await fs.readFile(path.join(home,'.credentials.yaml'),'utf8'));}catch{throw new Error('无法读取 DSH 桌面连接授权，请先打开 DSH。');}
  const record=document?.records?.['client-connection/browser-session'];
  if(record?.kind!=='grant'||record.payload?.version!==1||typeof record.payload.secret!=='string')throw new Error('DSH 尚未建立桌面连接授权，请先打开 DSH。');
  const secret=Buffer.from(record.payload.secret,'base64url');if(secret.length!==32)throw new Error('DSH 桌面连接授权格式不兼容。');
  const authority=new URL(base).host,issuedAt=Date.now();
  const body=Buffer.from(JSON.stringify({version:1,authority,issuedAt,expiresAt:issuedAt+3600000})).toString('base64url');
  return 'dsh-auth-'+crypto.createHash('sha256').update(authority).digest('base64url')+'=v1.'+body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');
}
async function desktopRunning(){
  if(process.platform!=='win32')return false;
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[bool](Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0})"],{windowsHide:true});
  return stdout.trim().toLowerCase()==='true';
}
function messagesFromEvents(events){
  const visible=[];
  for(const e of events){
    if(!['user/message','assistant/message'].includes(e.type)||e.surfaceOp===undefined)continue;
    if(e.surfaceOp!=='append')continue;
    const data=e.data?.message||e.data;
    const text=(data?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n\n').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g,'').replace(/\n\n<STG学习上下文>[\s\S]*<\/STG学习上下文>\s*$/,'').trim();
    if(text)visible.push({seq:e.seq,id:'dsh:'+e.seq,role:e.type==='user/message'?'user':'assistant',text});
  }
  return visible;
}
class DshDesktopService{
  constructor(options={}){this.onEvent=options.onEvent||(()=>{});this.storagePath=options.storagePath;this.home=options.home||process.env.DSH_HOME||path.join(os.homedir(),'.dsh');this.base=localUrl(options.base||process.env.STG_DSH_DESKTOP_URL);this.running=options.running||desktopRunning;this.fetch=options.fetch||globalThis.fetch;this.WebSocket=options.WebSocket||WebSocket;this.sessions=new Map();this.events=[];this.disposed=false;this.restored=this.restore();}
  emit(event){if(!this.disposed)this.onEvent({...event,cwd:this.cwd});}
  async restore(){try{const d=JSON.parse(await fs.readFile(this.storagePath,'utf8'));for(const [cwd,id]of Object.entries(d))if(typeof id==='string')this.sessions.set(cwd,id);}catch{}}
  async persist(){if(!this.storagePath)return;await fs.mkdir(path.dirname(this.storagePath),{recursive:true});const tmp=this.storagePath+'.tmp';await fs.writeFile(tmp,JSON.stringify(Object.fromEntries(this.sessions)));await fs.rename(tmp,this.storagePath);}
  async auth(){if(!await this.running())throw new Error('DSH 未打开，请打开 DSH 桌面应用后连接。');this.cookie=await desktopCookie(this.base,this.home);}
  async rpc(method,args={}){
    if(!this.cookie)await this.auth();
    let response;try{response=await this.fetch(this.base+'/api/'+method,{method:'POST',headers:{'content-type':'application/json',cookie:this.cookie},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}}),signal:AbortSignal.timeout(15000)});}catch{throw new Error('无法连接 DSH 桌面端，请确认 DSH 已打开。');}
    if(!response.ok){this.cookie=null;throw new Error(response.status===401?'DSH 连接授权已失效，请重新连接。':'DSH 桌面接口暂时不可用。');}
    const data=await response.json();if(!data.result?.ok)throw new Error(data.result?.error?.message||'DSH 桌面请求失败');return data.result.value;
  }
  async getStatus(){try{await this.auth();await this.rpc('session/modelCatalog');return {available:true,message:'已连接 · DSH 桌面同步'};}catch(e){return {available:false,message:e.message};}}
  async listSessions({cwd}){const data=await this.rpc('session/list',{_request:{}});return data.items.filter(s=>!s.parentSessionId&&s.origin!=='subagent'&&sameCwd(s.cwd||'.',cwd)).map(s=>({id:s.sessionId,title:s.projections?.values?.title||'DSH 会话',running:s.running,updatedAt:s.updatedAt}));}
  async getModels({cwd}){
    await this.restored;await this.auth();this.cwd=cwd;
    const [catalog,sessions]=await Promise.all([this.rpc('session/modelCatalog'),this.listSessions({cwd})]);
    this.models=catalog.groups.flatMap(g=>g.models.map(m=>({id:modelId({provider:g.id,model:m.id}),label:m.name||m.id,provider:g.name||g.id,providerId:g.id,modelId:m.id,reasoning:m.reasoning})));
    this.defaultSelection=catalog.default;
    // Desktop's ordinary create route uses session- IDs; prefer it over old ACP UUID sessions.
    let id=this.sessions.get(cwd);if(!sessions.some(s=>s.id===id))id=(sessions.find(s=>s.id.startsWith('session-'))||sessions[0])?.id;
    if(!id){const created=await this.rpc('session/create',{request:{cwd}});id=created.sessionId;}
    await this.attach(cwd,id);
    return {models:this.models,selectedModel:modelId(this.selection||catalog.default),sessionId:id,sessions,message:'已连接 · DSH 桌面同步'};
  }
  async attach(cwd,id){
    const previous=this.socket;this.socket=null;previous?.close();this.partial=null;this.cwd=cwd;this.id=id;this.sessions.set(cwd,id);await this.persist();
    const projections=await this.rpc('session/projections',{request:{sessionId:id}});
    this.events=[];this.selection=projections?.values?.modelSelection?.next||this.defaultSelection;
    await this.follow(id);
    clearInterval(this.health);this.health=setInterval(()=>this.checkHealth().catch(()=>{}),3000);this.health.unref?.();
  }
  async checkHealth(){if(!await this.running()){this.socket?.close();this.emit({type:'sync',connected:false,busy:false,status:'DSH 已关闭，打开后重新连接'});clearInterval(this.health);}}
  follow(id){return new Promise((resolve,reject)=>{
    const socket=new this.WebSocket(this.base.replace(/^http/,'ws')+'/api/remote.mux',{headers:{cookie:this.cookie}});this.socket=socket;const streamId=crypto.randomUUID();let opened=false;
    socket.on('open',()=>{opened=true;socket.send(JSON.stringify({type:'open',streamId,endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId:id},assistantStream:true,maxMessages:Number.MAX_SAFE_INTEGER}}}}));});
    socket.on('message',bytes=>{if(this.socket!==socket)return;try{const envelope=JSON.parse(bytes);if(envelope.type==='error'){this.emit({type:'sync',connected:false,busy:false,status:envelope.error?.message||'DSH 同步失败'});reject(new Error(envelope.error?.message||'DSH 同步失败'));return;}if(envelope.type==='item'){this.accept(envelope.value);if(envelope.value?.type==='snapshot')resolve();}}catch(e){this.emit({type:'error',message:'DSH 同步数据无法解析：'+e.message});}});
    socket.on('error',()=>{if(!opened)reject(new Error('DSH 实时会话连接失败'));});
    socket.on('close',()=>{if(!opened)reject(new Error('DSH 实时会话连接失败'));if(this.socket===socket&&!this.disposed)this.emit({type:'sync',connected:false,busy:false,status:'DSH 连接已断开，请重新连接'});});
  });}
  accept(value){
    if(value?.type==='snapshot'){this.events=(value.records||[]).map(r=>r.event||r).filter(r=>typeof r.seq==='number');this.selection=value.projections?.values?.modelSelection?.next||this.events.findLast(e=>e.type==='model/selection')?.data||this.events.findLast(e=>e.type==='request/header')?.data?.header?.config||this.selection;const attempt=value.assistantStream?.activeAttempt;this.partial=attempt?{id:'live:'+attempt.attemptId,role:'assistant',attemptId:attempt.attemptId,text:(attempt.stream||[]).map(r=>r.type==='text-chunks'?r.texts.join(''):r.type==='chunk'&&r.chunk.type==='text-delta'?r.chunk.text:'').join('')}:null;this.emit({type:'sync',sessionId:this.id,messages:[...messagesFromEvents(this.events),...(this.partial?.text?[this.partial]:[])],model:modelId(this.selection),title:value.projections?.values?.title,busy:!!attempt||this.events.findLast(e=>['turn/start','turn/end'].includes(e.type))?.type==='turn/start',connected:true});return;}
    if(value?.type==='assistant-stream'){
      const f=value.frame;
      if(f.type==='start')this.partial={id:'live:'+f.attemptId,role:'assistant',text:'',attemptId:f.attemptId};
      if(f.type==='chunk'&&this.partial?.attemptId===f.attemptId&&f.chunk?.type==='text-delta')this.partial.text+=f.chunk.text;
      if(f.type==='end')this.partial=null;
      if(this.partial?.text)this.emit({type:'sync',messages:[...messagesFromEvents(this.events),this.partial],busy:true,connected:true});
      return;
    }
    const event=value?.event||value?.record?.event||value?.record;
    if(event?.type){
      if(!this.events.some(e=>e.seq===event.seq))this.events.push(event);
      if(event.type==='model/selection')this.selection=event.data;
      if(['assistant/message','turn/end'].includes(event.type))this.partial=null;
      if(['user/message','assistant/message','model/selection','session/title','turn/start','turn/end'].includes(event.type))this.emit({type:'sync',messages:[...messagesFromEvents(this.events),...(this.partial?.text?[this.partial]:[])],model:modelId(this.selection),title:event.type==='session/title'?event.data.title:undefined,busy:this.events.findLast(e=>['turn/start','turn/end'].includes(e.type))?.type==='turn/start',connected:true});
    }
  }
  async selectModel({cwd,model}){if(!this.models?.some(m=>m.id===model))throw new Error('这个模型当前不可用');if(this.cwd!==cwd)await this.getModels({cwd});if(modelId(this.selection)===model)return;const [provider,selected]=JSON.parse(model),m=this.models.find(m=>m.id===model),effort=this.selection?.reasoningEffort;const reasoningEffort=m.reasoning?.efforts?.some(e=>e.id===effort)?effort:m.reasoning?.defaultEffort;const result=await this.rpc('session/selectModel',{request:{sessionId:this.id,provider,model:selected,...reasoningEffort?{reasoningEffort}:{}}});this.selection=result.selected;this.emit({type:'sync',model:modelId(this.selection),connected:true});}
  async send({cwd,text,model,context}){await this.auth();if(this.cwd!==cwd||!this.id)await this.getModels({cwd});if(model)await this.selectModel({cwd,model});const requestId=crypto.randomUUID();const documents=context?.documents||[];const prompt=documents.length?text+'\n\n<STG学习上下文>\n以下为已保存、与当前课程相关的文档；学生作答仅使用已提交内容。\n'+documents.map(d=>`\n文档：${d.path} (${d.role}, ${d.access})\n${d.content}`).join('\n')+'\n</STG学习上下文>':text;await this.rpc('session/prompt',{request:{sessionId:this.id,requestId,mode:'queue',content:[{type:'text',text:prompt}],clientTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}});return {sessionId:this.id,requestId};}
  async cancel(){await this.rpc('session/cancel',{request:{sessionId:this.id}});}
  async selectSession({cwd,sessionId}){const list=await this.listSessions({cwd});if(!list.some(s=>s.id===sessionId))throw new Error('请选择当前学习文件夹的 DSH 会话。');await this.attach(cwd,sessionId);}
  async newSession({cwd}){await this.auth();const result=await this.rpc('session/create',{request:{cwd}});await this.attach(cwd,result.sessionId);return result;}
  async dispose(){this.disposed=true;clearInterval(this.health);this.socket?.close();this.cookie=null;}
}
module.exports={DshDesktopService,desktopCookie,localUrl,messagesFromEvents,modelId};
