/* Learning-progress summary card (owned by src/progress-view.js / .css only).
   The caller passes the already-read status string in and gets escaped HTML
   back. Nothing here turns a round, a free-form status or a description into a
   number: the meter is rendered only when the status is an exact
   `${scope} · ${complete} / ${total} ${unit}已掌握[（${pending} ${unit}待记录）]`
   record as produced by lib/learning-progress.cjs display(). "尚未记录" and
   every other wording stay text — they are never mapped to 0%.

   The Chinese record shape is document-derived backend output, not UI chrome:
   it is recognized for counting, and the recognized counters are re-rendered
   through the provided translator (or the Chinese copy below by default) so the
   same record reads naturally in English. Anything that does not match the
   shape is displayed verbatim.

   This module deliberately has no imports: it is pure string rendering and is
   unit-tested in plain Node, so it must not depend on the DOM/i18n bootstrap. */

const UNRECORDED='尚未记录';
const MASTERY=/^([^\r\n]+) · (\d+) \/ (\d+) ([^（\s]+)已掌握(?:（(\d+) ([^（\s）]+)待记录）)?$/;

// Chinese defaults for callers that do not pass `t` (kept in sync with the
// `progress.*` entries in src/i18n.js).
const FALLBACK={
  'progress.chapter':'当前章节',
  'progress.recorded':'已记录的学习进度',
  'progress.unrecorded':'尚未记录',
  'progress.noteChapter':'学习档案中的当前轮次与状态。',
  'progress.noteOverall':'导师更新学习档案后，这里会同步最新进度。',
  'progress.masteredZh':'{scope} · {complete} / {total} {unit}已掌握',
  'progress.pendingZh':'（{n} {unit}待记录）',
  'progress.pendingShort':'{n} {unit}待记录',
  'progress.profileScope':'学习档案',
  'progress.routeScope':'课程路线',
  'progress.lessonUnit':'课',
  'progress.itemUnit':'项',
};
const fallbackTranslate=(key,params)=>{  const template=FALLBACK[key]??key;
  if(params==null)return template;
  return String(template).replace(/\{(\w+)\}/g,(all,name)=>Object.hasOwn(params,name)?String(params[name]):all);
};

function fallbackEscape(value){
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** Locale for the module-level defaults; callers normally pass `t` explicitly. */
let defaultLocale='zh-CN';
export function setProgressLocale(locale){defaultLocale=locale==='en'?'en':'zh-CN';}

function defaultTranslate(key,params){return fallbackTranslate(key,params,defaultLocale);}

function parseMasteryCount(status){
  const match=String(status).match(MASTERY);
  if(!match)return null;
  const complete=Number(match[2]),total=Number(match[3]);
  // A zero denominator, or more mastered than planned, cannot be drawn as a bar
  // without inventing a percentage, so such a record stays plain text.
  if(!Number.isSafeInteger(total)||!Number.isSafeInteger(complete)||total<1||complete>total)return null;
  const percent=Math.round(complete/total*1000)/10;
  return {
    complete,total,
    unit:match[4],
    pending:match[5]==null?null:Number(match[5]),
    pendingUnit:match[6]||match[4],
    percent,
    percentLabel:Number.isInteger(percent)?`${percent}%`:`${percent.toFixed(1)}%`
  };
}

// Fixed scopes produced by lib/learning-progress.cjs (as opposed to a subject
// name taken from the folder path, which always stays verbatim).
const SCOPE_KEYS={'学习档案':'progress.profileScope','课程路线':'progress.routeScope'};

/** Render a recognized mastery count in the active UI language. */
function localizedStatus(text,count,t){
  if(!t)return text;
  const rawScope=text.match(MASTERY)[1];
  const scope=SCOPE_KEYS[rawScope]?t(SCOPE_KEYS[rawScope]):rawScope;
  const pending=count.pending==null?'':t('progress.pendingZh',{n:count.pending,unit:unitText(count.pendingUnit,t)});
  return t('progress.masteredZh',{scope,complete:count.complete,total:count.total,unit:unitText(count.unit,t)})+pending;
}

// Units that appear in learning-progress.cjs output ("课", "项"). These are
// parser-side unit tokens, not free-form document text, so they can be mapped
// explicitly; an unknown unit is kept as written.
const UNIT_KEYS={'课':'progress.lessonUnit','项':'progress.itemUnit'};
function unitText(unit,tr){const key=UNIT_KEYS[unit];return key?tr(key):unit;}

export function renderProgressSummary({label,status,chapter=false,escape,t}={}){
  const safe=typeof escape==='function'?escape:fallbackEscape;
  const tr=typeof t==='function'?t:defaultTranslate;
  const raw=status==null?'':String(status);
  const text=raw.trim()?raw:UNRECORDED;
  const scope=chapter?'chapter':'overall';
  const id=`${scope}-progress`,labelId=`${scope}-progress-label`;
  const fallbackHeading=chapter?tr('progress.chapter'):tr('progress.recorded');
  const heading=label==null||!String(label).trim()?fallbackHeading:String(label);
  const count=parseMasteryCount(text);
  const shown=count?localizedStatus(text,count,tr):(text===UNRECORDED?tr('progress.unrecorded'):text);
  const head=`<div class="progress-card__head"><span class="progress-card__label" id="${labelId}">${safe(heading)}</span><p class="progress-card__status" id="${id}">${safe(shown)}</p></div>`;
  const body=count?meter(count,shown,safe,labelId,tr):`<p class="progress-card__note">${safe(chapter?tr('progress.noteChapter'):tr('progress.noteOverall'))}</p>`;
  return `<section class="progress-card" data-progress-state="${count?'counted':'unrecorded'}" role="group" aria-labelledby="${labelId}">${head}${body}</section>`;
}

function meter(count,text,safe,labelId,tr){
  const pending=count.pending==null?'':`<span class="progress-card__pending">${tr('progress.pendingShort',{n:count.pending,unit:safe(unitText(count.pendingUnit,tr))})}</span>`;
  const bar=`<div class="progress-card__meter" role="progressbar" aria-labelledby="${labelId}" aria-valuemin="0" aria-valuemax="${count.total}" aria-valuenow="${count.complete}" aria-valuetext="${safe(text)}"><span class="progress-card__track"><span class="progress-card__bar" style="width:${count.percent}%"></span></span></div>`;
  const meta=`<div class="progress-card__meta"><p class="progress-card__figures"><span class="progress-card__value">${count.complete}</span><span class="progress-card__total">/ ${count.total} ${safe(unitText(count.unit,tr))}</span></p><span class="progress-card__percent">${count.percentLabel}</span>${pending}</div>`;
  return bar+meta;
}
