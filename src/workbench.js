import {EditorView,basicSetup} from 'codemirror';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {undo,redo} from '@codemirror/commands';
import DOMPurify from 'dompurify';
import {createVisualEditor} from './visual-editor';
import './workbench.css';

export function mountWorkbench({api,renderer,renderMD,resolveLink,escape,icon}) {
  const $=s=>document.querySelector(s);
  const state={workspace:null,doc:null,answer:null,answerCache:null,mode:'read',dirty:false,answers:{},orphans:[],loading:false,busy:false,documents:[],learning:null,preferences:{fontSize:16,lineHeight:1.9,readingWidth:820,backupRetention:20}};
  let editor,visual,renderTimer,draftTimer,syncLock=false,loadEpoch=0;
  $('#workspace-meta').insertAdjacentHTML('afterend','<button id="continue-learning" class="continue-learning hidden">继续学习 <span>→</span></button><small id="current-learning"></small>');
  $('.header-actions').insertAdjacentHTML('afterbegin','<button id="preferences" class="header-button">阅读设置</button>');
  $('.mode-tabs').insertAdjacentHTML('beforeend','<button data-mode="visual">可视化编辑</button>');
  $('.view-toolbar>div:last-child').insertAdjacentHTML('afterbegin','<button id="outline-toggle">目录</button><button id="history">历史备份</button>');
  $('.view-toolbar').insertAdjacentHTML('afterend',`<div id="format-toolbar" class="format-toolbar hidden"><button data-format="h1">H1</button><button data-format="h2">H2</button><button data-format="bold"><b>B</b></button><button data-format="italic"><i>I</i></button><span></span><button data-format="list">列表</button><button data-format="task">清单</button><button data-format="quote">引用</button><button data-format="code">代码</button><button data-format="table">表格</button><button data-format="link">链接</button><span></span><button data-format="undo">↶ 撤销</button><button data-format="redo">↷ 重做</button></div><div id="draft-banner" class="draft-banner hidden"></div><nav id="outline" class="outline hidden"></nav>`);
  $('#editor').insertAdjacentHTML('afterend','<div id="visual-editor" class="hidden"></div>');
  $('.doc-actions').insertAdjacentHTML('afterbegin','<span id="draft-status"></span>');
  $('#app').insertAdjacentHTML('afterend','<div id="modal" class="modal-overlay hidden" role="dialog" aria-modal="true"><section class="modal-card"><header><div><span id="modal-eyebrow" class="eyebrow"></span><h2 id="modal-title"></h2></div><button id="modal-close" aria-label="关闭">×</button></header><div id="modal-body"></div><footer id="modal-actions"></footer></section></div>');
  const smallIcons={preferences:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="white"/><circle cx="15" cy="17" r="2" fill="white"/>',history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>','outline-toggle':'<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',save:'<path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',reload:'<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>'};
  for(const [id,path] of Object.entries(smallIcons)){const button=$('#'+id);button.insertAdjacentHTML('afterbegin',icon(path,14)+' ');}
  $('#import>span').innerHTML=icon('<path d="M12 5v14M5 12h14"/>',17);
  const fileIcon=icon('<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 13h8M8 17h6"/>',15);
  const folderIcon=icon('<path d="M3 7V5h7l2 2h9v13H3Z"/>',15);
  const formatIcons={list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',task:'<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m4 8 2 2 4-5M13 8h8M13 17h8M3 17h6"/>',quote:'<path d="M4 6h6v8H4Zm10 0h6v8h-6ZM10 14c0 3-2 4-4 4m14-4c0 3-2 4-4 4"/>',code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',table:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16M15 10v10"/>',link:'<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',undo:'<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5"/>',redo:'<path d="M20 10H10a6 6 0 0 0 0 12M20 10l-5-5M20 10l-5 5"/>'};
  for(const [name,path] of Object.entries(formatIcons)){const b=document.querySelector(`[data-format="${name}"]`);b.textContent=b.textContent.replace(/[↶↷]/g,'').trim();b.insertAdjacentHTML('afterbegin',icon(path,13));}

  function message(text,error=false){const box=$('#toast');box.textContent=text;box.className=`toast ${error?'error':''}`;clearTimeout(message.timer);message.timer=setTimeout(()=>box.classList.add('hidden'),5000);}
  async function guarded(task){if(state.busy)return;state.busy=true;document.documentElement.dataset.busy='true';try{await task();}catch(e){message(cleanError(e),true);}finally{state.busy=false;document.documentElement.dataset.busy='false';}}
  function cleanError(e){return String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');}
  function questionKey(q){return JSON.stringify([q.round,q.number,q.title,q.prompt]);}
  function hasAnswers(){return Object.values(state.answers).some(v=>v.length);}
  function text(){return editor?.state.doc.toString()||state.doc?.content||'';}
  function dirtyState(){state.dirty=!!state.doc&&text()!==state.doc.content;api?.dirty(state.dirty||hasAnswers());$('#save-status').textContent=state.dirty?'待保存到文档':'已保存';$('#save-status').classList.toggle('unsaved',state.dirty);}
  function scheduleDraft(){clearTimeout(draftTimer);$('#draft-status').textContent='保存草稿…';draftTimer=setTimeout(()=>flushDraft().catch(e=>{message(cleanError(e),true);$('#draft-status').textContent='草稿保存失败';}),250);}
  async function flushDraft(){
    clearTimeout(draftTimer);if(!api||!state.doc)return;
    const doc=state.doc,answer=state.answer,content=text(),answers={...state.answers};
    const has=Object.values(answers).some(v=>v.length);
    const docRecord={content,baseContent:doc.content,baseVersion:doc.version,mode:state.mode,answers:doc.path===answer?.path?answers:{}};
    if(content!==doc.content||(has&&doc.path===answer?.path))await api.draftPut(doc.path,docRecord);else await api.draftRemove(doc.path);
    if(answer&&answer.path!==doc.path){
      const record={...(state.answerCache||{}),content:state.answerCache?.content||answer.content,baseContent:state.answerCache?.baseContent||answer.content,baseVersion:state.answerCache?.baseVersion||answer.version,answers};
      if(has||record.content!==record.baseContent)await api.draftPut(answer.path,record);else await api.draftRemove(answer.path);
    }
    $('#draft-status').textContent=content!==doc.content||has?'草稿已自动保存':'';
  }
  async function mayLeave(){await flushDraft();return true;}
  function allFiles(nodes=state.workspace?.children||[]){return nodes.flatMap(n=>n.children?allFiles(n.children):[n]);}
  function describe(path){
    const name=path.split('/').at(-1);const kind=/教学引导/.test(name)?'guide':/学生回答/.test(name)?'answer':/课程路线/.test(name)?'route':/学习档案/.test(name)?'profile':/我的规则/.test(name)?'rules':path.startsWith('资料/')?'material':'document';
    return {kind,label:({guide:'教学',answer:'回答',route:'路线',profile:'档案',rules:'规则',material:'资料',document:'文档'})[kind]};
  }
  function drawTree(){
    $('#tree').innerHTML=(state.documents||[]).map(d=>`<button class="file ${state.doc?.path===d.path?'selected':''}" data-file="${escape(d.path)}" title="${escape(d.path)}"><span>${escape(d.label)}</span><small>${escape(d.access)}</small></button>`).join('')||'<span class="documents-empty">尚未发布当前课程，先查看学习档案</span>';
  }
  async function updateDocuments(){if(!api||!state.workspace)return;const result=await api.documents({currentPath:state.doc?.path||null});state.documents=result.documents;drawTree();}
  async function updateLearning(){
    if(!api||!state.workspace)return;
    state.learning=await api.learning();
    const l=state.learning;const target=l?.guidePath||l?.answerPath;
    $('#continue-learning').classList.toggle('hidden',!target);
    $('#current-learning').textContent=target?[l.subject,l.lesson,l.round].filter(Boolean).join(' · '):'尚未发布当前课程';
    if(l?.warnings?.length)$('#current-learning').title=l.warnings.join('\n');
  }
  async function importFolder(root){
    if(!api){message('请使用桌面应用导入本地文件夹。');return;}
    await mayLeave();const info=root==='__demo__'?await api.openDemo():root?await api.openRoot(root):await api.openDialog();if(!info)return;
    state.workspace=info;state.doc=null;state.answer=null;state.answers={};loadEpoch++;
    $('#workspace-name').textContent=info.name;$('#workspace-name').title=info.root;
    $('#workspace-meta').textContent=info.stg?'StepsToGreat 工作区':'学习文档工作区';
    await updateLearning();await updateDocuments();$('#status-left').textContent=info.root;
    const drafts=await api.draftList();const recover=drafts.find(d=>allFiles().some(f=>f.path===d.path));
    const first=state.learning?.guidePath||state.learning?.answerPath||state.documents?.find(d=>d.kind==='profile')?.path||recover?.path||state.documents?.[0]?.path;
    if(first)await selectFile(first,{approved:true});else{$('#document').classList.add('hidden');$('#welcome').classList.remove('hidden');message('文件夹已导入，但未找到文档。');}
    if(info.warnings?.length)message(info.warnings[0]);
  }
  function replaceSource(content){state.loading=true;editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:content}});state.loading=false;dirtyState();renderPreview();}
  async function selectFile(path,{approved=false,line=null}={}){
    if(!approved)await mayLeave();const epoch=++loadEpoch;
    const [disk,answer,draft,description]=await Promise.all([api.read(path),api.companion(path),api.draftGet(path),api.describe(path)]);
    if(epoch!==loadEpoch)return;
    visual?.destroy();visual=null;
    state.doc=disk;state.answer=answer;state.answers={};state.answerCache=answer?(answer.path===path?draft:await api.draftGet(answer.path)):null;
    let content=disk.content,recovered=false;
    if(draft&&draft.content!==disk.content){content=draft.content;state.doc={...disk,content:draft.baseContent??disk.content,version:draft.baseVersion};recovered=true;}
    state.answers={...(state.answerCache?.answers||{})};
    state.loading=true;editor?.destroy();$('#editor').innerHTML='';
    editor=new EditorView({state:EditorState.create({doc:content,extensions:[basicSetup,markdown(),EditorView.lineWrapping,EditorView.updateListener.of(update=>{
      if(update.docChanged&&!state.loading){dirtyState();clearTimeout(renderTimer);renderTimer=setTimeout(renderPreview,120);scheduleDraft();}
    }),EditorView.domEventHandlers({scroll:()=>{if(state.mode==='split')syncScroll('editor');}})]}),parent:$('#editor')});state.loading=false;
    $('#welcome').classList.add('hidden');$('#document').classList.remove('hidden');
    $('#document-title').textContent=description.lesson?`${description.lesson} · ${description.label}`:path.split('/').at(-1).replace(/\.(md|markdown|txt)$/i,'');
    $('#document-kind').textContent=`${description.label} · ${description.kind==='guide'?'TEACHING GUIDE':description.kind==='answer'?'YOUR ANSWERS':'MARKDOWN'}`;
    $('#breadcrumb').innerHTML=`${escape(state.workspace.name)} <span>/</span> ${escape(path)}`;
    $('#change-banner').classList.toggle('hidden',state.doc.version===disk.version);
    $('#draft-banner').classList.toggle('hidden',!(recovered||hasAnswers()));
    $('#draft-banner').textContent=recovered||hasAnswers()?'已恢复本地草稿。正式文档保持原样，保存后才会写入。':'';
    dirtyState();await updateDocuments();await api.documentContext(path);renderPreview();renderAnswers();setMode(state.mode==='visual'?'split':state.mode);
    $('#draft-status').textContent=recovered||hasAnswers()?'草稿已恢复':'';
    $('#status-left').textContent=path;
    if(line){const pos=editor.state.doc.line(Math.min(line,editor.state.doc.lines)).from;editor.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'start'})});const item=$('#preview').querySelector(`[data-source-line="${line}"]`);item?.scrollIntoView();}
  }
  function renderPreview(){
    if(!state.doc||!editor)return;const content=text();const env={path:state.doc.path};const tokens=renderer.parse(content,env);const headings=[];
    for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.type==='heading_open'&&t.level===0){const id=`section-${headings.length}`;t.attrSet('id',id);headings.push({id,title:tokens[i+1].content.replace(/[*`_]/g,''),level:Number(t.tag.slice(1)),line:t.map[0]+1});}if(t.map&&t.type.endsWith('_open')&&t.level===0)t.attrSet('data-source-line',String(t.map[0]+1));}
    $('#preview').innerHTML=DOMPurify.sanitize(renderer.renderer.render(tokens,renderer.options,env),{ALLOW_UNKNOWN_PROTOCOLS:true,ADD_ATTR:['data-source-line','encoding']});
    $('#outline').innerHTML='<div class="outline-title">本文目录</div>'+headings.map(h=>`<button data-section="${h.id}" data-line="${h.line}" style="padding-left:${12+(h.level-1)*10}px">${escape(h.title)}</button>`).join('');
    $('#status-right').textContent=`${content.length.toLocaleString()} 字符 · UTF-8 · Markdown`;
    if(state.mode==='split')syncScroll('editor');
  }
  function syncScroll(source){if(syncLock||state.mode!=='split')return;const from=source==='editor'?editor.scrollDOM:$('#preview');const to=source==='editor'?$('#preview'):editor.scrollDOM;const ratio=from.scrollTop/Math.max(1,from.scrollHeight-from.clientHeight);syncLock=true;to.scrollTop=ratio*Math.max(0,to.scrollHeight-to.clientHeight);requestAnimationFrame(()=>{syncLock=false;});}
  $('#preview').addEventListener('scroll',()=>syncScroll('preview'));
  function setMode(mode){
    if(mode==='visual'){
      try{visual?.destroy();visual=createVisualEditor($('#visual-editor'),text(),content=>{replaceSource(content);scheduleDraft();});}catch(e){message(e.message,true);return;}
    }else{visual?.destroy();visual=null;}
    state.mode=mode;$('#content-area').className=`content-area ${mode}`;$('#visual-editor').classList.toggle('hidden',mode!=='visual');$('#format-toolbar').classList.toggle('hidden',mode==='read');
    document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));editor?.requestMeasure();
  }
  function renderAnswers(){
    const answer=state.answer,current=answer?.questions?.current||[];$('#answer-footer').innerHTML='';
    if(!answer){$('#answer-description').textContent='选择教学引导或学生回答文档。';$('#answer-content').innerHTML='<div class="answer-empty"><span>✎</span><strong>在这里专注作答</strong><p>教学引导关联同目录的学生回答。</p></div>';return;}
    $('#answer-description').textContent=`${answer.questions.round} · ${current.length} 道题`;
    if(!current.length||current.length>3){$('#answer-content').innerHTML='<div class="answer-empty"><p>当前题目格式需要在源文档中作答。</p><button id="open-answer">打开学生回答</button></div>';return;}
    const known=new Set(current.map(questionKey));
    const orphan=Object.entries(state.answers).filter(([k,v])=>v&& !known.has(k));
    $('#answer-content').innerHTML=current.map((q,i)=>`<section class="question-card"><div class="question-number">问题 ${escape(q.number)} <span>${i+1} / ${current.length}</span></div><h3>${escape(q.title.replace(/.*(?:问题|题目|练习题)\s*\d+\s*[:：·]?/,''))||'当前问题'}</h3><div class="question-prompt markdown-body">${renderMD(q.prompt,answer.path)}</div><label for="answer-${i}">你的回答</label><textarea id="answer-${i}" data-answer-index="${i}" placeholder="写下你的理解，或粘贴代码…" spellcheck="false">${escape(state.answers[questionKey(q)]||'')}</textarea></section>`).join('')+orphan.map(([key,value])=>`<section class="orphan-draft"><strong>题目变化前的草稿</strong><p>已保留，请核对后复制到当前题目。</p><textarea readonly>${escape(value)}</textarea><button data-discard-answer="${escape(key)}">移除此草稿</button></section>`).join('');
    $('#answer-footer').innerHTML='<button class="primary" id="submit">保存本轮作答 <span>→</span></button><p>输入自动保留草稿；提交时原文追加。评估由导师完成。</p><button class="text-link" id="open-answer">查看回答文档 ↗</button>';
  }
  async function saveDoc(){
    if(!state.doc||!state.dirty)return;await flushDraft();
    try{const result=await api.save(state.doc.path,text(),state.doc.version);state.doc=result;if(state.answer?.path===result.path){state.answer=result;state.answerCache=null;renderAnswers();}dirtyState();await flushDraft();$('#draft-banner').classList.add('hidden');message('文档已保存，旧版本已备份。');}
    catch(e){if(/修改|已变化/.test(cleanError(e)))await showConflict();else throw e;}
  }
  async function submitAnswers(){
    if(state.dirty){message('请先保存当前文档，再提交答案。',true);return;}
    if(state.answerCache&&state.answerCache.content!==state.answerCache.baseContent){message('回答文档还有未保存的源文档草稿，请先打开回答文档核对并保存。',true);return;}
    const q=state.answer.questions.current;const submitted=q.filter(x=>state.answers[questionKey(x)]?.trim());
    if(!submitted.length){message('请先填写至少一道题。');return;}
    await flushDraft();const values=Object.fromEntries(submitted.map(x=>[x.id,state.answers[questionKey(x)]]));
    try{const result=await api.submit(state.answer.path,values,state.answer.version);for(const x of submitted)delete state.answers[questionKey(x)];state.answer=result;state.answerCache=null;if(state.doc.path===result.path){state.doc=result;replaceSource(result.content);}dirtyState();await flushDraft();renderAnswers();await api.dshVisible(true);await api.dshPrepareReview();message('作答已追加保存。可在 DSH 中发送评估请求。');}
    catch(e){if(/修改|已变化/.test(cleanError(e)))await showAnswerConflict();else throw e;}
  }
  function modal(title,body,actions,eyebrow='文档工作台'){const box=$('#modal');$('#modal-body').onclick=null;$('#modal-body').oninput=null;$('#modal-title').textContent=title;$('#modal-eyebrow').textContent=eyebrow;$('#modal-body').innerHTML=body;$('#modal-actions').innerHTML='';for(const a of actions){const b=document.createElement('button');b.textContent=a.label;if(a.primary)b.className='primary';b.onclick=()=>guarded(a.action);$('#modal-actions').append(b);}box.classList.remove('hidden');$('#modal-close').focus();}
  function closeModal(){$('#modal').classList.add('hidden');}
  async function showConflict(){
    const disk=await api.read(state.doc.path);const local=text();
    modal('比较外部修改与我的草稿',`<p class="modal-note">外部修改已保留。选择并核对最终文本，才会写入原文档。</p><div class="compare-grid"><section><h3>磁盘上的版本</h3><pre>${escape(disk.content)}</pre></section><section><h3>我的草稿 / 合并结果</h3><textarea id="merge-content">${escape(local)}</textarea></section></div>`,[
      {label:'继续保留草稿',action:async()=>{closeModal();await flushDraft();}},
      {label:'用外部版本作为合并起点',action:async()=>{$('#merge-content').value=disk.content;}},
      {label:'保存核对后的合并结果',primary:true,action:async()=>{const merged=$('#merge-content').value;const result=await api.save(state.doc.path,merged,disk.version);state.doc=result;if(state.answer?.path===result.path){state.answer=result;state.answerCache=null;}replaceSource(result.content);renderAnswers();if(state.mode==='visual')setMode('split');await flushDraft();closeModal();$('#change-banner').classList.add('hidden');$('#draft-banner').classList.add('hidden');message('合并结果已保存，覆盖前的磁盘版本已备份。');}}
    ],'保存冲突 · 两份内容都在');
  }
  async function showAnswerConflict(){const disk=await api.read(state.answer.path);modal('回答文档有外部更新',`<p class="modal-note">你的答案草稿已保留。先重新载入题目，核对是否仍对应当前轮次，再提交。</p><pre class="backup-preview">${escape(disk.content)}</pre>`,[{label:'继续保留草稿',action:async()=>closeModal()},{label:'重新加载题目并保留草稿',primary:true,action:async()=>{closeModal();await selectFile(state.doc.path);}}],'答案保护');}
  async function history(){
    if(state.dirty){message('请先保存或另存当前文档草稿，再恢复历史版本。',true);return;}
    const backups=await api.backups(state.doc.path);
    modal('历史版本与恢复',`<p class="modal-note">恢复前会再备份当前文档。每份文档保留最近 ${state.preferences.backupRetention} 个版本。</p><div class="history-layout"><nav class="history-list">${backups.map((b,i)=>`<button data-backup="${escape(b.id)}">${new Date(b.date).toLocaleString('zh-CN')}<small>${(b.bytes/1024).toFixed(1)} KB</small></button>`).join('')||'<p>尚无历史备份。</p>'}</nav><pre id="backup-preview" class="backup-preview">选择左侧版本预览内容。</pre></div>`,[{label:'关闭',action:async()=>closeModal()}],'本地备份');
    $('#modal-body').onclick=async e=>{const b=e.target.closest('[data-backup]');if(!b)return;try{const content=await api.backupRead(state.doc.path,b.dataset.backup);$('#backup-preview').textContent=content;document.querySelectorAll('[data-backup]').forEach(x=>x.classList.toggle('active',x===b));$('#modal-actions').innerHTML='';const restore=document.createElement('button');restore.className='primary';restore.textContent='恢复这个版本';restore.onclick=()=>guarded(async()=>{
      await flushDraft();const current=await api.read(state.doc.path);if(current.version!==state.doc.version){closeModal();await showConflict();return;}
      const result=await api.backupRestore(state.doc.path,b.dataset.backup,current.version);state.doc=result;if(state.answer?.path===result.path)state.answer=result;replaceSource(result.content);setMode('read');renderAnswers();await flushDraft();closeModal();message('历史版本已恢复，恢复前的内容已备份。');
    });$('#modal-actions').append(restore);}catch(error){message(cleanError(error),true);}};
  }
  function applyPreferences(){const p=state.preferences;document.documentElement.style.setProperty('--reading-font',p.fontSize+'px');document.documentElement.style.setProperty('--reading-line',p.lineHeight);document.documentElement.style.setProperty('--reading-width',p.readingWidth+'px');}
  function preferences(){const p=state.preferences;modal('阅读与备份设置',`<div class="preferences-form"><label>正文字号 <output id="font-output">${p.fontSize}px</output><input id="font-size" type="range" min="13" max="24" value="${p.fontSize}"></label><label>行距 <output id="line-output">${p.lineHeight}</output><input id="line-height" type="range" min="1.4" max="2.4" step=".1" value="${p.lineHeight}"></label><label>阅读宽度 <output id="width-output">${p.readingWidth}px</output><input id="reading-width" type="range" min="540" max="1200" step="20" value="${p.readingWidth}"></label><label>每份文档保留的备份数量<input id="retention" type="number" min="5" max="100" value="${p.backupRetention}"></label></div>`,[{label:'保存设置',primary:true,action:async()=>{state.preferences=await api.preferences(state.preferences);applyPreferences();closeModal();message('阅读与备份设置已保存。');}}],'按你的阅读习惯');
    $('#modal-body').oninput=()=>{state.preferences={fontSize:Number($('#font-size').value),lineHeight:Number($('#line-height').value),readingWidth:Number($('#reading-width').value),backupRetention:Number($('#retention').value)||20};$('#font-output').value=state.preferences.fontSize+'px';$('#line-output').value=state.preferences.lineHeight;$('#width-output').value=state.preferences.readingWidth+'px';applyPreferences();};
  }
  function format(action){
    if(!editor)return;
    if(state.mode==='visual'&&visual){const chain=visual.chain().focus();const commands={h1:()=>chain.toggleHeading({level:1}).run(),h2:()=>chain.toggleHeading({level:2}).run(),bold:()=>chain.toggleBold().run(),italic:()=>chain.toggleItalic().run(),list:()=>chain.toggleBulletList().run(),task:()=>chain.toggleTaskList().run(),quote:()=>chain.toggleBlockquote().run(),code:()=>chain.toggleCodeBlock().run(),table:()=>chain.insertTable({rows:3,cols:3,withHeaderRow:true}).run(),undo:()=>chain.undo().run(),redo:()=>chain.redo().run()};if(commands[action])commands[action]();else linkDialog(true);return;}
    if(state.mode==='read')setMode('split');
    if(action==='undo'||action==='redo'){editor.focus();(action==='undo'?undo:redo)(editor);return;}
    if(action==='link'){linkDialog(false);return;}
    const {from,to}=editor.state.selection.main,selected=editor.state.sliceDoc(from,to);
    const formats={h1:`# ${selected||'标题'}`,h2:`## ${selected||'小标题'}`,bold:`**${selected||'加粗文字'}**`,italic:`*${selected||'斜体文字'}*`,list:(selected||'列表项').split('\n').map(s=>'- '+s).join('\n'),task:(selected||'清单项').split('\n').map(s=>'- [ ] '+s).join('\n'),quote:(selected||'引用内容').split('\n').map(s=>'> '+s).join('\n'),code:`\n\`\`\`text\n${selected}\n\`\`\`\n`,table:'\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n'};
    if(formats[action]!==undefined){const insert=formats[action];editor.dispatch({changes:{from,to,insert},selection:{anchor:from+insert.length}});editor.focus();}
  }
  function linkDialog(rich){const s=editor.state.selection.main;const label=rich?visual.state.doc.textBetween(visual.state.selection.from,visual.state.selection.to):editor.state.sliceDoc(s.from,s.to);modal('插入链接',`<div class="preferences-form"><label>链接文字<input id="link-label" value="${escape(label)}"></label><label>链接地址<input id="link-url" placeholder="https://… 或 ./文档.md"></label></div>`,[{label:'插入',primary:true,action:async()=>{const title=$('#link-label').value||'链接',url=$('#link-url').value.trim();if(!url||/^(javascript|data|file):/i.test(url))throw new Error('请填写有效的文档路径或 HTTPS 链接。');if(rich)visual.chain().focus().insertContent({type:'text',text:title,marks:[{type:'link',attrs:{href:url}}]}).run();else{const insert=`[${title.replace(/[\[\]]/g,'')}](${url.replace(/[()\s]/g,c=>encodeURIComponent(c))})`;editor.dispatch({changes:{from:s.from,to:s.to,insert}});}closeModal();}}]);}
  function chooseCourse(){
    const guides=allFiles().filter(f=>f.readable&&!/^(?:tests|模板|示例|docs|research|tools|_\w+)(?:\/|$)/.test(f.path)&&(f.description||describe(f.path)).kind==='guide');
    modal('选择当前课程',`<p class="modal-note">只列出已发布教学引导。打开后，顶部会显示这一课需要的文档。</p><div class="course-list">${guides.map(f=>`<button data-file="${escape(f.path)}"><strong>${escape(f.description?.lesson||f.path.split('/').slice(-2,-1)[0])}</strong><small>${escape(f.path)}</small></button>`).join('')||'<p>当前没有已发布课程。请打开学习档案并在 DSH 中开始学习。</p>'}</div>`,[{label:'关闭',action:async()=>closeModal()}],'当前课程');
    $('#modal-body').onclick=e=>{if(e.target.closest('[data-file]'))closeModal();};
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.file){guarded(()=>selectFile(b.dataset.file,{line:b.dataset.resultLine?Number(b.dataset.resultLine):null}));return;}
    if(b.dataset.mode){setMode(b.dataset.mode);return;}
    if(b.dataset.format){format(b.dataset.format);return;}
    if(b.dataset.section){$('#preview').querySelector('#'+b.dataset.section)?.scrollIntoView({behavior:'smooth'});const pos=editor.state.doc.line(Number(b.dataset.line)).from;editor.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'start'})});$('#outline').classList.add('hidden');return;}
    if(b.dataset.discardAnswer){delete state.answers[b.dataset.discardAnswer];renderAnswers();scheduleDraft();return;}
    const actions={'import':()=>importFolder(),'welcome-import':()=>importFolder(),'welcome-demo':()=>importFolder('__demo__'),'recent-open':()=>importFolder(b.dataset.root),save:saveDoc,submit:submitAnswers,preferences:async()=>preferences(),history,'choose-course':async()=>chooseCourse(),refresh:async()=>{if(state.workspace){state.workspace=await api.tree();await updateLearning();await updateDocuments();}},reload:()=>state.doc&&selectFile(state.doc.path),'load-changes':()=>state.doc&&selectFile(state.doc.path),'open-answer':()=>state.answer&&selectFile(state.answer.path),reveal:()=>state.doc&&api.reveal(state.doc.path),export:()=>state.doc&&api.exportDraft(text()),'continue-learning':()=>selectFile(state.learning.guidePath||state.learning.answerPath),'outline-toggle':async()=>$('#outline').classList.toggle('hidden'),'modal-close':async()=>closeModal()};
    if(actions[b.id])guarded(actions[b.id]);
  });
  $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#outline').classList.add('hidden');}});
  $('#answer-content').addEventListener('input',e=>{if(e.target.dataset.answerIndex!==undefined){const q=state.answer.questions.current[Number(e.target.dataset.answerIndex)];state.answers[questionKey(q)]=e.target.value;dirtyState();scheduleDraft();}});
  $('#preview').addEventListener('click',e=>{const link=e.target.closest('a');if(!link)return;e.preventDefault();const href=link.getAttribute('href');if(!href)return;if(/^https?:\/\//i.test(href)){api?.external(href);return;}if(href.startsWith('#')){const title=decodeURIComponent(href.slice(1));const target=[...$('#preview').querySelectorAll('h1,h2,h3,h4,h5,h6')].find(h=>h.id===title||h.textContent.toLowerCase().replace(/\s+/g,'-')===title);target?.scrollIntoView();return;}const p=resolveLink(state.doc.path,href);if(p)guarded(()=>selectFile(p));});
  let dragCounter=0;document.addEventListener('dragenter',e=>{e.preventDefault();if(e.dataTransfer?.types.includes('Files')){dragCounter++;$('#drop-overlay').classList.remove('hidden');}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',e=>{e.preventDefault();if(--dragCounter<=0){dragCounter=0;$('#drop-overlay').classList.add('hidden');}});document.addEventListener('drop',e=>{e.preventDefault();dragCounter=0;$('#drop-overlay').classList.add('hidden');const file=e.dataTransfer.files[0];if(file&&api)guarded(()=>importFolder(api.droppedPath(file)));});
  api?.onShortcut(name=>guarded(()=>name==='import'?importFolder():saveDoc()));
  api?.onPrepareClose(async()=>{try{await flushDraft();await api.closeReady(true);}catch(e){await api.closeReady(false);message(cleanError(e),true);}});
  api?.onChange(async()=>{try{if(state.workspace){state.workspace=await api.tree();await updateLearning();await updateDocuments();}if(state.doc){const disk=await api.read(state.doc.path);const answer=state.answer&&state.answer.path!==state.doc.path?await api.read(state.answer.path):null;if(disk.version!==state.doc.version||(answer&&answer.version!==state.answer.version))$('#change-banner').classList.remove('hidden');}}catch{message('文档可能已移动或删除，请刷新当前文档。',true);}});
  api?.onWarning(text=>message('文件监测提示：'+text,true));
  if(api){api.preferences().then(p=>{state.preferences=p;applyPreferences();});api.lastRoot().then(async root=>{if(root){$('#recent').innerHTML=`<button id="recent-open" data-root="${escape(root)}">最近打开：${escape(root)} <span>→</span></button>`;await guarded(()=>importFolder(root));}});}else $('#recent').textContent='网页界面预览；本地文件功能请使用桌面应用。';
}

