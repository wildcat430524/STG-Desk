// Original SVG paths; a single stroke system for document controls.
const paths={
  save:'<path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  export:'<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
  focus:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  history:'<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-4v6l4 2"/>',
  window:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M14 3h7v7m0-7-9 9"/>',
  book:'<path d="M12 6c-3-3-7-3-10-2v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15"/>',
  math:'<path d="M18 4H6l7 8-7 8h12"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon:'<path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5Z"/>'
};
export const editorIcon=name=>`<svg class="editor-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.book}</svg>`;
export function mountEditorIcons(){
  for(const [id,name] of Object.entries({save:'save',export:'export','document-focus':'focus',preferences:'settings',history:'history','document-popout':'window','choose-course':'book'})){
    const button=document.getElementById(id);if(button){button.querySelectorAll(':scope > svg').forEach(svg=>svg.remove());button.insertAdjacentHTML('afterbegin',editorIcon(name));}
  }
}
