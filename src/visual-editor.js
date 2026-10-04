import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from '@tiptap/markdown';
import {TableKit} from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import MarkdownIt from 'markdown-it';
const parser=new MarkdownIt({html:false});
const semantic=text=>JSON.stringify(parser.parse(text,{}).map(t=>({type:t.type,content:t.type==='inline'?null:t.content,info:t.info,attrs:t.attrs,children:t.children?.map(c=>({type:c.type,content:c.content,attrs:c.attrs}))})));
export function visualIssue(content){
  if(/<!--|<\/?[a-z][^>]*>|^---\s*\r?\n[\s\S]*?\r?\n---|\$[^\n$]+\$|^\$\$|^```(?:mermaid|math)|\[\^|^\[[^\]]+\]:/im.test(content))return '此文档含注释、公式或特殊 Markdown。请使用源文档编辑，保留原有格式。';
  return null;
}
export function createVisualEditor(element,content,onChange){
  const problem=visualIssue(content);if(problem)throw new Error(problem);
  const editor=new Editor({element,extensions:[StarterKit.configure({link:{openOnClick:false,protocols:['http','https']}}),Markdown,TableKit.configure({table:{resizable:false}}),Image.configure({allowBase64:false}),TaskList,TaskItem.configure({nested:true})],content,contentType:'markdown',editorProps:{attributes:{class:'visual-document markdown-body'}},onUpdate:({editor})=>onChange(editor.getMarkdown())});
  if(semantic(editor.getMarkdown())!==semantic(content)){editor.destroy();throw new Error('此文档的格式暂时无法无损转换，请使用源文档编辑。');}
  return editor;
}
