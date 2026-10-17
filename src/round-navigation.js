import './round-navigation.css';
import {onEscape,isComposing} from './ui-interactions';

export function mountRoundNavigation({escape,icon,onSelect}){
  const trigger=document.querySelector('#round-switch'),menu=document.querySelector('#round-menu');
  const check=icon('<path d="m5 12 4 4L19 6"/>',15);
  const book=icon('<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4Z"/><path d="M13 7a3 3 0 0 1 3-3h4v15h-4a4 4 0 0 0-3 2"/>',17);
  const items=()=>[...menu.querySelectorAll('[role=menuitemradio]:not(:disabled)')];
  const isOpen=()=>menu.matches(':popover-open');
  let initialEdge;
  function close(restoreFocus=false){if(isOpen())menu.hidePopover();if(restoreFocus)trigger.focus({preventScroll:true});}
  onEscape(isOpen,()=>close(true),500);
  function placeAndFocus(edge){
    const anchor=trigger.getBoundingClientRect(),bounds=menu.getBoundingClientRect();
    menu.style.left=Math.max(12,Math.min(anchor.left,innerWidth-bounds.width-12))+'px';
    menu.style.top=Math.max(12,anchor.bottom+8+bounds.height>innerHeight-12?anchor.top-bounds.height-8:anchor.bottom+8)+'px';
    const choices=items();
    (edge==='last'?choices.at(-1):edge==='first'?choices[0]:choices.find(b=>b.getAttribute('aria-checked')==='true')||choices[0])?.focus({preventScroll:true});
  }
  function open(edge){
    if(trigger.classList.contains('hidden'))return;
    if(isOpen())placeAndFocus(edge);else {initialEdge=edge;menu.showPopover();}
  }
  trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(event.key==='ArrowUp'?'last':'first');}});
  menu.addEventListener('toggle',event=>{
    trigger.setAttribute('aria-expanded',String(event.newState==='open'));
    if(event.newState==='open'){placeAndFocus(initialEdge);initialEdge=undefined;}
  });
  menu.addEventListener('click',event=>{const item=event.target.closest('[data-round-file]');if(!item||item.disabled)return;close(true);onSelect(item.dataset.roundFile);});
  menu.addEventListener('keydown',event=>{
    if(isComposing(event))return;
    if(event.key==='Tab'){close();return;}
    const choices=items(),index=choices.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?choices.length-1:event.key==='ArrowDown'?(index+1)%choices.length:event.key==='ArrowUp'?(index-1+choices.length)%choices.length:null;
    if(next!==null){event.preventDefault();choices[next]?.focus();}
  });
  window.addEventListener('resize',()=>close());
  document.addEventListener('scroll',event=>{if(!menu.contains(event.target))close();},true);
  return {update({rounds=[],index,activePath,title='',isDetached=()=>false}){
    close();trigger.classList.toggle('hidden',!rounds.length);
    trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-label',`切换本章教学轮次，当前：${title}`);
    const row=(file,label,mark)=>{
      const selected=file.path===activePath,detached=isDetached(file.path);
      return `<button type="button" role="menuitemradio" aria-checked="${selected}" tabindex="-1" data-round-file="${escape(file.path)}" ${detached?'disabled':''}><span class="round-menu-mark" aria-hidden="true">${mark}</span><span class="round-menu-label">${label}</span>${detached?'<span class="round-menu-status">窗口中</span>':selected?`<span class="round-menu-check" aria-hidden="true">${check}</span>`:''}</button>`;
    };
    menu.innerHTML=`${index?row(index,'教学总入口',book)+'<div class="round-menu-divider" role="separator"></div>':''}<div class="round-menu-rounds" role="group" aria-label="已留存轮次">${rounds.map(file=>row(file,`第 ${file.number} 轮`,String(file.number).padStart(2,'0'))).join('')}</div>`;
  }};
}
