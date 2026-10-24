import {editorIcon} from './editor-icons';
import {onEscape} from './ui-interactions';
import {i18n} from './i18n.js';

export function mountFocusMode(button){
  const setFocused=enabled=>{
    document.body.classList.toggle('document-focused',enabled);
    button.setAttribute('aria-pressed',String(enabled));
    button.innerHTML=editorIcon('focus')+(enabled?i18n.t('doc.exitFocus'):i18n.t('doc.focus'));
  };
  button.addEventListener('click',()=>setFocused(!document.body.classList.contains('document-focused')));
  onEscape(()=>document.body.classList.contains('document-focused'),()=>{setFocused(false);button.focus({preventScroll:true});},100);
  i18n.subscribe(()=>setFocused(document.body.classList.contains('document-focused')));
}
