// Keep document actions below the reading surface and its title above it. The global
// controls remain available on welcome/progress pages; document actions only
// appear while a document is visible.
export function mountDocumentFooter(){
  const panel=document.querySelector('#document');
  const toolbar=document.querySelector('.document-toolbar');
  const topbar=document.querySelector('.topbar');
  const status=document.querySelector('.statusbar');
  if(!panel||!toolbar||!topbar||!status)return;
  const heading=toolbar.querySelector('div');
  if(heading){heading.className='document-heading';panel.prepend(heading);}
  const footer=document.createElement('footer');
  footer.className='document-footer';footer.setAttribute('aria-label','文档信息与操作');
  footer.append(toolbar,topbar);status.before(footer);
  const actions=toolbar.querySelector('.doc-actions');
  const focus=actions?.querySelector('#document-focus');
  if(focus)actions.append(focus);
  // Draft feedback belongs with file metadata, leaving room for the title.
  const draft=actions?.querySelector('#draft-status');
  if(draft)status.prepend(draft);
  status.setAttribute('aria-label','文件信息');
  const update=()=>{
    const absent=panel.classList.contains('hidden');
    toolbar.classList.toggle('hidden',absent);
    footer.classList.toggle('document-footer-empty',absent);
    // With a document open this is the card's final flex item. On other pages,
    // leave the global night/settings controls at the bottom of the main area.
    if(absent){
      const focus=toolbar.querySelector('button[aria-pressed="true"]');
      focus?.click();panel.parentElement.append(status);status.before(footer);
    }else{
      topbar.prepend(status);panel.append(footer);
    }
  };
  const observer=new MutationObserver(update);
  observer.observe(panel,{attributes:true,attributeFilter:['class']});update();
  new ResizeObserver(()=>{
    document.documentElement.style.setProperty('--document-footer-height',footer.getBoundingClientRect().height+'px');
  }).observe(footer);
}
