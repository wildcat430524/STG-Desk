import {Editor,Extension,Node} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {Markdown,MarkdownManager} from '@tiptap/markdown';
import {TableKit} from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {TextSelection} from '@tiptap/pm/state';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import katex from 'katex';
import {splitSource,assembleSource,withoutOrigins} from './visual-source.mjs';
import './live-editor.css';

const parser=new MarkdownIt({html:true});
const semanticParser=new MarkdownIt({html:false});
const semantic=text=>JSON.stringify(semanticParser.parse(text,{}).map(t=>({type:t.type,content:t.type==='inline'?null:t.content,info:t.info,attrs:t.attrs,children:t.children?.map(c=>({type:c.type,content:c.content,attrs:c.attrs}))})));
const mathPattern=/\$\$[\s\S]+?\$\$|(?<![\\$])\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$(?!\$)/g;

export function createVisualEditor(element,content,onChange,options={}){
  let visual,initialJSON;
  const ledger=new Map(),eol=content.includes('\r\n')?'\r\n':'\n';
  const renderEnv={path:options.path};options.renderer?.parse(content,renderEnv);
  const render=source=>options.renderer?options.renderer.render(source,{...renderEnv}):options.renderMD?options.renderMD(source,options.path):semanticParser.render(source);
  const Preserved=Node.create({
    name:'preservedBlock',group:'block',atom:true,selectable:true,
    addAttributes(){return {source:{default:''},label:{default:'特殊内容'},preview:{default:''}};},
    parseHTML(){return [{tag:'div[data-preserved-block]',getAttrs:el=>{const source=el.getAttribute('data-preserved-source')||'';return {source,label:'保留的 Markdown 内容',preview:render(source)};}}];},
    renderHTML({node}){return ['div',{'data-preserved-block':'','data-preserved-source':node.attrs.source,class:'visual-preserved'},node.attrs.source];},
    renderText({node}){return node.attrs.source;},
    renderMarkdown(node){return node.attrs.source;},
    addNodeView(){return ({node})=>{
      const dom=document.createElement('div');dom.className='visual-preserved markdown-body';dom.contentEditable='false';dom.dataset.preservedBlock='';
      const preview=document.createElement('div');preview.className='visual-preserved-preview';
      preview.innerHTML=DOMPurify.sanitize(node.attrs.preview,{ADD_TAGS:['annotation','semantics'],ADD_ATTR:['encoding'],ALLOW_UNKNOWN_PROTOCOLS:true});
      const tools=document.createElement('div');tools.className='visual-preserved-tools';
      const label=document.createElement('span');label.textContent=node.attrs.label;
      const button=document.createElement('button');button.type='button';button.textContent='编辑源码';
      button.addEventListener('click',()=>options.onSource?.(node.attrs.source));
      tools.append(label,button);dom.append(preview,tools);
      if(!preview.textContent.trim()&&!preview.querySelector('img,svg'))dom.classList.add('visual-preserved-marker');
      return {dom,stopEvent:event=>event.target.closest('button')!==null,ignoreMutation:()=>true};
    };}
  });
  const MathInline=Node.create({
    name:'mathInline',group:'inline',inline:true,atom:true,
    addAttributes(){return {source:{default:''}};},
    parseHTML(){return [{tag:'span[data-visual-math]',getAttrs:el=>({source:el.dataset.visualMath})}];},
    renderHTML({node}){return ['span',{'data-visual-math':node.attrs.source},node.attrs.source];},
    renderText({node}){return node.attrs.source;},
    renderMarkdown(node){return node.attrs.source;},
    addNodeView(){return ({node,getPos,editor})=>{
      const dom=document.createElement('span');dom.className='visual-math';dom.contentEditable='false';dom.title='双击编辑公式';
      dom.innerHTML=katex.renderToString(node.attrs.source.replace(/^\$\$?|\$\$?$/g,''),{throwOnError:false,trust:false});
      dom.addEventListener('dblclick',event=>{event.preventDefault();options.onMath?.({source:node.attrs.source,apply:value=>{
        const pos=getPos();if(typeof pos==='number')editor.commands.command(({tr,dispatch})=>{if(dispatch)tr.setNodeMarkup(pos,undefined,{...node.attrs,source:value});return true;});
      }});});
      return {dom,ignoreMutation:()=>true};
    };}
  });
  const Origin=Extension.create({name:'sourceOrigins',addGlobalAttributes(){return [{types:['heading','paragraph','bulletList','orderedList','taskList','blockquote','codeBlock','table','horizontalRule','image','preservedBlock'],attributes:{sourceKey:{default:null,rendered:false}}}];}});
  const LocalImage=Image.extend({addNodeView(){return ({node})=>{
    const dom=document.createElement('img');dom.alt=node.attrs.alt||'';dom.title=node.attrs.title||'';
    const holder=document.createElement('div');
    holder.innerHTML=DOMPurify.sanitize(render(`![${(node.attrs.alt||'').replace(/\]/g,'\\]')}](${String(node.attrs.src).replace(/[()\s]/g,c=>encodeURIComponent(c))})`),{ALLOW_UNKNOWN_PROTOCOLS:true});
    const rendered=holder.querySelector('img'),src=rendered?.getAttribute('src');
    dom.alt=rendered?.getAttribute('alt')||dom.alt;
    if(src)dom.src=src;
    return {dom,ignoreMutation:()=>true};
  };}});
  const extensions=[StarterKit.configure({link:{openOnClick:false,protocols:['http','https']}}),Markdown,TableKit.configure({table:{resizable:false}}),LocalImage.configure({allowBase64:false}),TaskList,TaskItem.configure({nested:true}),Preserved,MathInline,Origin];
  const manager=new MarkdownManager({extensions});
  const parts=splitSource(content,parser),nodes=[];
  const restoreMath=(node,formulas)=>{
    if(!node.content)return;
    node.content=node.content.flatMap(child=>{
      if(child.type!=='text'){restoreMath(child,formulas);return [child];}
      const pattern=/STGMATH\d+TOKEN/g;let offset=0,match,result=[];
      while((match=pattern.exec(child.text))){const formula=formulas.find(f=>f.key===match[0]);if(!formula)continue;
        if(match.index>offset)result.push({...child,text:child.text.slice(offset,match.index)});
        result.push({type:'mathInline',attrs:{source:formula.value},...(child.marks?{marks:child.marks}:{})});offset=match.index+match[0].length;
      }
      if(!offset)return [child];if(offset<child.text.length)result.push({...child,text:child.text.slice(offset)});return result;
    });
  };
  for(const [i,part] of parts.blocks.entries()){
    const sourceKey=String(i),source=part.source;let json;
    const code=part.kind==='fence'||part.kind==='code_block';
    const special=part.special||!code&&/<!--|<\/?[a-z][^>]*>|\[\^[^\]]+\]|\[[^\]]+\](?:\[[^\]]*\])|^\s*\$\$/im.test(source);
    try{
      if(special)throw Error('preserve');
      let input=source,formulas=[];
      if(part.kind!=='fence'&&part.kind!=='code_block'){
        input=source.replace(mathPattern,value=>{const key=`STGMATH${formulas.length}TOKEN`;formulas.push({key,value});return key;});
        if(formulas.length&&/`/.test(source))throw Error('mixed code and math');
      }
      const parsed=manager.parse(input);if(parsed.content?.length!==1)throw Error('multiple blocks');
      json=parsed.content[0];restoreMath(json,formulas);
      if(semantic(manager.serialize({type:'doc',content:[json]}))!==semantic(source))throw Error('unsupported round trip');
    }catch{
      const label=part.kind==='html_block'&&/^\s*<!--/.test(source)?'文档标记':part.special?'文档元数据':/\$/.test(source)?'公式与特殊内容':'保留的 Markdown 内容';
      json={type:'preservedBlock',attrs:{source,label,preview:/^\s*<!--[\s\S]*?-->\s*$/.test(source)?'':render(source)}};
    }
    json.attrs={...json.attrs,sourceKey};nodes.push(json);ledger.set(sourceKey,{...part,json:null});
  }
  const getSource=()=>{
    const json=visual.getJSON();if(JSON.stringify(json)===initialJSON)return content;
    return assembleSource(json.content||[],ledger,parts.tail,eol,node=>manager.serialize({type:'doc',content:[node]}));
  };
  visual=new Editor({element,extensions,content:{type:'doc',content:nodes.length?nodes:[{type:'paragraph'}]},editorProps:{attributes:{class:'visual-document markdown-body','aria-label':'学习文档，所见即所得编辑',spellcheck:'false'}},onUpdate:()=>onChange(getSource()),onSelectionUpdate:()=>options.onSelection?.(visual)});
  initialJSON=JSON.stringify(visual.getJSON());
  for(const node of visual.getJSON().content||[]){const entry=ledger.get(node.attrs?.sourceKey);if(entry)entry.json=JSON.stringify(withoutOrigins(node));}
  visual.getSource=getSource;
  visual.jumpToSource=offset=>{
    let index=0,target=0;
    assembleSource(visual.getJSON().content||[],ledger,parts.tail,eol,node=>manager.serialize({type:'doc',content:[node]}),range=>{if(range.from<=offset)index=range.index;});
    let current=0;visual.state.doc.forEach((node,pos)=>{if(current++===index)target=pos;});
    visual.view.dispatch(visual.state.tr.setSelection(TextSelection.near(visual.state.doc.resolve(Math.min(target+1,visual.state.doc.content.size)))).scrollIntoView());visual.commands.focus();
  };
  return visual;
}
