const {app}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
process.argv.push('--smoke-test');
const smokePath=require.resolve('../electron/smoke.cjs');
// The answer template ships an EMPTY fenced code block under "我的回答"
// (```python with nothing inside). Tiptap's serializer always writes one line
// break inside a fence, so the strict round-trip check used to reject it and
// replace the placeholder with an opaque preserved block: the answer area then
// rendered as a bare dashed marker with no code surface.
require.cache[smokePath]={id:smokePath,filename:smokePath,loaded:true,exports:async win=>{
  const out=path.join(__dirname,'artifacts/answer-placeholder');await fs.mkdir(out,{recursive:true});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stg-placeholder-'));
  await fs.cp(path.join(__dirname,'../demo/StepsToGreat'),root,{recursive:true});
  const answer='我的学习/学科/Python/01-认识变量/01_学生回答.md';
  const file=path.join(root,answer);
  // Git may check the demo out with CRLF on Windows; this fixture intentionally
  // exercises LF fences, with byte preservation asserted against submitted.
  const template=(await fs.readFile(file,'utf8')).replace(/\r\n/g,'\n');
  // The reported state: question 1 answered, question 2 still the placeholder.
  const submitted=template.replace('**我的回答**\n',`**我的回答**\n\n\n\n**学生作答 · 2026/10/22 09:58:00**\n\n\`\`\`text\nprice 是变量名，25 是变量值。\n\`\`\`\n`);
  assert.notEqual(submitted,template,'the fixture includes the already-submitted first answer');
  await fs.writeFile(file,submitted,'utf8');
  const errors=[];win.webContents.on('console-message',e=>{if(e.level===3||e.level==='error')errors.push(e.message);});
  const js=s=>win.webContents.executeJavaScript(s,true);
  const wait=async expr=>{for(let i=0;i<160;i++){if(await js(`document.documentElement.dataset.busy!=='true'&&(${expr})`))return;await new Promise(r=>setTimeout(r,75));}throw Error('UI wait failed: '+expr);};
  const capture=async name=>{win.showInactive();await new Promise(r=>setTimeout(r,200));await fs.writeFile(path.join(out,name),(await win.webContents.capturePage()).toPNG());};
  const save=async()=>{await js("document.querySelector('#save').click()");await wait("document.querySelector('#save-status').textContent==='已保存'");return fs.readFile(file,'utf8');};
  const evidence=[];
  try{
    await wait("!!document.querySelector('#welcome-import')");
    await js(`document.querySelector('#recent').innerHTML='<button id="recent-open">打开</button>';document.querySelector('#recent-open').dataset.root=${JSON.stringify(root)};document.querySelector('#recent-open').click()`);
    await wait("!!document.querySelector('.file.selected')");
    await js(`(()=>{const b=document.createElement('button');b.dataset.file=${JSON.stringify(answer)};document.body.append(b);b.click();b.remove()})()`);
    await wait(`document.querySelector('#status-left').textContent===${JSON.stringify(answer)}`);
    await wait("!!document.querySelector('#editor .tiptap h1')");
    // 1. The placeholder stays a real, editable code block with its own toolbar.
    const shape=await js(`({
      preserved:document.querySelectorAll('#editor [data-preserved-block]').length,
      fences:document.querySelectorAll('#editor .tiptap pre code').length,
      languages:[...document.querySelectorAll('#editor .edh-code-language')].map(s=>s.value),
      tools:document.querySelectorAll('#editor .edh-code-tools').length
    })`);
    assert.equal(shape.preserved,0,'an empty answer fence must not degrade to a preserved block');
    assert.equal(shape.fences,2);
    assert.deepEqual(shape.languages,['plaintext','python']);
    assert.equal(shape.tools,shape.fences);
    assert.equal(await js("document.querySelector('#editor .tiptap').editor.getSource()"),submitted);
    assert.equal(await fs.readFile(file,'utf8'),submitted);
    evidence.push('Empty ```python answer placeholder opens as a real code block with its language toolbar, and the untouched document stays byte-identical');
    await capture('placeholder.png');
    // 2. Typing fills the fence as plain Python; nothing is converted to opaque content.
    await js("(()=>{const e=document.querySelector('#editor .tiptap').editor;let pos=null;e.state.doc.descendants((n,p)=>{if(n.type.name==='codeBlock'&&n.attrs.language==='python'&&pos===null)pos=p+1});e.commands.setTextSelection(pos);e.view.focus()})()");
    await js("document.querySelector('#editor .tiptap').editor.commands.focus()");
    await win.webContents.insertText('age = 21\nprint(age)');
    await wait("document.querySelector('#editor .tiptap').editor.getSource().includes('print(age)')");
    const typed=await js("document.querySelector('#editor .tiptap').editor.getSource()");
    assert.ok(typed.includes('```python\nage = 21\nprint(age)\n```'),JSON.stringify(typed));
    assert.equal(await js("document.querySelectorAll('#editor [data-preserved-block]').length"),0);
    assert.equal(await save(),typed);
    evidence.push('Typing into the placeholder writes plain Python inside the fence and saves exactly');
    // 3. Clearing it again returns to the template shape, not to a blank line.
    // Deleting the fence's text is what a user does with Ctrl+A + Backspace.
    await js("(()=>{const e=document.querySelector('#editor .tiptap').editor;let pos=null,node=null;e.state.doc.descendants((n,p)=>{if(n.type.name==='codeBlock'&&n.attrs.language==='python'&&pos===null){pos=p;node=n}});const tr=e.state.tr.delete(pos+1,pos+node.nodeSize-1);e.view.dispatch(tr);e.view.focus()})()");
    await wait("!document.querySelector('#editor .tiptap').editor.getSource().includes('print(age)')");
    const cleared=await js("document.querySelector('#editor .tiptap').editor.getSource()");
    assert.ok(cleared.includes('```python\n```'),JSON.stringify(cleared));
    assert.equal(await js("document.querySelectorAll('#editor [data-preserved-block]').length"),0);
    await save();
    assert.equal(await fs.readFile(file,'utf8'),submitted,'a cleared code block keeps the template single-line fence');
    evidence.push('Clearing the placeholder restores the original single-line fence (```python/```) rather than adding a blank line');
    // 4. The current-round workspace offers a sized answer box for question 2.
    await js(`document.querySelector('[data-file=${JSON.stringify('我的学习/学科/Python/01-认识变量/01_教学引导.md')}]').click()`);
    await wait("document.querySelectorAll('[data-answer-index]').length===2");
    await js("document.querySelector('[data-answer-question=\"1\"]').click()");
    await wait("!!document.querySelector('.question-card:not(.hidden) .answer-input-highlight')");
    const card=await js(`(()=>{const c=document.querySelector('.question-card:not(.hidden)'),r=c.querySelector('[data-answer-index]').getBoundingClientRect(),m=c.querySelector('.answer-input-highlight').getBoundingClientRect();return {title:c.querySelector('h3').textContent,height:Math.round(r.height),mirror:Math.round(m.height)}})()`);
    assert.ok(card.height>20,`question 2 answer box collapsed: ${JSON.stringify(card)}`);
    assert.ok(Math.abs(card.height-card.mirror)<=2,`answer mirror misaligned: ${JSON.stringify(card)}`);
    evidence.push('The current-round workspace renders a sized answer box and highlight mirror for question 2');
    await capture('answer-workspace.png');
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,root,shape,card,evidence,errors},null,2));
    console.log('Answer placeholder acceptance passed: '+out);app.exit(0);
  }catch(error){console.error(error);await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:false,root,evidence,errors,error:String(error)},null,2));await capture('failure.png');app.exit(1);}
}};
require('../electron/main.cjs');
