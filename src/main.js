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
import {i18n} from './i18n.js';
import {mountLanguageControl} from './language-control.js';
import {mountNativeLanguageSync} from './language-sync.js';
import {watchDocumentTitle} from './language-sync.js';

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
  if(/^[a-z]+:/i.test(src)||src.startsWith('//')) {t.attrSet('src','');t.attrSet('alt',i18n.t('doc.remoteImageAlt',{alt:t.content||''}));}
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
<div class="native-titlebar">STG Desk <span data-i18n="app.nativeSubtitle">学习工作台</span></div>
<header class="workspace-header">
  <div class="brand"><span class="brand-mark">S<span>↗</span></span><div><strong>STG Desk</strong><small data-i18n="brand.tagline">每一步，都更进一步</small></div><span class="version">α</span></div>
  <div class="workspace-card"><span class="eyebrow" data-i18n="header.workspaceEyebrow">当前工作区</span><strong id="workspace-name">尚未导入文件夹</strong><div id="workspace-meta">支持 StepsToGreat 与普通 Markdown</div></div>
  <div class="workspace-actions">
    <button class="import primary" id="import"><span aria-hidden="true">＋</span><span class="import-label" data-i18n="header.import">导入学习文件夹</span><kbd>Ctrl O</kbd></button>
    <button id="open-dsh" class="dsh-launch" data-i18n-title="header.openDshTitle" title="打开 DSH 对话"><span class="dsh-launch-label">打开 DSH</span><span aria-hidden="true">↗</span></button>
  </div>
</header>
<section class="document-access"><div class="document-access-label"><span data-i18n="header.pages">学习页面</span><button id="refresh" data-i18n-title="header.refreshTitle" data-i18n-aria-label="header.refreshTitle" title="刷新当前文档和学习进度" aria-label="刷新当前文档和学习进度">↻</button></div><nav id="tree" class="document-tabs" data-i18n-aria-label="header.pagesAria" aria-label="教学、回答和进度页面"><span class="documents-empty" data-i18n="header.emptyDocs">导入后显示教学、回答和进度</span></nav></section>
<div class="application-body">
<main class="main">
  <header class="topbar"><div class="breadcrumb" id="breadcrumb"><span data-i18n="breadcrumb.workspace">工作台</span> <span>/</span> <span data-i18n="breadcrumb.welcome">欢迎</span></div><div class="header-actions"><button id="choose-course" class="header-button" data-i18n="header.chooseCourse">课程与文档</button><div class="local-label"><span class="dot"></span> <span data-i18n="header.localFirst">本地优先</span></div></div></header>
  <section id="welcome" class="welcome">
    <span class="welcome-tag">STEPS TO GREAT <i></i> <span data-i18n="welcome.tag">本地学习工作台</span></span><h1><span data-i18n="welcome.headline">一个文件夹，</span><br><span data-i18n="welcome.headlineAccent">一张清晰的学习桌面。</span></h1><p><span data-i18n="welcome.lead">让文档、练习和你的思考待在一起。</span><br><span data-i18n="welcome.leadSecond">打开学习文件夹，从上次停下的地方继续。</span></p>
    <div class="drop-card"><div class="folder-illustration">▱<span>md</span></div><h2 data-i18n="welcome.dropTitle">拖入你的 StepsToGreat 文件夹</h2><p data-i18n="welcome.dropHint">或点击下方按钮，从电脑中选择文件夹</p><button id="welcome-import" class="primary"><span data-i18n="welcome.chooseFolder">选择学习文件夹</span> <span aria-hidden="true">→</span></button><small data-i18n="welcome.noConvert">原有目录直接读取，无需转换格式</small><button id="welcome-demo" class="text-link demo-link" data-i18n="welcome.demo">先试用演示工作区 →</button></div>
    <div class="feature-grid"><div><span>01</span><strong data-i18n="welcome.feature1Title">阅读与编辑</strong><p data-i18n="welcome.feature1Text">清晰排版、公式、表格，直接在文档中编辑。</p></div><div><span>02</span><strong data-i18n="welcome.feature2Title">专注当前轮</strong><p data-i18n="welcome.feature2Text">关联学生回答，每次只处理当前轮的问题。</p></div><div><span>03</span><strong data-i18n="welcome.feature3Title">留住每次作答</strong><p data-i18n="welcome.feature3Text">答案追加到原文档，保存前自动备份。</p></div></div>
    <div class="recent" id="recent"></div>
  </section>
  <section id="document" class="document hidden">
    <div class="document-toolbar"><div><span class="eyebrow" id="document-kind">MARKDOWN</span><div class="document-title-wrap"><h1 id="document-title"></h1><button id="round-switch" class="round-switch hidden" popovertarget="round-menu" data-i18n-title="round.switchTitle" data-i18n-aria-label="round.switchTitle" title="切换本章教学轮次" aria-label="切换本章教学轮次" aria-haspopup="menu" aria-expanded="false" aria-controls="round-menu"><span class="round-switch-chevron"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span></button><div id="round-menu" class="round-menu" popover="auto" role="menu" data-i18n-aria-label="round.menuAria" aria-label="本章教学轮次"></div></div></div><div class="doc-actions"><button id="document-focus" class="document-focus" aria-pressed="false">专注</button><span id="save-status">已保存</span><button id="save" class="primary"><span data-i18n="doc.save">保存</span> <kbd>Ctrl S</kbd></button></div></div>
    <div id="change-banner" class="change-banner hidden"><span data-i18n="doc.changeBanner">文件夹中的文档有更新。</span><button id="load-changes" data-i18n="doc.reload">重新加载当前文档</button></div>
    <div class="doc-body"><div id="content-area" class="content-area edit"><div id="editor"></div></div>
      <aside id="answers-panel" class="answers-panel" data-i18n-aria-label="doc.answerPanelAria" aria-label="学生作答工作区"><div class="answer-heading"><h2 data-i18n="doc.answerHeading">作答工作区</h2><button id="answer-focus" aria-pressed="false" aria-controls="answers-panel" data-i18n-title="doc.answerFocusTitle" title="放大作答区域，按 Esc 返回">专注作答</button><p id="answer-description">选择一份教学引导，开始作答。</p><div id="answer-document-name" class="answer-document-name"></div></div><div class="answer-tabs" role="group" data-i18n-aria-label="doc.answerTabsAria" aria-label="作答工作区内容"><button data-answer-tab="current" aria-pressed="true" data-i18n="doc.currentRound">本轮作答</button><button data-answer-tab="records" aria-pressed="false" data-i18n="doc.answerRecordsTab">作答记录</button><button data-answer-tab="document" aria-pressed="false" data-i18n="doc.fullDocument">完整文档</button></div><div id="answer-question-nav" class="answer-question-nav hidden" role="group" data-i18n-aria-label="doc.roundQuestions" aria-label="切换本轮题目"></div><div id="answer-content"></div><section id="answer-records" class="hidden" data-i18n-aria-label="doc.answerRecordsAria" aria-label="历史作答与导师反馈"></section><section id="answer-document" class="hidden"><div class="answer-document-tools"><span id="answer-source-status">已保存版本</span><button id="answer-history" data-i18n="answer.history">历史版本</button><button id="answer-edit-source">编辑</button></div><article id="answer-document-preview" class="markdown-body"></article><textarea id="answer-source" class="hidden" data-i18n-aria-label="answer.sourceAria" aria-label="完整回答文档 Markdown" spellcheck="false"></textarea></section><div id="answer-footer"></div></aside>
    </div>
  </section>
  <section id="progress-page" class="progress-page hidden" aria-labelledby="progress-title"><span class="eyebrow">LEARNING PROGRESS</span><h1 id="progress-title"></h1><div id="progress-content"></div></section>
  <footer class="statusbar"><span id="status-left">所有文档保存在你的电脑上</span><span id="status-right">UTF-8 · Markdown</span></footer>
</main><section id="dsh-host" class="dsh-host hidden"></section></div><div id="toast" class="toast hidden" role="status"></div><div id="drop-overlay" class="drop-overlay hidden"><div><span data-i18n="drop.release">松开以导入文件夹</span><span data-i18n="drop.subtitle">StepsToGreat · Markdown 工作区</span></div></div>`;
i18n.apply();

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
import './answer-layout.css';
import './answer-editor.css';
import './ui-system.css';
import './language-control.css';
import './workspace-header.css';
import {mountPaneLayout} from './pane-layout';
import {mountEditorIcons} from './editor-icons';
const dshOnly=new URLSearchParams(location.search).has('dsh');
const documentOnly=new URLSearchParams(location.search).has('document');
if(documentOnly)document.body.classList.add('document-only');
if(dshOnly){document.body.classList.add('dsh-only');document.documentElement.classList.add('dsh-window');}
if(!dshOnly)mountWorkbench({api,renderer,renderMD,resolveLink,escape,icon,highlight:highlightCode,registry:languageRegistry,documentOnly});
if(!documentOnly)mountDsh({api,renderMD:(text,path)=>renderMD(text,path,true),escape,icon,dshOnly});
mountLanguageControl({dshOnly,documentOnly});
mountNativeLanguageSync(api);
i18n.apply();
watchDocumentTitle();
mountApplicationTheme({dshOnly});
if(!dshOnly)mountDocumentFooter();
if(!dshOnly)mountEditorIcons();
if(!dshOnly)mountPaneLayout();
