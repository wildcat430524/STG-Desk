import {editorIcon} from './editor-icons';
export function mountFocusMode(button){
  const setFocused=enabled=>{
    document.body.classList.toggle('document-focused',enabled);
    button.setAttribute('aria-pressed',String(enabled));
    button.innerHTML=editorIcon('focus')+(enabled?'退出专注':'专注');
  };
  button.addEventListener('click',()=>setFocused(!document.body.classList.contains('document-focused')));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')setFocused(false);});
}
