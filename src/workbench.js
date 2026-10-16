import {createVisualEditor} from './visual-editor';
import katex from 'katex';
import {editorIcon} from './editor-icons';
import {formulaBody,isDisplaySource,wrapFormula,renderFormula} from './editor-formula.mjs';
import {copyText} from './editor-rich.js';
import {mountAnswerEditor} from './answer-editor';
import {mountFocusMode} from './focus-mode';
import {renderProgressSummary} from './progress-view';
import {mountRoundNavigation} from './round-navigation';
import './progress-view.css';
import './workbench.css';

export function mountWorkbench({api,renderer,renderMD,resolveLink,escape,icon,highlight,registry,documentOnly=false}) {
  const $=s=>document.querySelector(s);
  const state={workspace:null,doc:null,answer:null,answerCache:null,answerTab:'current',answerEditing:false,answerSource:'',answerBaseContent:'',answerBaseVersion:null,answerRecords:null,parsedAnswerSource:null,documentWindow:null,dirty:false,answers:{},orphans:[],loading:false,busy:false,documents:[],learning:null,preferences:{fontSize:16,lineHeight:1.9,readingWidth:820,backupRetention:20}};
  let visual,sourceContent=null,draftTimer,draftWrites=Promise.resolve(),loadEpoch=0,page='document',progress={},detachedWindows=[],windowEvents=[],handlingWindowEvents=false,returningPaths=new Set();
  $('#workspace-meta').insertAdjacentHTML('afterend','<button id="continue-learning" class="continue-learning hidden">继续学习 <span>→</span></button><small id="current-learning"></small>');
  $('.header-actions').insertAdjacentHTML('afterbegin','<button id="preferences" class="header-button">阅读设置</button>');
  $('.doc-actions').insertAdjacentHTML('afterbegin','<span id="draft-status"></span>');
  $('.doc-actions').insertAdjacentHTML('beforeend','<button id="document-popout" class="hidden" title="移到独立窗口，主应用切换到另一份文档">开窗口 ↗</button>');
  $('.doc-actions').insertAdjacentHTML('beforeend',`<button id="insert-formula" title="插入数学公式">${editorIcon('math')}公式</button>`);
  $('#app').insertAdjacentHTML('afterend','<div id="modal" class="modal-overlay hidden" role="dialog" aria-modal="true"><section class="modal-card"><header><div><span id="modal-eyebrow" class="eyebrow"></span><h2 id="modal-title"></h2></div><button id="modal-close" aria-label="关闭">×</button></header><div id="modal-body"></div><footer id="modal-actions"></footer></section></div>');
  const smallIcons={preferences:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="white"/><circle cx="15" cy="17" r="2" fill="white"/>',save:'<path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>'};
  for(const [id,path] of Object.entries(smallIcons)){const button=$('#'+id);button.insertAdjacentHTML('afterbegin',icon(path,14)+' ');}
  $('#import>span').innerHTML=icon('<path d="M12 5v14M5 12h14"/>',17);
  const fileIcon=icon('<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 13h8M8 17h6"/>',15);
  const folderIcon=icon('<path d="M3 7V5h7l2 2h9v13H3Z"/>',15);

  mountFocusMode($('#document-focus'));
  let activeQuestionKey=null;
  let answerEditors=[];
  const answerLanguages=new Map();
  const setAnswerFocused=enabled=>{
    document.body.classList.toggle('answer-focused',enabled);
    $('#answer-focus').setAttribute('aria-pressed',String(enabled));
    $('#answer-focus').textContent=enabled?'返回对照':'专注作答';
  };
  $('#answer-focus').addEventListener('click',()=>setAnswerFocused(!document.body.classList.contains('answer-focused')));
  $('#document-focus').addEventListener('click',()=>setAnswerFocused(false));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')setAnswerFocused(false);});

  function message(text,error=false){const box=$('#toast');box.textContent=text;box.className=`toast ${error?'error':''}`;clearTimeout(message.timer);message.timer=setTimeout(()=>box.classList.add('hidden'),5000);}
  async function guarded(task){if(state.busy)return;state.busy=true;document.documentElement.dataset.busy='true';try{await task();}catch(e){message(cleanError(e),true);}finally{state.busy=false;document.documentElement.dataset.busy='false';drainWindowEvents();}}
  function cleanError(e){return String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');}
  function questionKey(q){return JSON.stringify([q.round,q.number,q.title,q.prompt]);}
  function answerValue(q){return state.answers[questionKey(q)]??q.answer?.value??'';}
  function hasAnswers(){const current=state.answer?.questions.current||[];return Object.entries(state.answers).some(([key,value])=>value!==(current.find(q=>questionKey(q)===key)?.answer?.value??''));}
  function text(){return sourceContent??state.doc?.content??'';}
  function sourceLineOffset(line){let offset=0;for(let n=1;n<line;n++){const next=text().indexOf('\n',offset);if(next<0)return text().length;offset=next+1;}return offset;}
  function answerSourceDirty(){return !!state.answer&&state.answerSource!==state.answer.content;}
  function recoveredEdits(record){return record&&record.content!==record.baseContent&&renderer.render(record.content.replace(/\r\n/g,'\n'))!==renderer.render((record.baseContent??'').replace(/\r\n/g,'\n'));}
  function dirtyState(){state.dirty=!!state.doc&&text()!==state.doc.content;api?.dirty(state.dirty||hasAnswers()||answerSourceDirty());const pending=state.dirty||hasAnswers()||answerSourceDirty();$('#save-status').textContent=pending?'待保存到文档':'已保存';$('#save-status').classList.toggle('unsaved',pending);}
  function scheduleDraft(){clearTimeout(draftTimer);$('#draft-status').textContent='';draftTimer=setTimeout(()=>flushDraft().catch(e=>{message(cleanError(e),true);$('#draft-status').textContent='输入保留失败，请点击保存';}),250);}
  function flushDraft(){
    clearTimeout(draftTimer);draftWrites=draftWrites.catch(()=>{}).then(persistInput);return draftWrites;
  }
  async function persistInput(){
    if(!api||!state.doc)return;
    const doc=state.doc,answer=state.answer,content=text(),answers=Object.fromEntries(Object.entries(state.answers).filter(([key,value])=>value!==((answer?.questions.current||[]).find(q=>questionKey(q)===key)?.answer?.value??'')));
    const has=Object.keys(answers).length>0;
    const docRecord={content,baseContent:doc.content,baseVersion:doc.version,mode:'edit',answers:doc.path===answer?.path?answers:{}};
    if(!isDetached(doc.path)&&!returningPaths.has(doc.path)){if(content!==doc.content||(has&&doc.path===answer?.path))await api.draftPut(doc.path,docRecord);else await api.draftRemove(doc.path);}
    if(answer&&answer.path!==doc.path&&!isDetached(answer.path)&&!returningPaths.has(answer.path)){
      const record={...(state.answerCache||{}),content:state.answerSource,baseContent:state.answerBaseContent,baseVersion:state.answerBaseVersion,answers};
      if(has||record.content!==record.baseContent)await api.draftPut(answer.path,record);else await api.draftRemove(answer.path);
    }
    $('#draft-status').textContent='';
    updateAnswerStatus();
  }
  async function mayLeave(){await flushDraft();return true;}
  function allFiles(nodes=state.workspace?.children||[]){return nodes.flatMap(n=>n.children?allFiles(n.children):[n]);}
  function describe(path){
    const name=path.split('/').at(-1);const kind=/教学引导/.test(name)?'guide':/学生回答/.test(name)?'answer':/课程路线/.test(name)?'route':/学习档案/.test(name)?'profile':/我的规则/.test(name)?'rules':path.startsWith('资料/')?'material':'document';
    return {kind,label:({guide:'教学',answer:'回答',route:'路线',profile:'档案',rules:'规则',material:'资料',document:'文档'})[kind]};
  }
  const roundNumber=value=>{
    const token=String(value||'').replace(/\s+/g,'').match(/第([一二三四五六七八九十\d]+)轮/)?.[1];
    if(!token)return null;
    if(/^\d+$/.test(token))return Number(token);
    const digit={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
    return token.includes('十')?(token.startsWith('十')?1:digit[token[0]]||0)*10+(digit[token.split('十')[1]]||0):digit[token]||null;
  };
  async function defaultTeachingPath(path=state.learning?.guidePath||state.learning?.answerPath){
    if(!path||!/(?:^|\/)01_教学引导\.md$/i.test(path))return path;
    const dir=path.split('/').slice(0,-1).join('/');
    const learningPath=state.learning?.guidePath||state.learning?.answerPath;
    const sameLesson=learningPath?.split('/').slice(0,-1).join('/')===dir;
    const round=sameLesson&&state.learning?.round?state.learning.round:(await api.companion(path))?.questions?.round;
    const number=roundNumber(round);
    if(!number)return path;
    return allFiles().find(file=>file.readable&&file.path.split('/').slice(0,-1).join('/')===dir&&/(?:^|\/)第[一二三四五六七八九十\d]+轮_教学引导\.md$/i.test(file.path)&&roundNumber(file.path.split('/').at(-1))===number)?.path||path;
  }
  const roundNavigation=mountRoundNavigation({escape,icon,onSelect:path=>guarded(()=>selectFile(path))});
  function drawRoundSwitch(){
    const active=state.doc?.path;if(!active){roundNavigation.update({rounds:[]});return;}
    const dir=active.split('/').slice(0,-1).join('/');
    const files=allFiles().filter(f=>f.readable&&f.path.split('/').slice(0,-1).join('/')===dir);
    const rounds=files.map(f=>({path:f.path,number:roundNumber(f.path.split('/').at(-1))})).filter(f=>f.number&&/(?:^|\/)第[一二三四五六七八九十\d]+轮_教学引导\.md$/i.test(f.path)).sort((a,b)=>a.number-b.number);
    const index=files.find(f=>/(?:^|\/)01_教学引导\.md$/i.test(f.path));
    if(rounds.length&&index?.path===active)$('#document-title').textContent='教学总入口';
    roundNavigation.update({rounds,index,activePath:active,title:$('#document-title').textContent,isDetached});
  }
  function drawTree(){
    const teaching=state.documents.find(d=>d.kind==='guide'&&d.path===state.doc?.path)||state.documents.find(d=>d.kind==='guide');
    $('#tree').innerHTML=(state.documents||[]).filter(d=>d===teaching||d.kind==='answer').map(d=>`<button class="file ${page==='document'&&state.doc?.path===d.path?'selected':''}" data-file="${escape(d.path)}" ${isDetached(d.path)?'disabled':''} title="${escape(isDetached(d.path)?'已在独立窗口打开，关闭窗口后返回':d.path)}"><span>${escape(d===teaching?'教学引导':d.label)}</span>${isDetached(d.path)?'<small>窗口中</small>':''}</button>`).join('')+['chapter','overall'].map(kind=>`<button class="file ${page===kind?'selected':''}" data-progress="${kind}">${kind==='chapter'?'当前章节进度':'总体进度'}</button>`).join('');
    drawRoundSwitch();
  }
  function isDetached(path){return !documentOnly&&detachedWindows.some(w=>w.root===state.workspace?.root&&w.path===path);}
  async function updateDocuments(){if(!api||!state.workspace)return;const result=await api.documents({currentPath:state.doc?.path||null});state.documents=result.documents;progress=result.progress||{};drawTree();document.body.classList.toggle('answer-detached',!!state.answer&&isDetached(state.answer.path));if(page!=='document')await renderProgress();}
  function progressSections(content,pattern){const tokens=renderer.parse(content,{}),headings=tokens.filter(t=>t.type==='heading_open'&&t.level===0);return headings.flatMap((h,i)=>{const title=tokens[tokens.indexOf(h)+1]?.content||'';if(!pattern.test(title))return [];const end=headings.slice(i+1).find(n=>Number(n.tag.slice(1))<=Number(h.tag.slice(1)))?.map[0];return [content.split(/\r?\n/).slice(h.map[0],end).join('\n')];}).join('\n\n');}
  async function renderProgress(){
    const kind=page,chapter=kind==='chapter';if(kind==='document')return;
    $('#progress-title').textContent=chapter?'当前章节进度':'总体进度';
    const source=chapter?state.learning?.profilePath:state.documents.find(d=>d.kind==='route')?.path||state.learning?.profilePath;
    let details='';
    const active=state.documents.find(d=>d.kind==='guide'||d.kind==='answer')?.path;
    const sameLesson=active&&[state.learning?.guidePath,state.learning?.answerPath].some(p=>p&&p.split('/').slice(0,-1).join('/')===active.split('/').slice(0,-1).join('/'));
    if(source&&(!chapter||sameLesson)){try{const doc=await api.read(source);details=source===state.learning?.profilePath?progressSections(doc.content,chapter?/🚦|当前交接/:/📊|掌握|📚|课次.*索引/):doc.content;}catch{}}
    if(page!==kind)return;
    const lesson=active?.split('/').at(-2)||state.learning?.lesson||'尚未选择课程';
    $('#progress-content').innerHTML=renderProgressSummary({label:chapter?lesson:'已记录的学习进度',status:progress[kind],chapter,escape})+(details?`<article class="markdown-body">${renderMD(details,source)}</article>`:'<p class="progress-empty">暂无更多进度记录，导师更新文档后会自动刷新。</p>');
  }
  async function showProgress(kind){await mayLeave();page=kind;$('#welcome').classList.add('hidden');$('#document').classList.add('hidden');$('#progress-page').classList.remove('hidden');drawTree();await renderProgress();}
  async function moveOutOfDocument(path){
    if(page!=='document'||state.doc?.path!==path)return;
    const other=state.documents.find(d=>['guide','answer'].includes(d.kind)&&d.path!==path&&!isDetached(d.path));
    if(other)await selectFile(other.path);else await showProgress('chapter');
  }
  async function popout(){
    if(!state.doc||documentOnly||page!=='document')return;
    const path=state.doc.path;await flushDraft();const result=await api.documentWindowOpen(path);
    detachedWindows=result.windows||await api.documentWindowList();drawTree();await moveOutOfDocument(path);
  }
  async function drainWindowEvents(){
    if(state.busy||handlingWindowEvents||documentOnly)return;handlingWindowEvents=true;
    try{while(windowEvents.length){const event=windowEvents.shift();if(event.root!==state.workspace?.root)continue;await guarded(async()=>{if(event.type==='closed'&&!isDetached(event.path)){try{await selectFile(event.path);}finally{returningPaths.delete(event.path);}}else if(event.type==='opened')await moveOutOfDocument(event.path);});}}finally{handlingWindowEvents=false;}
  }
  async function updateLearning(){
    if(!api||!state.workspace)return;
    state.learning=await api.learning();
    const l=state.learning;const target=l?.guidePath||l?.answerPath;
    $('#continue-learning').classList.toggle('hidden',!target);
    $('#current-learning').textContent=target?[l.subject,l.lesson,l.round].filter(Boolean).join(' · '):'尚未发布当前课程';
    if(l?.warnings?.length)$('#current-learning').title=l.warnings.join('\n');
  }
  async function importFolder(root,initialPath=null){
    if(!api){message('请使用桌面应用导入本地文件夹。');return;}
    await mayLeave();const info=root==='__demo__'?await api.openDemo():root?await api.openRoot(root):await api.openDialog();if(!info)return;
    state.workspace=info;state.doc=null;state.answer=null;state.answers={};loadEpoch++;
    detachedWindows=documentOnly?[]:await api.documentWindowList();page='document';$('#progress-page').classList.add('hidden');
    $('#workspace-name').textContent=info.name;$('#workspace-name').title=info.root;
    $('#workspace-meta').textContent=info.stg?'StepsToGreat 工作区':'学习文档工作区';
    await updateLearning();await updateDocuments();$('#status-left').textContent=info.root;
    const drafts=await api.draftList();const recover=drafts.find(d=>allFiles().some(f=>f.path===d.path));
    const first=initialPath||await defaultTeachingPath()||state.documents?.find(d=>d.kind==='profile')?.path||recover?.path||state.documents?.[0]?.path;
    if(first&&!isDetached(first))await selectFile(first,{approved:true});else if(first){const other=state.documents.find(d=>['guide','answer'].includes(d.kind)&&!isDetached(d.path));if(other)await selectFile(other.path,{approved:true});else await showProgress('chapter');}else{$('#document').classList.add('hidden');$('#welcome').classList.remove('hidden');message('文件夹已导入，但未找到文档。');}
    if(info.warnings?.length)message(info.warnings[0]);
  }
  function replaceSource(content){if(text()!==content){sourceContent=content;visual?.destroy();visual=null;mountVisual();}dirtyState();updateDocumentText();}
  async function selectFile(path,{approved=false,line=null}={}){
    if(isDetached(path)){message('这份文档已在独立窗口中，关闭窗口后会返回这里。');return;}
    if(state.documentWindow&&path!==state.documentWindow.path){if(/(教学引导|学生回答)\.md$/i.test(path))await api.documentWindowOpen(path);else await api.reveal(path);return;}
    if(!approved)await mayLeave();const epoch=++loadEpoch;
    setAnswerFocused(false);
    page='document';$('#progress-page').classList.add('hidden');
    const [disk,answer,draft,description]=await Promise.all([api.read(path),api.companion(path),api.draftGet(path),api.describe(path)]);
    if(epoch!==loadEpoch)return;
    state.doc=disk;state.answer=answer;state.answers={};state.answerCache=answer?(answer.path===path?draft:await api.draftGet(answer.path)):null;
    let content=disk.content;
    if(recoveredEdits(draft)&&draft.content!==disk.content){content=draft.content;state.doc={...disk,content:draft.baseContent??disk.content,version:draft.baseVersion};}
    state.answers={...(state.answerCache?.answers||{})};
    const editedAnswer=recoveredEdits(state.answerCache);
    state.answerSource=editedAnswer?state.answerCache.content:answer?.content??'';
    state.answerBaseContent=editedAnswer?state.answerCache.baseContent:answer?.content??'';
    state.answerBaseVersion=editedAnswer?state.answerCache.baseVersion:answer?.version??null;
    state.answerEditing=false;state.answerRecords=answer?await api.answerRecords(state.answerSource):null;state.parsedAnswerSource=state.answerSource;if(answer)state.answer.questions=state.answerRecords.questions;
    const viewedRound=roundNumber(path.split('/').at(-1));
    state.answerTab=viewedRound&&viewedRound!==roundNumber(answer?.questions?.round)?'records':'current';
    if(epoch!==loadEpoch)return;
    sourceContent=content;visual?.destroy();visual=null;$('#editor').innerHTML='';
    $('#welcome').classList.add('hidden');$('#document').classList.remove('hidden');
    $('#document-title').textContent=viewedRound&&description.kind==='guide'?`第 ${viewedRound} 轮 · 教学引导`:description.lesson?`${description.lesson} · ${description.label}`:path.split('/').at(-1).replace(/\.(md|markdown|txt)$/i,'');
    $('#document-kind').textContent=`${description.label} · ${description.kind==='guide'?'TEACHING GUIDE':description.kind==='answer'?'YOUR ANSWERS':'MARKDOWN'}`;
    if(state.documentWindow){$('.native-titlebar span').textContent=description.lesson||description.label;if(state.documentWindow.kind==='answer')$('.answer-heading h2').textContent=description.lesson||'学生作答';}
    $('#breadcrumb').innerHTML=`${escape(state.workspace.name)} <span>/</span> ${escape(path)}`;
    $('#change-banner').classList.toggle('hidden',state.doc.version===disk.version);
    dirtyState();await updateDocuments();await api.documentContext(path);updateDocumentText();renderAnswers();renderAnswerWorkspace();
    document.body.classList.toggle('answer-document-active',description.kind==='answer');
    mountVisual();
    $('#document-popout').classList.toggle('hidden',!/(教学引导|学生回答)\.md$/i.test(path)||!!state.documentWindow);
    $('#draft-status').textContent='';
    $('#status-left').textContent=path;
    if(line)visual?.jumpToSource(sourceLineOffset(line));
  }
  function updateDocumentText(){
    if(!state.doc)return;const content=text();
    if(state.answer?.path===state.doc.path)state.answerSource=content;
    $('#status-right').textContent=`${content.length.toLocaleString()} 字符 · UTF-8 · Markdown`;
  }
  function mountVisual(){
    if(!state.doc)return;
    if(visual&&visual.getSource()===text())return;
    visual?.destroy();$('#editor .visual-host')?.remove();
    const host=document.createElement('div');host.className='visual-host';$('#editor').append(host);
    visual=createVisualEditor(host,text(),content=>{
      sourceContent=content;dirtyState();updateDocumentText();scheduleDraft();
    },{renderer,renderMD,path:state.doc.path,onMath:editFormula,highlight,registry,onCopyCode:copyText});
  }
  function editFormula({source='',display,apply}={}){
    const savedSelection=visual?.state.selection;
    const block=display??isDisplaySource(source);
    modal(source?'编辑公式':'插入公式',`<div class="preferences-form"><label>LaTeX 公式<textarea id="formula-source" rows="3" spellcheck="false">${escape(formulaBody(source).trim())}</textarea></label><label>显示方式<select id="formula-display" ${source?'disabled':''}><option value="inline" ${block?'':'selected'}>行内公式</option><option value="block" ${block?'selected':''}>独立公式块</option></select></label></div><p class="formula-help">例如：x^2 + y^2 = z^2、\\frac{a}{b}、\\sum_{i=1}^{n} i。已有公式可双击修改。</p><div id="formula-preview" class="formula-preview" aria-label="公式预览"></div>`,[{label:source?'应用':'插入',primary:true,action:async()=>{
      const value=$('#formula-source').value.trim();if(!value)throw Error('请输入公式。');
      const displayMode=$('#formula-display').value==='block';
      if(!displayMode&&/[\r\n]/.test(value))throw Error('多行公式请选择独立公式块。');
      const wrapped=wrapFormula(value,displayMode);
      const rendered=renderFormula(wrapped,katex,{display:displayMode});if(rendered.error)throw Error(rendered.error);
      if(apply)apply(wrapped);
      else if(visual){
        visual.commands.setTextSelection({from:savedSelection.from,to:savedSelection.to});
        visual.commands.insertContent(displayMode?{type:'mathBlock',attrs:{source:wrapped}}:{type:'mathInline',attrs:{source:wrapped}});
      }
      closeModal();visual?.commands.focus();
    }},{label:'取消',action:async()=>closeModal()}],'数学公式 · 实时预览');
    const preview=()=>{
      const value=$('#formula-source').value.trim();
      if(!value){$('#formula-preview').textContent='在上方输入公式';return;}
      const rendered=renderFormula(wrapFormula(value,$('#formula-display').value==='block'),katex);
      if(rendered.error)$('#formula-preview').textContent=rendered.error;else $('#formula-preview').innerHTML=rendered.html;
    };
    $('#modal-body').oninput=preview;preview();$('#formula-source').focus();
  }
  $('#insert-formula').onclick=()=>{if(visual)editFormula();};
  function renderAnswers(){
    answerEditors.forEach(dispose=>dispose());answerEditors=[];
    const answer=state.answer,current=answer?.questions?.current||[];$('#answer-footer').innerHTML='';
    $('#answer-question-nav').classList.add('hidden');
    if(!answer){$('#answer-description').textContent='选择教学引导或学生回答文档。';$('#answer-content').innerHTML='<div class="answer-empty"><span>✎</span><strong>在这里专注作答</strong><p>教学引导关联同目录的学生回答。</p></div>';return;}
    $('#answer-description').textContent=`${answer.questions.round} · ${current.length} 道题`;
    if(!current.length||current.length>3){$('#answer-content').innerHTML='<div class="answer-empty"><p>这份文档暂不支持按题作答，可以在这里编辑完整回答文档。</p><button id="answer-edit-fallback">编辑完整文档</button></div>';return;}
    const known=new Set(current.map(questionKey));
    const orphan=Object.entries(state.answers).filter(([k,v])=>v&& !known.has(k));
    $('#answer-content').innerHTML=current.map((q,i)=>`<section class="question-card"><div class="question-number">问题 ${escape(q.number)} <span>${i+1} / ${current.length}</span></div><h3>${escape(q.title.replace(/.*(?:问题|题目|练习题)\s*\d+\s*[:：·]?/,''))||'当前问题'}</h3><details class="answer-prompt"><summary>题干与示例 <span class="answer-prompt-hint"></span></summary><div class="question-prompt markdown-body">${renderMD(q.prompt,answer.path)}</div></details><label for="answer-${i}">你的回答</label><textarea id="answer-${i}" data-answer-index="${i}" placeholder="写下你的理解，或粘贴代码…" spellcheck="false">${escape(answerValue(q))}</textarea></section>`).join('')+orphan.map(([key,value])=>`<section class="orphan-draft"><strong>题目变化前的输入</strong><p>已保留，请核对后复制到当前题目。</p><textarea readonly>${escape(value)}</textarea><button data-discard-answer="${escape(key)}">移除此输入</button></section>`).join('');
    $('#answer-content').querySelectorAll('.question-card').forEach((card,i)=>{
      const q=current[i],guideQuestion=/教学引导\.md$/i.test(state.doc.path)?state.doc.questions?.questions?.find(g=>g.number===q.number&&g.round===q.round):null;
      const prompt=guideQuestion&&(!q.prompt.trim()||/^[\s<>→-]+$/.test(q.prompt))?guideQuestion.prompt:q.prompt;
      if(prompt!==q.prompt)card.querySelector('.question-prompt').innerHTML=renderMD(prompt,state.doc.path);
      card.querySelector('.answer-prompt').open=prompt.length<=260&&prompt.split('\n').length<=8;
      card.insertAdjacentHTML('beforeend',`<div class="answer-input-tools"><button data-answer-code="${i}">插入代码块</button><span data-answer-count="${i}">${(answerValue(q)).length} 字</span></div>`);
      answerEditors.push(mountAnswerEditor(card.querySelector('[data-answer-index]'),{context:prompt+'\n'+state.doc.content,language:answerLanguages.get(questionKey(q))||'auto',onLanguage:language=>answerLanguages.set(questionKey(q),language)}));
    });
    $('#answer-footer').innerHTML='<div class="answer-footer-status" id="answer-draft-status">点击保存，写入回答文档</div><button class="primary" id="submit">保存本轮作答 <span>→</span></button><p>回答与学生文档同步，保存后可继续修改。</p>';
    $('#submit').title='保存所有已填写的本轮答案。回答与学生文档同步，保存后可继续修改。专注作答时可按 Ctrl S 保存。';
    $('#answer-question-nav').innerHTML='<span class="answer-question-position" aria-live="polite"></span>'+current.map((q,i)=>`<button data-answer-question="${i}" aria-controls="answer-${i}" aria-pressed="false" aria-label="问题 ${escape(q.number)}，${answerValue(q).trim()?'已填写':'未填写'}">问题 ${escape(q.number)} <span class="answer-question-check" aria-hidden="true">${answerValue(q).trim()?'✓':''}</span></button>`).join('');
    showAnswerQuestion(Math.max(0,current.findIndex(q=>questionKey(q)===activeQuestionKey)));
  }
  function showAnswerQuestion(index){
    const current=state.answer?.questions?.current||[];
    if(!current[index])return;
    activeQuestionKey=questionKey(current[index]);
    $('#answer-content').querySelectorAll('.question-card').forEach((card,i)=>card.classList.toggle('hidden',i!==index));
    $('#answer-question-nav').classList.toggle('hidden',state.answerTab!=='current');
    $('#answer-question-nav').querySelectorAll('[data-answer-question]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.answerQuestion)===index)));
    $('.answer-question-position').textContent=`${index+1} / ${current.length}`;
    $('#answer-content').scrollTop=0;
  }
  function updateAnswerStatus(){const el=$('#answer-draft-status');if(el)el.textContent=hasAnswers()||answerSourceDirty()?'有修改 · 点击保存即可写入回答文档':'学生文档已保存 · 可继续作答';}
  function renderAnswerWorkspace(){
    const answer=state.answer,tab=state.answerTab;
    $('#answer-question-nav').classList.add('hidden');
    $('#answer-focus').disabled=!answer;
    $('#answer-document-name').textContent=answer?.path.split('/').at(-1)||'尚无配套学生文档';$('#answer-document-name').title=answer?.path||'';
    document.querySelectorAll('[data-answer-tab]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.answerTab===tab));b.disabled=!answer;});
    $('#answer-content').classList.toggle('hidden',tab!=='current');$('#answer-records').classList.toggle('hidden',tab!=='records');$('#answer-document').classList.toggle('hidden',tab!=='document');
    if(tab==='current'){renderAnswers();}
    else if(tab==='records'){
      const records=state.answerRecords,rounds=records?.rounds||[],tutor=records?.finalSections||[];
      const viewedRound=roundNumber(state.doc?.path.split('/').at(-1));
      if(viewedRound)$('#answer-description').textContent=`第${viewedRound}轮 · 历史作答`;
      $('#answer-records').innerHTML='<p class="answer-record-note">历史原答与导师反馈按文档原文显示。</p>'+(records?.blocks||[]).filter(r=>r.kind!=='preamble').map((r,i)=>`<details class="answer-record" ${(viewedRound?roundNumber(r.title)===viewedRound:i===rounds.length-1)?'open':''}><summary>${escape(r.title)}</summary><div class="markdown-body">${renderMD(r.content,answer.path)}</div></details>`).join('');
      if(!rounds.length&&!tutor.length)$('#answer-records').insertAdjacentHTML('beforeend','<div class="answer-empty"><p>尚未识别到轮次记录，完整文档中的内容仍全部保留。</p><button data-answer-tab="document">查看完整文档</button></div>');
      $('#answer-footer').innerHTML='<p>只展示已有记录，不自动生成评估或掌握结果。</p>';
    }else{
      $('#answer-source-status').textContent=answerSourceDirty()||hasAnswers()?'有修改 · 待保存':'已保存版本';$('#answer-edit-source').textContent=state.answerEditing?'预览':'编辑';
      $('#answer-document-preview').innerHTML=answer?renderMD(state.answerSource,answer.path):'';
      if(answer&&hasAnswers())previewCurrentAnswers();
      $('#answer-document-preview').classList.toggle('hidden',state.answerEditing);$('#answer-source').classList.toggle('hidden',!state.answerEditing);
      if($('#answer-source').value!==state.answerSource)$('#answer-source').value=state.answerSource;
      $('#answer-footer').innerHTML=state.answerEditing?'<div class="answer-footer-status" id="answer-draft-status"></div><button class="primary" id="answer-save-source">保存回答文档 <span>Ctrl S</span></button><p>写入前校验版本并备份，原有轮次和评估完整保留。</p>':'<p>完整回答文档已在这里展示，可直接编辑或查看历史版本。</p>';
    }
    updateAnswerStatus();
  }
  async function acceptAnswer(result,{savedSource}={}){
    const pending=savedSource!==undefined&&state.answerSource!==savedSource?state.answerSource:result.content;
    state.answer=result;state.answerCache=null;state.answerSource=pending;state.answerBaseContent=result.content;state.answerBaseVersion=result.version;
    if(state.doc?.path===result.path){const displayed=text();state.doc=result;replaceSource(savedSource!==undefined&&displayed!==savedSource?displayed:result.content);}
    state.answerRecords=await api.answerRecords(result.content);state.parsedAnswerSource=result.content;
    dirtyState();await flushDraft();
    const focused=document.activeElement,inputFocus=focused?.matches('#answer-source,[data-answer-index]')?{id:focused.id,start:focused.selectionStart,end:focused.selectionEnd,top:focused.scrollTop}:null;
    const scrollTop=$('#answer-content').scrollTop;
    renderAnswerWorkspace();
    if(inputFocus){const input=document.getElementById(inputFocus.id);if(input){input.focus({preventScroll:true});input.setSelectionRange(inputFocus.start,inputFocus.end);input.scrollTop=inputFocus.top;$('#answer-content').scrollTop=scrollTop;}}
  }
  function answerEntries(){
    return (state.answer?.questions.current||[]).filter(q=>Object.hasOwn(state.answers,questionKey(q))&&state.answers[questionKey(q)]!==(q.answer?.value??'')).map(q=>({...q,value:state.answers[questionKey(q)]}));
  }
  async function previewCurrentAnswers(){
    const path=state.answer.path,source=state.answerSource,entries=answerEntries();
    try{
      const content=await api.composeAnswers(source,entries);
      if(state.answer?.path===path&&state.answerSource===source&&JSON.stringify(answerEntries())===JSON.stringify(entries)&&state.answerTab==='document'){
        $('#answer-document-preview').innerHTML=renderMD(content,path);
        // Editing the full document edits the underlying text; pending answers
        // are included by the same save operation, without a second save step.
      }
    }catch(e){message(cleanError(e),true);}
  }
  async function materializeAnswers(){
    if(!state.answer)return;
    const entries=answerEntries(),source=state.answerSource;
    if(entries.length){
      const content=await api.composeAnswers(source,entries);
      state.answerSource=content;
      for(const q of entries)if(state.answers[questionKey(q)]===q.value)delete state.answers[questionKey(q)];
      if(state.doc.path===state.answer.path)replaceSource(content);
    }
    const records=await api.answerRecords(state.answerSource);
    state.answer.questions=records.questions;state.answerRecords=records;state.parsedAnswerSource=state.answerSource;
    dirtyState();await flushDraft();
  }
  async function saveAnswerDocument(){return saveAll();}
  async function answerHistory(){
    if(answerSourceDirty()||hasAnswers())await saveAll();
    const target=state.answer;if(!target)return;const backups=await api.backups(target.path);
    modal('回答文档历史版本',`<p class="modal-note">恢复前会备份当前版本；未提交的本轮答案继续保留。</p><div class="history-layout"><nav class="history-list">${backups.map(b=>`<button data-answer-backup="${escape(b.id)}">${new Date(b.date).toLocaleString('zh-CN')}</button>`).join('')||'<p>尚无历史版本。</p>'}</nav><pre id="answer-backup-preview" class="backup-preview">选择版本查看原文。</pre></div>`,[{label:'关闭',action:async()=>closeModal()}],'学生文档 · 本地备份');
    $('#modal-body').onclick=async e=>{const b=e.target.closest('[data-answer-backup]');if(!b)return;try{const content=await api.backupRead(target.path,b.dataset.answerBackup);$('#answer-backup-preview').textContent=content;$('#modal-actions').innerHTML='';const restore=document.createElement('button');restore.className='primary';restore.textContent='恢复这个版本';restore.onclick=()=>guarded(async()=>{const result=await api.backupRestore(target.path,b.dataset.answerBackup,target.version);closeModal();await acceptAnswer(result);message('回答文档历史版本已恢复。');});$('#modal-actions').append(restore);}catch(e){message(cleanError(e),true);}};
  }
  async function saveAll(){
    if(!state.doc)return;
    await flushDraft();
    const entries=answerEntries();
    let changed=false;
    // Save edits to the lesson as part of the same click as the answers.
    if(state.dirty&&state.doc.path!==state.answer?.path){
      const content=text(),result=await api.saveCurrent(state.doc.path,{content,baseContent:state.doc.content});
      state.doc=result;
      if(text()===content)replaceSource(result.content);
      changed=true;
    }
    if(state.answer&&(entries.length||answerSourceDirty()||(state.dirty&&state.doc.path===state.answer.path))){
      const content=state.answerSource,result=await api.saveCurrent(state.answer.path,{content,baseContent:state.answerBaseContent,answers:entries});
      for(const q of entries)if(state.answers[questionKey(q)]===q.value)delete state.answers[questionKey(q)];
      await acceptAnswer(result,{savedSource:content});
      changed=true;
    }
    dirtyState();await flushDraft();$('#change-banner').classList.add('hidden');
    message(changed?'现有修改已保存。':'已保存。');
  }
  async function saveDoc(){return saveAll();}
  async function submitAnswers(){return saveAll();}
  function modal(title,body,actions,eyebrow='文档工作台'){const box=$('#modal');$('#modal-body').onclick=null;$('#modal-body').oninput=null;$('#modal-title').textContent=title;$('#modal-eyebrow').textContent=eyebrow;$('#modal-body').innerHTML=body;$('#modal-actions').innerHTML='';for(const a of actions){const b=document.createElement('button');b.textContent=a.label;if(a.primary)b.className='primary';b.onclick=()=>guarded(a.action);$('#modal-actions').append(b);}box.classList.remove('hidden');$('#modal-close').focus();}
  function closeModal(){$('#modal').classList.add('hidden');}
  function applyPreferences(){const p=state.preferences;document.documentElement.style.setProperty('--reading-font',p.fontSize+'px');document.documentElement.style.setProperty('--reading-line',p.lineHeight);document.documentElement.style.setProperty('--reading-width',p.readingWidth+'px');}
  function preferences(){const p=state.preferences;modal('阅读与备份设置',`<div class="preferences-form"><label>正文字号 <output id="font-output">${p.fontSize}px</output><input id="font-size" type="range" min="13" max="24" value="${p.fontSize}"></label><label>行距 <output id="line-output">${p.lineHeight}</output><input id="line-height" type="range" min="1.4" max="2.4" step=".1" value="${p.lineHeight}"></label><label>阅读宽度 <output id="width-output">${p.readingWidth}px</output><input id="reading-width" type="range" min="540" max="1200" step="20" value="${p.readingWidth}"></label><label>每份文档保留的备份数量<input id="retention" type="number" min="5" max="100" value="${p.backupRetention}"></label></div>`,[{label:'保存设置',primary:true,action:async()=>{state.preferences=await api.preferences(state.preferences);applyPreferences();closeModal();message('阅读与备份设置已保存。');}}],'按你的阅读习惯');
    $('#modal-body').oninput=()=>{state.preferences={fontSize:Number($('#font-size').value),lineHeight:Number($('#line-height').value),readingWidth:Number($('#reading-width').value),backupRetention:Number($('#retention').value)||20};$('#font-output').value=state.preferences.fontSize+'px';$('#line-output').value=state.preferences.lineHeight;$('#width-output').value=state.preferences.readingWidth+'px';applyPreferences();};
  }
  function chooseCourse(){
    const files=allFiles();
    const guides=files.filter(f=>f.readable&&!/^(?:tests|模板|示例|docs|research|tools|_\w+)(?:\/|$)/.test(f.path)&&(f.description||describe(f.path)).kind==='guide'&&!(roundNumber(f.path.split('/').at(-1))&&files.some(index=>index.path===f.path.replace(/[^/]+$/,'01_教学引导.md'))));
    const related=state.documents.filter(d=>!['guide','answer'].includes(d.kind));
    modal('课程与文档',`<p class="modal-note">选择课程后，顶部显示该课的教学、回答和学习进度。</p><div class="course-list">${guides.map(f=>`<button data-file="${escape(f.path)}"><strong>${escape(f.description?.lesson||f.path.split('/').slice(-2,-1)[0])}</strong><small>${escape(f.path)}</small></button>`).join('')||'<p>当前没有已发布课程，请在 DSH 中开始学习。</p>'}</div>${related.length?`<h3>相关文档</h3><div class="course-list">${related.map(d=>`<button data-file="${escape(d.path)}"><strong>${escape(d.label)}</strong><small>${escape(d.path)}</small></button>`).join('')}</div>`:''}`,[{label:'关闭',action:async()=>closeModal()}],'当前课程');
    $('#modal-body').onclick=e=>{if(e.target.closest('[data-file]'))closeModal();};
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.disabled)return;
    if(b.dataset.progress){guarded(()=>showProgress(b.dataset.progress));return;}
    if(b.dataset.file){guarded(async()=>selectFile(b.closest('#tree,.course-list')?await defaultTeachingPath(b.dataset.file):b.dataset.file,{line:b.dataset.resultLine?Number(b.dataset.resultLine):null}));return;}
    if(b.dataset.discardAnswer){delete state.answers[b.dataset.discardAnswer];renderAnswers();scheduleDraft();return;}
    if(b.dataset.answerQuestion!==undefined){showAnswerQuestion(Number(b.dataset.answerQuestion));return;}
    if(b.dataset.answerTab){const show=()=>{state.answerTab=b.dataset.answerTab;renderAnswerWorkspace();};if(hasAnswers()||state.parsedAnswerSource!==state.answerSource)guarded(async()=>{await materializeAnswers();show();});else show();return;}
    if(b.dataset.answerCode!==undefined){const input=document.querySelector(`[data-answer-index="${b.dataset.answerCode}"]`);const from=input.selectionStart,to=input.selectionEnd;input.setRangeText('\n```\n'+input.value.slice(from,to)+'\n```\n',from,to,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();return;}
    if(b.id==='answer-edit-source'||b.id==='answer-edit-fallback'){const edit=()=>{state.answerTab='document';state.answerEditing=b.id==='answer-edit-fallback'||!state.answerEditing;renderAnswerWorkspace();if(state.answerEditing)$('#answer-source').focus();};if(hasAnswers()||state.parsedAnswerSource!==state.answerSource)guarded(async()=>{await materializeAnswers();edit();});else edit();return;}
    if(b.id==='document-popout'){guarded(popout);return;}
    if(b.id==='answer-save-source'){guarded(saveAnswerDocument);return;}
    if(b.id==='answer-history'){guarded(answerHistory);return;}
    const actions={'import':()=>importFolder(),'welcome-import':()=>importFolder(),'welcome-demo':()=>importFolder('__demo__'),'recent-open':()=>importFolder(b.dataset.root),save:saveDoc,submit:submitAnswers,preferences:async()=>preferences(),'choose-course':async()=>chooseCourse(),refresh:async()=>{if(state.workspace){state.workspace=await api.tree();await updateLearning();await updateDocuments();}},'load-changes':()=>state.doc&&selectFile(state.doc.path),'open-answer':()=>state.answer&&selectFile(state.answer.path),'continue-learning':async()=>selectFile(await defaultTeachingPath()),'modal-close':async()=>closeModal()};
    if(actions[b.id])guarded(actions[b.id]);
  });
  $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();}});
  $('#answer-content').addEventListener('input',e=>{if(e.target.dataset.answerIndex!==undefined){const q=state.answer.questions.current[Number(e.target.dataset.answerIndex)];state.answers[questionKey(q)]=e.target.value;const count=document.querySelector(`[data-answer-count="${e.target.dataset.answerIndex}"]`);if(count)count.textContent=e.target.value.length+' 字';const button=document.querySelector(`[data-answer-question="${e.target.dataset.answerIndex}"]`);if(button){button.querySelector('.answer-question-check').textContent=e.target.value.trim()?'✓':'';button.setAttribute('aria-label',`问题 ${q.number}，${e.target.value.trim()?'已填写':'未填写'}`);}dirtyState();scheduleDraft();updateAnswerStatus();}});
  $('#answer-source').addEventListener('input',e=>{state.answerSource=e.target.value;state.answerCache={...(state.answerCache||{}),content:state.answerSource,baseContent:state.answerBaseContent,baseVersion:state.answerBaseVersion};if(state.doc.path===state.answer.path)replaceSource(state.answerSource);dirtyState();scheduleDraft();$('#answer-source-status').textContent='有修改 · 待保存';updateAnswerStatus();});
  for(const selector of ['#answer-records','#answer-document-preview','#answer-content'])$(selector).addEventListener('click',e=>{const link=e.target.closest('a');if(!link)return;const href=link.getAttribute('href');e.preventDefault();if(/^https?:\/\//i.test(href)){api.external(href);return;}if(href&&!href.startsWith('#')){const path=resolveLink(state.answer.path,href);if(path)guarded(()=>selectFile(path));}});
  $('#editor').addEventListener('click',e=>{const link=e.target.closest('a');if(!link)return;e.preventDefault();if(!e.ctrlKey&&!e.metaKey)return;const href=link.getAttribute('href');if(!href)return;if(/^https?:\/\//i.test(href)){api?.external(href);return;}if(href.startsWith('#')){const title=decodeURIComponent(href.slice(1));const target=[...$('#editor').querySelectorAll('h1,h2,h3,h4,h5,h6')].find(h=>h.id===title||h.textContent.toLowerCase().replace(/\s+/g,'-')===title);target?.scrollIntoView();return;}const p=resolveLink(state.doc.path,href);if(p)guarded(()=>selectFile(p));});
  let dragCounter=0;document.addEventListener('dragenter',e=>{e.preventDefault();if(e.dataTransfer?.types.includes('Files')){dragCounter++;$('#drop-overlay').classList.remove('hidden');}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',e=>{e.preventDefault();if(--dragCounter<=0){dragCounter=0;$('#drop-overlay').classList.add('hidden');}});document.addEventListener('drop',e=>{e.preventDefault();dragCounter=0;$('#drop-overlay').classList.add('hidden');const file=e.dataTransfer.files[0];if(file&&api)guarded(()=>importFolder(api.droppedPath(file)));});
  api?.onShortcut(name=>guarded(()=>{
    if(name==='import')return state.documentWindow?Promise.resolve():importFolder();
    if(page!=='document')return Promise.resolve();
    return saveAll();
  }));
  api?.onPrepareClose(async()=>{try{await flushDraft();await api.closeReady(true);}catch(e){await api.closeReady(false);message(cleanError(e),true);}});
  api?.onChange(async()=>{try{if(state.workspace){state.workspace=await api.tree();await updateLearning();await updateDocuments();}if(state.doc){const disk=await api.read(state.doc.path);const answer=state.answer&&state.answer.path!==state.doc.path?await api.read(state.answer.path):null;if(disk.version!==state.doc.version)$('#change-banner').classList.remove('hidden');const updated=answer||(state.answer?.path===disk.path?disk:null);if(updated&&updated.version!==state.answer.version){if(!hasAnswers()&&!answerSourceDirty()&&!(state.doc.path===updated.path&&state.dirty))await acceptAnswer(updated);else $('#change-banner').classList.remove('hidden');}}}catch{message('文档可能已移动或删除，请刷新当前文档。',true);}});
  api?.onWarning(text=>message('文件监测提示：'+text,true));
  if(!documentOnly)api?.onDocumentWindowsChange(event=>{if(event.root!==state.workspace?.root)return;if(event.type==='closed')returningPaths.add(event.path);detachedWindows=event.windows||[];drawTree();document.body.classList.toggle('answer-detached',!!state.answer&&isDetached(state.answer.path));windowEvents.push(event);drainWindowEvents();});
  if(api){api.preferences().then(p=>{state.preferences=p;applyPreferences();});if(documentOnly){api.documentWindowInfo().then(async info=>{state.documentWindow=info;document.body.classList.add(info.kind==='answer'?'answer-document-window':'guide-document-window');await guarded(()=>importFolder(info.root,info.path));});}else api.lastRoot().then(async root=>{if(root){$('#recent').innerHTML=`<button id="recent-open" data-root="${escape(root)}">最近打开：${escape(root)} <span>→</span></button>`;await guarded(()=>importFolder(root));}});}else $('#recent').textContent='网页界面预览；本地文件功能请使用桌面应用。';
}

