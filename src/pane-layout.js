import {onEscape,isComposing,mountRovingGroup} from './ui-interactions';

export function mountPaneLayout(){
  if(document.body.matches('.dsh-only,.document-only'))return;
  const panel=document.querySelector('#document'),row=panel.querySelector('.doc-body'),answer=document.querySelector('#answers-panel');
  const application=document.querySelector('.application-body'),dsh=document.querySelector('#dsh-host');
  const switcher=document.createElement('div');switcher.className='document-pane-switch';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','切换教学与作答');
  switcher.innerHTML='<button type="button" data-pane="reading" aria-pressed="true" aria-controls="content-area">教学</button><button type="button" data-pane="answer" aria-pressed="false" aria-controls="answers-panel">本轮作答</button>';
  panel.querySelector('.document-heading').append(switcher);
  mountRovingGroup(switcher);
  let root='',preferences={},view='reading',drag=null,frame=0;
  const key=()=>`stg-pane-layout:${root||'default'}`;
  const save=()=>{try{localStorage.setItem(key(),JSON.stringify(preferences));}catch{}};
  const clamp=(value,min,max)=>Math.max(min,Math.min(Math.max(min,max),value));
  function separator(id,label,before,parent){
    const element=document.createElement('div');element.id=id;element.className='pane-separator';element.tabIndex=0;
    element.setAttribute('role','separator');element.setAttribute('aria-orientation','vertical');element.setAttribute('aria-label',label);element.setAttribute('aria-valuemin','0');element.setAttribute('aria-valuemax','100');element.title='拖动调整宽度；双击恢复默认；方向键微调';
    parent.insertBefore(element,before);return element;
  }
  const answerHandle=separator('answer-resizer','调整教学与作答宽度',answer,row);
  const dshHandle=separator('dsh-resizer','调整工作台与 DSH 宽度',dsh,application);
  const hasAnswer=()=>!document.querySelector('#answer-focus').disabled&&!document.body.matches('.answer-detached,.answer-document-active');
  function update(){
    frame=0;
    const available=application.clientWidth-parseFloat(getComputedStyle(application).paddingLeft)-parseFloat(getComputedStyle(application).paddingRight);
    const dshWidth=clamp(Number(preferences.dshWidth)||410,300,Math.min(620,available-390));
    dsh.style.width=`${Math.round(dshWidth)}px`;
    const width=row.clientWidth,narrow=width<800,has=hasAnswer();
    panel.dataset.paneNarrow=String(narrow);panel.dataset.hasAnswer=String(has);panel.dataset.paneView=view;
    const desired=preferences.answerRatio?width*preferences.answerRatio:document.body.classList.contains('dsh-open')?360:420;
    const answerWidth=clamp(desired,300,width-420-8);
    row.style.setProperty('--answer-pane-width',`${Math.round(answerWidth)}px`);
    switcher.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.pane===view)));
    for(const [handle,total,rightWidth] of [[answerHandle,width,answerWidth],[dshHandle,available,dshWidth]]){
      const left=Math.round(100*(1-rightWidth/Math.max(1,total)));
      handle.setAttribute('aria-valuenow',String(left));handle.setAttribute('aria-valuetext',`${handle===answerHandle?'教学':'工作台'} ${left}%，${handle===answerHandle?'作答':'DSH'} ${100-left}%`);
    }
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
  function setView(value){
    view=value;panel.dataset.paneView=value;
    if(value==='reading'&&document.body.classList.contains('answer-focused'))document.querySelector('#answer-focus').click();
    schedule();
  }
  switcher.addEventListener('click',event=>{const button=event.target.closest('[data-pane]');if(button)setView(button.dataset.pane);});
  row.addEventListener('focusin',event=>{
    if(answer.contains(event.target))setView('answer');
    else if(document.querySelector('#content-area').contains(event.target))setView('reading');
  });
  function cancelDrag(){
    if(!drag)return;
    const {element,pointerId,original}=drag;preferences=original;drag=null;
    if(element.hasPointerCapture(pointerId))element.releasePointerCapture(pointerId);
    document.body.classList.remove('pane-dragging');update();
  }
  onEscape(()=>!!drag,cancelDrag,1000);
  for(const element of [answerHandle,dshHandle]){
    const change=width=>{
      if(element===answerHandle)preferences.answerRatio=clamp(width,300,row.clientWidth-428)/Math.max(1,row.clientWidth);
      else preferences.dshWidth=width;
      update();
    };
    element.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();element.focus({preventScroll:true});
      drag={element,pointerId:event.pointerId,start:event.clientX,width:(element===answerHandle?answer:dsh).getBoundingClientRect().width,original:{...preferences},moved:false};
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener('pointermove',event=>{
      if(!drag||drag.element!==element||drag.pointerId!==event.pointerId)return;
      const delta=event.clientX-drag.start;if(!drag.moved&&Math.abs(delta)<4)return;
      drag.moved=true;document.body.classList.add('pane-dragging');change(drag.width-delta);
    });
    element.addEventListener('pointerup',event=>{
      if(!drag||drag.element!==element||drag.pointerId!==event.pointerId)return;
      const moved=drag.moved;drag=null;document.body.classList.remove('pane-dragging');
      if(element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);
      if(moved)save();
    });
    element.addEventListener('pointercancel',cancelDrag);
    element.addEventListener('lostpointercapture',()=>{if(drag?.element===element)cancelDrag();});
    element.addEventListener('dblclick',()=>{delete preferences[element===answerHandle?'answerRatio':'dshWidth'];update();save();});
    element.addEventListener('keydown',event=>{
      if(isComposing(event)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const width=(element===answerHandle?answer:dsh).getBoundingClientRect().width;
      change(event.key==='Home'?10000:event.key==='End'?0:width+(event.key==='ArrowLeft'?1:-1)*(event.shiftKey?60:20));save();
    });
  }
  document.addEventListener('stg-document-changed',event=>{
    if(root!==event.detail.root){
      cancelDrag();root=event.detail.root;try{preferences=JSON.parse(localStorage.getItem(key())||'{}')||{};}catch{preferences={};}
    }
    view='reading';schedule();
  });
  new ResizeObserver(schedule).observe(application);
  new ResizeObserver(schedule).observe(row);
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
  new MutationObserver(schedule).observe(document.querySelector('#answer-focus'),{attributes:true,attributeFilter:['disabled']});
  new MutationObserver(schedule).observe(panel,{attributes:true,attributeFilter:['class']});
  schedule();
}
