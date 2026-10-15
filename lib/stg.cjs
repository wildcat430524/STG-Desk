const MarkdownIt = require('markdown-it');
// Parse HTML blocks so commented future rounds stay opaque. This parser only
// inspects tokens; it never renders or executes the document's HTML.
const md = new MarkdownIt({ html: true });
function readQuestionAnswer(source,from,to){
  const section=source.slice(from,to),lines=[0];
  for(const match of section.matchAll(/\n/g))lines.push(match.index+1);
  const tokens=md.parse(section,{});let latest=null,slot=null;
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i];
    if(token.type!=='paragraph_open'||token.level!==0)continue;
    const inline=tokens[i+1]?.content||'';
    if(/^\*\*学生作答\s*·[^\n]*\*\*$/.test(inline)){
      const fence=tokens[i+3];
      if(fence?.type!=='fence'||fence.level!==0||fence.info.trim()!=='text')continue;
      const raw=section.slice(lines[fence.map[0]],lines[fence.map[1]]??section.length);
      const closing=new RegExp('^ {0,3}'+fence.markup[0]+'{'+fence.markup.length+',}[ \\t]*(?:\\r?\\n)?$','m');
      const bodyStart=raw.indexOf('\n')+1,body=raw.slice(bodyStart),end=body.search(closing);
      if(end<0)continue;
      latest={value:body.slice(0,end).replace(/\r?\n$/,'').replace(/\r\n/g,'\n'),start:from+lines[token.map[0]],end:from+(lines[fence.map[1]]??section.length),kind:'saved'};
    }else if(/^\*\*(?:我的|你的|学生)?(?:回答|代码)[^*\n]*\*\*/.test(inline)){
      const marker=inline.match(/^\*\*(?:我的|你的|学生)?(?:回答|代码)[^*\n]*\*\*[：:]?\s*/);
      const inlineValue=inline.slice(marker[0].length);
      let end=section.length;
      for(const next of tokens.slice(i+3))if(next.level===0&&['hr','html_block','heading_open'].includes(next.type)){end=lines[next.map[0]];break;}
      const value=[inlineValue,section.slice(lines[token.map[1]]??section.length,end).trim()].filter(Boolean).join('\n\n');
      const bodyTokens=md.parse(value,{}),singleFence=bodyTokens.length===1&&bodyTokens[0].type==='fence';
      const decoded=(singleFence?bodyTokens[0].content.replace(/\n$/,''):value).replace(/\r\n/g,'\n');
      slot={value:/^(?:\s*\/\/\s*在这里写出完整代码\s*|\s*（(?:在这里填写|待填写)）\s*)$/.test(decoded)?'':decoded,kind:'legacy'};
    }
  }
  return latest||slot||{value:'',kind:'empty'};
}
// Markdown token maps exclude headings inside comments, fenced code and quotes.
function parseQuestions(source) {
  const tokens = md.parse(source, {});
  const offsets = [0];
  for (const match of source.matchAll(/\n/g)) offsets.push(match.index + 1);
  const headings = [];
  let listSection = false, sectionLevel = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && t.level === 0) {
      const title=tokens[i+1].content;
      const level=Number(t.tag.slice(1));
      if(level<=sectionLevel) listSection=false;
      if(/本轮题目|本轮练习/.test(title)){listSection=true;sectionLevel=level;}
      headings.push({ title, start: offsets[t.map[0]], body: offsets[t.map[1]] ?? source.length, level });
    } else if(t.type==='paragraph_open' && t.level===0 && t.map) {
      const raw=source.slice(offsets[t.map[0]],offsets[t.map[1]]??source.length);
      const q=raw.match(/^\*\*((?:问题|题目|练习题)\s*\d+[^*]*)\*\*[：:]?\s*([^\n]*)/);
      if(q) headings.push({title:q[1],prefix:q[2],start:offsets[t.map[0]],body:offsets[t.map[1]]??source.length,level:6,question:true});
    } else if(listSection && t.type==='list_item_open' && t.level===1 && t.map) {
      const raw=source.slice(offsets[t.map[0]],offsets[t.map[1]]??source.length);
      const q=raw.match(/^\s*(\d+)[.)]\s+(.*)/);
      if(q) headings.push({title:`问题 ${q[1]}`,prefix:q[2],start:offsets[t.map[0]],body:offsets[t.map[0]+1]??source.length,level:6,question:true});
    }
  }
  let round = '当前轮';
  const questions = [];
  let assessmentLevel = null;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    // Final result and answer-key sections belong to the tutor, including all
    // nested question headings. Round assessments are skipped until a peer section.
    if(/最终复评|正确答案/.test(h.title)) break;
    if(assessmentLevel!==null){if(h.level>assessmentLevel)continue;assessmentLevel=null;}
    if(/评估|解析|复评/.test(h.title)){assessmentLevel=h.level;continue;}
    const r = h.title.match(/第[一二三四五六七八九十\d]+轮|费曼(?:诊断)?轮|摸底轮/);
    if (r) round = r[0];
    const q = h.title.match(/(?:问题|题目|练习题)\s*(\d+)/);
    if (!q || /评估|解析|复评/.test(h.title)) continue;
    let end = source.length;
    for (let j = i+1; j < headings.length; j++) {
      if (headings[j].level <= h.level || /(?:问题|题目)\s*\d+|评估|最终复评|正确答案/.test(headings[j].title)) { end = headings[j].start; break; }
    }
    const body = source.slice(h.body, end);
    const marker = body.search(/\*\*(?:(?:我的|你的|学生)?(?:回答|代码)|学生作答)[^\n]*\*\*/);
    const prompt = [h.prefix,(marker >= 0 ? body.slice(0,marker) : body).replace(/\n---\s*$/, '').trim()].filter(Boolean).join('\n');
    questions.push({ id: String(h.start), number: q[1], title: h.title, round, prompt, start: h.start, end, answer:readQuestionAnswer(source,h.body,end) });
  }
  const latest = questions.at(-1)?.round;
  return { questions, current: questions.filter(q => q.round === latest), round: latest || '当前轮' };
}
function appendAnswers(source, answers, date = new Date()) {
  const parsed = parseQuestions(source);
  if (!parsed.current.length || parsed.current.length > 3) throw new Error('无法识别 1–3 题的当前轮，请在源文档中作答。');
  const allowed = new Map(parsed.current.map(q => [q.id, q]));
  const updates = Object.entries(answers).map(([id, value]) => {
    if (!allowed.has(id) || typeof value !== 'string' || !value.trim()) throw new Error('题目已变化或答案为空，请重新加载。');
    const fence = '`'.repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map(m=>m[0].length+1)));
    const time = date.toLocaleString('zh-CN', { hour12: false });
    const q = allowed.get(id);
    const section = source.slice(q.start,q.end);
    const trailing = section.match(/(?:\r?\n)[ \t]*---[ \t]*(?:\r?\n|\s)*$/);
    const position = trailing ? q.end - trailing[0].length : q.end;
    const nl = source.includes('\r\n') ? '\r\n' : '\n';
    const insert = `\n\n**学生作答 · ${time}**\n\n${fence}text\n${value}\n${fence}\n\n`.replace(/\r?\n/g,nl);
    return {position, insert};
  });
  if (!updates.length) throw new Error('请先填写至少一道题。');
  updates.sort((a,b)=>b.position-a.position);
  for (const u of updates) source = source.slice(0,u.position)+u.insert+source.slice(u.position);
  return source;
}
module.exports = { parseQuestions, appendAnswers };
