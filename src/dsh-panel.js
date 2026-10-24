import './dsh-panel.css';
import {mountConversation} from './dsh-conversation';
import {onEscape,isComposing} from './ui-interactions';
import {mountModelPicker} from './model-picker';
import {i18n, localizeRoleLabel} from './i18n.js';
import './model-picker.css';

export function mountDsh({api,renderMD,escape,icon,dshOnly=false}){
  const host=document.querySelector('#dsh-host');
  if(!host)return;
  const t=(key,params)=>i18n.t(key,params);
  const dockIcon=icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',16);
  const floatIcon=icon('<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 19h12V9"/>',16);
  host.innerHTML=`<header class="dsh-header"><span class="dsh-logo">DS</span><div class="dsh-heading"><strong id="dsh-title">${t('dsh.title')}</strong><small id="dsh-status">${t('dsh.status.notConnected')}</small></div><div class="dsh-window-actions"><button id="dsh-detach" data-i18n-title="dsh.detach" data-i18n-aria-label="dsh.detach" title="${escape(t('dsh.detach'))}" aria-label="${escape(t('dsh.detach'))}">${floatIcon}</button><button id="dsh-pin" class="${dshOnly?'':'hidden'}" data-i18n-title="dsh.pin" data-i18n-aria-label="dsh.pin" title="${escape(t('dsh.pin'))}" aria-label="${escape(t('dsh.pin'))}">${icon('<path d="M9 3h6l-1 5 4 4H6l4-4ZM12 12v9"/>',16)}</button><button id="dsh-more" data-i18n-title="dsh.more" data-i18n-aria-label="dsh.more" title="${escape(t('dsh.more'))}" aria-label="${escape(t('dsh.more'))}">${icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',16)}</button><button id="dsh-close" data-i18n-title="dsh.close" data-i18n-aria-label="dsh.close" title="${escape(t('dsh.close'))}" aria-label="${escape(t('dsh.close'))}">${icon('<path d="m6 6 12 12M18 6 6 18"/>',16)}</button></div></header><div id="dsh-more-menu" class="dsh-more-menu hidden"><button id="dsh-reconnect" data-i18n="dsh.reconnect">${t('dsh.reconnect')}</button><button id="dsh-new" data-i18n="dsh.newSession">${t('dsh.newSession')}</button></div><div class="dsh-conversation" id="dsh-conversation" role="log" aria-label="${escape(t('dsh.currentSession'))}"><div id="dsh-context" class="dsh-context hidden"></div><div id="dsh-messages"></div></div><div class="dsh-composer"><div class="dsh-input-box"><textarea id="dsh-input" rows="2" placeholder="${escape(t(dshOnly?'dsh.placeholderFloating':'dsh.placeholderDocked'))}" aria-label="${escape(t('dsh.inputAria'))}"></textarea><div class="dsh-input-tools"><select id="dsh-model" aria-label="${escape(t('dsh.modelAria'))}" title="${escape(t('dsh.modelAria'))}"><option value="">${t('dsh.modelPlaceholder')}</option></select><button id="dsh-send" disabled>${t('dsh.send')} ${icon('<path d="M4 12h15m-6-6 6 6-6 6"/>',13)}</button></div></div></div>`;
  const $=id=>host.querySelector('#'+id);
  if(dshOnly){
    host.querySelector('.dsh-logo').remove();
    const leading=document.createElement('div');leading.className='dsh-leading-actions';
    const minimize=document.createElement('button');minimize.id='dsh-minimize';minimize.title=t('dsh.minimize');minimize.setAttribute('aria-label',t('dsh.minimize'));minimize.innerHTML=icon('<path d="M5 12h14"/>',18);
    leading.append(minimize,$('dsh-pin'),$('dsh-detach'));host.querySelector('.dsh-header').prepend(leading);
    minimize.onclick=()=>api.dshMinimize().catch(showError);
  }
  const modelIcon=document.createElement('span');modelIcon.className='dsh-model-icon';modelIcon.setAttribute('aria-hidden','true');modelIcon.innerHTML=icon('<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5H4l1.8-4.2A8.5 8.5 0 1 1 21 11.5Z"/>',16);$('dsh-model').before(modelIcon);
  const sessionSelect=document.createElement('select');sessionSelect.id='dsh-session';sessionSelect.setAttribute('aria-label',t('dsh.sessionAria'));sessionSelect.title=t('dsh.sessionTitle');
  $('dsh-more-menu').prepend(sessionSelect);
  const workspaceLabel=document.createElement('div');workspaceLabel.id='dsh-workspace';workspaceLabel.className='dsh-context';host.querySelector('.dsh-header').after(workspaceLabel);
  const openDesktop=document.createElement('button');openDesktop.id='dsh-open-desktop';openDesktop.textContent=t('dsh.openDesktop');$('dsh-more-menu').prepend(openDesktop);
  const connectBar=document.createElement('div');connectBar.className='dsh-connect-bar';connectBar.innerHTML=`<span>${t('dsh.connectBar')}</span><button id="dsh-launch-desktop">${t('header.openDsh')}</button><button id="dsh-connect-now">${t('dsh.connectNow')}</button>`;host.querySelector('.dsh-composer').before(connectBar);
  const input=$('dsh-input'),select=$('dsh-model'),messages=$('dsh-messages'),conversation=$('dsh-conversation');
  const feed=mountConversation({conversation,messages,renderMD,escape});
  $('dsh-status').setAttribute('role','status');
  $('dsh-more').setAttribute('aria-expanded','false');$('dsh-more').setAttribute('aria-controls','dsh-more-menu');
  let current={},lastModels='',composing=false,preparing=false;
  const fitInput=()=>{input.style.height='auto';input.style.height=Math.min(148,input.scrollHeight)+'px';};
  const readableError=e=>String(e?.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
  const showError=e=>{$('dsh-status').textContent=readableError(e);};
  const modelPicker=mountModelPicker({select,icon,onChange:model=>api.dshModel(model),onError:showError});
  function controls(){const busy=current.busy||preparing,button=$('dsh-send');button.disabled=!busy&&(!input.value.trim()||!current.root||!current.connected);const key=String(!!busy);if(button.dataset.busy!==key){button.dataset.busy=key;button.innerHTML=busy?icon('<rect x="7" y="7" width="10" height="10" rx="2"/>',18):icon('<path d="M12 19V5m-6 6 6-6 6 6"/>',19);}button.title=busy?t('dsh.stop'):t('dsh.sendTitle');button.setAttribute('aria-label',button.title);host.dataset.busy=key;select.disabled=busy||!current.connected||!(current.models?.length);modelPicker.sync((current.root||'')+'\0'+(current.sessionId||''));input.disabled=preparing;sessionSelect.disabled=busy||!current.connected;connectBar.classList.toggle('hidden',!!current.connected);}
  function show(state){
    current=state;
    workspaceLabel.textContent=state.root?t('dsh.workspace',{path:state.root}):t('dsh.noWorkspace');
    workspaceLabel.title=state.root||'';
    host.dataset.connected=String(!!state.connected);
    const visible=dshOnly||state.visible&&state.mode!=='floating';host.classList.toggle('hidden',!visible);
    document.body.classList.toggle('dsh-open',visible&&!dshOnly);
    const launch=document.querySelector('#open-dsh');if(launch)launch.querySelector('.dsh-launch-label').textContent=state.mode==='floating'&&state.visible?t('dsh.launch.floating'):visible?(state.connected?t('dsh.launch.connected'):t('dsh.launch.connect')):t('dsh.launch.docked');
    const title=state.title||t('dsh.title'),status=state.status||t('dsh.status.notConnected');
    $('dsh-title').textContent=title;$('dsh-status').textContent=status;
    $('dsh-title').title=title;$('dsh-status').title=status;
    const sessions=state.sessions||[];const sessionsKey=JSON.stringify(sessions);
    if(sessionSelect.dataset.key!==sessionsKey){sessionSelect.dataset.key=sessionsKey;sessionSelect.replaceChildren();for(const s of sessions){const o=document.createElement('option');o.value=s.id;o.textContent=s.title;sessionSelect.append(o);}if(!sessions.length){const o=document.createElement('option');o.textContent=t('dsh.sessionPlaceholder');o.value='';sessionSelect.append(o);}}
    if(state.sessionId)sessionSelect.value=state.sessionId;
    $('dsh-detach').innerHTML=dshOnly?dockIcon:floatIcon;$('dsh-detach').title=dshOnly?t('dsh.dock'):t('dsh.detach');$('dsh-detach').setAttribute('aria-label',$('dsh-detach').title);
    $('dsh-pin').classList.toggle('active',!!state.pinned);
    $('dsh-pin').setAttribute('aria-pressed',String(!!state.pinned));
    if(input.value!==(state.draft||'')&&(document.activeElement!==input||preparing)){input.value=state.draft||'';fitInput();}
    const modelKey=JSON.stringify(state.models||[]);
    if(modelKey!==lastModels){lastModels=modelKey;select.innerHTML='';const groups=new Map();for(const model of state.models||[]){const provider=model.provider||'DSH';let group=groups.get(provider);if(!group){group=document.createElement('optgroup');group.label=provider;groups.set(provider,group);select.append(group);}const option=document.createElement('option');option.value=model.id;option.textContent=model.label||model.id;group.append(option);}if(!select.options.length){const option=document.createElement('option');option.textContent=t('dsh.modelPlaceholder');option.value='';select.append(option);}}
    if(state.model&&[...select.options].some(o=>o.value===state.model))select.value=state.model;
    const context=$('dsh-context');context.classList.toggle('hidden',!state.contextLabel);context.textContent=state.contextLabel?t('dsh.contextPrefix',{label:localizeRoleLabel(state.contextLabel,t)}):'';
    feed.show(state);
    controls();
  }
  async function send(){if(composing)return;if(current.busy){await api.dshCancel();return;}if(preparing||!input.value.trim()||!current.root)return;const text=input.value;preparing=true;controls();try{await api.dshDraft(text);await api.dshSend({text,model:select.value||null});}catch(e){showError(e);}finally{preparing=false;controls();}}
  input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>composing=false);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&!composing){e.preventDefault();send().catch(showError);}});
  input.addEventListener('input',()=>{controls();api?.dshDraft(input.value).catch(showError);fitInput();});
  $('dsh-send').onclick=()=>send().catch(showError);
  sessionSelect.onchange=()=>api.dshSession(sessionSelect.value).catch(showError);
  const launchDesktop=()=>api.dshOpenDesktop().then(()=>{setTimeout(()=>api.dshConnect().catch(showError),1800);}).catch(showError);
  openDesktop.onclick=launchDesktop;$('dsh-launch-desktop').onclick=launchDesktop;$('dsh-connect-now').onclick=()=>api.dshConnect().catch(showError);
  $('dsh-detach').onclick=()=>api.dshMode(dshOnly?'docked':'floating').catch(showError);
  $('dsh-close').onclick=()=>api.dshVisible(false).catch(showError);
  $('dsh-pin').onclick=()=>api.dshPin(!current.pinned).catch(showError);
  const menu=$('dsh-more-menu'),more=$('dsh-more');
  function closeMenu(restore=false){menu.classList.add('hidden');more.setAttribute('aria-expanded','false');if(restore)more.focus({preventScroll:true});}
  more.onclick=()=>{const open=menu.classList.contains('hidden');menu.classList.toggle('hidden',!open);more.setAttribute('aria-expanded',String(open));if(open)menu.querySelector('button:not(:disabled),select:not(:disabled)')?.focus({preventScroll:true});};
  more.addEventListener('keydown',event=>{if(event.key==='ArrowDown'&&!isComposing(event)){event.preventDefault();if(menu.classList.contains('hidden'))more.click();}});
  menu.addEventListener('keydown',event=>{
    if(isComposing(event)||event.target.tagName==='SELECT')return;
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const items=[...menu.querySelectorAll('button:not(:disabled),select:not(:disabled)')],index=items.indexOf(document.activeElement);
    event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
  });
  onEscape(()=>!menu.classList.contains('hidden'),()=>closeMenu(true),300);
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target)&&!more.contains(event.target))closeMenu();});
  host.addEventListener('focusout',()=>queueMicrotask(()=>{if(!menu.contains(document.activeElement)&&document.activeElement!==more)closeMenu();}));
  $('dsh-reconnect').onclick=()=>{closeMenu();api.dshConnect().catch(showError);};
  $('dsh-new').onclick=()=>{closeMenu();if(!current.busy&&window.confirm(t('dsh.newConfirm')))api.dshNew().catch(showError);};
  document.querySelector('#open-dsh')?.addEventListener('click',()=>api?.dshVisible(true).catch(showError));
  api?.onDshState(show);api?.dshState().then(show).catch(showError);
  if(!api)show({status:t('dsh.webOnly'),messages:[],models:[]});
  // Repaint chrome without touching the conversation, the input draft or the
  // in-flight reply. State title/status come from DSH and stay as provided.
  i18n.subscribe(()=>{
    input.placeholder=t(dshOnly?'dsh.placeholderFloating':'dsh.placeholderDocked');
    input.setAttribute('aria-label',t('dsh.inputAria'));
    const launch=document.querySelector('#open-dsh');
    if(launch){const label=launch.querySelector('.dsh-launch-label');
      if(label)label.textContent=current.visible?(current.mode==='floating'?t('dsh.launch.floating'):current.connected?t('dsh.launch.connected'):t('dsh.launch.connect')):t('dsh.launch.docked');}
    $('dsh-detach').title=dshOnly?t('dsh.dock'):t('dsh.detach');$('dsh-detach').setAttribute('aria-label',$('dsh-detach').title);
    $('dsh-pin').title=t('dsh.pin');$('dsh-pin').setAttribute('aria-label',t('dsh.pin'));
    $('dsh-more').title=t('dsh.more');$('dsh-more').setAttribute('aria-label',t('dsh.more'));
    $('dsh-close').title=t('dsh.close');$('dsh-close').setAttribute('aria-label',t('dsh.close'));
    const minimize=host.querySelector('#dsh-minimize');if(minimize){minimize.title=t('dsh.minimize');minimize.setAttribute('aria-label',t('dsh.minimize'));}
    openDesktop.textContent=t('dsh.openDesktop');
    connectBar.querySelector('span').textContent=t('dsh.connectBar');
    $('dsh-launch-desktop').textContent=t('header.openDsh');
    $('dsh-connect-now').textContent=t('dsh.connectNow');
    sessionSelect.setAttribute('aria-label',t('dsh.sessionAria'));sessionSelect.title=t('dsh.sessionTitle');
    const emptySession=sessionSelect.querySelector('option[value=""]');if(emptySession)emptySession.textContent=t('dsh.sessionPlaceholder');
    $('dsh-model').setAttribute('aria-label',t('dsh.modelAria'));$('dsh-model').title=t('dsh.modelAria');
    if(current.root)workspaceLabel.textContent=t('dsh.workspace',{path:current.root});else workspaceLabel.textContent=t('dsh.noWorkspace');
    if(!current.title)$('dsh-title').textContent=t('dsh.title');
    if(current.contextLabel)$('dsh-context').textContent=t('dsh.contextPrefix',{label:localizeRoleLabel(current.contextLabel,t)});
    const sendButton=$('dsh-send');
    if(sendButton.dataset.busy){sendButton.title=t('dsh.stop');sendButton.setAttribute('aria-label',sendButton.title);}
    else{sendButton.title=t('dsh.sendTitle');sendButton.setAttribute('aria-label',sendButton.title);}
    feed.refreshLabels();
    controls();
  });
}
