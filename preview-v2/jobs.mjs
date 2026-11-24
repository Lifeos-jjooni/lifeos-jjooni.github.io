import {canonical,safeTitle,newId} from './core.mjs';
export const JOB_HEADER=['schema','record_id','job_id','kind','base_id','agent','text','due_date','recorded_at'];
const schema='LIFEOS_AI_JOB_V1',agents=['JJOONI','ROY','JJANGGU'],id=(x,p)=>typeof x==='string'&&new RegExp('^'+p+'_[a-f0-9]{32}$').test(x);
const date=x=>x===''||(/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x);
export function jobRow({job_id=newId('job'),record_id=newId('rec'),kind,base_id='',agent,text='',due_date='',recorded_at=new Date().toISOString()}){
 return validate([schema,record_id,job_id,kind,base_id,agent,text,due_date,recorded_at]);
}
function validate(r){
 if(!Array.isArray(r)||r.length!==9||r.some(x=>typeof x!=='string')||r[0]!==schema||!id(r[1],'rec')||!id(r[2],'job')||!agents.includes(r[5])||!date(r[7])||!Number.isFinite(Date.parse(r[8])))throw Error('JOB_ROW_INVALID');
 if(r[3]==='REQUEST'){if(r[4]||!safeTitle(r[6]))throw Error('JOB_REQUEST_INVALID');}
 else if(!id(r[4],'rec')||r[7]||!['RECEIPT','VERIFY','CANCEL'].includes(r[3])||(r[3]==='RECEIPT'?!safeTitle(r[6]):!!r[6]))throw Error('JOB_TRANSITION_INVALID');
 return r;
}
export function projectJobs(rows){
 if(!Array.isArray(rows)||rows.length>2000)throw Error('JOB_LIMIT');
 const unique=new Map(),groups=new Map();let duplicates=0;
 for(const r of rows){validate(r);if(unique.has(r[1])){if(canonical(unique.get(r[1]))!==canonical(r))throw Error('JOB_ID_COLLISION');duplicates++;continue;}unique.set(r[1],r);if(!groups.has(r[2]))groups.set(r[2],[]);groups.get(r[2]).push(r);}
 const jobs=[];
 for(const [job_id,rs] of groups){
  const roots=rs.filter(r=>r[3]==='REQUEST');if(roots.length!==1)throw Error('JOB_ROOT');
  const root=roots[0],states=new Map([[root[1],'REQUESTED']]),used=new Set(),remaining=rs.filter(r=>r!==root);
  while(remaining.length){let progress=false;for(let i=remaining.length-1;i>=0;i--){const r=remaining[i],p=unique.get(r[4]);if(!p||p[2]!==job_id||r[5]!==root[5])throw Error('JOB_PARENT');if(!states.has(r[4]))continue;const s=states.get(r[4]);const allowed=r[3]==='RECEIPT'&&s==='REQUESTED'?'RESULT_UNVERIFIED':r[3]==='VERIFY'&&s==='RESULT_UNVERIFIED'?'VERIFIED':r[3]==='CANCEL'&&['REQUESTED','RESULT_UNVERIFIED'].includes(s)?'CANCELLED':null;if(!allowed)throw Error('JOB_TRANSITION_INVALID');states.set(r[1],allowed);used.add(r[4]);remaining.splice(i,1);progress=true;}if(!progress)throw Error('JOB_CYCLE');}
  const heads=[...states.keys()].filter(k=>!used.has(k));const status=heads.length===1?states.get(heads[0]):'CONFLICT';
  const receipts=rs.filter(r=>r[3]==='RECEIPT').map(r=>r[6]);
  jobs.push({job_id,agent:root[5],title:root[6],due_date:root[7],head:heads.length===1?heads[0]:null,status,receipts});
 }
 return {jobs,duplicates};
}
export function dispatchText(j){if(j.status!=='REQUESTED')throw Error('JOB_NOT_REQUESTED');return 'LIFE OS 업무 요청 (자동 전송 아님)\n업무 ID: '+j.job_id+'\n담당 AI: '+j.agent+'\n요청: '+j.title+'\n기한: '+(j.due_date||'미정')+'\n비민감 정보만 처리. 완료 후 업무 ID와 짧은 결과 요약을 회신. 실제 결과가 없으면 완료라고 주장하지 말 것.';}
export function jobsStore({fileId,token,signal,fetcher=fetch}){
 if(!/^[A-Za-z0-9_-]{10,160}$/.test(fileId||'')||!token)throw Error('CONSENT_REQUIRED');
 const drive='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId),sheet='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(fileId);
 async function req(url,method='GET',data){if(signal?.aborted)throw Error('SESSION_ENDED');const r=await fetcher(url,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,cache:'no-store',credentials:'omit',redirect:'error',signal});if(signal?.aborted)throw Error('SESSION_ENDED');if(!r.ok)throw Error(r.status===401||r.status===403?'OWNER_ONLY_REQUIRED':'JOB_READ_FAILED');return r.json();}
 async function guard(){const m=await req(drive+'?fields='+encodeURIComponent('id,mimeType,ownedByMe,shared,trashed,driveId,permissions(type,role)'));if(m.id!==fileId||m.mimeType!=='application/vnd.google-apps.spreadsheet'||m.ownedByMe!==true||m.shared!==false||m.trashed!==false||m.driveId||m.permissions?.length!==1||m.permissions[0].type!=='user'||m.permissions[0].role!=='owner')throw Error('OWNER_ONLY_REQUIRED');}
 async function read(){await guard();const v=await req(sheet+'/values/'+encodeURIComponent("'Events'!A1:I2002")+'?valueRenderOption=UNFORMATTED_VALUE');if(!Array.isArray(v.values)||canonical(v.values[0])!==canonical(JOB_HEADER)||v.values.length>2001)throw Error('JOB_SCHEMA');const rows=v.values.slice(1),view=projectJobs(rows);await guard();return {rows,view};}
 async function append(row){validate(row);const before=await read();const prior=before.rows.find(r=>r[1]===row[1]);if(prior){if(canonical(prior)!==canonical(row))throw Error('JOB_ID_COLLISION');return before;}projectJobs([...before.rows,row]);try{await req(sheet+'/values/'+encodeURIComponent("'Events'!A:I")+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values:[row]});}catch{}const after=await read();if(!after.rows.some(r=>canonical(r)===canonical(row)))throw Error('JOB_WRITE_UNCERTAIN');return after;}
 return {read,append};
}
