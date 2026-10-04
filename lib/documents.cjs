const path=require('node:path');
const {getLearningState,describeFile}=require('./learning.cjs');

async function relevantDocuments(workspace,{currentPath=null}={}) {
  const learning=await getLearningState(workspace);
  const tree=await workspace.tree();
  const files=[];
  const collect=nodes=>{for(const node of nodes){if(node.children)collect(node.children);else if(node.readable)files.push(node.path);}};
  collect(tree.children);
  const existing=new Set(files);
  let guide=learning.guidePath,answer=learning.answerPath;
  if(currentPath&&existing.has(currentPath)){
    const kind=describeFile(currentPath).kind;
    if(kind==='guide'){guide=currentPath;answer=currentPath.replace(/教学引导\.(md|markdown)$/i,'学生回答.$1');}
    if(kind==='answer'){answer=currentPath;const companion=currentPath.replace(/学生回答\.(md|markdown)$/i,'教学引导.$1');if(existing.has(companion))guide=companion;}
  }
  const result=[];
  const add=(file,label,access)=>{if(file&&existing.has(file)&&!result.some(d=>d.path===file))result.push({path:file,label:label||describeFile(file).displayName,kind:describeFile(file).kind,access});};
  add(guide,'教学引导','阅读');add(answer,'学生回答','读写');add(learning.profilePath,'学习档案','读写');
  const active=guide||answer;
  const subjectDir=active&&active.includes('/学科/')?active.split('/').slice(0,active.split('/').lastIndexOf('学科')+2).join('/'):null;
  for(const file of files){const kind=describeFile(file).kind;const dir=path.posix.dirname(file);if(kind==='rules'&&(dir==='.'||active?.startsWith(dir+'/')||dir===path.posix.dirname(learning.profilePath||'')))add(file,'学习规则','阅读');if(kind==='route'&&(subjectDir&&dir===subjectDir||!subjectDir&&dir==='.'))add(file,'课程路线','读写');}
  add('SKILL.md','教学规则','阅读');
  if(guide&&existing.has(guide)){
    const doc=await workspace.read(guide);
    for(const match of doc.content.matchAll(/(?<!!)\[([^\]]+)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g)){
      let target=match[2]||match[3];try{target=decodeURIComponent(target.split(/[?#]/)[0]);}catch{continue;}
      if(!target||/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(target))continue;
      const relative=path.posix.normalize(path.posix.join(path.posix.dirname(guide),target.replace(/\\/g,'/')));
      if(relative==='..'||relative.startsWith('../'))continue;
      add(relative,match[1],'阅读');
    }
  }
  if(!result.length&&existing.has('README.md'))add('README.md','使用说明','阅读');
  // A document explicitly opened through a link stays reachable in the current task.
  if(currentPath)add(currentPath,null,describeFile(currentPath).kind==='answer'?'读写':'阅读');
  return {learning,documents:result};
}
module.exports={relevantDocuments};
