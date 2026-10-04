'use strict';
const path=require('node:path');
const md=require('markdown-it')();
const {getLearningState}=require('./learning.cjs');
const normalize=p=>String(p||'').replace(/\\/g,'/');
const plain=s=>String(s||'').replace(/[*`_]/g,'').trim();
const concrete=s=>!!plain(s)&&!/[<>]|尚未记录|待填写|待补充/.test(plain(s))&&!/^[-—–]+$/.test(plain(s));
const statusText=s=>plain(s).replace(/^[\s✅⚠️⏳🟢🔴🟡]+/u,'');
function completion(s){
  const value=statusText(s);
  if(!concrete(value))return null;
  if(/^(?:已掌握|已完成|全部通过)(?:$|[\s，。；（(·])/.test(value))return true;
  if(/^(?:未掌握|未完成|未评估|待评估|未开始|进行中|部分掌握|待作答|尚未作答|暂停|挂起|待复评)/.test(value))return false;
  return null;
}
// Token parsing ignores examples inside code fences and blockquotes.
function inspect(content){
  const tokens=md.parse(content,{}),headings=[],tables=[];
  let section='',row=null,table=null;
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(t.type==='heading_open'&&t.level===0){const h={title:plain(tokens[i+1].content),level:Number(t.tag.slice(1))};headings.push(h);if(h.level<=2)section=h.title;}
    if(t.type==='table_open'&&t.level===0){table={section,rows:[]};tables.push(table);}
    if(!table)continue;
    if(t.type==='tr_open')row=[];
    if(t.type==='inline'&&row)row.push(plain(t.content));
    if(t.type==='tr_close'){table.rows.push(row);row=null;}
    if(t.type==='table_close')table=null;
  }
  return {headings,tables};
}
function tableUnits(table){
  const [header,...rows]=table.rows;if(!header)return [];
  const status=header.findIndex(h=>/^(?:状态|掌握状态|完成状态)$/.test(h));
  const identity=header.findIndex(h=>/^(?:课次|课程|课名|章节|单元|知识点)$/.test(h));
  if(status<0||identity<0)return [];
  return rows.filter(r=>concrete(r[identity])).map(r=>({name:r[identity],complete:completion(r[status])}));
}
function routeUnits(doc){
  const units=new Map();
  for(const h of doc.headings){
    const m=h.title.match(/^#?(\d+)\s+(.+?)(?:[（(]状态[：:]\s*(.+?)[）)])?$/);
    if(!m||!concrete(m[2]))continue;
    units.set(m[1],{name:m[2],complete:completion(m[3])});
  }
  if(units.size)return [...units.values()];
  return doc.tables.flatMap(tableUnits);
}
async function read(workspace,file){if(!file)return null;try{return inspect((await workspace.read(file)).content);}catch{return null;}}
function display(units,scope,unit){
  if(!units.length||units.every(u=>u.complete===null))return '尚未记录';
  const known=units.filter(u=>u.complete!==null).length;
  return `${scope} · ${units.filter(u=>u.complete===true).length} / ${units.length} ${unit}已掌握${known<units.length?`（${units.length-known} ${unit}待记录）`:''}`;
}
async function getLearningProgress(workspace,{learning,guidePath,answerPath,routePath}={}){
  learning=learning||await getLearningState(workspace);
  const selected=normalize(guidePath||answerPath);
  const current=selected&&[learning.guidePath,learning.answerPath].some(p=>p&&path.posix.dirname(normalize(p))===path.posix.dirname(selected));
  const [guide,answer]=await Promise.all([read(workspace,guidePath),read(workspace,answerPath)]);
  let round=null,status=null;
  for(const doc of [guide,answer].filter(Boolean)){
    for(const h of doc.headings){const match=h.title.match(/第[一二三四五六七八九十\d]+轮|费曼(?:诊断)?轮|摸底轮/);if(match)round=match[0];}
    for(const table of doc.tables)for(const row of table.rows){if(/^(?:课程状态|本课状态|当前进度|当前状态)$/.test(row[0])&&concrete(row[1]))status=row[1];}
  }
  if(current){round=learning.round||round;status=learning.status||status;}
  const chapter=[round,status].filter(Boolean).join(' · ')||'尚未记录';
  const subject=selected.match(/(?:^|\/)学科\/([^/]+)\//)?.[1]||learning.subject;
  const route=await read(workspace,routePath);
  const units=route?routeUnits(route):[];
  if(units.length)return {chapter,overall:display(units,subject||'课程路线','课')};
  const profile=await read(workspace,learning.profilePath);
  const mastery=profile?.tables.filter(t=>/掌握|知识点掌握/.test(t.section))||[];
  // The profile can contain several subjects; explicitly label the aggregate scope.
  const recorded=mastery.flatMap(tableUnits);
  const knowledge=mastery.some(t=>t.rows[0]?.includes('知识点'));
  return {chapter,overall:display(recorded,'学习档案',knowledge?'项':'课')};
}
module.exports={getLearningProgress};
