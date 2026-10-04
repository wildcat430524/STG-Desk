import './dsh-panel.css';

export function mountDsh({api,renderMD,escape,icon,dshOnly=false}){
  const host=document.querySelector('#dsh-host');
  if(!host)return;
  const dockIcon=icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',16);
  const floatIcon=icon('<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 19h12V9"/>',16);
  host.innerHTML=`<header class="dsh-header"><span class="dsh-logo">DS</span><div class="dsh-heading"><strong id="dsh-title">DSH 导师</strong><small id="dsh-status">尚未连接</small></div><div class="dsh-window-actions"><button id="dsh-detach" title="独立小窗" aria-label="独立小窗">${floatIcon}</button><button id="dsh-pin" class="${dshOnly?'':'hidden'}" title="置顶" aria-label="置顶">${icon('<path d="M9 3h6l-1 5 4 4H6l4-4ZM12 12v9"/>',16)}</button><button id="dsh-more" title="更多" aria-label="更多">${icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',16)}</button><button id="dsh-close" title="收起 DSH" aria-label="收起 DSH">${icon('<path d="m6 6 12 12M18 6 6 18"/>',16)}</button></div></header><div id="dsh-more-menu" class="dsh-more-menu hidden"><button id="dsh-reconnect">重新连接</button><button id="dsh-new">新会话</button></div><div class="dsh-conversation" id="dsh-conversation" role="log" aria-label="当前 DSH 会话"><div id="dsh-context" class="dsh-context hidden"></div><div id="dsh-messages"></div></div><div class="dsh-composer"><div class="dsh-input-box"><textarea id="dsh-input" rows="2" placeholder="提问，或告诉导师你的学习目标…" aria-label="发送给 DSH 的消息"></textarea><div class="dsh-input-tools"><button id="dsh-quote" title="引用当前文档" aria-label="引用当前文档">＋</button><select id="dsh-model" aria-label="切换模型" title="切换模型"><option value="">连接后选择模型</option></select><button id="dsh-send" disabled>发送 ${icon('<path d="M4 12h15m-6-6 6 6-6 6"/>',13)}</button></div></div></div>`;
  const $=id=>host.querySelector('#'+id);
  if(dshOnly){
    host.querySelector('.dsh-logo').remove();
    const leading=document.createElement('div');leading.className='dsh-leading-actions';
    const minimize=document.createElement('button');minimize.id='dsh-minimize';minimize.title='最小化';minimize.setAttribute('aria-label','最小化');minimize.innerHTML=icon('<path d="M5 12h14"/>',18);
    leading.append(minimize,$('dsh-pin'),$('dsh-detach'));host.querySelector('.dsh-header').prepend(leading);
    minimize.onclick=()=>api.dshMinimize().catch(showError);
    $('dsh-input').placeholder='发消息，或继续当前对话…';
  }
  const modelIcon=document.createElement('span');modelIcon.className='dsh-model-icon';modelIcon.setAttribute('aria-hidden','true');modelIcon.innerHTML=icon('<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5H4l1.8-4.2A8.5 8.5 0 1 1 21 11.5Z"/>',16);$('dsh-model').before(modelIcon);
  const sessionSelect=document.createElement('select');sessionSelect.id='dsh-session';sessionSelect.setAttribute('aria-label','选择同步的 DSH 会话');sessionSelect.title='选择当前学习文件夹的 DSH 会话';
  $('dsh-more-menu').prepend(sessionSelect);
  const openDesktop=document.createElement('button');openDesktop.id='dsh-open-desktop';openDesktop.textContent='打开 DSH 桌面应用';$('dsh-more-menu').prepend(openDesktop);
  const connectBar=document.createElement('div');connectBar.className='dsh-connect-bar';connectBar.innerHTML='<span>打开 DSH，与桌面端共用会话</span><button id="dsh-launch-desktop">打开 DSH</button><button id="dsh-connect-now">连接</button>';host.querySelector('.dsh-composer').before(connectBar);
  const input=$('dsh-input'),select=$('dsh-model'),messages=$('dsh-messages'),conversation=$('dsh-conversation');
  let current={},lastMessages='',lastModels='',composing=false,preparing=false;
  const readableError=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
  const showError=e=>{$('dsh-status').textContent=readableError(e);};
  function controls(){const busy=current.busy||preparing,button=$('dsh-send');button.disabled=!busy&&(!input.value.trim()||!current.root||!current.connected);const key=String(!!busy);if(button.dataset.busy!==key){button.dataset.busy=key;button.innerHTML=busy?icon('<rect x="7" y="7" width="10" height="10" rx="2"/>',18):icon('<path d="M12 19V5m-6 6 6-6 6 6"/>',19);button.title=busy?'停止回复':'发送消息';button.setAttribute('aria-label',button.title);}host.dataset.busy=key;select.disabled=busy||!current.connected||!(current.models?.length);input.disabled=preparing;sessionSelect.disabled=busy||!current.connected;connectBar.classList.toggle('hidden',!!current.connected);}
  function show(state){
    current=state;
    host.dataset.connected=String(!!state.connected);
    const visible=dshOnly||state.visible&&state.mode!=='floating';host.classList.toggle('hidden',!visible);
    document.body.classList.toggle('dsh-open',visible&&!dshOnly);
    const launch=document.querySelector('#open-dsh');if(launch)launch.innerHTML=state.mode==='floating'&&state.visible?'显示 DSH 小窗 ↗':visible?(state.connected?'DSH 已连接':'连接 DSH'):'打开 DSH 面板 ↗';
    $('dsh-title').textContent=state.title||'DSH 导师';$('dsh-status').textContent=state.status||'尚未连接';
    $('dsh-title').title=state.title||'DSH 导师';$('dsh-status').title=state.status||'尚未连接';
    const sessions=state.sessions||[];const sessionsKey=JSON.stringify(sessions);
    if(sessionSelect.dataset.key!==sessionsKey){sessionSelect.dataset.key=sessionsKey;sessionSelect.replaceChildren();for(const s of sessions){const o=document.createElement('option');o.value=s.id;o.textContent=s.title;sessionSelect.append(o);}if(!sessions.length){const o=document.createElement('option');o.textContent='连接后选择同步会话';o.value='';sessionSelect.append(o);}}
    if(state.sessionId)sessionSelect.value=state.sessionId;
    $('dsh-detach').innerHTML=dshOnly?dockIcon:floatIcon;$('dsh-detach').title=dshOnly?'停靠回主窗口':'独立小窗';$('dsh-detach').setAttribute('aria-label',$('dsh-detach').title);
    $('dsh-pin').classList.toggle('active',!!state.pinned);
    $('dsh-pin').setAttribute('aria-pressed',String(!!state.pinned));
    if(input.value!==(state.draft||'')&&(document.activeElement!==input||preparing))input.value=state.draft||'';
    const modelKey=JSON.stringify(state.models||[]);
    if(modelKey!==lastModels){lastModels=modelKey;select.innerHTML='';const groups=new Map();for(const model of state.models||[]){const provider=model.provider||'DSH';let group=groups.get(provider);if(!group){group=document.createElement('optgroup');group.label=provider;groups.set(provider,group);select.append(group);}const option=document.createElement('option');option.value=model.id;option.textContent=model.label||model.id;group.append(option);}if(!select.options.length){const option=document.createElement('option');option.textContent='连接后选择模型';option.value='';select.append(option);}}
    if(state.model&&[...select.options].some(o=>o.value===state.model))select.value=state.model;
    const context=$('dsh-context');context.classList.toggle('hidden',!state.contextLabel);context.textContent=state.contextLabel?'引用：'+state.contextLabel:'';
    const contentKey=JSON.stringify({messages:state.messages||[],root:state.root});
    if(contentKey!==lastMessages){const atBottom=conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<45;lastMessages=contentKey;messages.innerHTML=state.messages?.length?state.messages.map(m=>`<section class="dsh-message ${m.role==='user'?'user':m.role==='error'?'error':'assistant'}"><small>${m.role==='user'?'你':m.role==='error'?'连接提示':'DSH'}</small><div class="dsh-message-text ${m.role==='user'?'':'markdown-body'}">${m.role==='user'?escape(m.text).replace(/\n/g,'<br>'):renderMD(m.text,state.contextPath||'')}</div></section>`).join(''):`<div class="dsh-empty"><span>DSH</span><h3>在这里继续学习</h3><p>${state.root?'可以询问当前课程，或告诉导师你的学习目标。':'先导入学习文件夹，DSH 会关联当前所需文档。'}</p></div>`;if(atBottom)conversation.scrollTop=conversation.scrollHeight;}
    controls();
  }
  async function send(){if(composing)return;if(current.busy){await api.dshCancel();return;}if(preparing||!input.value.trim()||!current.root)return;const text=input.value;preparing=true;controls();try{await api.dshDraft(text);await api.dshSend({text,model:select.value||null});}catch(e){showError(e);}finally{preparing=false;controls();}}
  input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>composing=false);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&!composing){e.preventDefault();send().catch(showError);}});
  input.addEventListener('input',()=>{controls();api?.dshDraft(input.value).catch(showError);input.style.height='auto';input.style.height=Math.min(148,input.scrollHeight)+'px';});
  $('dsh-send').onclick=()=>send().catch(showError);
  select.onchange=()=>api.dshModel(select.value).catch(showError);
  sessionSelect.onchange=()=>api.dshSession(sessionSelect.value).catch(showError);
  const launchDesktop=()=>api.dshOpenDesktop().then(()=>{setTimeout(()=>api.dshConnect().catch(showError),1800);}).catch(showError);
  openDesktop.onclick=launchDesktop;$('dsh-launch-desktop').onclick=launchDesktop;$('dsh-connect-now').onclick=()=>api.dshConnect().catch(showError);
  $('dsh-detach').onclick=()=>api.dshMode(dshOnly?'docked':'floating').catch(showError);
  $('dsh-close').onclick=()=>api.dshVisible(false).catch(showError);
  $('dsh-pin').onclick=()=>api.dshPin(!current.pinned).catch(showError);
  $('dsh-more').onclick=()=> $('dsh-more-menu').classList.toggle('hidden');
  $('dsh-reconnect').onclick=()=>{ $('dsh-more-menu').classList.add('hidden');api.dshConnect().catch(showError);};
  $('dsh-new').onclick=()=>{ $('dsh-more-menu').classList.add('hidden');if(!current.busy&&window.confirm('在 DSH 中开始新会话？当前对话仍保留在 DSH 历史中。'))api.dshNew().catch(showError);};
  $('dsh-quote').onclick=()=>api.dshQuote().catch(showError);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$('dsh-more-menu').classList.add('hidden');});
  document.querySelector('#open-dsh')?.addEventListener('click',()=>api?.dshVisible(true).catch(showError));
  api?.onDshState(show);api?.dshState().then(show).catch(showError);
  if(!api)show({status:'请使用桌面应用连接 DSH',messages:[],models:[]});
}
