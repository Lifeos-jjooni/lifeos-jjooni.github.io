// Browser adapter for an explicitly owner-selected spreadsheet. Never stores a token.
// Live mode is not wired to UI until OAuth origin/account and per-file selection are verified.
import {HEADER,fromRow,toRow,project,canonical} from './core.mjs';
const FILE=/^[A-Za-z0-9_-]{10,160}$/;
export function sheetsCore({fileId,token,fetcher=fetch,signal}){
 if(!FILE.test(fileId||'')||!token)throw Error('CONSENT_REQUIRED');
 const drive='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId);
 const sheet='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(fileId);
 async function request(url,method='GET',body){
  if(signal?.aborted)throw Error('SESSION_ENDED');
  const r=await fetcher(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error',signal});
  if(signal?.aborted)throw Error('SESSION_ENDED');
  if(!r.ok)throw Error('GOOGLE_'+r.status);return r.json();
 }
 async function ownerOnly(){
  const m=await request(drive+'?fields='+encodeURIComponent('id,mimeType,ownedByMe,shared,trashed,driveId,permissions(type,role)'));
  if(m.id!==fileId||m.mimeType!=='application/vnd.google-apps.spreadsheet'||m.ownedByMe!==true||m.shared!==false||m.trashed!==false||m.driveId||m.permissions?.length!==1||m.permissions[0].role!=='owner'||m.permissions[0].type!=='user')throw Error('OWNER_ONLY_REQUIRED');
 }
 async function read(){
  await ownerOnly();
  // Read a bounded sentinel row beyond the accepted maximum; never silently truncate.
  const v=await request(sheet+'/values/'+encodeURIComponent("'Events'!A1:I10002")+'?valueRenderOption=UNFORMATTED_VALUE');
  if(!Array.isArray(v.values)||canonical(v.values[0])!==canonical(HEADER)||v.values.length>10001)throw Error('CORE_SCHEMA');
  const events=v.values.slice(1).map((row,i)=>{try{return fromRow(row);}catch{throw Error('CORE_ROW_INVALID_'+(i+2));}});const view=project(events);await ownerOnly();return {events,view};
 }
 async function append(event){
  const row=toRow(event),before=await read();
  const existing=before.events.find(e=>e.event_id===event.event_id);
  if(existing){if(canonical(existing)!==canonical(event))throw Error('EVENT_ID_COLLISION');return before;}
  const current=before.view.tasks.find(t=>t.task_id===event.task_id);
  if(event.event_type==='CREATE'&&current)throw Object.assign(Error('STALE_BASE'),{events:before.events});
  if(event.event_type==='RESOLVE'&&(!current||canonical([...current.heads].sort())!==canonical([...event.payload.heads].sort())))throw Object.assign(Error('STALE_BASE'),{events:before.events});
  if(!['CREATE','RESOLVE'].includes(event.event_type)&&(!current||current.conflict||current.heads[0]!==event.base_event_id))throw Object.assign(Error('STALE_BASE'),{events:before.events});
  project([...before.events,event]); // reject locally invalid commands before append
  let uncertain=false;
  try{await request(sheet+'/values/'+encodeURIComponent("'Events'!A:I")+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS','POST',{values:[row]});}catch{uncertain=true;}
  // A timeout may have committed. Always reread; never blindly retry.
  let after;try{after=await read();}catch(err){if(/OWNER_|GOOGLE_401|GOOGLE_403|SESSION_ENDED|CORE_SCHEMA|CORE_ROW_INVALID|EVENT_ID_COLLISION/.test(err.message))throw err;throw Error('WRITE_UNCERTAIN_RETAIN_EVENT');}
  if(!after.events.some(e=>e.event_id===event.event_id&&canonical(e)===canonical(event)))throw Error(uncertain?'WRITE_UNCERTAIN_RETAIN_EVENT':'READBACK_MISSING');
  return after;
 }
 return {read,append};
}
