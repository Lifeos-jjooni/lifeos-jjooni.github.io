// Pure event reducer. No network, no server, no model API.
export const SCHEMA='LIFEOS_CORE_EVENT_V1';
export const HEADER=['schema_version','event_id','task_id','event_type','device_id','client_ts','base_event_id','payload','idempotency_key'];
const id=(v,p)=>typeof v==='string'&&new RegExp('^'+p+'_[a-f0-9]{32}$').test(v);
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,k)=>plain(x)&&Object.keys(x).length===k.length&&k.every(y=>Object.hasOwn(x,y));
export const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':plain(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const fail=msg=>{throw Error(msg)};
const labels=['P0','P1','P2'], statuses=['OPEN','DONE','ARCHIVED'];
function due(v){return v===null||(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);}
export function safeTitle(v){
 if(typeof v!=='string'||v!==v.trim()||!v||v.length>140||/[\p{Cc}\p{Cf}]/u.test(v))return false;
 const n=v.normalize('NFKC'), c=n.replace(/\s/g,'');
 return !/(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\d[ .\-/·_]?){6,})/i.test(n)&&!/(?:거래처|거래선|협력사|클라이언트|고객|계약서|사내|기밀|회의록|내부보고|업무보고|은행계좌|주민등록|사번|통장비번)/.test(c);
}
function fields(p){return exact(p,['title','priority','due_date'])&&safeTitle(p.title)&&labels.includes(p.priority)&&due(p.due_date);}
function snapshot(p){return exact(p,['title','priority','due_date','status'])&&fields({title:p.title,priority:p.priority,due_date:p.due_date})&&statuses.includes(p.status);}
export function validateEvent(e){
 if(!exact(e,HEADER)||e.schema_version!==SCHEMA||!id(e.event_id,'evt')||!id(e.task_id,'task')||!id(e.device_id,'dev')||e.idempotency_key!==e.event_id||typeof e.client_ts!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(e.client_ts)||!Number.isFinite(Date.parse(e.client_ts)))fail('EVENT_INVALID');
 if(e.event_type==='CREATE'){if(e.base_event_id!==null||!fields(e.payload))fail('CREATE_INVALID');}
 else if(e.event_type==='RESOLVE'){
  if(e.base_event_id!==null||!exact(e.payload,['heads','chosen'])||!Array.isArray(e.payload.heads)||e.payload.heads.length<2||e.payload.heads.length>50||new Set(e.payload.heads).size!==e.payload.heads.length||!e.payload.heads.every(x=>id(x,'evt'))||!e.payload.heads.includes(e.payload.chosen))fail('RESOLVE_INVALID');
 }else{
  if(!id(e.base_event_id,'evt'))fail('BASE_INVALID');
  if(e.event_type==='EDIT'){if(!fields(e.payload))fail('EDIT_INVALID');}
  else if(!['COMPLETE','REOPEN','ARCHIVE','RESTORE'].includes(e.event_type)||!exact(e.payload,[]))fail('COMMAND_INVALID');
 }
 return e;
}
export function toRow(e){validateEvent(e);return HEADER.map(k=>k==='payload'?canonical(e.payload):e[k]??'');}
export function fromRow(r){if(!Array.isArray(r)||r.length!==9||r.some(x=>typeof x!=='string'))fail('ROW_INVALID');let p;try{p=JSON.parse(r[7]);}catch{fail('PAYLOAD_INVALID');}return validateEvent(Object.fromEntries(HEADER.map((k,i)=>[k,i===7?p:i===6&&!r[i]?null:r[i]])));}
function apply(e,parent){
 if(e.event_type==='CREATE')return {...e.payload,status:'OPEN'};
 if(e.event_type==='EDIT'){if(parent.status==='ARCHIVED')fail('EDIT_ARCHIVED');return {...parent,...e.payload};}
 const rules={COMPLETE:['OPEN','DONE'],REOPEN:['DONE','OPEN'],ARCHIVE:['DONE','ARCHIVED'],RESTORE:['ARCHIVED','OPEN']};
 const rule=rules[e.event_type];if(!rule||parent.status!==rule[0])fail('TRANSITION_INVALID');return {...parent,status:rule[1]};
}
export function project(events){
 if(!Array.isArray(events)||events.length>10000)fail('LEDGER_LIMIT');
 const all=new Map(),groups=new Map();let duplicateRows=0;
 for(const e of events){validateEvent(e);if(all.has(e.event_id)){if(canonical(all.get(e.event_id))!==canonical(e))fail('EVENT_ID_COLLISION');duplicateRows++;continue;}all.set(e.event_id,e);if(!groups.has(e.task_id))groups.set(e.task_id,[]);groups.get(e.task_id).push(e);}
 const tasks=[];
 for(const [task_id,items] of groups){
  const roots=items.filter(e=>e.event_type==='CREATE');if(roots.length!==1)fail('ROOT_CONFLICT');
  // Kahn topological traversal: no per-event transitive ancestor sets.
  const nodes=new Map(),used=new Set(),parentsById=new Map(),children=new Map(),indegree=new Map(),queue=[];
  for(const e of items){
   const parents=e.event_type==='CREATE'?[]:e.event_type==='RESOLVE'?e.payload.heads:[e.base_event_id];
   if(parents.some(x=>!all.has(x)||all.get(x).task_id!==task_id))fail('PARENT_MISSING');
   parentsById.set(e.event_id,parents);indegree.set(e.event_id,parents.length);
   if(!parents.length)queue.push(e.event_id);
   for(const p of parents){used.add(p);if(!children.has(p))children.set(p,[]);children.get(p).push(e.event_id);}
  }
  // Bounded ancestry bitsets: 10k events require at most ~12.5 MB
  // per task. One OR per parent edge; exact checks even for stale forks.
  const words=Math.ceil(items.length/32), bits=new Uint32Array(items.length*words),order=new Map();
  for(let cursor=0;cursor<queue.length;cursor++){
   const key=queue[cursor],e=all.get(key),parents=parentsById.get(key);
   const parentIndices=parents.map(p=>order.get(p));
   if(e.event_type==='RESOLVE'){
    for(const p of parentIndices)for(const q of parentIndices){
     if(p!==q&&(bits[p*words+(q>>>5)]&(1<<(q&31))))fail('RESOLVE_NON_HEADS');
    }
   }
   const off=cursor*words;
   for(const p of parentIndices){
    const po=p*words;for(let j=0;j<words;j++)bits[off+j]|=bits[po+j];
    bits[off+(p>>>5)]|=1<<(p&31);
   }
   const state=e.event_type==='RESOLVE'?{...nodes.get(e.payload.chosen)}:apply(e,nodes.get(parents[0]));
   if(!snapshot(state))fail('STATE_INVALID');nodes.set(key,state);order.set(key,cursor);
   for(const c of children.get(key)||[]){const n=indegree.get(c)-1;indegree.set(c,n);if(n===0)queue.push(c);}
  }
  if(nodes.size!==items.length)fail('EVENT_CYCLE');
  const heads=[...nodes.keys()].filter(k=>!used.has(k)).sort();
  const variants=heads.map(event_id=>({event_id,...nodes.get(event_id)}));
  tasks.push({task_id,heads,conflict:heads.length!==1,state:heads.length===1?nodes.get(heads[0]):null,variants});
 }
 return {tasks:tasks.sort((a,b)=>a.task_id.localeCompare(b.task_id)),duplicateRows};
}
export function makeEvent({task_id,event_type,device_id,base_event_id=null,payload={},event_id='evt_'+crypto.randomUUID().replaceAll('-',''),client_ts=new Date().toISOString()}){
 return validateEvent({schema_version:SCHEMA,event_id,task_id,event_type,device_id,client_ts,base_event_id,payload,idempotency_key:event_id});
}
export const newId=p=>p+'_'+crypto.randomUUID().replaceAll('-','');
