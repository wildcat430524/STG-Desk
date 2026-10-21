import {onEscape,isComposing} from './ui-interactions';
import {i18n} from './i18n.js';

// Keep the native value as the bridge to DSH; render the menu outside the dock
// so neither the conversation scroll area nor a narrow window can clip it.
export function mountModelPicker({select,icon,onChange,onError}){
  const t=(key,params)=>i18n.t(key,params);
  select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const trigger=document.createElement('button');trigger.id='dsh-model-trigger';trigger.type='button';
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','dsh-model-picker');
  trigger.innerHTML='<span class="model-trigger-label"></span>'+icon('<path d="m7 10 5 5 5-5"/>',14);select.after(trigger);
  const panel=document.createElement('div');panel.id='dsh-model-picker';panel.hidden=true;panel.className='model-picker';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',t('picker.title'));
  panel.innerHTML=`<header class="model-picker-heading"><strong>${t('picker.title')}</strong><span class="model-picker-count"></span></header><div class="model-search-wrap">${icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',17)}<input id="dsh-model-search" type="search" placeholder="${escapeAttr(t('picker.search'))}" aria-label="${escapeAttr(t('picker.search'))}" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="dsh-model-list" autocomplete="off" spellcheck="false"></div><div id="dsh-model-list" role="listbox" aria-label="${escapeAttr(t('picker.listAria'))}"></div><div class="model-picker-empty" hidden>${t('picker.empty')}<small>${t('picker.emptyHint')}</small></div><footer class="model-picker-footer"><span>${t('picker.footerSelect')} <span class="model-key">Enter</span> ${t('picker.footerConfirm')}</span><span><span class="model-key">Esc</span> ${t('picker.footerClose')}</span></footer><div class="model-picker-feedback" role="status"></div>`;
  document.body.append(panel);
  const search=panel.querySelector('input'),list=panel.querySelector('[role=listbox]'),empty=panel.querySelector('.model-picker-empty'),feedback=panel.querySelector('.model-picker-feedback');
  let models=[],filtered=[],active=-1,lastKey='',pending=false,open=false,scope='';
  const optionNodes=()=>[...list.querySelectorAll('[role=option]')];
  function position(){
    if(!open)return;
    const anchor=trigger.getBoundingClientRect(),margin=12,width=Math.min(368,innerWidth-margin*2);
    panel.style.width=width+'px';panel.style.left=Math.max(margin,Math.min(anchor.right-width,innerWidth-margin-width))+'px';
    const above=anchor.top-8-margin,below=innerHeight-anchor.bottom-8-margin,up=above>=Math.min(380,below);
    panel.style.maxHeight=Math.min(472,Math.max(120,up?above:below))+'px';
    panel.style.top=up?'auto':anchor.bottom+8+'px';panel.style.bottom=up?innerHeight-anchor.top+8+'px':'auto';
  }
  function activate(index,scroll=true){
    active=index;const nodes=optionNodes();
    for(let i=0;i<nodes.length;i++)nodes[i].dataset.active=String(i===active);
    if(nodes[active]){search.setAttribute('aria-activedescendant',nodes[active].id);if(scroll)nodes[active].scrollIntoView({block:'nearest'});}
    else search.removeAttribute('aria-activedescendant');
  }
  function render(){
    const query=search.value.trim().toLocaleLowerCase();
    filtered=models.filter(m=>(m.label+' '+m.provider+' '+m.id).toLocaleLowerCase().includes(query));
    list.replaceChildren();const groups=new Map();
    for(const [index,model] of filtered.entries()){
      let group=groups.get(model.provider);
      if(!group){
        group=document.createElement('div');group.className='model-group';group.setAttribute('role','group');group.setAttribute('aria-label',model.provider);
        const heading=document.createElement('div');heading.className='model-group-label';heading.textContent=model.provider;
        const count=document.createElement('span');count.textContent=String(filtered.filter(m=>m.provider===model.provider).length);heading.append(count);heading.setAttribute('aria-hidden','true');group.append(heading);list.append(group);groups.set(model.provider,group);
      }
      const row=document.createElement('div');row.className='model-option';row.id='dsh-model-option-'+index;row.dataset.modelId=model.id;row.setAttribute('role','option');row.setAttribute('aria-selected',String(model.id===select.value));
      const text=document.createElement('span');text.className='model-option-name';
      const parts=model.label.match(/^(.*?)\s*[·]\s*(.+)$/);text.textContent=parts?parts[1]:model.label;row.append(text);row.title=model.label;
      if(parts){const price=document.createElement('span');price.className='model-option-price';price.textContent=parts[2];row.append(price);}
      const check=document.createElement('span');check.className='model-option-check';check.setAttribute('aria-hidden','true');check.innerHTML=icon('<path d="m5 12 4 4L19 6"/>',15);row.append(check);
      row.addEventListener('pointermove',()=>{if(active!==index)activate(index,false);});
      row.addEventListener('pointerdown',event=>event.preventDefault());
      row.addEventListener('click',()=>choose(model));group.append(row);
    }
    empty.hidden=!!filtered.length;list.hidden=!filtered.length;
    panel.querySelector('.model-picker-count').textContent=query?t('picker.countFiltered',{shown:filtered.length,total:models.length}):t('picker.count',{n:models.length});
    const selected=filtered.findIndex(model=>model.id===select.value);activate(selected>=0?selected:filtered.length?0:-1);
  }
  function close(restore=false){
    if(!open)return;open=false;panel.hidden=true;trigger.setAttribute('aria-expanded','false');
    if(restore&&!trigger.disabled)trigger.focus({preventScroll:true});
  }
  function show(){
    if(trigger.disabled)return;open=true;panel.hidden=false;trigger.setAttribute('aria-expanded','true');search.value='';feedback.textContent='';position();render();search.focus({preventScroll:true});
  }
  async function choose(model){
    if(pending||select.disabled)return;
    if(model.id===select.value){close(true);return;}
    const previous=select.value,requestScope=scope;let restore=false;
    pending=true;search.disabled=true;panel.setAttribute('aria-busy','true');feedback.textContent=t('picker.switching');
    try{await onChange(model.id);if(scope===requestScope){select.value=model.id;restore=open;close();}}
    catch(error){if(scope===requestScope){select.value=previous;feedback.textContent=t('picker.switchFailed');onError(error);}}
    finally{pending=false;search.disabled=false;panel.removeAttribute('aria-busy');sync();if(open)search.focus({preventScroll:true});else if(restore&&!trigger.disabled)trigger.focus({preventScroll:true});}
  }
  function sync(nextScope=scope){
    if(nextScope!==scope){scope=nextScope;close();}
    trigger.disabled=select.disabled||pending;const selected=select.selectedOptions[0];
    const label=selected?.textContent||t('picker.triggerFallback');
    trigger.querySelector('.model-trigger-label').textContent=label;trigger.title=label;trigger.setAttribute('aria-label',t('picker.triggerAria',{model:label}));
    const key=select.innerHTML+'\0'+select.value;
    if(key!==lastKey){lastKey=key;models=[...select.options].filter(o=>o.value).map(o=>({id:o.value,label:o.textContent,provider:o.parentElement.label||'DSH'}));if(open)render();}
    if(select.disabled||!trigger.getClientRects().length)close();else if(open)position();
  }
  trigger.addEventListener('click',()=>open?close(true):show());
  trigger.addEventListener('keydown',event=>{if(!isComposing(event)&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show();}});
  search.addEventListener('input',render);
  search.addEventListener('keydown',event=>{
    if(event.key==='Tab'){close(true);return;}
    if(isComposing(event)||pending)return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey){
      // Home/End continue editing text when a search is present.
      if(search.value&&['Home','End'].includes(event.key))return;
      event.preventDefault();if(!filtered.length)return;
      activate(event.key==='Home'?0:event.key==='End'?filtered.length-1:(active+(event.key==='ArrowDown'?1:-1)+filtered.length)%filtered.length);
    }else if(event.key==='Enter'){event.preventDefault();if(filtered[active])choose(filtered[active]);}
  });
  onEscape(()=>open,()=>close(true),350);
  document.addEventListener('pointerdown',event=>{if(open&&!panel.contains(event.target)&&!trigger.contains(event.target))close();});
  document.addEventListener('focusin',event=>{if(open&&!panel.contains(event.target)&&event.target!==trigger)close();});
  window.addEventListener('resize',position);window.addEventListener('blur',()=>close());
  const observer=new ResizeObserver(position);observer.observe(trigger);
  select.addEventListener('change',()=>onChange(select.value).catch(onError));
  // Repaint labels only. The picker stays open, the search text and the currently
  // highlighted option are preserved so a language switch cannot drop a choice.
  i18n.subscribe(()=>{
    panel.setAttribute('aria-label',t('picker.title'));
    panel.querySelector('.model-picker-heading strong').textContent=t('picker.title');
    search.placeholder=t('picker.search');search.setAttribute('aria-label',t('picker.search'));
    list.setAttribute('aria-label',t('picker.listAria'));
    panel.querySelector('.model-picker-empty').firstChild.textContent=t('picker.empty');
    panel.querySelector('.model-picker-empty small').textContent=t('picker.emptyHint');
    panel.querySelector('.model-picker-footer').innerHTML=`<span>${t('picker.footerSelect')} <span class="model-key">Enter</span> ${t('picker.footerConfirm')}</span><span><span class="model-key">Esc</span> ${t('picker.footerClose')}</span>`;
    if(pending)feedback.textContent=t('picker.switching');
    sync();
  });
  return {sync,close};
}

function escapeAttr(value){
  return String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
