import {project,makeEvent,newId,safeTitle} from './core.mjs';
import {ADVICE_HEADER,projectAdvice,advisoryStore,adviceTaskId,dailyHTaskId,growthWeek,mustDo} from './advisory.mjs';
import {sheetsCore} from './sheets.mjs';
import {planImport,kstWindow,calendarAdapter,groupCalendarRows} from './calendar.mjs';
import {JOB_HEADER,jobRow,projectJobs,dispatchText,jobsStore} from './jobs.mjs';
import {googleConfig} from './config.mjs';
import {configReady,requestGoogleToken,verifyGoogleToken,googleCoreFiles,enrollmentReady,enrollmentPin} from './google.mjs';
const el=x=>document.getElementById(x);let events=[],device=null,mode=null,editing=null,proposalUsed=false,filter='OPEN',epoch=0,busy=false,controller=null,session=null,store=null,files=null,pending=null,timer=null,creating=false,gisReady=false,hiddenAt=null,hideTimer=null;
let calSelected=new Set(),calData=[],openHistory=new Set();
let calSession=null,calApi=null,calLists=[],calChosen=new Set(),calLoaded=false,calTimer=null,calGeneration=0,calAbort=null,calBatch=false;
let page='home',adviceRows=[],adviceConnected=false,adviceCreating=false;
let jobRows=[],jobStore=null,jobFiles=null,jobPending=null,jobCreating=false;
const demoTitles=['가상 일정 확인','가상 준비물 점검','가상 할 일 검토','가상 AI 제안 확인'];
const enabled=window.top===window.self&&configReady(googleConfig,location.origin);
const enrolling=window.top===window.self&&enrollmentReady(googleConfig,location.origin);
function controls(){
 el('google').disabled=!enabled||!gisReady||busy||!!mode;el('enroll').hidden=!enrolling;el('enroll').disabled=!gisReady||busy||!!mode;el('start').disabled=busy||!!mode;
 for(const b of el('dashboard').querySelectorAll('button,input,select'))b.disabled=busy||!!pending||calBatch;
 el('calConnect').disabled=busy||!!pending||calBatch||!!jobPending||!gisReady;el('calDisconnect').disabled=busy||calBatch;
 for(const b of el('calRows').querySelectorAll('input[data-blocked]'))b.disabled=true;
 el('calImport').disabled=busy||!!pending||calBatch||!!jobPending||!calSelected.size;el('calLoad').disabled=busy||!!pending||calBatch||!!jobPending||(mode==='live'&&(!calSession||!calChosen.size));
 const draftOpen=!el('editor').hidden;
 if(draftOpen){for(const b of el('nav').querySelectorAll('button'))b.disabled=true;for(const b of el('tasks').querySelectorAll('button'))b.disabled=true;for(const b of el('summary').querySelectorAll('button'))b.disabled=true;for(const b of el('filters').querySelectorAll('button'))b.disabled=true;el('newTask').disabled=true;}
 el('retryCore').disabled=busy||!pending;el('refreshCore').disabled=busy||!!pending||draftOpen;el('proposal').disabled=busy||!!pending||proposalUsed||mode!=='demo';
 el('createCore').disabled=busy||creating;el('jobsCreate').disabled=busy||jobCreating;el('jobsConnect').disabled=busy||!!jobPending||!!pending;for(const b of el('jobsArea').querySelectorAll('button,input,select'))b.disabled=busy||!!jobPending||!!pending;const retry=el('retryJob');if(retry)retry.disabled=busy||!jobPending;el('cancelEdit').disabled=busy||!!pending;el('form').inert=!draftOpen;el('lock').disabled=false;el('revokeGoogle').hidden=mode!=='live';el('revokeGoogle').disabled=busy||calBatch||!!pending||!!jobPending;el('adviceConnect').disabled=mode!=='live'||busy||!!pending||calBatch||!!jobPending;el('adviceCreate').disabled=mode!=='live'||busy||!!pending||adviceCreating||calBatch||!!jobPending;el('hMission').disabled=busy||!!pending||calBatch||!!jobPending;
}
function resetDraft(){editing=null;el('form').reset();el('liveTitle').value='';el('editor').hidden=true;el('formFeedback').textContent='';}
function clear(message='데이터 표시 삭제 · 연결 대기'){
 epoch++;resetCalendar();adviceRows=[];adviceConnected=false;adviceCreating=false;el('adviceList').replaceChildren();el('homeAdvice').replaceChildren();el('triAdvice').textContent='실시간 전략 판정 미연결';el('adviceStatus').textContent='아직 연결되지 않음';el('adviceCreate').hidden=true;el('hMissionStatus').textContent='';el('growthWeek').replaceChildren();el('focusRows').replaceChildren();el('focusAdvice').replaceChildren();el('focusStatus').textContent='';el('focusCount').textContent='';clearTimeout(hideTimer);hideTimer=null;hiddenAt=null;document.body.classList.remove('backgrounded');controller?.abort();controller=null;clearTimeout(timer);timer=null;session=null;store=null;files=null;pending=null;creating=false;events=[];openHistory.clear();device=null;mode=null;jobRows=[];jobStore=null;jobFiles=null;jobPending=null;jobCreating=false;calSelected.clear();calData=[];el('calendarDemo').hidden=true;el('calConnect').hidden=true;el('calDisconnect').hidden=true;el('calSources').hidden=true;el('calSources').replaceChildren();el('calConnection').textContent='';el('homeCalRows').replaceChildren();el('homeCalStatus').textContent='Google Calendar · 연결 전';el('calRows').replaceChildren();el('calStatus').textContent='';el('jobsArea').hidden=true;el('jobsConnect').hidden=true;el('jobsCreate').hidden=true;el('jobsList').replaceChildren();el('jobsStatus').textContent='';el('jobsForm').reset();el('dispatchText').value='';el('dispatchPanel').hidden=true;el('pin').textContent='';el('pinPanel').hidden=true;busy=false;proposalUsed=false;filter='OPEN';resetDraft();el('tasks').replaceChildren();el('summary').textContent='';el('dashboard').hidden=true;el('welcome').hidden=false;el('connectionLabel').textContent='연결 전';setPage('home');el('homeTasks').replaceChildren();el('homeJobSummary').textContent='';el('briefText').textContent='';el('growthHistory').replaceChildren();el('homeXp').textContent='';el('growthXp').textContent='';el('growthLevel').textContent='';el('growthToday').textContent='';el('homeProgress').value=0;el('growthProgress').value=0;el('start').hidden=false;el('google').hidden=false;el('lock').hidden=true;el('createCore').hidden=true;el('retryCore').hidden=true;el('status').textContent=message;controls();
}
function active(e){return e===epoch&&(!controller||!controller.signal.aborted);}
function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
function day(offset=0){const d=new Date(Date.now()+9*3600000);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
function visible(t){if(t.conflict)return true;const s=t.state;if(filter==='ALL')return true;if(filter==='OPEN'||filter==='DONE')return s.status===filter;return s.status==='OPEN'&&!!s.due_date&&(filter==='TODAY'?s.due_date===day():filter==='OVERDUE'?s.due_date<day():s.due_date>=day()&&s.due_date<=day(7));}
const statusLabel={OPEN:'미완료',DONE:'완료',ARCHIVED:'보관'},priorityLabel={P0:'긴급',P1:'중요',P2:'일반'};
const timeText=t=>{const d=new Date(t);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'시각 미확인';};
function setPage(name){
 page=name;
 for(const [n,id] of Object.entries({home:'homePage',tasks:'tasksPage',jobs:'jobsPage',calendar:'calendarPage',growth:'growthPage',inbox:'inboxPage'}))el(id).hidden=n!==name;
 for(const b of el('nav').querySelectorAll('[data-page]')){if(b.dataset.page===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
}
function openEditor(isEdit=false){
 el('editor').hidden=false;el('editorTitle').textContent=isEdit?'할 일 수정':'새 할 일';el('saveTask').textContent=isEdit?'변경 저장':'등록하기';el('formFeedback').textContent='';el(mode==='demo'?'title':'liveTitle').focus();el('editor').scrollIntoView({block:'nearest'});controls();
}

const prompts=['오늘 끝낼 일 하나의 완료 기준을 세 가지로 정해 보세요.','오늘의 성과를 다른 사람의 반응과 구분해 기록해 보세요.','오늘 미뤘던 일 하나를 10분짜리 행동으로 바꿔 보세요.','어제의 결정 중 다시 검증할 수 있는 근거를 하나 찾아보세요.','새 일을 시작하기 전 기존의 미완료 과제 하나를 정리해 보세요.','오늘 집중한 시간이 실제 결과물로 이어졌는지 확인해 보세요.','이번 주에 직접 통제할 수 있는 목표를 하나 정해 보세요.'];
function renderJobSummary(){const j=projectJobs(jobRows).jobs;el('homeJobSummary').textContent=mode==='live'&&!jobStore?'업무함 연결 전':('요청 '+j.filter(x=>x.status==='REQUESTED').length+'건 · 결과 확인 대기 '+j.filter(x=>x.status==='RESULT_UNVERIFIED').length+'건');}
function renderHome(tasks){
 const today=day(),open=tasks.filter(t=>t.state?.status==='OPEN'),late=open.filter(t=>t.state.due_date&&t.state.due_date<today),due=open.filter(t=>t.state.due_date===today);
 el('homeDate').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date());
 el('briefText').textContent=pending?'저장 결과를 확인한 후 최신 할 일과 경험치를 표시합니다.':'오늘 마감 '+due.length+'건 · 연체 '+late.length+'건. '+(late.length?'연체된 일부터 정리하세요.':due.length?'오늘 마감 업무를 우선 완료하세요.':'오늘의 핵심 목표를 정해 보세요.');
 const root=el('homeTasks');root.replaceChildren();
 const ordered=[...open].sort((a,b)=>(a.state.due_date||'9999').localeCompare(b.state.due_date||'9999')||a.state.priority.localeCompare(b.state.priority));
 for(const t of ordered.slice(0,5)){const item=document.createElement('div');item.className='home-task';const c=button('완료',()=>add('COMPLETE',t.task_id,t.heads[0]));c.setAttribute('aria-label',t.state.title+' 완료');c.className='complete-action';const text=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('p');title.textContent=t.state.title;meta.className='muted';meta.textContent=priorityLabel[t.state.priority]+' · '+(t.state.due_date||'마감일 없음');text.append(title,meta);item.append(text,c);root.append(item);}
 if(!ordered.length)root.textContent=pending?'저장 결과 확인 필요':tasks.some(t=>t.conflict)?'충돌을 확인해 주세요.':'진행할 일이 없습니다.';
 const prompt=prompts[Math.floor(Date.parse(today+'T00:00:00Z')/86400000)%prompts.length];el('hPrompt').textContent=prompt;el('growthPrompt').textContent=prompt;
 const first=new Map(),created=new Map();for(const e of events){if(e.event_type==='CREATE')created.set(e.task_id,e);if(e.event_type==='COMPLETE'&&(!first.has(e.task_id)||e.client_ts<first.get(e.task_id).client_ts))first.set(e.task_id,e);}
 const credits=tasks.filter(t=>['DONE','ARCHIVED'].includes(t.state?.status)&&first.has(t.task_id)).map(t=>{const e=first.get(t.task_id);return {title:t.state.title,xp:created.get(t.task_id)?.payload.priority==='P2'?10:30,time:e.client_ts};});
 const xp=credits.reduce((n,c)=>n+c.xp,0),todayXp=credits.filter(c=>new Date(Date.parse(c.time)+9*3600000).toISOString().slice(0,10)===today).reduce((n,c)=>n+c.xp,0);
 el('homeXp').textContent=pending?'동기화 확인 필요':'Level '+(1+Math.floor(xp/100))+' · '+xp+' XP';el('homeProgress').value=xp%100;el('growthLevel').textContent=pending?'—':'Level '+(1+Math.floor(xp/100));el('growthXp').textContent=pending?'동기화 확인 필요':xp+' XP';el('growthProgress').value=xp%100;el('growthToday').textContent=pending?'확인되지 않은 기록은 집계하지 않습니다.':'오늘 +'+todayXp+' XP · 다음 레벨까지 '+(100-xp%100)+' XP';el('homeProgress').hidden=el('growthProgress').hidden=!!pending;
 const hist=el('growthHistory');hist.replaceChildren();for(const c of credits.sort((a,b)=>b.time.localeCompare(a.time)).slice(0,20)){const row=document.createElement('div');row.className='home-task';const t=document.createElement('span'),n=document.createElement('strong');t.textContent=c.title;n.textContent='+'+c.xp+' XP';row.append(t,n);hist.append(row);}if(!credits.length)hist.textContent=pending?'동기화 확인 필요':'완료한 업무가 아직 없습니다.';renderJobSummary();renderFocus();renderAdvisory();renderGrowthWeek();
}
el('homeAdd').onclick=()=>{setPage('tasks');resetDraft();openEditor();};
for(const [id,target] of Object.entries({homeTasksLink:'tasks',homeCalendar:'calendar',homeGrowth:'growth',homeJobs:'jobs',homePlaud:'inbox',homeAdviceLink:'inbox'}))el(id).onclick=()=>setPage(target);
function syncTheme(){const night=document.documentElement.classList.contains('night');el('themeToggle').textContent=night?'라이트':'다크';el('themeToggle').setAttribute('aria-pressed',String(night));}document.documentElement.classList.toggle('night',matchMedia('(prefers-color-scheme: dark)').matches);syncTheme();el('themeToggle').onclick=()=>{document.documentElement.classList.toggle('night');syncTheme();};


const adviceCategory={MORNING:'아침 전략',MIDDAY:'중간 점검',EVENING:'저녁 회고',PROJECT_H:'PROJECT H',TASK:'업무 제안',TRI_POD:'투자 전략 조언'};

function renderFocus(){
 const root=el('focusRows');root.replaceChildren();el('focusCount').textContent='';el('focusAdvice').replaceChildren();
 if(pending){el('focusStatus').textContent='원장 동기화 확인 필요 · 우선순위 산정 보류';return;}
 const rows=mustDo(events,day());el('focusCount').textContent=rows.length+' / 3';
 el('focusStatus').textContent='등록된 미완료 업무 기준 · 연체, 오늘 마감, 긴급 순서';
 if(!rows.length){root.textContent='확인된 긴급·오늘 마감 업무 없음. 새로운 의무는 추정하지 않습니다.';return;}
 for(const [n,t] of rows.entries()){
  const item=document.createElement('article'),rank=document.createElement('span'),body=document.createElement('div'),title=document.createElement('strong'),reason=document.createElement('p'),meta=document.createElement('p');item.className='focus-item';rank.className='focus-rank';rank.textContent=String(n+1).padStart(2,'0');title.textContent=t.title;reason.textContent='선정 이유 · '+t.reason;meta.className='muted';meta.textContent='원장 등록 기한 · '+(t.due||'미정')+' / '+priorityLabel[t.priority];body.append(title,reason,meta);
  const action=button('완료',()=>add('COMPLETE',t.id,t.head));action.className='complete-action';action.setAttribute('aria-label',t.title+' 필수 과제 완료');item.append(rank,body,action);root.append(item);
 }
}

function renderGrowthWeek(){
 const root=el('growthWeek');root.replaceChildren();if(pending){root.textContent='동기화 확인 필요';return;}
 const days=growthWeek(events,day()),max=Math.max(30,...days.map(d=>d.xp));
 for(const d of days){const col=document.createElement('div'),bar=document.createElement('progress'),label=document.createElement('small'),num=document.createElement('strong');col.className='week-day';bar.max=max;bar.value=d.xp;bar.setAttribute('aria-label',d.date+' '+d.xp+' XP');label.textContent=d.date.slice(5);num.textContent=d.xp+' XP';col.append(num,bar,label);root.append(col);}
}
el('hMission').onclick=async()=>{
 if(!mode||busy||pending||calBatch||jobPending)return;const e=epoch,today=day();busy=true;controls();
 let id;try{id=await dailyHTaskId(today);}finally{if(active(e)){busy=false;controls();}}
 if(!id||!active(e))return;const t=project(events).tasks.find(t=>t.task_id===id);
 if(t){el('hMissionStatus').textContent='오늘의 실천 과제는 이미 등록되어 있습니다.';return;}
 const ok=await add('CREATE',id,null,{title:'PROJECT H 오늘의 실천 과제',priority:'P1',due_date:today});
 if(active(e))el('hMissionStatus').textContent=ok?'실천 과제 등록 · 완료 시 경험치 반영':'등록 결과 확인 필요';
};
function renderAdvisory(){
 const list=el('adviceList'),home=el('homeAdvice');list.replaceChildren();home.replaceChildren();el('focusAdvice').replaceChildren();el('triAdvice').textContent='실시간 전략 판정 미연결';
 if(!adviceConnected){if(mode==='demo')el('adviceStatus').textContent='가상 모드 · 실제 AI 자문 없음';return;}
 const rows=projectAdvice(adviceRows),current=rows.filter(r=>r.status==='CURRENT');
 for(const r of rows.slice(0,30)){
  const card=document.createElement('article'),title=document.createElement('strong'),meta=document.createElement('p'),body=document.createElement('p');card.className='advice-card';title.textContent=r.title;meta.className='muted';meta.textContent=adviceCategory[r.category]+' · '+r.agent+' (기록상 발행자) · '+timeText(r.issued)+' · '+({CURRENT:'유효 기간 내',EXPIRED:'기간 만료',FUTURE:'발행 시각 확인 필요'}[r.status]);body.textContent='근거 기록: '+r.evidence;card.append(title,meta,body);
  if(r.action){const p=document.createElement('p');p.textContent='실천 제안: '+r.action;card.append(p);}
  if(r.action&&r.status==='CURRENT'&&r.category!=='TRI_POD')card.append(button('검토 후 할 일로 등록',async()=>{
   if(busy||pending||calBatch||jobPending||!confirm('이 제안의 실천 항목을 내 할 일로 등록할까요?'))return;
   const e=epoch;busy=true;controls();let id;try{id=await adviceTaskId(r.id);}finally{if(active(e)){busy=false;controls();}}
   if(!id||!active(e)||Date.parse(r.expires)<=Date.now())return;
   if(project(events).tasks.some(t=>t.task_id===id)){el('adviceStatus').textContent='이미 등록된 제안입니다.';return;}
   const ok=await add('CREATE',id,null,{title:r.action,priority:'P1',due_date:null});if(active(e))el('adviceStatus').textContent=ok?'선택한 제안 등록 완료':'등록 결과 확인 필요';
  }));
  list.append(card);
 }
 if(!rows.length)list.textContent='수신된 조언 없음';
 const candidates=current.filter(r=>r.category==='TASK').slice(0,3);if(candidates.length){const box=el('focusAdvice'),h=document.createElement('h3');h.textContent='AI 추천 · 확인 필요';box.append(h);for(const r of candidates){const p=document.createElement('p');p.textContent=r.title+' · '+r.agent+' (기록상 발행자)';box.append(p);}box.append(button('제안 검토',()=>setPage('inbox')));}
 const brief=current.find(r=>['MORNING','MIDDAY','EVENING'].includes(r.category));if(brief){const p=document.createElement('p');p.textContent=brief.agent+' · '+brief.title+' (기록상 발행 · 별도 확인 필요)';home.append(p);}
 const h=current.find(r=>r.category==='PROJECT_H');if(h){el('hPrompt').textContent=h.title;el('growthPrompt').textContent=h.title+(h.action?' · '+h.action:'');}
 const tri=current.find(r=>r.category==='TRI_POD');if(tri)el('triAdvice').textContent=tri.title+' · '+timeText(tri.issued)+' · 기록상 '+tri.agent+' 조언 (신호 원천 미검증)';
}
async function connectAdvice(create=false){
 if(mode!=='live'||!session||busy||pending||jobPending||calBatch)return;const e=epoch;busy=true;adviceRows=[];adviceConnected=false;renderHome(project(events).tasks);controls();
 try{
  const af=googleCoreFiles({token:session.token,signal:controller.signal,kind:'LIFEOS_ADVICE_V1',header:ADVICE_HEADER,title:'JJOONI LIFE OS — ADVISORY',rowCount:1002});let id=await af.discover();
  if(!id&&create){adviceCreating=true;id=await af.create();}
  if(!active(e)||document.hidden)return;
  if(!id){el('adviceCreate').hidden=false;el('adviceStatus').textContent='비공개 자문함을 최초 1회 생성하세요.';return;}
  const rows=await advisoryStore({fileId:id,token:session.token,signal:controller.signal}).read();if(!active(e)||document.hidden)return;
  adviceRows=rows;adviceConnected=true;el('adviceCreate').hidden=true;el('adviceStatus').textContent='비공개 자문함 조회 완료 · '+rows.length+'개 기록 · 발행자 및 내용 별도 확인 필요';
 }catch{if(active(e)){adviceRows=[];adviceConnected=false;el('adviceStatus').textContent='자문함 확인 실패 · 생성 여부 및 접근 권한 확인 필요';}}
 finally{if(active(e)){busy=false;renderHome(project(events).tasks);controls();}}
}
el('adviceConnect').onclick=()=>connectAdvice();
el('adviceCreate').onclick=()=>{if(!adviceCreating&&confirm('Google Drive에 별도 비공개 자문함을 만들까요?'))connectAdvice(true);};

function render(){
 const {tasks,duplicateRows}=project(events),today=day(),opened=tasks.filter(t=>t.state?.status==='OPEN'),done=tasks.filter(t=>t.state?.status==='DONE'),archived=tasks.filter(t=>t.state?.status==='ARCHIVED'),conflicts=tasks.filter(t=>t.conflict);
 el('todayLabel').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date());
 renderHome(tasks);el('summary').replaceChildren();
 for(const [label,count,target] of [['오늘',opened.filter(t=>t.state.due_date===today).length,'TODAY'],['연체',opened.filter(t=>t.state.due_date&&t.state.due_date<today).length,'OVERDUE'],['미완료',opened.length,'OPEN'],['완료',done.length,'DONE']]){
  const metric=button('',()=>{filter=target;render();});metric.setAttribute('aria-label',label+' '+(pending?'확인 필요':count+'건'));metric.className='metric'+(target==='OVERDUE'&&count?' overdue':'');const n=document.createElement('strong'),l=document.createElement('span');n.textContent=pending?'—':String(count);l.textContent=label;metric.append(l,n);el('summary').append(metric);
 }
 if(conflicts.length||duplicateRows){const note=document.createElement('p');note.className='warning';note.textContent='확인 필요: 충돌 '+conflicts.length+'건 · 중복 기록 '+duplicateRows+'건';el('summary').append(note);}
 for(const b of el('filters').querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b.dataset.filter===filter));
 el('tasks').replaceChildren();
 const creation=new Map(),latest=new Map(),completed=new Map(),byTask=new Map();
 for(const e of events){if(!byTask.has(e.task_id))byTask.set(e.task_id,[]);byTask.get(e.task_id).push(e);if(e.event_type==='CREATE')creation.set(e.task_id,e);const old=latest.get(e.task_id);if(!old||e.client_ts>old.client_ts)latest.set(e.task_id,e);if(e.event_type==='COMPLETE'){const prev=completed.get(e.task_id);if(!prev||e.client_ts>prev.client_ts)completed.set(e.task_id,e);}}
 const list=tasks.filter(visible).sort((a,b)=>Number(b.conflict)-Number(a.conflict)||(filter==='DONE'||filter==='ALL'?(latest.get(b.task_id)?.client_ts||'').localeCompare(latest.get(a.task_id)?.client_ts||''):0)||(a.state?.due_date||'9999').localeCompare(b.state?.due_date||'9999')||(a.state?.priority||'').localeCompare(b.state?.priority||'')||(creation.get(b.task_id)?.client_ts||'').localeCompare(creation.get(a.task_id)?.client_ts||''));
 const heading=document.createElement('div');heading.className='list-heading';heading.textContent=({OPEN:'진행할 일',TODAY:'오늘 마감',OVERDUE:'연체된 일',WEEK:'7일 내 마감',DONE:'완료한 일',ALL:'등록·완료·보관 이력'}[filter])+' · '+(pending?'확인 필요':list.length+'건');el('tasks').append(heading);
 if(!list.length){const empty=document.createElement('div');empty.className='empty';const title=document.createElement('strong');title.textContent=pending?'저장 결과 확인 필요':filter==='OPEN'?'아직 진행할 일이 없어요.':'해당하는 내역이 없어요.';const p=document.createElement('p');p.textContent=pending?'동일 기록 재확인을 이용하세요.':filter==='OPEN'?'새 할 일을 등록하면 여기에 표시됩니다.':'다른 필터에서 내역을 확인할 수 있습니다.';empty.append(title,p);el('tasks').append(empty);}
 for(const t of list){
  const row=document.createElement('article');row.className='task'+(t.conflict?' conflict':'');
  if(t.conflict){row.append(document.createTextNode('동시 수정 감지 · 변경 내역을 선택하세요.'));for(const v of t.variants)row.append(button(v.title+' · '+statusLabel[v.status]+' · '+priorityLabel[v.priority]+' · '+(v.due_date||'기한 없음'),()=>{if(confirm('이 변경을 선택할까요? 다른 변경 이력은 보존됩니다.'))add('RESOLVE',t.task_id,null,{heads:t.heads,chosen:v.event_id});}));}
  else{
   const s=t.state,h=t.heads[0],body=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('div'),actions=document.createElement('div'),history=document.createElement('p');body.className='task-body';title.className='task-title';title.textContent=s.title;meta.className='task-meta';
   const badge=document.createElement('span');badge.className='pill '+(s.status==='DONE'?'done':s.status==='ARCHIVED'?'archived':s.priority==='P0'?'urgent':s.priority==='P1'?'important':'normal');badge.textContent=s.status==='OPEN'?priorityLabel[s.priority]:statusLabel[s.status];meta.append(badge);
   const due=document.createElement('span');due.className=s.status==='OPEN'&&s.due_date&&s.due_date<today?'late':'muted';due.textContent=!s.due_date?'마감일 없음':s.due_date===today?'오늘 마감':s.due_date===day(1)?'내일 마감':(s.status==='OPEN'&&s.due_date<today?'연체 · ':'마감 · ')+s.due_date;meta.append(due);
   history.className='task-history';history.textContent='등록 '+timeText(creation.get(t.task_id)?.client_ts)+(s.status==='DONE'&&completed.has(t.task_id)?' · 완료 기록 '+timeText(completed.get(t.task_id).client_ts):'')+(latest.has(t.task_id)&&latest.get(t.task_id).event_type!=='CREATE'?' · 변경 '+timeText(latest.get(t.task_id).client_ts):'')+' (기기 기록)';
   actions.className='task-actions';const command=s.status==='OPEN'?'COMPLETE':s.status==='DONE'?'REOPEN':'RESTORE';
   const action=button({COMPLETE:'완료',REOPEN:'다시 열기',RESTORE:'복원'}[command],()=>add(command,t.task_id,h));action.className=s.status==='OPEN'?'complete-action':'quiet';actions.append(action);
   if(s.status==='DONE')actions.append(button('보관',()=>add('ARCHIVE',t.task_id,h)));
   if(s.status!=='ARCHIVED'){const edit=button('수정',()=>{editing={id:t.task_id,head:h};el(mode==='demo'?'title':'liveTitle').value=s.title;el('priority').value=s.priority;el('due').value=s.due_date||'';openEditor(true);controls();});edit.className='quiet';actions.append(edit);}
   body.append(title,meta,history);
   const historyRows=[...new Map((byTask.get(t.task_id)||[]).map(e=>[e.event_id,e])).values()].sort((a,b)=>b.client_ts.localeCompare(a.client_ts));
   const details=document.createElement('details'),summary=document.createElement('summary');details.className='history-details';details.open=openHistory.has(t.task_id);summary.textContent='변경 이력 '+historyRows.length+'건';details.append(summary);
   const fillHistory=()=>{if(!details.open||details.childElementCount>1)return;const ul=document.createElement('ol');const labels={CREATE:'등록',EDIT:'수정',COMPLETE:'완료',REOPEN:'다시 열기',ARCHIVE:'보관',RESTORE:'복원',RESOLVE:'충돌 해결'};for(const e of historyRows.slice(0,30)){const li=document.createElement('li');const payload=e.payload;li.textContent=timeText(e.client_ts)+' · '+labels[e.event_type]+(['CREATE','EDIT'].includes(e.event_type)?' · '+payload.title+' · '+priorityLabel[payload.priority]+' · '+(payload.due_date||'마감일 없음'):'');ul.append(li);}details.append(ul);if(historyRows.length>30){const p=document.createElement('p');p.textContent='최근 30건 표시 · 이전 기록은 보존됩니다.';details.append(p);}};details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open)openHistory.add(t.task_id);else openHistory.delete(t.task_id);fillHistory();});fillHistory();
   body.append(details);row.append(body,actions);
  }
  el('tasks').append(row);
 }
 el('retryCore').hidden=!pending;controls();
}
function show(modeName){mode=modeName;device=newId('dev');el('start').hidden=true;el('google').hidden=true;el('lock').hidden=false;el('dashboard').hidden=false;el('welcome').hidden=true;el('connectionLabel').textContent=mode==='live'?'Google 연결됨':'가상 모드';setPage('home');el('title').hidden=mode!=='demo';el('liveTitle').hidden=mode==='demo';el('refreshCore').hidden=mode==='demo';el('jobsConnect').hidden=mode==='demo';el('jobsArea').hidden=mode!=='demo';el('calendarDemo').hidden=mode!=='demo';el('calConnect').hidden=mode!=='live';el('demoSourceLabel').hidden=mode!=='demo';if(mode==='demo')loadCalDemo();el('demoJob').hidden=mode!=='demo';el('jobTitle').hidden=mode==='demo';render();renderJobs();}
async function commit(event){
 if(!store||busy)return false;const e=epoch;busy=true;controls();
 try{const result=await store.append(event);if(!active(e))return false;events=result.events;pending=null;const current=project(events).tasks.find(t=>t.task_id===event.task_id);el('status').textContent=current?.conflict?'기록 충돌 · 확인 필요':'저장 완료 · Google 동기화 확인';return true;}
 catch(err){if(!active(e))return false;if(err.message==='STALE_BASE'&&Array.isArray(err.events)){events=err.events;pending=null;setPage('tasks');el('status').textContent='다른 변경 또는 충돌이 먼저 반영되었습니다. 최신 기록 확인 필요';if(!el('editor').hidden)el('formFeedback').textContent='입력 내용은 유지됩니다. 취소 후 최신 기록을 다시 열어 주세요.';if(calBatch)el('status').textContent='일정 일괄 등록 중 최신 변경 감지 · 추가 등록 중단';return false;}if(/OWNER_|GOOGLE_401|GOOGLE_403|SESSION_ENDED|CORE_SCHEMA|CORE_ROW_INVALID|EVENT_ID_COLLISION/.test(err.message)){clear('연결 또는 데이터 검증 실패 · 재인증 필요');return false;}pending=event;events=[];setPage('tasks');el('status').textContent='저장 결과 미확정 · 같은 변경만 재확인할 수 있습니다.';return false;}
 finally{if(active(e)){busy=false;render();}}
}
async function add(event_type,task_id,base_event_id,payload={}){
 if(!mode||busy||pending||jobPending||calBatch)return false;try{const e=makeEvent({event_type,task_id,base_event_id,payload,device_id:device});if(mode==='demo'){const next=[...events,e];project(next);events=next;render();return true;}return await commit(e);}catch{el('status').textContent='허용되지 않는 변경입니다.';return false;}
}
async function loadCore(id){
 const e=epoch;store=sheetsCore({fileId:id,token:session.token,signal:controller.signal});const r=await store.read();if(!active(e)||document.hidden)throw Error('SESSION_ENDED');events=r.events;el('createCore').hidden=true;show('live');el('status').textContent='Google 연결됨 · 내 할 일 동기화 완료';
}

function renderJobs(){
 if(mode)renderJobSummary();
 const root=el('jobsList');root.replaceChildren();const view=projectJobs(jobRows);
 for(const j of view.jobs){
  const row=document.createElement('div');row.className='task';const title=document.createElement('strong'),meta=document.createElement('p');title.textContent=j.title;meta.textContent=j.agent+' · '+({REQUESTED:'요청 등록 · 인수 미확인',RESULT_UNVERIFIED:'결과 수신 · 미검증',VERIFIED:'사용자 확인 완료',CANCELLED:'취소',CONFLICT:'동시 변경 충돌'}[j.status])+' · '+(j.due_date||'기한 없음');row.append(title,meta);
  for(const receipt of j.receipts){const p=document.createElement('p');p.textContent='결과(사용자 입력): '+receipt;row.append(p);}
  if(j.status==='REQUESTED'){
   row.append(button('요청 내용 보기',()=>{el('dispatchText').value=dispatchText(j);el('dispatchPanel').hidden=false;el('dispatchText').focus();el('dispatchText').select();}));
   const input=document.createElement('input');input.maxLength=140;input.autocomplete='off';input.placeholder='받은 결과의 비민감 요약';input.setAttribute('aria-label','결과 요약');row.append(input,button('결과 수신 기록',()=>{if(!safeTitle(input.value)||!confirm('실제로 받은 결과입니까? 아직 미검증으로 기록합니다.'))return;changeJob(jobRow({job_id:j.job_id,kind:'RECEIPT',base_id:j.head,agent:j.agent,text:input.value}));}));
  }
  if(j.status==='RESULT_UNVERIFIED')row.append(button('결과 확인 완료',()=>{if(confirm('실제 결과를 확인하고 승인할까요?'))changeJob(jobRow({job_id:j.job_id,kind:'VERIFY',base_id:j.head,agent:j.agent}));}));
  if(['REQUESTED','RESULT_UNVERIFIED'].includes(j.status))row.append(button('업무 취소',()=>{if(confirm('이 업무를 취소할까요?'))changeJob(jobRow({job_id:j.job_id,kind:'CANCEL',base_id:j.head,agent:j.agent}));}));
  root.append(row);
 }
 if(jobPending){const retry=button('동일 기록 재확인',()=>changeJob(jobPending,true));retry.id='retryJob';root.append(retry);}
 controls();
}
async function changeJob(row,retry=false){
 if(!mode||busy||pending||(!retry&&jobPending))return false;
 try{
  if(mode==='demo'){if(row[3]==='REQUEST'&&!['가상 일정 누락 점검','가상 정보 교차검증'].includes(row[6]))return false;if(row[3]==='RECEIPT'&&row[6]!=='가상 결과 확인'){el('jobsStatus').textContent='가상 모드에서는 가상 결과 확인만 입력하세요.';return false;}const n=[...jobRows,row];projectJobs(n);jobRows=n;renderJobs();return true;}
  if(!jobStore)return false;const e=epoch;busy=true;controls();
  try{const r=await jobStore.append(row);if(!active(e))return false;jobRows=r.rows;jobPending=null;el('jobsStatus').textContent='업무 기록 및 재조회 완료';return true;}
  catch(err){if(!active(e))return false;if(/OWNER_ONLY|JOB_SCHEMA|JOB_ROW_INVALID|JOB_ID_COLLISION|SESSION_ENDED/.test(err.message)){clear('업무함 권한 또는 원장 검증 실패 · 재연결 필요');return false;}jobPending=row;jobRows=[];el('jobsStatus').textContent='저장 결과 미확정 · 동일 기록만 다시 확인하세요.';return false;}
  finally{if(active(e)){busy=false;renderJobs();}}
 }catch{el('jobsStatus').textContent='유효하지 않은 업무 변경';return false;}
}
async function connectJobs(create=false){
 if(mode!=='live'||!session||busy||jobPending||pending)return;const e=epoch;busy=true;controls();
 try{jobFiles=googleCoreFiles({token:session.token,signal:controller.signal,kind:'LIFEOS_AI_JOBS_V1',header:JOB_HEADER,title:'JJOONI LIFE OS — AI JOBS',rowCount:2002});let id=await jobFiles.discover();if(!id&&create){jobCreating=true;id=await jobFiles.create();}if(!active(e))return;if(!id){el('jobsCreate').hidden=false;el('jobsStatus').textContent='별도 AI 업무함을 생성하세요.';return;}jobStore=jobsStore({fileId:id,token:session.token,signal:controller.signal});const r=await jobStore.read();if(!active(e))return;jobRows=r.rows;el('jobsCreate').hidden=true;el('jobsArea').hidden=false;el('jobsStatus').textContent='AI 업무함 연결 · 자동 인수 미연동';}
 catch{if(active(e)){jobRows=[];jobStore=null;el('jobsArea').hidden=true;el('jobsStatus').textContent='업무함 연결 실패 · 생성 여부를 Drive에서 확인하세요.';}}
 finally{if(active(e)){busy=false;renderJobs();}}
}
el('jobsConnect').onclick=()=>connectJobs();
el('jobsCreate').onclick=()=>{if(!jobCreating&&confirm('Google Drive에 별도 AI 업무함을 생성할까요?'))connectJobs(true);};
el('jobsForm').onsubmit=async e=>{e.preventDefault();if(!mode||busy||jobPending)return;const title=el(mode==='demo'?'demoJob':'jobTitle').value;if(!safeTitle(title))return;try{if(await changeJob(jobRow({kind:'REQUEST',agent:el('jobAgent').value,text:title,due_date:el('jobDue').value})))el('jobsForm').reset();}catch{el('jobsStatus').textContent='업무 제목 또는 기한 확인';}};



function resetCalendar(){
 calGeneration++;calAbort?.abort();calAbort=null;clearTimeout(calTimer);calTimer=null;calSession=null;calApi=null;calLists=[];calChosen.clear();calSelected.clear();calData=[];calLoaded=false;calBatch=false;
}
function updateCalendarHome(){
 const root=el('homeCalRows');root.replaceChildren();
 el('homeCalStatus').textContent=mode==='demo'?'가상 일정 · '+(calLoaded?'조회 완료':'조회 전'):!calSession?'Google Calendar · 연결 전':calLoaded?'Google Calendar · 선택한 일정 조회 완료':'Google Calendar · 일정 불러오기 필요';
 if(!calLoaded)return;
 const rows=calData.filter(r=>!r.cancelled&&r.due_date===day());
 for(const r of rows){const p=document.createElement('p');p.textContent=(r.time||'')+' '+r.title+' · '+r.calendar;root.append(p);}
 if(!rows.length)root.textContent='선택한 캘린더의 오늘 일정 없음';
}
function resetCalSelection(){calLoaded=false;calData=[];calSelected.clear();renderCal();el('calStatus').textContent='불러오기를 눌러 주세요.';}
function loadCalDemo(){
 const days=Number(el('calDays').value),source=el('calSource').value;kstWindow(days);
 calData=[{task_id:'task_'+('1'.repeat(32)),title:'가상 일정 확인',due_date:day(1),cancelled:false},{task_id:'task_'+('2'.repeat(32)),title:'가상 준비물 점검',due_date:day(4),cancelled:false},{task_id:'task_'+('3'.repeat(32)),title:'가상 할 일 검토',due_date:day(10),cancelled:false},{task_id:'task_'+('4'.repeat(32)),title:'가상 일정 확인',due_date:day(18),cancelled:false}].map((r,i)=>({...r,calendar:i===1?'가족 일정':'기본 캘린더',source:i===1?'family':'primary'})).filter(r=>r.due_date<day(days)&&(source==='all'||r.source===source));
 calSelected.clear();calLoaded=true;renderCal();
}
function renderSources(){
 const root=el('calSources');root.replaceChildren();root.hidden=false;
 for(const c of calLists){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=calChosen.has(c.id);input.onchange=()=>{input.checked?calChosen.add(c.id):calChosen.delete(c.id);resetCalSelection();};label.className='calRow';label.append(input,document.createTextNode(c.summary+(c.primary?' · 기본':'')));root.append(label);}
}
function closeCalendar(message='일정 연결 종료'){
 resetCalendar();el('calSources').replaceChildren();el('calSources').hidden=true;el('calDisconnect').hidden=true;el('calendarDemo').hidden=mode!=='demo';el('calConnect').hidden=mode!=='live';el('calConnection').textContent=message;renderCal();controls();
}
el('calConnect').onclick=async()=>{
 if(mode!=='live'||!session||busy||pending||jobPending||calBatch)return;
 const e=epoch;resetCalendar();const g=calGeneration;calAbort=new AbortController();busy=true;controls();el('calConnection').textContent='읽기 전용 권한 요청 중';
 try{
  const response=await requestGoogleToken({config:googleConfig,signal:calAbort.signal,calendar:true});
  const auth=await verifyGoogleToken({response,config:googleConfig,signal:calAbort.signal,calendar:true});
  if(!active(e)||g!==calGeneration||document.hidden)throw Error('SESSION_ENDED');
  calSession=auth;calApi=calendarAdapter({token:auth.token,signal:calAbort.signal});
  const list=await calApi.calendars();if(!active(e)||g!==calGeneration||document.hidden)throw Error('SESSION_ENDED');
  calLists=list;const primary=list.find(c=>c.primary);if(primary)calChosen.add(primary.id);renderSources();
  el('calConnect').hidden=true;el('calDisconnect').hidden=false;el('calendarDemo').hidden=false;
  el('calConnection').textContent='읽기 전용 연결 완료 · 캘린더 선택 후 불러오세요.';
  calTimer=setTimeout(()=>{if(active(e)&&g===calGeneration)closeCalendar('일정 권한 만료 · 다시 연결하세요.');},Math.max(0,Math.min(session.expiresAt,auth.expiresAt)-Date.now()));
 }catch{if(active(e)&&g===calGeneration)closeCalendar('캘린더 연결 실패 · Google Calendar API 활성화 및 읽기 권한 확인 필요');}
 finally{if(active(e)){busy=false;controls();updateCalendarHome();}}
};
el('calDisconnect').onclick=()=>closeCalendar();
async function loadCalLive(){
 if(mode!=='live'||!calApi||!calSession||busy||pending||jobPending||calBatch||!calChosen.size)return;
 const e=epoch,g=calGeneration;busy=true;calData=[];calLoaded=false;calSelected.clear();renderCal();controls();el('calStatus').textContent='일정 조회 중';
 try{
  if(Date.now()>=calSession.expiresAt)throw Error('EXPIRED');
  const result=[];const now=Date.now(),days=Number(el('calDays').value);
  for(const id of calChosen){const c=calLists.find(x=>x.id===id);if(!c)throw Error('SOURCE_UNKNOWN');const rows=await calApi.events(id,days,now);if(!active(e)||g!==calGeneration)return;if(document.hidden)throw Error('SESSION_HIDDEN');result.push(...rows.map(r=>({...r,calendar:c.summary})));if(result.length>500)throw Error('CALENDAR_LIMIT');}
  const grouped=groupCalendarRows(result);planImport(grouped.rows,events,[]);calData=grouped.rows.sort((x,y)=>(x.due_date||'9999').localeCompare(y.due_date||'9999')||(x.time||'').localeCompare(y.time||''));calLoaded=true;renderCal();if(grouped.ambiguous)el('calStatus').textContent+=' · 출처 간 불일치 '+grouped.ambiguous+'건 제외';
 }catch{if(active(e)&&g===calGeneration){calData=[];calLoaded=false;renderCal();el('calStatus').textContent='일정 조회 실패 · 권한 또는 조회 범위를 확인하세요.';}}
 finally{if(active(e)){busy=false;controls();}}
}
function renderCal(){
 const root=el('calRows');root.replaceChildren();
 if(!mode||pending){el('calStatus').textContent=pending?'저장 재확인 필요':'';updateCalendarHome();return;}
 const current=new Map(project(events).tasks.map(t=>[t.task_id,t]));
 const plan=planImport(calData,events,[]),changed=new Set(plan.changed),cancelled=new Set(plan.cancelled);
 for(const r of calData){
  if(r.cancelled&&!cancelled.has(r.task_id))continue;
  const existing=current.has(r.task_id),label=document.createElement('label'),check=document.createElement('input'),info=document.createElement('span');check.type='checkbox';check.checked=!existing&&!r.cancelled&&calSelected.has(r.task_id);
  if(existing||r.cancelled){check.dataset.blocked='true';check.disabled=true;calSelected.delete(r.task_id);}
  check.onchange=()=>{if(check.checked){if(calSelected.size>=100){check.checked=false;el('calStatus').textContent='한 번에 최대 100건 선택';return;}calSelected.add(r.task_id);}else calSelected.delete(r.task_id);el('calStatus').textContent=calSelected.size+'건 선택';controls();};
  label.className='calRow';const title=r.cancelled?(current.get(r.task_id)?.state?.title||'기존 일정'):r.title;
  info.textContent=(r.due_date||'')+' '+(r.time||'')+' · '+title+' · '+r.calendar+(r.cancelled?' · 원본 취소 (직접 확인)':changed.has(r.task_id)?' · 원본 변경 후보 (직접 확인)':existing?' · 등록됨':'');
  label.append(check,info);root.append(label);
 }
 el('calStatus').textContent=calSelected.size+'건 선택'+(changed.size?' · 변경 후보 '+changed.size+'건':'')+(cancelled.size?' · 취소 '+cancelled.size+'건':'');updateCalendarHome();controls();
}
el('calDays').onchange=el('calSource').onchange=resetCalSelection;
el('calLoad').onclick=()=>mode==='demo'?loadCalDemo():loadCalLive();
el('calAll').onclick=()=>{if(!mode||busy||calBatch||pending)return;const current=new Set(project(events).tasks.map(t=>t.task_id));calSelected=new Set(calData.filter(r=>!r.cancelled&&!current.has(r.task_id)).slice(0,100).map(r=>r.task_id));renderCal();};
el('calNone').onclick=()=>{calSelected.clear();renderCal();};
el('calImport').onclick=async()=>{
 if(!mode||!calSelected.size||busy||pending||jobPending||calBatch||!confirm('선택한 일정 제목과 날짜를 내 할 일에 등록할까요? 원본 일정은 변경하지 않습니다.'))return;
 const e=epoch,g=calGeneration;let count=0;calBatch=true;controls();
 try{
  const p=planImport(calData,events,[...calSelected]);const batch=p.add.map(r=>makeEvent({task_id:r.task_id,event_type:'CREATE',device_id:device,payload:{title:r.title,priority:'P1',due_date:r.due_date}}));
  if(mode==='demo'){const next=[...events,...batch];project(next);events=next;count=batch.length;render();}
  else for(const event of batch){if(!active(e)||g!==calGeneration||document.hidden||pending||!calSession)break;const ok=await commit(event);if(!ok)break;const current=project(events).tasks.find(t=>t.task_id===event.task_id);if(current?.conflict)break;count++;}
  if(active(e)&&g===calGeneration){calSelected.clear();renderCal();el('calStatus').textContent=count+'건 등록'+(count!==batch.length?' · 일부 미등록, 최신 기록 확인 후 다시 선택':' · 기존 일정 중복 제외');}
 }catch{if(active(e))el('calStatus').textContent='등록할 수 없는 일정이 있습니다. 선택을 확인해 주세요.';}
 finally{if(active(e)){calBatch=false;controls();}}
};

el('start').onclick=()=>{clear();show('demo');el('status').textContent='가상 데이터 전용 · 저장/Google 연동 없음';};
el('lock').onclick=()=>clear();
el('revokeGoogle').onclick=()=>{if(mode!=='live'||!session||busy||pending||jobPending||calBatch||!confirm('Google 앱 접근 권한을 철회하고 연결을 종료할까요? 다시 연결할 때 동의가 필요합니다.'))return;const token=session.token;const oauth=globalThis.google?.accounts?.oauth2;clear('연결 종료 · Google 권한 철회 요청');try{if(!oauth?.revoke)throw Error('REVOKE_UNAVAILABLE');oauth.revoke(token,r=>{if(!mode)el('status').textContent=r?.successful===true?'Google 권한 철회 확인':'권한 철회 미확인 · Google 계정의 앱 액세스에서 확인하세요.';});}catch{el('status').textContent='권한 철회 미확인 · Google 계정에서 확인하세요.';}};
el('newTask').onclick=()=>{resetDraft();openEditor();};
for(const b of el('nav').querySelectorAll('[data-page]'))b.onclick=()=>setPage(b.dataset.page);
for(const b of el('editor').querySelectorAll('[data-due]'))b.onclick=()=>{el('due').value=b.dataset.due==='none'?'':day(Number(b.dataset.due));};
el('form').onsubmit=async e=>{e.preventDefault();if(!mode||busy||pending||jobPending)return;const p={title:el(mode==='demo'?'title':'liveTitle').value,priority:el('priority').value,due_date:el('due').value||null};if(!safeTitle(p.title)||(mode==='demo'&&!demoTitles.includes(p.title))){el('formFeedback').textContent='개인 식별정보나 회사 기밀 없이 짧은 제목을 입력해 주세요.';return;}const wasEdit=!!editing;const id=editing?.id||newId('task');if(editing){const current=project(events).tasks.find(t=>t.task_id===id);if(!current||current.conflict||current.heads[0]!==editing.head){el('formFeedback').textContent='다른 변경이 먼저 반영되었습니다. 입력 내용을 확인 후 다시 열어 주세요.';return;}}const ok=await (editing?add('EDIT',id,editing.head,p):add('CREATE',id,null,p));if(ok){const current=project(events).tasks.find(t=>t.task_id===id);if(!current||current.conflict){el('formFeedback').textContent='동시 변경 충돌 · 입력 내용을 확인 후 취소하고 충돌을 해결하세요.';el('status').textContent='기록 충돌 · 확인 필요';return;}resetDraft();if(!wasEdit)filter='OPEN';render();el('status').textContent=wasEdit?'변경 저장 완료':'할 일 등록 완료';el('newTask').focus();controls();}};
el('cancelEdit').onclick=()=>{resetDraft();controls();el('newTask').focus();};
el('proposal').onclick=async()=>{if(mode!=='demo'||proposalUsed||!confirm('가상 AI 제안을 할 일로 등록할까요?'))return;proposalUsed=await add('CREATE',newId('task'),null,{title:'가상 AI 제안 확인',priority:'P1',due_date:null});controls();};
el('retryCore').onclick=async()=>{if(pending&&!busy){const id=pending.task_id;if(await commit(pending)){if(project(events).tasks.find(t=>t.task_id===id)?.conflict){el('status').textContent='기록 충돌 · 확인 필요';el('formFeedback').textContent='입력 내용을 확인 후 취소하고 충돌을 해결하세요.';}else resetDraft();render();}}};
el('refreshCore').onclick=async()=>{if(!store||busy||pending||!el('editor').hidden)return;const e=epoch;busy=true;controls();try{const r=await store.read();if(active(e)){events=r.events;el('status').textContent='최신 할 일 동기화 완료';}}catch{if(active(e))clear('조회 실패 · 재인증 필요');}finally{if(active(e)){busy=false;render();}}};
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
  if(mode==='live'&&!pending&&!busy&&!jobPending&&!calBatch&&el('editor').hidden)el('refreshCore').click();
 }
});window.addEventListener('pagehide',()=>clear());
el('enroll').onclick=async()=>{
 if(!enrolling||!gisReady||busy)return;clear();const e=epoch;controller=new AbortController();busy=true;el('lock').hidden=false;controls();
 try{const response=await requestGoogleToken({config:googleConfig,signal:controller.signal,enrollment:true});const pin=await enrollmentPin({response,signal:controller.signal});if(!active(e)||document.hidden)return;el('pin').textContent=pin;el('pinPanel').hidden=false;el('status').textContent='설정용 계정 식별값 · Google에서 선택한 계정이 본인인지 확인하세요. 데이터 접근 권한은 요청하지 않았습니다.';}
 catch{if(active(e))clear('설정용 계정 확인 실패');}finally{if(active(e)){busy=false;controls();}}
};
if(enabled||enrolling){const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=()=>{gisReady=!!globalThis.google?.accounts?.oauth2;controls();};s.onerror=()=>{el('status').textContent='Google 인증 모듈을 불러오지 못했습니다.';};document.head.append(s);}
if(!enabled&&!enrolling)el('status').textContent='Google 연결은 배포 설정 후 활성화됩니다.';controls();if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
