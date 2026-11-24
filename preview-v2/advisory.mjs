import {canonical,safeTitle,project} from './core.mjs';
import {sha256} from './google.mjs';
export const ADVICE_HEADER=['schema','advice_id','agent','category','issued_at','expires_at','title','action','evidence'];
const SCHEMA='LIFEOS_ADVICE_V1',agents=['JJOONI','ROY','JJANGGU'],categories=['MORNING','MIDDAY','EVENING','PROJECT_H','TASK','TRI_POD'];
const ts=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)&&Number.isFinite(Date.parse(s));
export function validateAdvice(r){
 if(!Array.isArray(r)||r.length!==9||r.some(x=>typeof x!=='string')||r[0]!==SCHEMA||!/^adv_[a-f0-9]{32}$/.test(r[1])||!agents.includes(r[2])||!categories.includes(r[3])||!ts(r[4])||!ts(r[5])||Date.parse(r[5])<=Date.parse(r[4])||Date.parse(r[5])-Date.parse(r[4])>7*864e5||!safeTitle(r[6])||!(r[7]===''||safeTitle(r[7]))||!safeTitle(r[8]))throw Error('ADVICE_ROW_INVALID');
 return r;
}
export function projectAdvice(rows,now=Date.now()){
 if(!Array.isArray(rows)||rows.length>1000)throw Error('ADVICE_LIMIT');const m=new Map();
 for(const r of rows){validateAdvice(r);if(m.has(r[1])&&canonical(m.get(r[1]))!==canonical(r))throw Error('ADVICE_ID_COLLISION');m.set(r[1],r);}
 return [...m.values()].sort((a,b)=>Date.parse(b[4])-Date.parse(a[4])).map(r=>({id:r[1],agent:r[2],category:r[3],issued:r[4],expires:r[5],title:r[6],action:r[7],evidence:r[8],status:Date.parse(r[4])>now+300000?'FUTURE':Date.parse(r[5])<=now?'EXPIRED':'CURRENT'}));
}
export async function adviceTaskId(id){if(!/^adv_[a-f0-9]{32}$/.test(id))throw Error('ADVICE_ID');return 'task_'+(await sha256('LIFEOS-ADVICE-TASK-V1:'+id)).slice(0,32);}
export async function dailyHTaskId(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('DAY_INVALID');return 'task_'+(await sha256('LIFEOS-PROJECT-H-V1:'+day)).slice(0,32);}
export function growthWeek(events,today){
 const first=new Map(),created=new Map();
 for(const e of events){if(e.event_type==='CREATE')created.set(e.task_id,e);if(e.event_type==='COMPLETE'&&(!first.has(e.task_id)||e.client_ts<first.get(e.task_id).client_ts))first.set(e.task_id,e);}
 const days=Array.from({length:7},(_,i)=>({date:new Date(Date.parse(today+'T00:00:00Z')+(i-6)*864e5).toISOString().slice(0,10),xp:0,count:0}));
 for(const t of project(events).tasks){if(!['DONE','ARCHIVED'].includes(t.state?.status)||!first.has(t.task_id))continue;const date=new Date(Date.parse(first.get(t.task_id).client_ts)+9*3600000).toISOString().slice(0,10);const d=days.find(v=>v.date===date);if(d){d.xp+=created.get(t.task_id)?.payload.priority==='P2'?10:30;d.count++;}}
 return days;
}
export function advisoryStore({fileId,token,signal,fetcher=fetch}){
 if(!/^[A-Za-z0-9_-]{10,160}$/.test(fileId||'')||!token)throw Error('CONSENT_REQUIRED');
 async function get(url){if(signal?.aborted)throw Error('SESSION_ENDED');const r=await fetcher(url,{headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',redirect:'error',signal});if(!r.ok||signal?.aborted)throw Error('ADVICE_READ_FAILED');return r.json();}
 async function guard(){const m=await get('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?fields='+encodeURIComponent('id,mimeType,ownedByMe,shared,trashed,driveId,permissions(type,role)'));if(m.id!==fileId||m.mimeType!=='application/vnd.google-apps.spreadsheet'||m.ownedByMe!==true||m.shared!==false||m.trashed!==false||m.driveId||m.permissions?.length!==1||m.permissions[0].type!=='user'||m.permissions[0].role!=='owner')throw Error('OWNER_ONLY_REQUIRED');}
 return {async read(){await guard();const v=await get('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(fileId)+'/values/'+encodeURIComponent("'Events'!A1:I1002")+'?valueRenderOption=UNFORMATTED_VALUE');if(!Array.isArray(v.values)||canonical(v.values[0])!==canonical(ADVICE_HEADER)||v.values.length>1001)throw Error('ADVICE_SCHEMA');const rows=v.values.slice(1);projectAdvice(rows);await guard();return rows;}};
}

// Pure deterministic triage. Only actual OPEN tasks with a known urgency qualify.
// Advice, calendar attendance and missing data never become verified obligations.
export function mustDo(events,today){
 const {tasks}=project(events);
 const rows=tasks.filter(t=>!t.conflict&&t.state?.status==='OPEN').map(t=>{
  const s=t.state,overdue=!!s.due_date&&s.due_date<today,dueToday=s.due_date===today;
  const tier=overdue?0:dueToday?1:s.priority==='P0'?2:99;
  return {id:t.task_id,head:t.heads[0],title:s.title,priority:s.priority,due:s.due_date,tier,reason:overdue?'등록된 마감일 경과':dueToday?'오늘 등록 마감일 도래':'긴급 우선순위로 등록됨'};
 }).filter(t=>t.tier<99).sort((x,y)=>x.tier-y.tier||x.priority.localeCompare(y.priority)||(x.due||'9999').localeCompare(y.due||'9999')||x.id.localeCompare(y.id));
 return rows.slice(0,3);
}
