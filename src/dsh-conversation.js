import {copyText} from './editor-rich';
import {i18n} from './i18n.js';

// Keep existing text nodes and selections while the current reply changes.
function patchChildren(target,source){
  let current=target.firstChild;
  for(const next of [...source.childNodes]){
    if(!current){target.append(next.cloneNode(true));continue;}
    const after=current.nextSibling;
    if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName)current.replaceWith(next.cloneNode(true));
    else if(current.nodeType===Node.TEXT_NODE){if(current.data!==next.data)current.data=next.data;}
    else if(current.nodeType===Node.ELEMENT_NODE&&!current.dataset.copyState){
      for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
      for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
      patchChildren(current,next);
    }
    current=after;
  }
  while(current){const after=current.nextSibling;current.remove();current=after;}
}
function selectedOffsets(element){
  const selection=getSelection();if(!selection?.rangeCount||!element.contains(selection.anchorNode)||!element.contains(selection.focusNode))return null;
  const offset=(node,length)=>{const range=document.createRange();range.selectNodeContents(element);range.setEnd(node,length);return range.toString().length;};
  return [offset(selection.anchorNode,selection.anchorOffset),offset(selection.focusNode,selection.focusOffset)];
}
function restoreSelection(element,offsets){
  if(!offsets)return;
  const position=offset=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node,last;
    while((node=walker.nextNode())){last=node;if(offset<=node.length)return [node,offset];offset-=node.length;}
    return last?[last,last.length]:[element,0];
  };
  getSelection()?.setBaseAndExtent(...position(offsets[0]),...position(offsets[1]));
}

export function mountConversation({conversation,messages,renderMD,escape}){
  const t=(key,params)=>i18n.t(key,params);
  const jumpRow=document.createElement('div');jumpRow.className='dsh-jump-row';
  const jump=document.createElement('button');jump.id='dsh-jump-latest';jump.type='button';jump.className='hidden';jump.textContent=t('dsh.jump');jump.setAttribute('aria-label',t('dsh.jumpAria'));
  jumpRow.append(jump);conversation.after(jumpRow);
  conversation.tabIndex=-1;conversation.setAttribute('aria-relevant','additions');
  let entries=new Map(),scope=null,pinned=true,lastUserInput=-Infinity,lastTop=0,frame=0,intentTimer,lastState=null;
  const distance=()=>conversation.scrollHeight-conversation.clientHeight-conversation.scrollTop;
  const updateJump=()=>jump.classList.toggle('hidden',pinned||distance()<12);
  function scrollBottom(){conversation.scrollTop=conversation.scrollHeight;lastTop=conversation.scrollTop;pinned=true;updateJump();}
  function follow(){
    if(frame)return;
    frame=requestAnimationFrame(()=>{frame=0;if(pinned&&performance.now()-lastUserInput>150)scrollBottom();else updateJump();});
  }
  const userIntent=event=>{
    if(event.type==='wheel'&&event.deltaY===0)return;
    lastUserInput=performance.now();if(event.type!=='wheel'||event.deltaY<0)pinned=false;
    clearTimeout(intentTimer);intentTimer=setTimeout(()=>{if(distance()<=2){pinned=true;follow();}else updateJump();},170);
  };
  conversation.addEventListener('wheel',userIntent,{passive:true});
  conversation.addEventListener('touchstart',userIntent,{passive:true});
  conversation.addEventListener('pointerdown',event=>{if(event.target===conversation)userIntent(event);});
  conversation.addEventListener('keydown',event=>{if(['ArrowUp','PageUp','Home','ArrowDown','PageDown','End',' '].includes(event.key))userIntent(event);});
  conversation.addEventListener('scroll',()=>{
    const top=conversation.scrollTop;if(top<lastTop-1)pinned=false;
    if(distance()<=2&&performance.now()-lastUserInput>150)pinned=true;
    lastTop=top;updateJump();
  },{passive:true});
  jump.onclick=()=>{lastUserInput=-Infinity;scrollBottom();conversation.focus({preventScroll:true});};
  new ResizeObserver(follow).observe(messages);
  new ResizeObserver(follow).observe(conversation);
  messages.addEventListener('click',async event=>{
    const button=event.target.closest('[data-copy-message],[data-copy-code]');if(!button)return;
    const entry=entries.get(button.closest('.dsh-message')?.dataset.messageKey);
    const text=button.hasAttribute('data-copy-code')?button.closest('.dsh-code-block').querySelector('pre code')?.textContent:entry?.text;
    const active=document.activeElement,offsets=selectedOffsets(messages),ok=await copyText(text);
    if(active?.isConnected)active.focus({preventScroll:true});restoreSelection(messages,offsets);
    const label=button.hasAttribute('data-copy-code')?t('dsh.copyCode'):t('dsh.copy');
    clearTimeout(button.copyTimer);button.dataset.copyState=ok?'copied':'failed';button.textContent=ok?t('dsh.copied'):t('dsh.copyFailed');
    button.copyTimer=setTimeout(()=>{delete button.dataset.copyState;button.textContent=label;},1600);
  });
  function markdown(text,path){
    const template=document.createElement('template');template.innerHTML=renderMD(text,path);
    template.content.querySelectorAll('pre').forEach(pre=>{
      const code=pre.querySelector('code');if(!code)return;
      const wrapper=document.createElement('div');wrapper.className='dsh-code-block';
      const tools=document.createElement('div');tools.className='dsh-code-tools';
      const language=document.createElement('span');language.textContent=[...code.classList].find(name=>name.startsWith('language-'))?.slice(9)||t('dsh.codeFallback');
      const copy=document.createElement('button');copy.type='button';copy.dataset.copyCode='';copy.textContent=t('dsh.copyCode');copy.setAttribute('aria-label',t('dsh.copyCodeAria'));
      tools.append(language,copy);pre.replaceWith(wrapper);wrapper.append(tools,pre);
    });
    return template.content;
  }
  const roleLabel=role=>role==='user'?t('dsh.roleYou'):role==='error'?t('dsh.roleError'):t('dsh.roleAssistant');
  return {show(state){
    lastState=state;
    const nextScope=JSON.stringify([state.root,state.sessionId]);
    if(scope!==nextScope){scope=nextScope;entries=new Map();messages.replaceChildren();pinned=true;lastUserInput=-Infinity;}
    const list=state.messages||[],alive=new Set();
    if(list.length)messages.querySelector('.dsh-empty')?.remove();
    let cursor=messages.firstChild;
    list.forEach((message,index)=>{
      const key=String(message.id??`${message.role}:${index}`),text=String(message.text??'');alive.add(key);
      let entry=entries.get(key);
      if(!entry){
        const node=document.createElement('section');node.className='dsh-message';node.dataset.messageKey=key;
        const label=document.createElement('small'),body=document.createElement('div'),actions=document.createElement('div');body.className='dsh-message-text';actions.className='dsh-message-actions';
        const copy=document.createElement('button');copy.type='button';copy.dataset.copyMessage='';copy.textContent=t('dsh.copy');copy.setAttribute('aria-label',t('dsh.copyAria'));actions.append(copy);
        node.append(label,body,actions);entry={node,label,body,actions};entries.set(key,entry);
      }
      if(entry.node!==cursor)messages.insertBefore(entry.node,cursor);else cursor=cursor.nextSibling;
      const role=message.role==='user'?'user':message.role==='error'?'error':'assistant';
      if(entry.text!==text||entry.role!==role||entry.path!==state.contextPath){
        const offsets=selectedOffsets(entry.body),scroll=[...entry.body.querySelectorAll('pre')].map(pre=>pre.scrollLeft);
        entry.node.className=`dsh-message ${role}`;entry.label.textContent=roleLabel(role);entry.body.className=`dsh-message-text ${role==='user'?'':'markdown-body'}`;
        if(role==='user'){
          const template=document.createElement('template');template.innerHTML=escape(text).replace(/\n/g,'<br>');patchChildren(entry.body,template.content);
        }else patchChildren(entry.body,markdown(text,state.contextPath||''));
        entry.actions.hidden=role==='error';entry.text=text;entry.role=role;entry.path=state.contextPath;
        entry.body.querySelectorAll('pre').forEach((pre,i)=>{pre.scrollLeft=scroll[i]||0;});restoreSelection(entry.body,offsets);
      }
    });
    for(const [key,entry] of entries)if(!alive.has(key)){entry.node.remove();entries.delete(key);}
    if(!list.length&&!messages.querySelector('.dsh-empty'))messages.innerHTML=`<div class="dsh-empty"><span>DSH</span><h3>${t('dsh.emptyTitle')}</h3><p>${state.root?t('dsh.emptyAsk'):t('dsh.emptyImport')}</p></div>`;
    follow();
  },
  // Relabel already-rendered chrome without rebuilding message bodies, which
  // would disturb selection, scroll position and in-flight streaming.
  refreshLabels(){
    jump.textContent=t('dsh.jump');jump.setAttribute('aria-label',t('dsh.jumpAria'));
    for(const entry of entries.values()){
      const role=entry.role||'assistant';
      entry.label.textContent=roleLabel(role);
      const copy=entry.actions?.querySelector('[data-copy-message]');
      if(copy&&!copy.dataset.copyState){copy.textContent=t('dsh.copy');copy.setAttribute('aria-label',t('dsh.copyAria'));}
    }
    for(const button of messages.querySelectorAll('[data-copy-code]')){
      if(button.dataset.copyState)continue;
      button.textContent=t('dsh.copyCode');button.setAttribute('aria-label',t('dsh.copyCodeAria'));
    }
    const empty=messages.querySelector('.dsh-empty');
    if(empty){empty.querySelector('h3').textContent=t('dsh.emptyTitle');empty.querySelector('p').textContent=lastState?.root?t('dsh.emptyAsk'):t('dsh.emptyImport');}
  }};
}
