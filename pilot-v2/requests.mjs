import {canonical,safeTitle,newId} from './core.mjs';
import {sha256} from './google.mjs';
export const REQUEST_HEADER=['schema','record_id','request_id','kind','base_id','agent','text','payload','recorded_at'];
const SCHEMA='LIFEOS_REQUEST_V1',id=(v,p)=>typeof v==='string'&&new RegExp('^'+p+'_[a-f0-9]{32}$').test(v);
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
const date=v=>v===null||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function safeRequest(v){
 if(typeof v!=='string'||v!==v.trim()||!v||v.length>600||/[\p{Cc}\p{Cf}]/u.test(v))return false;
 const n=v.normalize('NFKC'),c=n.replace(/\s/g,'');
 return !/(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\d[ .\-/·_]?){6,})/i.test(n)&&!/(?:거래처|거래선|협력사|클라이언트|고객|계약서|사내|기밀|회의록|내부보고|업무보고|은행계좌|주민등록|사번|통장비번|비밀번호|인증번호)/.test(c);
}
export function requestRow({record_id=newId('reqrec'),request_id=newId('req'),kind,base_id='',agent='OWNER',text='',payload='',recorded_at=new Date().toISOString()}){
 return validateRequest([SCHEMA,record_id,request_id,kind,base_id,agent,text,payload,recorded_at]);
}
export function validateRequest(r){
 if(!Array.isArray(r)||r.length!==9||r.some(x=>typeof x!=='string')||r[0]!==SCHEMA||!id(r[1],'reqrec')||!id(r[2],'req')||!timestamp(r[8]))throw Error('REQUEST_ROW_INVALID');
 if(r[3]==='REQUEST'){if(r[4]||r[5]!=='OWNER'||!safeRequest(r[6])||r[7])throw Error('REQUEST_INVALID');}
 else if(r[3]==='CANCEL'){if(!id(r[4],'reqrec')||r[5]!=='OWNER'||r[6]||r[7])throw Error('REQUEST_CANCEL_INVALID');}
 else if(r[3]==='ANSWER'){
  if(!id(r[4],'reqrec')||r[5]!=='JJOONI'||!safeRequest(r[6])||r[7].length>4000)throw Error('REQUEST_ANSWER_INVALID');
  let p;try{p=JSON.parse(r[7]);}catch{throw Error('REQUEST_ANSWER_INVALID');}
  if(!exact(p,['tasks'])||!Array.isArray(p.tasks)||p.tasks.length>5||p.tasks.some(t=>!exact(t,['title','priority','due_date','reason'])||!safeTitle(t.title)||!['P0','P1','P2'].includes(t.priority)||!date(t.due_date)||!safeTitle(t.reason))||new Set(p.tasks.map(t=>t.title)).size!==p.tasks.length)throw Error('REQUEST_ANSWER_INVALID');
 }else throw Error('REQUEST_KIND');
 return r;
}
export function projectRequests(rows){
 if(!Array.isArray(rows)||rows.length>1000)throw Error('REQUEST_LIMIT');
 const unique=new Map(),groups=new Map();
 for(const [i,r] of rows.entries()){try{validateRequest(r);}catch{throw Error('REQUEST_ROW_INVALID_'+(i+2));}
  if(unique.has(r[1])){if(canonical(unique.get(r[1]))!==canonical(r))throw Error('REQUEST_ID_COLLISION');continue;}
  unique.set(r[1],r);if(!groups.has(r[2]))groups.set(r[2],[]);groups.get(r[2]).push(r);}
 const requests=[];
 for(const [request_id,rs] of groups){const roots=rs.filter(r=>r[3]==='REQUEST');if(roots.length!==1)throw Error('REQUEST_ROOT');const root=roots[0],tail=rs.filter(r=>r!==root);
  if(tail.some(r=>r[4]!==root[1]||Date.parse(r[8])<Date.parse(root[8])))throw Error('REQUEST_PARENT');
  const status=tail.length>1?'CONFLICT':!tail.length?'REQUESTED':tail[0][3]==='CANCEL'?'CANCELLED':'ANSWERED';
  requests.push({id:request_id,root:root[1],question:status==='CANCELLED'?'':root[6],created:root[8],status,answer:status==='ANSWERED'?{id:tail[0][1],text:tail[0][6],tasks:JSON.parse(tail[0][7]).tasks,issued:tail[0][8]}:null});
 }
 return requests.sort((a,b)=>b.created.localeCompare(a.created)||a.id.localeCompare(b.id));
}
export async function requestTaskId(requestId,index){if(!id(requestId,'req')||!Number.isInteger(index)||index<0||index>=5)throw Error('REQUEST_TASK_ID');return 'task_'+(await sha256('LIFEOS-REQUEST-TASK-V1:'+requestId+':'+index)).slice(0,32);}
export function requestsStore({fileId,token,signal,fetcher=fetch}){
 if(!/^[A-Za-z0-9_-]{10,160}$/.test(fileId||'')||!token)throw Error('CONSENT_REQUIRED');
 const drive='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId),sheet='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(fileId);
 async function req(url,method='GET',body){if(signal?.aborted)throw Error('SESSION_ENDED');const r=await fetcher(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error',signal});if(signal?.aborted)throw Error('SESSION_ENDED');if(!r.ok)throw Error('REQUEST_HTTP_'+r.status);return r.json();}
 async function guard(){const m=await req(drive+'?fields='+encodeURIComponent('id,mimeType,ownedByMe,shared,trashed,driveId,permissions(type,role)'));if(m.id!==fileId||m.mimeType!=='application/vnd.google-apps.spreadsheet'||m.ownedByMe!==true||m.shared!==false||m.trashed!==false||m.driveId||m.permissions?.length!==1||m.permissions[0].type!=='user'||m.permissions[0].role!=='owner')throw Error('OWNER_ONLY_REQUIRED');}
 async function read(){await guard();const v=await req(sheet+'/values/'+encodeURIComponent("'Events'!A1:I1002")+'?valueRenderOption=UNFORMATTED_VALUE');if(!Array.isArray(v.values)||canonical(v.values[0])!==canonical(REQUEST_HEADER)||v.values.length>1001)throw Error('REQUEST_SCHEMA');const rows=v.values.slice(1);const view=projectRequests(rows);await guard();return {rows,view};}
 async function append(row){validateRequest(row);if(!['REQUEST','CANCEL'].includes(row[3]))throw Error('CLIENT_WRITE_DENIED');const before=await read(),prior=before.rows.find(r=>r[1]===row[1]);if(prior){if(canonical(prior)!==canonical(row))throw Error('REQUEST_ID_COLLISION');return before;}
  const current=before.view.find(r=>r.id===row[2]);if(row[3]==='REQUEST'?!!current:!current||current.status!=='REQUESTED'||current.root!==row[4])throw Object.assign(Error('REQUEST_STALE'),{rows:before.rows});
  projectRequests([...before.rows,row]);try{await req(sheet+'/values/'+encodeURIComponent("'Events'!A:I")+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values:[row]});}catch{}
  const after=await read();if(!after.rows.some(r=>canonical(r)===canonical(row)))throw Error('REQUEST_WRITE_UNCERTAIN');return after;
 }
 return {read,append};
}
