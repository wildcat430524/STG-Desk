import {StateField} from '@codemirror/state';
import {Decoration,EditorView,WidgetType} from '@codemirror/view';
import DOMPurify from 'dompurify';
import './live-editor.css';

// Decorations are only a projection. CodeMirror's original document remains
// the model used by drafts, undo and version-checked saves.
class MarkdownBlock extends WidgetType {
  constructor(from,to,html){super();this.from=from;this.to=to;this.html=html;}
  eq(other){return this.from===other.from&&this.to===other.to&&this.html===other.html;}
  toDOM(view){
    const element=document.createElement('div');
    element.className='cm-live-block markdown-body';
    element.innerHTML=this.html;
    element.addEventListener('mousedown',event=>{
      if(event.button!==0)return;
      event.preventDefault();
      const rect=element.getBoundingClientRect();
      const first=view.state.doc.lineAt(this.from),last=view.state.doc.lineAt(this.to);
      const fraction=Math.max(0,Math.min(.999,(event.clientY-rect.top)/Math.max(1,rect.height)));
      const line=view.state.doc.line(first.number+Math.floor(fraction*(last.number-first.number+1)));
      const column=Math.round(Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)))*line.length);
      view.dispatch({selection:{anchor:Math.min(this.to,line.from+column)}});
      view.focus();
    });
    // Opening a rendered link must first enter editing, never navigate away
    // from the desktop document's unsaved text.
    element.addEventListener('click',event=>event.preventDefault());
    return element;
  }
  ignoreEvent(){return true;}
}

export function liveMarkdown({renderer,path}){
  function decorations(state){
    const content=state.doc.toString(),env={path};
    const tokens=renderer.parse(content,env),ranges=[];
    for(let i=0;i<tokens.length;i++){
      const token=tokens[i];
      if(token.level!==0||!token.map||token.nesting===-1)continue;
      const [start,end]=token.map;
      if(end<=start||start>=state.doc.lines)continue;
      const from=state.doc.line(start+1).from;
      const to=state.doc.line(Math.min(end,state.doc.lines)).to;
      let finish=i;
      if(token.nesting===1){
        while(finish+1<tokens.length){finish++;if(tokens[finish].level===0&&tokens[finish].nesting===-1)break;}
      }
      const active=state.selection.ranges.some(selection=>selection.from<=to&&selection.to>=from);
      if(!active&&to>from){
        const raw=content.slice(from,to);
        const html=/^\s*<!--[\s\S]*?-->\s*$/.test(raw)?'':DOMPurify.sanitize(
          renderer.renderer.render(tokens.slice(i,finish+1),renderer.options,env),
          {ADD_TAGS:['annotation','semantics'],ADD_ATTR:['encoding'],ALLOW_UNKNOWN_PROTOCOLS:true}
        );
        ranges.push(Decoration.replace({block:true,widget:new MarkdownBlock(from,to,html)}).range(from,to));
      }else{
        for(let n=start+1;n<=Math.min(end,state.doc.lines);n++){
          const line=state.doc.line(n),heading=line.text.match(/^(#{1,6})\s+/);
          const kind=heading?'heading-'+heading[1].length:token.type==='fence'?'code':token.type==='blockquote_open'?'quote':'paragraph';
          ranges.push(Decoration.line({class:'cm-live-active cm-live-'+kind}).range(line.from));
        }
      }
      i=finish;
    }
    return Decoration.set(ranges,true);
  }
  const field=StateField.define({
    create:decorations,
    update(value,transaction){return transaction.docChanged||transaction.selection?decorations(transaction.state):value;},
    provide:field=>EditorView.decorations.from(field)
  });
  return [field,EditorView.editorAttributes.of({class:'cm-live-editor'})];
}
