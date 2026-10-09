import './style.css';
import './monochrome.css';
import './mono-detail.css';
import 'katex/dist/katex.min.css';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import katex from 'katex';
import texmath from 'markdown-it-texmath';
import taskLists from 'markdown-it-task-lists';
import {hljs,highlightCode,languageRegistry} from './editor-highlight.mjs';

const api=window.stg;
const state={workspace:null,doc:null,answer:null,mode:'read',dirty:false,answerDirty:false,answers:{},loading:false,filter:'',scope:'all',busy:false};
const $=s=>document.querySelector(s);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const renderer=new MarkdownIt({html:false,linkify:true,typographer:false,highlight:(code,language)=>language&&hljs.getLanguage(language)&&code.length<100000?hljs.highlight(code,{language}).value:''}).use(taskLists,{enabled:false}).use(texmath,{engine:katex,delimiters:'dollars',katexOptions:{throwOnError:false,trust:false}});
const originalFence=renderer.renderer.rules.fence;
const originalHighlightLanguages=new Set(['python','javascript','typescript','json','bash','sql']);
renderer.renderer.rules.fence=(tokens,index,options,env,self)=>{
  const language=tokens[index].info.trim().split(/\s+/)[0];
  const fenceOptions=env.keepOriginalHighlight&&!originalHighlightLanguages.has(languageRegistry(language))?{...options,highlight:()=>''}:options;
  return originalFence(tokens,index,fenceOptions,env,self);
};
const originalImage=renderer.renderer.rules.image;
renderer.renderer.rules.image=(tokens,idx,options,env,self)=>{
  const t=tokens[idx];const src=t.attrGet('src')||'';
  if(src.startsWith('data:image/')) return originalImage(tokens,idx,options,env,self);
  if(/^[a-z]+:/i.test(src)||src.startsWith('//')) {t.attrSet('src','');t.attrSet('alt','[远程图片未加载] '+(t.content||''));}
  else { const p=resolveLink(env.path||'',src); t.attrSet('src',p?`stg-asset://${new URLSearchParams(location.search).get('asset')||'workspace'}/${p.split('/').map(encodeURIComponent).join('/')}`:''); }
  return originalImage(tokens,idx,options,env,self);
};
function resolveLink(from,target){
  let decoded;try{decoded=decodeURIComponent(target.split('#')[0]);}catch{return null;}
  if(decoded.startsWith('/')||/^[a-z]+:/i.test(decoded))return null;
  const pieces=from.split('/').slice(0,-1);
  for(const part of decoded.replace(/\\/g,'/').split('/')){if(part==='..'){if(!pieces.length)return null;pieces.pop();}else if(part&&part!=='.')pieces.push(part);}
  return pieces.join('/');
}
function renderMD(text,path='',keepOriginalHighlight=false){return DOMPurify.sanitize(renderer.render(text,{path,keepOriginalHighlight}),{ADD_TAGS:['annotation','semantics'],ADD_ATTR:['encoding'],ALLOW_UNKNOWN_PROTOCOLS:true});}
document.querySelector('#app').innerHTML=`
<div class="native-titlebar">STG Desk <span>学习工作台</span></div>
<header class="workspace-header">
  <div class="brand"><span class="brand-mark">S<span>↗</span></span><div><strong>STG Desk</strong><small>每一步，都更进一步</small></div><span class="version">α</span></div>
  <button class="import primary" id="import"><span>＋</span> 导入学习文件夹 <kbd>Ctrl O</kbd></button>
  <div class="workspace-card"><span class="eyebrow">当前工作区</span><strong id="workspace-name">尚未导入文件夹</strong><div id="workspace-meta">支持 StepsToGreat 与普通 Markdown</div></div>
  <button id="open-dsh" class="dsh-launch" title="打开 DSH 对话">打开 DSH <span>↗</span></button>
</header>
<section class="document-access"><div class="document-access-label">学习页面 <button id="refresh" title="刷新当前文档和学习进度" aria-label="刷新当前文档和学习进度">↻</button></div><nav id="tree" class="document-tabs" aria-label="教学、回答和进度页面"><span class="documents-empty">导入后显示教学、回答和进度</span></nav></section>
<div class="application-body">
<main class="main">
  <header class="topbar"><div class="breadcrumb" id="breadcrumb">工作台 <span>/</span> 欢迎</div><div class="header-actions"><button id="choose-course" class="header-button">课程与文档</button><div class="local-label"><span class="dot"></span> 本地优先</div></div></header>
  <section id="welcome" class="welcome">
    <span class="welcome-tag">STEPS TO GREAT <i></i> 本地学习工作台</span><h1>一个文件夹，<br><span>一张清晰的学习桌面。</span></h1><p>让文档、练习和你的思考待在一起。<br>打开学习文件夹，从上次停下的地方继续。</p>
    <div class="drop-card"><div class="folder-illustration">▱<span>md</span></div><h2>拖入你的 StepsToGreat 文件夹</h2><p>或点击下方按钮，从电脑中选择文件夹</p><button id="welcome-import" class="primary">选择学习文件夹 <span>→</span></button><small>原有目录直接读取，无需转换格式</small><button id="welcome-demo" class="text-link demo-link">先试用演示工作区 →</button></div>
    <div class="feature-grid"><div><span>01</span><strong>阅读与编辑</strong><p>清晰排版、公式、表格，直接在文档中编辑。</p></div><div><span>02</span><strong>专注当前轮</strong><p>关联学生回答，每次只处理当前轮的问题。</p></div><div><span>03</span><strong>留住每次作答</strong><p>答案追加到原文档，保存前自动备份。</p></div></div>
    <div class="recent" id="recent"></div>
  </section>
  <section id="document" class="document hidden">
    <div class="document-toolbar"><div><span class="eyebrow" id="document-kind">MARKDOWN</span><h1 id="document-title"></h1></div><div class="doc-actions"><button id="document-focus" class="document-focus" aria-pressed="false">专注</button><span id="save-status">已保存</span><button id="export" title="将当前文档草稿另存到新文件">另存草稿</button><button id="save" class="primary">保存 <kbd>Ctrl S</kbd></button></div></div>
    <div id="change-banner" class="change-banner hidden">文件夹中的文档有更新。<button id="load-changes">重新加载当前文档</button></div>
    <div class="doc-body"><div id="content-area" class="content-area edit"><div id="editor"></div></div>
      <aside id="answers-panel" class="answers-panel" aria-label="学生作答工作区"><div class="answer-heading"><span class="eyebrow">YOUR WORKSPACE</span><h2>作答工作区</h2><p id="answer-description">选择一份教学引导，开始作答。</p><div id="answer-document-name" class="answer-document-name"></div></div><div class="answer-tabs" role="group" aria-label="作答工作区内容"><button data-answer-tab="current" aria-pressed="true">本轮作答</button><button data-answer-tab="records" aria-pressed="false">作答记录</button><button data-answer-tab="document" aria-pressed="false">完整文档</button></div><div id="answer-content"></div><section id="answer-records" class="hidden" aria-label="历史作答与导师反馈"></section><section id="answer-document" class="hidden"><div class="answer-document-tools"><span id="answer-source-status">已保存版本</span><button id="answer-history">历史版本</button><button id="answer-edit-source">编辑</button></div><article id="answer-document-preview" class="markdown-body"></article><textarea id="answer-source" class="hidden" aria-label="完整回答文档 Markdown" spellcheck="false"></textarea></section><div id="answer-footer"></div></aside>
    </div>
  </section>
  <section id="progress-page" class="progress-page hidden" aria-labelledby="progress-title"><span class="eyebrow">LEARNING PROGRESS</span><h1 id="progress-title"></h1><div id="progress-content"></div></section>
  <footer class="statusbar"><span id="status-left">所有文档保存在你的电脑上</span><span id="status-right">UTF-8 · Markdown</span></footer>
</main><section id="dsh-host" class="dsh-host hidden"></section></div><div id="toast" class="toast hidden" role="status"></div><div id="drop-overlay" class="drop-overlay hidden"><div>松开以导入文件夹<span>StepsToGreat · Markdown 工作区</span></div></div>`;

const icon=(paths,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const folderIcon=icon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M8 13h8m-4-4v8"/>',46);
$('.folder-illustration').innerHTML=folderIcon;
$('.brand-mark').innerHTML=icon('<path d="M4 19h5v-5h5V9h6"/><path d="M14 4h6v6"/>',26);
$('#refresh').innerHTML=icon('<path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/>',16);
$('.feature-grid>div:nth-child(1)>span').innerHTML=icon('<path d="M4 5h6a3 3 0 0 1 3 3v12a4 4 0 0 0-4-2H4Z"/><path d="M13 8a3 3 0 0 1 3-3h5v13h-5a4 4 0 0 0-3 2"/>');
$('.feature-grid>div:nth-child(2)>span').innerHTML=icon('<path d="m15 5 4 4M5 19l4-1 11-11a2.8 2.8 0 0 0-4-4L5 14Z"/>');
$('.feature-grid>div:nth-child(3)>span').innerHTML=icon('<path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>');
document.documentElement.dataset.theme='mono';

import {mountWorkbench} from './workbench';
import {mountDsh} from './dsh-panel';
import {mountApplicationTheme} from './app-theme';
import {mountDocumentFooter} from './document-footer';
import './learning-shell.css';
import './refined-surfaces.css';
import './dsh-polish.css';
import './workspace-polish.css';
import './answer-workspace.css';
import './app-theme.css';
import './focus-mode.css';
import './document-footer.css';
import './editor-design.css';
import './editor-syntax.css';
import './typography.css';
import {mountEditorIcons} from './editor-icons';
const dshOnly=new URLSearchParams(location.search).has('dsh');
const documentOnly=new URLSearchParams(location.search).has('document');
if(documentOnly)document.body.classList.add('document-only');
if(dshOnly){document.body.classList.add('dsh-only');document.documentElement.classList.add('dsh-window');}
else mountWorkbench({api,renderer,renderMD,resolveLink,escape,icon,highlight:highlightCode,registry:languageRegistry,documentOnly});
if(!documentOnly)mountDsh({api,renderMD:(text,path)=>renderMD(text,path,true),escape,icon,dshOnly});
mountApplicationTheme({dshOnly});
if(!dshOnly)mountDocumentFooter();
if(!dshOnly)mountEditorIcons();
