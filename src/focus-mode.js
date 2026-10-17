import {editorIcon} from './editor-icons';
import {onEscape} from './ui-interactions';
export function mountFocusMode(button){
  const setFocused=enabled=>{
    document.body.classList.toggle('document-focused',enabled);
    button.setAttribute('aria-pressed',String(enabled));
    button.innerHTML=editorIcon('focus')+(enabled?'退出专注':'专注');
  };
  button.addEventListener('click',()=>setFocused(!document.body.classList.contains('document-focused')));
  onEscape(()=>document.body.classList.contains('document-focused'),()=>{setFocused(false);button.focus({preventScroll:true});},100);
}
