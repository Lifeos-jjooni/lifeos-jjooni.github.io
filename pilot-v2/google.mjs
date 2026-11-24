// Owner-bound OAuth token model. No client secret, refresh token or persisted access token.
import {HEADER,canonical} from './core.mjs';
const SCOPE='openid https://www.googleapis.com/auth/drive.file';
export const CALENDAR_SCOPE='openid https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly';
export const COMBINED_SCOPE=SCOPE+' '+CALENDAR_SCOPE.split(' ').slice(1).join(' ');
const hashPattern=/^[a-f0-9]{64}$/;
const CORE_TAG='LIFEOS_CORE_EVENTS_V1';
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{10,160}$/.test(x);
export function configReady(c,origin){
 return c?.enabled===true&&typeof c.clientId==='string'&&/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.clientId)&&hashPattern.test(c.ownerSubSha256||'')&&c.origin===origin&&origin.startsWith('https://');
}
export async function sha256(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');}
async function getSubject({response,fetcher=fetch,signal,scope=SCOPE}){
 if(signal?.aborted||!response||response.error||typeof response.access_token!=='string'||!response.access_token||!Number.isFinite(Number(response.expires_in))||Number(response.expires_in)<=30)throw Error('GOOGLE_AUTH_FAILED');
 const actual=new Set(String(response.scope||'').trim().split(/\s+/)),expected=scope.split(' ');
 if(actual.size!==expected.length||!expected.every(s=>actual.has(s)))throw Error('SCOPE_MISMATCH');
 const r=await fetcher('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+response.access_token},cache:'no-store',credentials:'omit',redirect:'error',signal});
 if(!r.ok||signal?.aborted)throw Error('GOOGLE_IDENTITY_FAILED');
 const u=await r.json();if(typeof u.sub!=='string'||!u.sub||signal?.aborted)throw Error('OWNER_MISMATCH');
 return sha256(u.sub);
}
export async function verifyGoogleToken({response,config,fetcher=fetch,signal,calendar=false,combined=false}){
 if(calendar&&combined)throw Error('SCOPE_MISMATCH');
 const pin=await getSubject({response,fetcher,signal,scope:combined?COMBINED_SCOPE:calendar?CALENDAR_SCOPE:SCOPE});
 if(!hashPattern.test(config.ownerSubSha256||'')||pin!==config.ownerSubSha256||signal?.aborted)throw Error('OWNER_MISMATCH');
 return {token:response.access_token,expiresAt:Date.now()+Math.min(Number(response.expires_in),3600)*1000-15000};
}
// Setup only, no data scope or session activation.
export function enrollmentReady(c,origin){return c?.enabled===false&&c?.enrollment===true&&/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.clientId||'')&&c.origin===origin&&origin.startsWith('https://');}
export async function enrollmentPin({response,fetcher=fetch,signal}){return getSubject({response,fetcher,signal,scope:'openid'});}
// Only allow known provider error codes into UI; never expose raw provider details.
export function googleAuthMessage(code){
 const messages={
  GOOGLE_ACCESS_DENIED:'Google 접근이 거부되었습니다. OAuth 앱의 테스트 사용자 등록 여부와 권한 동의를 확인하세요. 기존 계정 등록을 반복할 필요는 없습니다.',
  GOOGLE_AUTH_CANCELLED:'Google 연결이 취소되었습니다. 기존 계정으로 다시 연결할 수 있습니다.',
  GOOGLE_POPUP_BLOCKED:'Google 로그인 창이 차단되었습니다. 브라우저에서 팝업을 허용한 후 다시 연결하세요.',
  GOOGLE_AUTH_UNAVAILABLE:'Google 인증 모듈을 사용할 수 없습니다. 네트워크 또는 브라우저 설정을 확인하세요.',
  OWNER_MISMATCH:'등록된 소유자 계정과 다릅니다. 다른 계정 선택에서 최초 승인한 계정을 선택하세요.',
  SCOPE_MISMATCH:'필요한 Google 권한이 일치하지 않습니다. 권한을 확인한 후 다시 연결하세요.',
  GOOGLE_403:'Google 데이터 접근이 거부되었습니다. API 활성화 및 승인된 권한을 확인하세요.',
  GOOGLE_401:'Google 연결이 만료되었습니다. 기존 계정으로 다시 연결하세요.',
  CORE_NOT_PRIVATE:'저장 파일이 소유자 전용이 아닙니다. 공유 설정을 확인하세요.',
  CORE_MULTIPLE:'저장 파일이 여러 개 발견되었습니다. 중복 파일을 확인하기 전에는 연결하지 않습니다.'
 };return Object.hasOwn(messages,code)?messages[code]:'Google 연결을 완료하지 못했습니다. 네트워크와 권한을 확인한 후 기존 계정으로 다시 연결하세요.';
}
export function requestGoogleToken({config,signal,enrollment=false,calendar=false,combined=false,chooseAccount=false,oauth=globalThis.google?.accounts?.oauth2}){
 if(combined&&(enrollment||calendar))return Promise.reject(Error('SCOPE_MISMATCH'));
 if(!oauth||signal?.aborted) return Promise.reject(Error('GOOGLE_AUTH_UNAVAILABLE'));
 return new Promise((resolve,reject)=>{
  let done=false;const finish=(ok,v)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);ok?resolve(v):reject(v);};
  const abort=()=>finish(false,Error('SESSION_ENDED'));signal?.addEventListener('abort',abort,{once:true});
  try{const client=oauth.initTokenClient({client_id:config.clientId,scope:enrollment?'openid':combined?COMBINED_SCOPE:calendar?CALENDAR_SCOPE:SCOPE,include_granted_scopes:false,callback:r=>r?.error?finish(false,Error(r.error==='access_denied'?'GOOGLE_ACCESS_DENIED':'GOOGLE_AUTH_FAILED')):finish(true,r),error_callback:r=>finish(false,Error(r?.type==='popup_failed_to_open'?'GOOGLE_POPUP_BLOCKED':'GOOGLE_AUTH_CANCELLED'))});client.requestAccessToken({prompt:enrollment||chooseAccount?'select_account':''});}catch{finish(false,Error('GOOGLE_AUTH_FAILED'));}
 });
}
export function googleCoreFiles({token,fetcher=fetch,signal,kind=CORE_TAG,header=HEADER,title='JJOONI LIFE OS — CORE',rowCount=10002}){
 if(![CORE_TAG,'LIFEOS_AI_JOBS_V1','LIFEOS_ADVICE_V1','LIFEOS_REQUEST_V1'].includes(kind))throw Error('FILE_KIND');
 const base='https://www.googleapis.com/drive/v3/files',sbase='https://sheets.googleapis.com/v4/spreadsheets';
 async function req(url,method='GET',data){
  if(signal?.aborted)throw Error('SESSION_ENDED');
  const r=await fetcher(url,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,cache:'no-store',redirect:'error',credentials:'omit',signal});
  if(!r.ok||signal?.aborted)throw Error('GOOGLE_'+r.status);return r.json();
 }
 async function discover(){
  const q=new URLSearchParams({q:"trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and appProperties has { key='lifeos_kind' and value='"+kind+"' }",fields:'nextPageToken,files(id,ownedByMe,shared,trashed,driveId,permissions(type,role))',pageSize:'10',spaces:'drive'});
  const r=await req(base+'?'+q);
  if(r.nextPageToken||!Array.isArray(r.files)||r.files.length>1)throw Error('CORE_MULTIPLE');
  if(!r.files.length)return null;
  const f=r.files[0];if(!validId(f.id)||f.ownedByMe!==true||f.shared!==false||f.trashed!==false||f.driveId||f.permissions?.length!==1||f.permissions[0].type!=='user'||f.permissions[0].role!=='owner')throw Error('CORE_NOT_PRIVATE');
  return f.id;
 }
 async function create(){
  if(await discover())throw Error('CORE_ALREADY_EXISTS');
  // An earlier create may have succeeded before its tag was written. Search the
  // reserved name too (app-visible drive.file scope); never adopt or delete an orphan.
  if(kind==='LIFEOS_REQUEST_V1'){
   const escaped=title.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
   const q=new URLSearchParams({q:"trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and name = '"+escaped+"'",fields:'nextPageToken,files(id)',pageSize:'10',spaces:'drive'});
   const prior=await req(base+'?'+q);
   if(prior.nextPageToken||!Array.isArray(prior.files)||prior.files.length)throw Error('CORE_CREATE_REVIEW_REQUIRED');
  }
  // User-confirmed create only. No blind retry if response is lost. Tag after fully initialized.
  const r=await req(sbase,'POST',{properties:{title},sheets:[{properties:{sheetId:0,title:'Events',gridProperties:{rowCount,columnCount:9,frozenRowCount:1}}}]});
  if(!validId(r.spreadsheetId))throw Error('CREATE_UNCERTAIN');
  const id=r.spreadsheetId;
  const meta=await req(base+'/'+id+'?fields='+encodeURIComponent('id,ownedByMe,shared,trashed,driveId,permissions(type,role)'));
  if(meta.id!==id||meta.ownedByMe!==true||meta.shared!==false||meta.trashed!==false||meta.driveId||meta.permissions?.length!==1||meta.permissions[0].role!=='owner'||meta.permissions[0].type!=='user')throw Error('CORE_NOT_PRIVATE');
  const url=sbase+'/'+id+'/values/'+encodeURIComponent("'Events'!A1:I1");
  await req(url+'?valueInputOption=RAW','PUT',{values:[header]});
  const v=await req(url+'?valueRenderOption=UNFORMATTED_VALUE');if(canonical(v.values)!==canonical([header]))throw Error('CORE_HEADER_FAILED');
  // Prevent normal second create after the existing initialized file is registered.
  await req(base+'/'+id+'?fields=id,appProperties','PATCH',{appProperties:{lifeos_kind:kind}});
  if(await discover()!==id)throw Error('CORE_CREATE_CONFLICT');
  return id;
 }
 return {discover,create};
}
