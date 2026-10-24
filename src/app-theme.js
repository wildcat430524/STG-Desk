import {editorIcon} from './editor-icons';
import {i18n} from './i18n.js';

export function mountApplicationTheme({dshOnly=false}={}) {
  const key='stg-app-theme';
  const button=document.createElement('button');button.type='button';button.id='app-theme-toggle';button.className='app-theme-toggle';
  const host=dshOnly?document.querySelector('#dsh-more-menu'):document.querySelector('.header-actions');
  host?.prepend(button);
  function label(dark){
    button.innerHTML=editorIcon(dark?'sun':'moon')+' '+(dark?i18n.t('theme.day'):i18n.t('theme.night'));
    button.setAttribute('aria-label',i18n.t('theme.toggleAria'));
    button.setAttribute('aria-pressed',String(dark));
  }
  function apply(theme){
    const dark=theme==='dark';document.documentElement.dataset.appTheme=dark?'dark':'light';
    label(dark);
    document.querySelectorAll('[data-reader-theme]').forEach(b=>{b.disabled=dark;});
    window.dispatchEvent(new Event('stg-theme-changed'));
    window.stg?.applyTheme?.(dark?'dark':'light').catch(()=>{});
  }
  let initial='light';
  try{initial=localStorage.getItem(key)||'light';if(!localStorage.getItem(key)&&localStorage.getItem('stg-reader-theme')==='night'){initial='dark';localStorage.setItem(key,initial);localStorage.setItem('stg-reader-theme','light');}}catch{}
  apply(initial);
  button.onclick=()=>{const theme=document.documentElement.dataset.appTheme==='dark'?'light':'dark';apply(theme);try{localStorage.setItem(key,theme);}catch{}};
  window.addEventListener('storage',event=>{if(event.key===key)apply(event.newValue);});
  i18n.subscribe(()=>label(document.documentElement.dataset.appTheme==='dark'));
}
