// One Escape action per keypress, including menus opened outside the focus area.
const escapeLayers=[];
let listening=false,composing=false,compositionEnded=-Infinity;
export const isComposing=event=>composing||event.isComposing||event.keyCode===229;
export function onEscape(active,close,priority=0){
  const layer={active,close,priority};escapeLayers.push(layer);
  if(!listening){
    listening=true;
    document.addEventListener('compositionstart',()=>{composing=true;},true);
    document.addEventListener('compositionend',()=>{composing=false;compositionEnded=performance.now();},true);
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      // Let the input method consume Escape without closing application layers.
      if(isComposing(event)||performance.now()-compositionEnded<80){event.stopImmediatePropagation();return;}
      if(event.defaultPrevented)return;
      const top=[...escapeLayers].sort((a,b)=>b.priority-a.priority).find(item=>item.active());
      if(top){event.preventDefault();event.stopImmediatePropagation();top.close();}
    },true);
  }
  return ()=>{const index=escapeLayers.indexOf(layer);if(index>=0)escapeLayers.splice(index,1);};
}

const focusable=root=>[...root.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length&&!el.closest('[inert]'));
export function mountModalFocus(modal,onClose){
  let previous=null,wasInert=false;
  const background=document.querySelector('#app');
  const active=()=>!modal.classList.contains('hidden');
  onEscape(active,onClose,400);
  modal.setAttribute('aria-labelledby','modal-title');
  modal.tabIndex=-1;
  modal.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||isComposing(event))return;
    const choices=focusable(modal),first=choices[0],last=choices.at(-1);
    if(!first){event.preventDefault();modal.focus();return;}
    if(event.shiftKey&&(document.activeElement===first||!choices.includes(document.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!choices.includes(document.activeElement))){event.preventDefault();first.focus();}
  });
  document.addEventListener('focusin',event=>{
    if(active()&&!modal.contains(event.target))(focusable(modal)[0]||modal).focus({preventScroll:true});
  });
  return {
    open(){
      if(!active()){previous=document.activeElement;wasInert=background?.inert||false;}
      modal.classList.remove('hidden');
      if(background)background.inert=true;
      (modal.querySelector('#modal-close')||focusable(modal)[0]||modal).focus({preventScroll:true});
    },
    close(){
      if(!active())return;
      modal.classList.add('hidden');
      if(background)background.inert=wasInert;
      if(previous?.isConnected&&previous.getClientRects().length&&!previous.disabled)previous.focus({preventScroll:true});
      previous=null;
    }
  };
}

// Direction keys move within a control group; Enter/Space retain native actions.
export function mountRovingGroup(root,selector='button'){
  if(!root)return;
  const choices=()=>[...root.querySelectorAll(selector)].filter(el=>!el.disabled&&el.getClientRects().length);
  const sync=()=>{
    const buttons=choices(),active=buttons.find(el=>el.getAttribute('aria-pressed')==='true'||el.getAttribute('aria-selected')==='true'||el.classList.contains('selected'))||buttons[0];
    for(const button of buttons)button.tabIndex=button===active?0:-1;
  };
  root.addEventListener('keydown',event=>{
    if(isComposing(event)||event.altKey||event.ctrlKey||event.metaKey)return;
    const buttons=choices(),index=buttons.indexOf(document.activeElement);if(index<0||!buttons.length)return;
    const step=['ArrowRight','ArrowDown'].includes(event.key)?1:['ArrowLeft','ArrowUp'].includes(event.key)?-1:0;
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:step?(index+step+buttons.length)%buttons.length:null;
    if(next===null)return;
    event.preventDefault();for(const button of buttons)button.tabIndex=-1;
    buttons[next].tabIndex=0;buttons[next].focus({preventScroll:true});
  });
  root.addEventListener('click',event=>{const target=event.target.closest(selector);if(!target||!root.contains(target))return;for(const button of choices())button.tabIndex=button===target?0:-1;});
  new MutationObserver(sync).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed','aria-selected','class','disabled']});
  sync();
}
