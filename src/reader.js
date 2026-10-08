import {mappedTasks,scrollPercent} from './reader-model.mjs';

export function mountReader({preview,outline,getSource,toggleTask,notify}) {
  const bar=document.createElement('section');
  bar.className='reader-tools';bar.setAttribute('aria-label','阅读导航');
  bar.innerHTML=`<div class="reader-info"><span class="reader-section">开始阅读</span><span class="reader-meta"></span></div><div class="reader-controls"><button class="reader-tasks hidden" title="跳到下一项未完成清单"></button><div class="reader-themes" role="group" aria-label="阅读配色"><button data-reader-theme="light" title="明亮" aria-label="明亮配色">白</button><button data-reader-theme="paper" title="纸张" aria-label="纸张配色">纸</button></div><button class="reader-answer-toggle" aria-pressed="false" title="展开作答工作区">作答</button><button class="reader-focus" aria-pressed="false">专注</button></div><div class="reader-progress" role="progressbar" aria-label="本文阅读位置" aria-valuemin="0" aria-valuemax="100"><span></span></div>`;
  document.querySelector('.doc-body').before(bar);
  let headings=[],tasks=[],frame=0,docKey='',nextIndex=-1;
  const positions=new Map();
  function setTheme(theme,persist=true){
    document.documentElement.dataset.readerTheme=theme;
    bar.querySelectorAll('[data-reader-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.readerTheme===theme)));
    if(persist)try{localStorage.setItem('stg-reader-theme',theme);}catch{}
  }
  let theme='light';try{theme=localStorage.getItem('stg-reader-theme')||theme;}catch{}
  // Let the app theme migrate the earlier reader-only night preference.
  setTheme(['light','paper'].includes(theme)?theme:'light',theme!=='night');
  function update(){
    frame=0;
    if(preview.clientHeight===0)return;
    const percent=scrollPercent(preview.scrollTop,preview.scrollHeight,preview.clientHeight);
    const track=bar.querySelector('.reader-progress');track.setAttribute('aria-valuenow',String(percent));
    track.firstElementChild.style.width=percent+'%';
    bar.querySelector('.reader-meta').textContent=`阅读 ${percent}% · 约 ${minutes} 分钟`;
    const top=preview.getBoundingClientRect().top;
    let active=headings[0];
    for(const h of headings){if(h.element.getBoundingClientRect().top<=top+80)active=h;else break;}
    bar.querySelector('.reader-section').textContent=active?.title||'正文';
    outline.querySelectorAll('[data-section]').forEach(b=>{const selected=b.dataset.section===active?.id;b.classList.toggle('reader-current',selected);if(selected)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');});
    if(docKey)positions.set(docKey,preview.scrollTop);
  }
  function refresh(){if(!frame)frame=requestAnimationFrame(update);}
  let minutes=1;
  preview.addEventListener('scroll',refresh,{passive:true});
  preview.addEventListener('load',refresh,true);
  new ResizeObserver(refresh).observe(preview);
  function decorate(){
    preview.querySelectorAll('table').forEach(table=>{const wrap=document.createElement('div');wrap.className='reader-table';wrap.setAttribute('role','region');wrap.setAttribute('aria-label','表格，可横向滚动');wrap.tabIndex=0;table.before(wrap);wrap.append(table);});
    preview.querySelectorAll('pre').forEach(pre=>{
      const code=pre.querySelector('code');if(!code)return;
      const wrapper=document.createElement('div');wrapper.className='reader-code';
      const header=document.createElement('div');header.className='reader-code-header';
      const label=document.createElement('span');label.textContent=code.className.match(/language-([\w+-]+)/)?.[1]||'代码';
      const copy=document.createElement('button');copy.type='button';copy.textContent='复制';copy.setAttribute('aria-label','复制代码');
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent);copy.textContent='已复制';setTimeout(()=>{if(copy.isConnected)copy.textContent='复制';},1600);}catch{notify('无法复制，请选中代码后按 Ctrl C。',true);}};
      header.append(label,copy);pre.before(wrapper);wrapper.append(header,pre);
    });
  }
  function render({tokens,content,headings:items,key}){
    // Estimate from the article before adding navigation and copy controls.
    minutes=Math.max(1,Math.ceil(preview.textContent.replace(/\s/g,'').length/450));
    const changed=key!==docKey,position=positions.get(key)??(changed?0:preview.scrollTop);
    docKey=key;nextIndex=-1;
    headings=items.map(h=>({...h,element:preview.querySelector('#'+h.id)})).filter(h=>h.element);
    const maps=mappedTasks(tokens,content);
    tasks=[...preview.querySelectorAll('.task-list-item')].map((item,i)=>{
      const input=item.querySelector(':scope > .task-list-item-checkbox, :scope > p > .task-list-item-checkbox');
      const map=maps[i];if(!input)return null;
      item.classList.toggle('reader-task-done',input.checked);
      input.setAttribute('aria-label',item.textContent.trim().slice(0,160)||'清单项');
      if(map){input.disabled=false;input.dataset.readerOffset=String(map.offset);input.title='勾选会更新文档草稿，点击保存后写入文件';}
      return {item,input,map};
    }).filter(Boolean);
    const total=tasks.length,complete=tasks.filter(t=>t.input.checked).length;
    const taskButton=bar.querySelector('.reader-tasks');taskButton.classList.toggle('hidden',!total);
    taskButton.textContent=`清单 ${complete} / ${total}`;
    taskButton.setAttribute('aria-label',`清单已完成 ${complete} 项，共 ${total} 项。跳到下一项未完成清单`);
    if(total){const summary=document.createElement('div');summary.className='reader-checklist-summary';summary.title='勾选会保留为草稿，保存后写入文档';summary.innerHTML='<div class="reader-checklist-top"><span class="reader-checklist-label">已完成</span><span class="reader-checklist-count"></span><span class="reader-checklist-remaining"></span></div><progress aria-label="清单完成度"></progress>';summary.querySelector('.reader-checklist-count').textContent=`${complete} / ${total}`;summary.querySelector('.reader-checklist-remaining').textContent=complete===total?'全部完成':`${total-complete} 项待完成`;const meter=summary.querySelector('progress');meter.max=total;meter.value=complete;preview.prepend(summary);}
    decorate();
    preview.scrollTop=position;refresh();
  }
  preview.addEventListener('change',event=>{
    const input=event.target;
    if(!input.matches('.task-list-item-checkbox[data-reader-offset]'))return;
    if(document.documentElement.dataset.busy==='true'){input.checked=!input.checked;return;}
    const offset=Number(input.dataset.readerOffset),source=getSource();
    if(!/[ xX]/.test(source[offset]||'')||source[offset-1]!=='['||source[offset+1]!==']'){input.checked=!input.checked;notify('清单内容已变化，请重新加载后再勾选。',true);return;}
    const checked=input.checked;const y=preview.scrollTop;
    toggleTask(offset,checked);
    // Re-render synchronously to keep every source offset and count consistent.
    preview.scrollTop=y;refresh();
    const replacement=[...preview.querySelectorAll('[data-reader-offset]')].find(n=>Number(n.dataset.readerOffset)===offset);
    replacement?.focus({preventScroll:true});
  });
  bar.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.readerTheme)setTheme(button.dataset.readerTheme);
    if(button.classList.contains('reader-answer-toggle')){const enabled=document.body.classList.toggle('reader-show-answers');button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'收起作答':'作答';refresh();}
    if(button.classList.contains('reader-focus')){const enabled=document.body.classList.toggle('reader-focused');button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'退出专注':'专注';refresh();}
    if(button.classList.contains('reader-tasks')){const pending=tasks.filter(t=>!t.input.checked);if(!pending.length){notify('本文清单已全部完成。');return;}nextIndex=(nextIndex+1)%pending.length;pending[nextIndex].item.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});pending[nextIndex].input.focus({preventScroll:true});}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('reader-focused')){bar.querySelector('.reader-focus').click();}});
  function mode(value){bar.classList.toggle('hidden',value!=='read');if(value!=='read'&&document.body.classList.contains('reader-focused'))bar.querySelector('.reader-focus').click();refresh();}
  return {render,refresh,mode};
}
