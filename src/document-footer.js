// Keep document information and actions below the reading surface. The global
// controls remain available on welcome/progress pages; document actions only
// appear while a document is visible.
export function mountDocumentFooter(){
  const panel=document.querySelector('#document');
  const toolbar=document.querySelector('.document-toolbar');
  const topbar=document.querySelector('.topbar');
  const status=document.querySelector('.statusbar');
  if(!panel||!toolbar||!topbar||!status)return;
  const footer=document.createElement('footer');
  footer.className='document-footer';footer.setAttribute('aria-label','文档信息与操作');
  footer.append(topbar,toolbar);status.before(footer);
  const update=()=>{
    const absent=panel.classList.contains('hidden');
    toolbar.classList.toggle('hidden',absent);
    footer.classList.toggle('document-footer-empty',absent);
    // With a document open this is the card's final flex item. On other pages,
    // leave the global night/settings controls at the bottom of the main area.
    if(absent){
      const focus=toolbar.querySelector('button[aria-pressed="true"]');
      focus?.click();status.before(footer);
    }else panel.append(footer);
  };
  const observer=new MutationObserver(update);
  observer.observe(panel,{attributes:true,attributeFilter:['class']});update();
  new ResizeObserver(()=>{
    document.documentElement.style.setProperty('--document-footer-height',footer.getBoundingClientRect().height+'px');
  }).observe(footer);
}
