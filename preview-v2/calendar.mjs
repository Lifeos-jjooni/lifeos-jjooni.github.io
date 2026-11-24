import {safeTitle,makeEvent,project,canonical} from './core.mjs';
import {sha256,CALENDAR_SCOPE} from './google.mjs';
export const CALENDAR_READ_SCOPES=CALENDAR_SCOPE.split(' ');
export function kstWindow(days,now=Date.now()){
 if(![7,14,21].includes(days))throw Error('WINDOW_INVALID');
 const start=new Date(now+9*3600000).toISOString().slice(0,10);
 const end=new Date(Date.parse(start+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 return {timeMin:start+'T00:00:00+09:00',timeMax:end+'T00:00:00+09:00'};
}
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
export async function normalizeEvent(calendarId,e){
 if(typeof calendarId!=='string'||!calendarId||calendarId.length>1024||typeof e?.id!=='string'||!e.id||e.id.length>1024)throw Error('EVENT_ID_INVALID');
 const instance=e.originalStartTime?.date||e.originalStartTime?.dateTime;const validInstance=typeof instance==='string'&&(day(instance)||(/(Z|[+-]\d\d:\d\d)$/.test(instance)&&Number.isFinite(Date.parse(instance))));
 const key=typeof e.iCalUID==='string'&&e.iCalUID.length>0&&e.iCalUID.length<=1024&&(!e.recurringEventId||validInstance)?['ical',e.iCalUID,validInstance?(day(instance)?instance:new Date(instance).toISOString()):'single']:['event',calendarId,e.id];
 const digest=await sha256(JSON.stringify(key[0]==='event'?[calendarId,e.id]:key));
 const task_id='task_'+digest.slice(0,32);
 if(e.status==='cancelled')return {task_id,cancelled:true};
 if(!['confirmed','tentative'].includes(e.status)||!safeTitle(e.summary)||['private','confidential'].includes(e.visibility)||e.eventType&&e.eventType!=='default')return null;
 const raw=e.start?.date||e.start?.dateTime;
 const due=e.start?.date?raw:typeof raw==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(raw)&&Number.isFinite(Date.parse(raw))?new Date(Date.parse(raw)+9*3600000).toISOString().slice(0,10):null;
 if(!day(due))return null;
 return {task_id,cancelled:false,title:e.summary,due_date:due,time:e.start?.date?'종일':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(raw))};
}
// No persisted source IDs, raw descriptions, attendees or locations.
// Import plan is a candidate only. No writes to Google Calendar.
export function planImport(rows,events,selected){
 const current=new Map(project(events).tasks.map(t=>[t.task_id,t])),original=new Map(events.filter(e=>e.event_type==='CREATE').map(e=>[e.task_id,e.payload])),seen=new Set(),add=[],existing=[],changed=[],cancelled=[];
 if(!Array.isArray(rows)||rows.length>500||!Array.isArray(selected)||selected.length>100)throw Error('SELECTION_LIMIT');
 const ids=new Set(selected);if(ids.size!==selected.length)throw Error('DUPLICATE_SELECTION');
 for(const r of rows){
  if(!r||!/^task_[a-f0-9]{32}$/.test(r.task_id)||seen.has(r.task_id))throw Error('SOURCE_DUPLICATE');seen.add(r.task_id);
  const t=current.get(r.task_id);
  if(r.cancelled){if(t)cancelled.push(r.task_id);continue;}
  if(!safeTitle(r.title)||!day(r.due_date))throw Error('SOURCE_INVALID');
  if(t){if(!t.state||original.get(r.task_id)?.due_date!==r.due_date||original.get(r.task_id)?.title!==r.title)changed.push(r.task_id);else existing.push(r.task_id);continue;}
  if(ids.has(r.task_id))add.push(r);
 }
 if([...ids].some(id=>!seen.has(id)))throw Error('UNKNOWN_SELECTION');
 return {add,existing,changed,cancelled};
}
export function calendarAdapter({token,signal,fetcher=fetch}){
 if(!token)throw Error('CONSENT_REQUIRED');
 const base='https://www.googleapis.com/calendar/v3';
 async function pages(path,params,max){
  const items=[],tokens=new Set();let pageToken='';
  for(let n=0;n<10;n++){
   if(signal?.aborted)throw Error('SESSION_ENDED');
   const q=new URLSearchParams(params);if(pageToken)q.set('pageToken',pageToken);
   const r=await fetcher(base+path+'?'+q,{headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',redirect:'error',signal});
   if(!r.ok||signal?.aborted)throw Error('CALENDAR_READ_FAILED');
   const p=await r.json();if(!Array.isArray(p.items||[]))throw Error('CALENDAR_SCHEMA');
   items.push(...(p.items||[]));if(items.length>max)throw Error('CALENDAR_LIMIT');
   if(!p.nextPageToken)return items;
   if(typeof p.nextPageToken!=='string'||tokens.has(p.nextPageToken))throw Error('CALENDAR_PAGE_LOOP');
   pageToken=p.nextPageToken;tokens.add(pageToken);
  }
  throw Error('CALENDAR_LIMIT');
 }
 async function calendars(){const items=await pages('/users/me/calendarList',{minAccessRole:'reader',maxResults:'100',fields:'nextPageToken,items(id,summary,primary,accessRole,deleted)'},200);return items.filter(x=>!x.deleted&&typeof x.id==='string'&&['owner','writer','reader'].includes(x.accessRole)).map(x=>({id:x.id,summary:typeof x.summary==='string'?x.summary:'캘린더',primary:x.primary===true}));}
 async function events(calendarId,days,now){if(typeof calendarId!=='string'||!calendarId||calendarId.length>1024)throw Error('CALENDAR_ID');const items=await pages('/calendars/'+encodeURIComponent(calendarId)+'/events',{...kstWindow(days,now),singleEvents:'true',showDeleted:'true',maxResults:'250',fields:'nextPageToken,items(id,status,summary,start,visibility,eventType,iCalUID,recurringEventId,originalStartTime)'},500);const start=kstWindow(days,now).timeMin.slice(0,10);return (await Promise.all(items.map(e=>normalizeEvent(calendarId,e)))).filter(r=>r&&(r.cancelled||r.due_date>=start));}
 return {calendars,events};
}

// Copies of a shared invitation use one canonical task ID when iCalUID and occurrence are supplied.
// Inconsistent copies and live/cancelled mixtures are not safe to import automatically.
export function groupCalendarRows(rows){
 const groups=new Map(),result=[];let ambiguous=0;
 for(const r of rows){if(!groups.has(r.task_id))groups.set(r.task_id,[]);groups.get(r.task_id).push(r);}
 for(const rs of groups.values()){
  const live=rs.filter(r=>!r.cancelled),first=live[0]||rs[0];
  if(live.length&&rs.some(r=>r.cancelled||r.title!==first.title||r.due_date!==first.due_date||r.time!==first.time)){ambiguous++;continue;}
  result.push({...first,calendar:[...new Set(rs.map(r=>r.calendar))].join(' / ')});
 }
 return {rows:result,ambiguous};
}
