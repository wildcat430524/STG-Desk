/* Learning-progress summary card (owned by src/progress-view.js / .css only).
   The caller passes the already-read status string in and gets escaped HTML
   back. Nothing here turns a round, a free-form status or a description into a
   number: the meter is rendered only when the status is an exact
   `${scope} · ${complete} / ${total} ${unit}已掌握[（${pending} ${unit}待记录）]`
   record as produced by lib/learning-progress.cjs display(). "尚未记录" and
   every other wording stay text — they are never mapped to 0%. */

const UNRECORDED='尚未记录';
const MASTERY=/^([^\r\n]+) · (\d+) \/ (\d+) ([^（\s]+)已掌握(?:（(\d+) ([^（\s）]+)待记录）)?$/;

function fallbackEscape(value){
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

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

export function renderProgressSummary({label,status,chapter=false,escape}={}){
  const safe=typeof escape==='function'?escape:fallbackEscape;
  const raw=status==null?'':String(status);
  const text=raw.trim()?raw:UNRECORDED;
  const scope=chapter?'chapter':'overall';
  const id=`${scope}-progress`,labelId=`${scope}-progress-label`;
  const heading=label==null||!String(label).trim()?(chapter?'当前章节':'已记录的学习进度'):String(label);
  const count=parseMasteryCount(text);
  const head=`<div class="progress-card__head"><span class="progress-card__label" id="${labelId}">${safe(heading)}</span><p class="progress-card__status" id="${id}">${safe(text)}</p></div>`;
  const body=count?meter(count,text,safe,labelId):`<p class="progress-card__note">${safe(chapter?'学习档案中的当前轮次与状态。':'导师更新学习档案后，这里会同步最新进度。')}</p>`;
  return `<section class="progress-card" data-progress-state="${count?'counted':'unrecorded'}" role="group" aria-labelledby="${labelId}">${head}${body}</section>`;
}

function meter(count,text,safe,labelId){
  const pending=count.pending==null?'':`<span class="progress-card__pending">${count.pending} ${safe(count.pendingUnit)}待记录</span>`;
  const bar=`<div class="progress-card__meter" role="progressbar" aria-labelledby="${labelId}" aria-valuemin="0" aria-valuemax="${count.total}" aria-valuenow="${count.complete}" aria-valuetext="${safe(text)}"><span class="progress-card__track"><span class="progress-card__bar" style="width:${count.percent}%"></span></span></div>`;
  const meta=`<div class="progress-card__meta"><p class="progress-card__figures"><span class="progress-card__value">${count.complete}</span><span class="progress-card__total">/ ${count.total} ${safe(count.unit)}</span></p><span class="progress-card__percent">${count.percentLabel}</span>${pending}</div>`;
  return bar+meta;
}
