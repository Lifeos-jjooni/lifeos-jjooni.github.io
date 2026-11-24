import {project,makeEvent,newId,safeTitle} from './core.mjs';
import {sheetsCore} from './sheets.mjs';
import {googleConfig} from './config.mjs';
import {configReady,requestGoogleToken,verifyGoogleToken,googleCoreFiles,enrollmentReady,enrollmentPin} from './google.mjs';
const el=x=>document.getElementById(x);let events=[],device=null,mode=null,editing=null,proposalUsed=false,filter='OPEN',epoch=0,busy=false,controller=null,session=null,store=null,files=null,pending=null,timer=null,creating=false,gisReady=false,hiddenAt=null,hideTimer=null;
const demoTitles=['가상 일정 확인','가상 준비물 점검','가상 할 일 검토','가상 AI 제안 확인'];
const enabled=window.top===window.self&&configReady(googleConfig,location.origin);
const enrolling=window.top===window.self&&enrollmentReady(googleConfig,location.origin);
function controls(){
 el('google').disabled=!enabled||!gisReady||busy||!!mode;el('enroll').hidden=!enrolling;el('enroll').disabled=!gisReady||busy||!!mode;el('start').disabled=busy||!!mode;
 for(const b of el('dashboard').querySelectorAll('button,input,select'))b.disabled=busy||!!pending;
 el('retryCore').disabled=busy||!pending;el('refreshCore').disabled=busy||!!pending;el('proposal').disabled=busy||!!pending||proposalUsed||mode!=='demo';
 el('createCore').disabled=busy||creating;el('cancelEdit').hidden=!editing;el('lock').disabled=false;
}
function resetDraft(){editing=null;el('form').reset();el('liveTitle').value='';el('cancelEdit').hidden=true;}
function clear(message='데이터 표시 삭제 · 연결 대기'){
 epoch++;clearTimeout(hideTimer);hideTimer=null;hiddenAt=null;document.body.classList.remove('backgrounded');controller?.abort();controller=null;clearTimeout(timer);timer=null;session=null;store=null;files=null;pending=null;creating=false;events=[];device=null;mode=null;el('pin').textContent='';el('pinPanel').hidden=true;busy=false;proposalUsed=false;filter='OPEN';resetDraft();el('tasks').replaceChildren();el('summary').textContent='';el('dashboard').hidden=true;el('start').hidden=false;el('google').hidden=false;el('lock').hidden=true;el('createCore').hidden=true;el('retryCore').hidden=true;el('status').textContent=message;controls();
}
function active(e){return e===epoch&&(!controller||!controller.signal.aborted);}
function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
function day(offset=0){const d=new Date(Date.now()+9*3600000);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
function visible(t){if(t.conflict)return true;const s=t.state;if(filter==='ALL')return true;if(filter==='OPEN'||filter==='DONE')return s.status===filter;return s.status==='OPEN'&&!!s.due_date&&(filter==='TODAY'?s.due_date===day():filter==='OVERDUE'?s.due_date<day():s.due_date>=day()&&s.due_date<=day(7));}
function render(){
 const {tasks,duplicateRows}=project(events);el('summary').textContent='미완료 '+tasks.filter(t=>t.state?.status==='OPEN').length+'건 · 완료 '+tasks.filter(t=>t.state?.status==='DONE').length+'건 · 충돌 '+tasks.filter(t=>t.conflict).length+'건'+(duplicateRows?' · 중복행 '+duplicateRows+'건(표시 제외)':'');
 for(const b of el('filters').querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b.dataset.filter===filter));
 el('tasks').replaceChildren();const list=tasks.filter(visible).sort((a,b)=>Number(b.conflict)-Number(a.conflict)||(a.state?.due_date||'9999').localeCompare(b.state?.due_date||'9999')||(a.state?.priority||'').localeCompare(b.state?.priority||''));
 if(!list.length)el('tasks').append(document.createTextNode('해당하는 할 일이 없습니다.'));
 for(const t of list){const row=document.createElement('div');row.className='task'+(t.conflict?' conflict':'');if(t.conflict){row.append(document.createTextNode('동시 수정 감지 · 확인 필요'));for(const v of t.variants){row.append(button(v.title+' · '+v.status+' · '+v.priority+' · '+(v.due_date||'기한 없음'),()=>{if(confirm('이 변경을 선택할까요? 다른 변경 이력은 보존됩니다.'))add('RESOLVE',t.task_id,null,{heads:t.heads,chosen:v.event_id});}));}}else{const s=t.state,h=t.heads[0],title=document.createElement('strong'),meta=document.createElement('p'),actions=document.createElement('div');title.textContent=s.title;meta.className='muted';meta.textContent=s.status+' · '+s.priority+' · '+(s.due_date||'기한 없음');actions.className='actions';const command=s.status==='OPEN'?'COMPLETE':s.status==='DONE'?'REOPEN':'RESTORE';actions.append(button({COMPLETE:'완료',REOPEN:'다시 열기',RESTORE:'복원'}[command],()=>add(command,t.task_id,h)));if(s.status==='DONE')actions.append(button('보관',()=>add('ARCHIVE',t.task_id,h)));if(s.status!=='ARCHIVED')actions.append(button('수정',()=>{editing={id:t.task_id,head:h};el(mode==='demo'?'title':'liveTitle').value=s.title;el('priority').value=s.priority;el('due').value=s.due_date||'';controls();}));row.append(title,meta,actions);}el('tasks').append(row);}
 el('retryCore').hidden=!pending;controls();
}
function show(modeName){mode=modeName;device=newId('dev');el('start').hidden=true;el('google').hidden=true;el('lock').hidden=false;el('dashboard').hidden=false;el('title').hidden=mode!=='demo';el('liveTitle').hidden=mode==='demo';el('refreshCore').hidden=mode==='demo';render();}
async function commit(event){
 if(!store||busy)return false;const e=epoch;busy=true;controls();
 try{const result=await store.append(event);if(!active(e))return false;events=result.events;pending=null;el('status').textContent='Google CORE 기록 및 재조회 확인';return true;}
 catch(err){if(!active(e))return false;if(/OWNER_|GOOGLE_401|GOOGLE_403|SESSION_ENDED|CORE_SCHEMA|CORE_ROW_INVALID|EVENT_ID_COLLISION/.test(err.message)){clear('연결 또는 데이터 검증 실패 · 재인증 필요');return false;}pending=event;events=[];el('status').textContent='저장 결과 미확정 · 같은 변경만 재확인할 수 있습니다.';return false;}
 finally{if(active(e)){busy=false;render();}}
}
async function add(event_type,task_id,base_event_id,payload={}){
 if(!mode||busy||pending)return false;try{const e=makeEvent({event_type,task_id,base_event_id,payload,device_id:device});if(mode==='demo'){const next=[...events,e];project(next);events=next;render();return true;}return await commit(e);}catch{el('status').textContent='허용되지 않는 변경입니다.';return false;}
}
async function loadCore(id){
 const e=epoch;store=sheetsCore({fileId:id,token:session.token,signal:controller.signal});const r=await store.read();if(!active(e)||document.hidden)throw Error('SESSION_ENDED');events=r.events;el('createCore').hidden=true;show('live');el('status').textContent='Google 계정 확인 · 비민감 CORE만 사용 · 앱 자체 생체인증 아님';
}
el('start').onclick=()=>{clear();show('demo');el('status').textContent='가상 데이터 전용 · 저장/Google 연동 없음';};
el('lock').onclick=()=>clear();
el('form').onsubmit=async e=>{e.preventDefault();if(!mode||busy||pending)return;const p={title:el(mode==='demo'?'title':'liveTitle').value,priority:el('priority').value,due_date:el('due').value||null};if(!safeTitle(p.title)||(mode==='demo'&&!demoTitles.includes(p.title))){el('status').textContent='비민감한 짧은 제목만 입력하세요.';return;}const ok=await (editing?add('EDIT',editing.id,editing.head,p):add('CREATE',newId('task'),null,p));if(ok){resetDraft();controls();}};
el('cancelEdit').onclick=()=>{resetDraft();controls();};
el('proposal').onclick=async()=>{if(mode!=='demo'||proposalUsed||!confirm('가상 AI 제안을 할 일로 등록할까요?'))return;proposalUsed=await add('CREATE',newId('task'),null,{title:'가상 AI 제안 확인',priority:'P1',due_date:null});controls();};
el('retryCore').onclick=async()=>{if(pending&&!busy&&await commit(pending)){resetDraft();controls();}};
el('refreshCore').onclick=async()=>{if(!store||busy||pending)return;const e=epoch;busy=true;controls();try{const r=await store.read();if(active(e)){events=r.events;resetDraft();el('status').textContent='Google CORE 최신 기록 확인';}}catch{if(active(e))clear('조회 실패 · 재인증 필요');}finally{if(active(e)){busy=false;render();}}};
for(const b of el('filters').querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;render();};
el('google').onclick=async()=>{
 if(!enabled||!gisReady||busy)return;clear();const e=epoch;controller=new AbortController();busy=true;el('lock').hidden=false;controls();
 try{const response=await requestGoogleToken({config:googleConfig,signal:controller.signal});const auth=await verifyGoogleToken({response,config:googleConfig,signal:controller.signal});if(!active(e)||document.hidden)throw Error('SESSION_ENDED');session=auth;timer=setTimeout(()=>clear('Google 세션 만료 · 다시 연결하세요'),Math.max(0,auth.expiresAt-Date.now()));files=googleCoreFiles({token:auth.token,signal:controller.signal});const id=await files.discover();if(!active(e)||document.hidden)throw Error('SESSION_ENDED');if(id)await loadCore(id);else{el('createCore').hidden=false;el('start').hidden=true;el('google').hidden=true;el('status').textContent='본인 확인 완료 · 비민감 CORE 파일 생성 여부를 선택하세요.';}}
 catch{if(active(e))clear('Google 연결 실패 · 계정 및 권한을 확인하세요');}finally{if(active(e)){busy=false;controls();}}
};
el('createCore').onclick=async()=>{if(!files||busy||creating||!confirm('본인 Google Drive에 새 비민감 CORE 파일을 생성할까요?'))return;const e=epoch;creating=true;busy=true;controls();try{const id=await files.create();if(active(e))await loadCore(id);}catch{if(active(e)){el('status').textContent='생성 결과 미확정 · 중복 방지를 위해 재생성하지 마세요. Drive에서 확인 후 다시 연결하세요.';}}finally{if(active(e)){busy=false;controls();}}};
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){
  if(enrolling){el('pin').textContent='';el('pinPanel').hidden=true;}
  if(mode==='demo'){clear();return;}
  if(session){hiddenAt=Date.now();document.body.classList.add('backgrounded');clearTimeout(hideTimer);hideTimer=setTimeout(()=>clear('자리 비움 · 다시 연결하세요'),120000);}
 }else if(hiddenAt!==null){
  clearTimeout(hideTimer);hideTimer=null;const elapsed=Date.now()-hiddenAt;hiddenAt=null;
  if(elapsed>=120000||!session||Date.now()>=session.expiresAt){clear('세션 만료 · 다시 연결하세요');return;}
  document.body.classList.remove('backgrounded');
  if(mode==='live'&&!pending&&!busy)el('refreshCore').click();
 }
});window.addEventListener('pagehide',()=>clear());
el('enroll').onclick=async()=>{
 if(!enrolling||!gisReady||busy)return;clear();const e=epoch;controller=new AbortController();busy=true;el('lock').hidden=false;controls();
 try{const response=await requestGoogleToken({config:googleConfig,signal:controller.signal,enrollment:true});const pin=await enrollmentPin({response,signal:controller.signal});if(!active(e)||document.hidden)return;el('pin').textContent=pin;el('pinPanel').hidden=false;el('status').textContent='설정용 계정 식별값 · Google에서 선택한 계정이 본인인지 확인하세요. 데이터 접근 권한은 요청하지 않았습니다.';}
 catch{if(active(e))clear('설정용 계정 확인 실패');}finally{if(active(e)){busy=false;controls();}}
};
if(enabled||enrolling){const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=()=>{gisReady=!!globalThis.google?.accounts?.oauth2;controls();};s.onerror=()=>{el('status').textContent='Google 인증 모듈을 불러오지 못했습니다.';};document.head.append(s);}
controls();if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
