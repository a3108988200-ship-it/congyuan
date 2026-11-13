'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const today = () => new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const chinaTime = () => new Date(Date.now()+8*3600000).toISOString().slice(11,16);
const stamp = () => new Date().toISOString();
const isLocalOrigin = (origin=location.origin) => /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(origin);
function renderAccess(){ $('accessNotice').hidden=true;$('phoneHelpText').textContent='当前为云端便签。请在各设备使用本网址并登录同一个ChatGPT账号；手机无VPN可达性以实际网络测试为准。'; }
let currentUser=null;
const statusNames = {pending:'待执行',doing:'进行中',done:'已完成',blocked:'有阻碍',deferred:'已调整时间'};
function scheduledNext(tasks){
 const ordered=[...tasks].filter(t=>['pending','doing','deferred'].includes(t.status)).sort((a,b)=>a.time.localeCompare(b.time));
 const doing=ordered.find(t=>t.status==='doing');
 if(doing)return doing;
 if(selected===today()){
  const due=ordered.filter(t=>t.time<=chinaTime());
  if(due.length)return due[due.length-1];
 }
 return ordered[0];
}
function renderFocus(tasks){
 const next=scheduledNext(tasks);nextId=next?.id;
 $('nextTitle').textContent=next?`${next.time} · ${next.title}`:(tasks.some(t=>t.status==='blocked')?'先解决阻碍，再继续推进':(tasks.length?'今天的任务已全部确认':'今天想做什么？自由添加一件事。'));
 $('nextDescription').textContent=next?next.target:(tasks.length?'查看成果，按需要写下复盘。':'没有固定安排，按自己的想法开始。');
 $('nextAction').textContent=next?'查看任务 →':'去复盘 →';
 if($('boardNext'))$('boardNext').textContent=next?`${next.time} · ${next.title}`:(tasks.length?'当前任务已完成，可以写点心得。':'今天留白，添加你想做的事。');
}
const templates = [];
const weekendTemplates = [];
let state = {revision:0,data:{days:{},settings:{}}}, selected = today(), filter = 'all', busy = false, view = 'today', dialogTask, dialogMode, importCandidate, nextId;
let toastTimer;
const drafts = new Map();
function draft(){if(!drafts.has(selected))drafts.set(selected,{});return drafts.get(selected);}
function toast(message){ if($('taskDialog').open){$('taskDialogMessage').textContent=message;$('taskDialogMessage').hidden=false;} $('toast').textContent=message; $('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000); }
async function api(path,body){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store'});
 const result=await response.json();
 if(!response.ok){if(response.status===401){showLogin(false);location.href='/signin-with-chatgpt?return_to=%2F';}const error=new Error(result.error||'服务器暂时不可用');error.status=response.status;throw error;}return result;
}
function isWeekend(date){return [0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());}
function day(){
 if(!state.data.days[selected]){
 const list=[];
 const previous=Object.keys(state.data.days).filter(date=>date<selected&&state.data.days[date].tomorrow?.trim()).sort().pop();
 state.data.days[selected]={tasks:clone(list).map(t=>({...t,status:'pending',result:'',startedAt:null,completedAt:null,log:[]})),priorities:['','',''],review:'',tomorrow:''};
 }return state.data.days[selected];
}
async function commit(change){
 if(busy){toast('正在保存，请稍候再操作。');return false;}
 busy=true;$('syncState').textContent='正在保存…';const previous=clone(state.data);
 try{change();const result=await api('/api/state',{revision:state.revision,data:state.data,expectedUserId:currentUser?.id});state.revision=result.revision;$('syncState').textContent='已同步 · 云端';render();return true;}
 catch(error){state.data=previous;if(error.status===409){try{const fresh=await api('/api/state');state=fresh;render();}catch{}error.message='记录已在其他页面更新，已载入最新内容，请再操作一次。';}$('syncState').textContent='未保存 · 请重试';toast(error.message);return false;}
 finally{busy=false;}
}
async function load(quiet=false){
 if(busy)return;try{const result=await api('/api/state');const changed=result.revision!==state.revision||result.user?.id!==currentUser?.id;if(result.user&&typeof applyIdentity==='function')applyIdentity(result.user);state=result;$('syncState').textContent='已同步 · 云端';if(!quiet||changed)render();}
 catch(error){$('syncState').textContent='连接中断';if(!quiet)toast(error.message);}
}
function showLogin(){ $('shell').hidden=true;$('login').hidden=false; }
async function init(){renderAccess();try{const session=await api('/api/session');if(!session.authenticated)return showLogin(session.setup,session.localSetup);if(session.user&&typeof applyIdentity==='function')applyIdentity(session.user);$('login').hidden=true;$('shell').hidden=false;await load();}catch(error){showLogin(false);$('loginError').textContent='暂时无法连接云端，请检查网络后刷新。';}}
function render(){if(typeof renderAccount==='function')renderAccount();renderAccess();renderToday();if(view==='history')renderHistory();if(view==='settings')renderSettings();}
function renderToday(){
 renderRhythm();
 const expanded=[...document.querySelectorAll('.task-card > details[open]')].map(d=>d.closest('article').id);
 const d=day(),tasks=d.tasks,done=tasks.filter(t=>t.status==='done').length,percent=tasks.length?Math.round(done/tasks.length*100):0;
 $('date').value=selected;$('dayType').textContent=isWeekend(selected)?'周末 · 轻量安排':'工作日 · 稳步推进';
 $('pastBanner').hidden=selected===today();$('pastBanner').textContent=selected<today()?'正在查看历史日期；补记成果请在说明中标明实际执行日期。':'正在规划未来日期；届时再确认实际完成情况。';
 $('priorities').innerHTML=[0,1,2].map(i=>`<label class="priority"><span>0${i+1}</span><input id="priority${i}" aria-label="第${i+1}件重点" maxlength="200" placeholder="写下一个具体、可完成的动作" value="${esc(draft()['priority'+i]??d.priorities?.[i]??'')}"></label>`).join('');
 $('percent').innerHTML=`${percent}<span>%</span>`;$('progressRing').style.setProperty('--p',percent+'%');$('doneCount').textContent=`${done} / ${tasks.length}`;$('doingCount').textContent=tasks.filter(t=>t.status==='doing').length;$('blockedCount').textContent=tasks.filter(t=>t.status==='blocked').length;$('taskCount').textContent=tasks.length+' 项';
 const next=scheduledNext(tasks);nextId=next?.id;
 $('nextTitle').textContent=next?`${next.time} · ${next.title}`:(tasks.some(t=>t.status==='blocked')?'先解决阻碍，再继续推进':(tasks.length?'今天的任务已全部确认':'今天想做什么？自由添加一件事。'));$('nextDescription').textContent=next?next.target:(tasks.length?'查看成果，按需要写下复盘。':'没有固定安排，按自己的想法开始。');$('nextAction').textContent=next?'查看任务 →':'去复盘 →';
 $('tasks').innerHTML=tasks.filter(t=>filter==='all'||(filter==='pending'?['pending','deferred'].includes(t.status):t.status===filter)).sort((a,b)=>a.time.localeCompare(b.time)).map(taskCard).join('')||'<div class="empty">这个分类下还没有任务。</div>';
 expanded.forEach(id=>{const node=document.getElementById(id);if(node)node.querySelector('details').open=true;});
 $('review').value=draft().review??d.review??'';$('tomorrow').value=draft().tomorrow??d.tomorrow??'';
 if(typeof renderDimensionBoard==='function')renderDimensionBoard();
}
function taskCard(t){
 return `<article class="task-card ${esc(t.status)}" id="task-${esc(t.id)}"><div class="task-header"><button type="button" class="task-marker" data-action="${t.status==='done'?'undo':'done'}" data-id="${esc(t.id)}" aria-label="${t.status==='done'?'撤销完成':'确认完成'}：${esc(t.title)}">${t.status==='done'?'✓':t.status==='doing'?'·':''}</button><div class="task-info"><div class="task-meta"><span>${esc(t.time)} · 北京时间</span><span class="category">${esc(t.category||'自定义任务')}</span></div><h3>${esc(t.title)}</h3><p>${esc(t.target)}</p></div><div class="task-actions"><span class="badge ${esc(t.status)}">${statusNames[t.status]}</span>${t.status==='done'?`<button class="subtle" data-action="undo" data-id="${esc(t.id)}">撤销确认</button>`:`<button class="outline" data-action="start" data-id="${esc(t.id)}">${t.status==='doing'?'继续查看':'开始执行'}</button><button class="primary" data-action="done" data-id="${esc(t.id)}">确认完成</button>`}</div></div><details class="task-detail"><summary>执行步骤与工作提示词</summary><div class="detail-body"><div><h4>按这几步去做 · ${(t.stepChecks||[]).filter(Boolean).length}/${(t.steps||[]).length}</h4><div class="step-list">${(t.steps||[]).map((s,i)=>`<label class="step-check"><input type="checkbox" data-step="${i}" data-task="${esc(t.id)}" ${t.stepChecks?.[i]?'checked':''} ${t.status==='done'?'disabled':''}><span>${esc(s)}</span></label>`).join('')}</div><small>步骤勾选只记录进度，整项成果仍需确认。</small><h4>完成标准</h4><p class="muted">${esc(t.target)}</p></div><div><h4>复制给 AI，辅助执行</h4><div class="detail-box">${esc(t.prompt||'按需要填写自己的工作提示词。')}</div><button class="subtle" data-action="copy" data-id="${esc(t.id)}">复制工作提示词 ↗</button></div></div><div class="detail-buttons">${t.status!=='done'?`<button class="outline" data-action="blocked" data-id="${esc(t.id)}">遇到阻碍</button><button class="outline" data-action="deferred" data-id="${esc(t.id)}">调整时间</button>`:''}<button class="subtle" data-action="edit" data-id="${esc(t.id)}">编辑任务内容</button></div>${t.result?`<div class="task-result"><b>${t.status==='done'?'完成成果':'最新记录'}</b> · ${t.completedAt?esc(formatStamp(t.completedAt)):'已保存'}<br>${esc(t.result)}</div>`:''}${(t.log||[]).length?`<details><summary>查看操作记录 (${t.log.length})</summary><div class="detail-box">${t.log.slice(-12).map(l=>esc(formatStamp(l.at)+' · '+l.text)).join('<br>')}</div></details>`:''}</details></article>`;
}
function formatStamp(value){return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});}
function addLog(t,text){t.log=t.log||[];t.log.push({at:stamp(),text});if(t.log.length>100)t.log=t.log.slice(-100);}
function setView(name){view=name;$('phoneHelp').hidden=name!=='settings';['today','history','settings'].forEach(v=>$(v+'View').hidden=v!==name);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$('viewLabel').textContent={today:'每日计划',history:'执行记录',settings:'计划与提醒'}[name];render();window.scrollTo({top:0,behavior:'smooth'});}
function openTask(id){filter='all';document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter==='all'));renderToday();const card=document.getElementById('task-'+id);if(card){card.querySelector('details').open=true;card.scrollIntoView({behavior:'smooth',block:'center'});}}
function openDialog(mode,id){$('taskDialogMessage').hidden=true;$('taskDialogMessage').textContent='';dialogMode=mode;dialogTask=id;const t=day().tasks.find(t=>t.id===id);$('editFields').hidden=!['edit','add'].includes(mode);$('resultField').hidden=['edit','add'].includes(mode);$('deferField').hidden=mode!=='deferred';$('dialogTitle').textContent={done:'记录成果，确认完成',blocked:'记下阻碍，明确下一步',deferred:'调整今天的执行时间',edit:'编辑任务内容',add:'添加今天的任务'}[mode];$('dialogHelp').textContent=mode==='done'?'确认代表你已实际执行。请写下具体成果；草稿、发送和回复应分别记录。':mode==='blocked'?'写清卡在哪里、需要谁配合，以及下一步动作。':mode==='deferred'?'只调整本任务今天的提醒时间；跨日事项请在目标日期另建任务。':'只安排这一天。写下想做的事，时间、说明和步骤由你决定。';$('deleteTask').hidden=mode!=='edit';$('taskResult').value='';$('taskResult').placeholder=mode==='done'?'请写一句实际成果，例如：已用 Accio 查找供应商，筛选结果待整理。':'请说明当前情况和下一步动作。';$('taskResult').required=!['edit','add'].includes(mode);$('editTitle').value=t?.title||'';$('editTime').value=t?.time||chinaTime();$('editTarget').value=t?.target||'';$('editSteps').value=(t?.steps||[]).join('\n');$('editPrompt').value=t?.prompt||'';$('deferTime').value=t?.time||'17:00';$('editTitle').required=['edit','add'].includes(mode);$('editTime').required=['edit','add'].includes(mode);$('deferTime').required=mode==='deferred';if(typeof prepareDimensionSelect==='function')prepareDimensionSelect(t);$('taskDialog').showModal();if(!['edit','add'].includes(mode))$('taskResult').focus();}
function renderHistory(){
 const dates=Object.keys(state.data.days).sort().reverse();const since=new Date(new Date(today()+'T12:00:00Z').getTime()-6*86400000).toISOString().slice(0,10);const recent=dates.filter(d=>d>=since&&d<=today());let total=0,done=0,blocked=0;recent.forEach(date=>state.data.days[date].tasks.forEach(t=>{total++;if(t.status==='done')done++;if(t.status==='blocked')blocked++;}));
 $('weekStats').innerHTML=`<div class="stat"><strong>${done}</strong><span>近7日已确认任务</span></div><div class="stat"><strong>${total?Math.round(done/total*100):0}%</strong><span>已记录任务完成率</span></div><div class="stat"><strong>${blocked}</strong><span>已标记阻碍</span></div>`;
 $('historyList').innerHTML=dates.map(date=>{const d=state.data.days[date];return `<article class="history-card"><div><h3>${esc(date)} · ${isWeekend(date)?'周末':'工作日'}</h3><p>${d.tasks.filter(t=>t.status==='done').length} / ${d.tasks.length} 项已确认</p><p>${esc(d.review||'还没有填写复盘。')}</p>${d.tomorrow?`<p>下一步：${esc(d.tomorrow)}</p>`:''}</div><button class="outline" data-history="${esc(date)}">查看记录 →</button></article>`;}).join('')||'<p class="empty">开始执行后，这里会保留你的成果。</p>';
}
function renderSettings(){
 $('templateList').innerHTML='<p>每天从空白清单开始。点击「添加任务」，按自己的想法安排当天；不会自动复制昨天或生成固定任务。</p>';
 $('reminders').checked=state.data.settings.reminders!==false;$('notificationState').textContent=!('Notification'in window)?'当前浏览器不支持系统通知，仍会显示网页内提示。':!window.isSecureContext?'系统通知需要HTTPS；当前仍可使用网页内提示。':'当前系统通知：'+({default:'未授权',granted:'已授权（页面打开时有效）',denied:'已拒绝，可在浏览器设置中调整'}[Notification.permission]);
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderToday();});
$('loginForm').onsubmit=async event=>{event.preventDefault();const button=$('authSubmit');button.disabled=true;try{const setup=$('loginForm').dataset.setup==='yes',register=$('loginForm').dataset.mode==='register';await api(setup?'/api/setup':register?'/api/register':'/api/login',{password:$('password').value,username:$('username').value.trim(),name:$('displayName').value.trim(),inviteCode:$('inviteCodeInput').value.trim()});$('password').value='';$('inviteCodeInput').value='';$('loginError').textContent='';await init();}catch(error){$('loginError').textContent=error.message;}finally{button.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/api/logout',{});state={revision:0,data:{days:{},settings:{}}};$('tasks').innerHTML='';drafts.clear();currentUser=null;if(typeof clearIdentityView==='function')clearIdentityView();showLogin(false);}catch(error){toast(error.message);}};
$('accountLogout').onclick=()=> $('logout').onclick();
$('accessDetails').onclick=()=>{setView('settings');$('phoneHelp').scrollIntoView({behavior:'smooth',block:'center'});};
$('refresh').onclick=()=>load();
document.addEventListener('input',event=>{if(['priority0','priority1','priority2','review','tomorrow'].includes(event.target.id))draft()[event.target.id]=event.target.value;});
window.addEventListener('beforeunload',event=>{const d=state.data.days[selected],v=drafts.get(selected);if(d&&v&&Object.entries(v).some(([key,value])=>value!==(key.startsWith('priority')?d.priorities?.[Number(key.slice(-1))]||'':d[key]||''))){event.preventDefault();event.returnValue='';}});
function changeDate(offset){selected=new Date(new Date(selected+'T12:00:00Z').getTime()+offset*86400000).toISOString().slice(0,10);renderToday();}
$('prevDate').onclick=()=>changeDate(-1);$('nextDate').onclick=()=>changeDate(1);$('goToday').onclick=()=>{selected=today();renderToday();};$('date').onchange=event=>{if(/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){selected=event.target.value;renderToday();}};
$('savePriorities').onclick=async()=>{const values=[0,1,2].map(i=>$('priority'+i).value.trim());if(await commit(()=>day().priorities=values))toast('今日重点已保存。');};
$('saveReview').onclick=async()=>{const review=$('review').value.trim(),tomorrow=$('tomorrow').value.trim();if(!review)return toast('先写下一句今天的成果或问题。');if(await commit(()=>{day().review=review;day().tomorrow=tomorrow;}))toast('复盘已保存，明天继续。');};
$('nextAction').onclick=()=>nextId?openTask(nextId):document.querySelector('.review-card').scrollIntoView({behavior:'smooth'});
$('addTask').onclick=()=>openDialog('add');$('closeDialog').onclick=()=>$('taskDialog').close();
$('tasks').onchange=async event=>{const box=event.target;if(box.dataset.step===undefined)return;const t=day().tasks.find(t=>t.id===box.dataset.task),i=Number(box.dataset.step);if(!t||t.status==='done'||!Number.isInteger(i)||i<0||i>=t.steps.length)return;if(selected>today()){box.checked=false;return toast('未来日期请在实际执行时勾选。');}const checked=box.checked;if(!await commit(()=>{t.stepChecks=t.steps.map((_,j)=>j===i?checked:Boolean(t.stepChecks?.[j]));}))box.checked=!checked;};
$('tasks').onclick=async event=>{
 const button=event.target.closest('[data-action]');if(!button)return;const {action,id}=button.dataset,t=day().tasks.find(t=>t.id===id);if(!t)return;
 if(action==='copy'){try{await navigator.clipboard.writeText(t.prompt||t.target);toast('提示词已复制，补齐真实资料后使用。');}catch{toast('复制权限不可用，请在任务内手动选择文字复制。');}return;}
 if(['done','start'].includes(action)&&selected>today())return toast('这是未来日期，请到实际执行时再开始或确认。');
 if(action==='start'){if(t.status!=='doing'){if(!await commit(()=>{t.status='doing';t.startedAt=stamp();addLog(t,'开始执行');}))return;}return openTask(id);}
 if(action==='undo'){if(!confirm('撤销这项完成确认？原成果仍会保存在操作记录中。'))return;await commit(()=>{addLog(t,'撤销确认，原成果：'+t.result);t.status='pending';t.completedAt=null;});return;}
 openDialog(action,id);
};
$('taskForm').onsubmit=async event=>{
 event.preventDefault();const mode=dialogMode,id=dialogTask;const result=$('taskResult').value.trim(),title=$('editTitle').value.trim(),time=$('editTime').value,target=$('editTarget').value.trim(),steps=$('editSteps').value.split('\n').map(s=>s.trim()).filter(Boolean),prompt=$('editPrompt').value.trim(),defer=$('deferTime').value;
 if(['done','blocked','deferred'].includes(mode)&&!result){$('taskResult').focus();return toast('请先填写一句具体成果或原因，再确认保存。');}
 if(['edit','add'].includes(mode)&&(!title||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))return toast('请填写任务名称和有效的时间；说明和步骤可以留空。');
 if(mode==='deferred'&&selected===today()&&defer<=chinaTime())return toast('今天的提醒时间应晚于当前北京时间。');
 $('dialogSubmit').disabled=true;
 const ok=await commit(()=>{if(mode==='add'){day().tasks.push({id:'custom-'+crypto.randomUUID(),title,time,target,steps,prompt,category:'自定义任务',dimensionId:typeof selectedTaskDimension==='function'?selectedTaskDimension():undefined,status:'pending',result:'',log:[{at:stamp(),text:'新增任务'}]});return;}const t=day().tasks.find(t=>t.id===id);if(mode==='edit'){Object.assign(t,{title,time,target,steps,prompt,dimensionId:typeof selectedTaskDimension==='function'?selectedTaskDimension():t.dimensionId,stepChecks:steps.map((step,i)=>step===t.steps[i]&&Boolean(t.stepChecks?.[i]))});addLog(t,'编辑任务内容');return;}t.status=mode;t.result=result;if(mode==='done')t.completedAt=stamp();if(mode==='deferred')t.time=defer;addLog(t,statusNames[mode]+'：'+result);});
 $('dialogSubmit').disabled=false;if(ok){$('taskDialog').close();if(typeof pendingDimension!=='undefined')pendingDimension=null;toast(mode==='done'?'成果已记录，任务确认完成。':'已保存。');}
};
$('deleteTask').onclick=async()=>{
 const id=dialogTask,t=day().tasks.find(t=>t.id===id);if(!t)return;
 if(!confirm('删除「'+t.title+'」？只影响当前日期。'))return;
 if(await commit(()=>{day().tasks=day().tasks.filter(item=>item.id!==id);})){ $('taskDialog').close();toast('已删除这一天的任务。'); }
};
$('historyList').onclick=event=>{const b=event.target.closest('[data-history]');if(b){selected=b.dataset.history;setView('today');}};
$('reminders').onchange=async event=>{const checked=event.target.checked;await commit(()=>state.data.settings.reminders=checked);};
$('enableNotify').onclick=async()=>{if(!('Notification'in window)||!window.isSecureContext)return toast('当前环境不支持系统通知，可使用日历提醒和网页提示。');await Notification.requestPermission();renderSettings();};
function download(name,type,content){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('exportData').onclick=()=>download('Conrad-backup-'+today()+'.json','application/json',JSON.stringify({format:'conrad-daily-v1',exportedAt:stamp(),data:state.data},null,2));
$('importData').onclick=async()=>{const file=$('importFile').files[0];if(!file)return toast('请先选择备份文件。');if(file.size>1900000)return toast('备份过大，限1.9MB。');try{const parsed=JSON.parse(await file.text());if(parsed.format!=='conrad-daily-v1'||!parsed.data?.days||!parsed.data?.settings)throw new Error('不是有效的工作台备份。');importCandidate=parsed.data;$('importSummary').textContent=`备份包含 ${Object.keys(parsed.data.days).length} 个日期，导出于 ${formatStamp(parsed.exportedAt)}。`;$('importDialog').showModal();}catch(error){toast(error.message);}};
$('cancelImport').onclick=()=>$('importDialog').close();$('confirmImport').onclick=async()=>{if(await commit(()=>state.data=clone(importCandidate))){$('importDialog').close();toast('已恢复并同步备份。');}};
$('calendar').onclick=()=>{
 const tasks=day().tasks.filter(t=>t.status!=='done');
 if(!tasks.length)return toast('这一天还没有待办任务，先添加想做的事。');
 const escapeICS=s=>s.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const events=tasks.map(t=>{
 const at=new Date(selected+'T'+t.time+':00+08:00').toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const description=(t.target||'')+(isLocalOrigin()?' 手机正式入口尚未部署，请勿在手机使用电脑本机地址。':' 工作台网址：'+location.origin);
 return ['BEGIN:VEVENT',`UID:${escapeICS(t.id)}-${selected}@conrad.local`,`DTSTAMP:${stamp().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART:${at}`,'DURATION:PT15M',`SUMMARY:${escapeICS(t.title)}`,`DESCRIPTION:${escapeICS(description)}`,'BEGIN:VALARM','TRIGGER:-PT5M','ACTION:DISPLAY',`DESCRIPTION:${escapeICS(t.title)}`,'END:VALARM','END:VEVENT'].join('\r\n');
 });
 // RFC 5545: fold long lines at UTF-8 octet boundaries, at most 75 bytes.
 const raw=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Conrad//Daily Desk//ZH','CALSCALE:GREGORIAN',...events,'END:VCALENDAR'].join('\r\n');
 const fold=line=>{let result='',segment='',bytes=0;for(const char of line){const n=new TextEncoder().encode(char).length;if(bytes+n>74){result+=segment+'\r\n ';segment='';bytes=1;}segment+=char;bytes+=n;}return result+segment;};download(`Conrad-${selected}-任务提醒.ics`,'text/calendar;charset=utf-8',raw.split('\r\n').map(fold).join('\r\n')+'\r\n');toast('下载后请导入常用日历，并检查通知权限。');
};
function reminders(){
 if($('shell').hidden||state.data.settings.reminders===false)return;const d=state.data.days[today()];if(!d)return;const now=chinaTime();const due=d.tasks.filter(t=>['pending','deferred'].includes(t.status)&&t.time<=now).sort((a,b)=>b.time.localeCompare(a.time))[0];if(!due)return;
 const key=`conrad-reminded-${today()}-${due.id}-${due.time}`;try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');}catch{return;}
 $('reminderText').textContent=due.time+' · '+due.title;$('reminderBanner').hidden=false;if('Notification'in window&&Notification.permission==='granted')new Notification('Conrad · 该开始下一项工作了',{body:due.title});
}
$('dismissReminder').onclick=()=>$('reminderBanner').hidden=true;
setInterval(reminders,20000);
setInterval(()=>{if(!$('shell').hidden&&!busy&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName))load(true);},30000);
init();

function renderRhythm(){
 const tasks=[...day().tasks].sort((a,b)=>a.time.localeCompare(b.time));
 const recommended=scheduledNext(tasks);
 const time=chinaTime();
 $('liveTime').textContent='北京时间 '+time;
 $('rhythmTrack').innerHTML=tasks.map((t,i)=>`<button class="rhythm-stop ${t.status==='done'?'finished':t.id===recommended?.id?'current':''}" data-rhythm="${esc(t.id)}"><span class="rhythm-dot">${t.status==='done'?'✓':String(i+1).padStart(2,'0')}</span><b>${esc(t.time)}</b><span>${esc(t.category||t.title)}</span></button>`).join('');
 const doing=tasks.find(t=>t.status==='doing');
 const waiting=tasks.filter(t=>['pending','deferred'].includes(t.status));
 $('nextTiming').textContent=selected!==today()?(selected>today()?'计划预览':'历史记录'):doing?'正在执行':waiting.some(t=>t.time<=time)?'待推进 · 按优先级开始':waiting.length?'即将开始':'本日回顾';
}
$('rhythmTrack').onclick=event=>{const button=event.target.closest('[data-rhythm]');if(button)openTask(button.dataset.rhythm);};
setInterval(()=>{if(!$('shell').hidden){renderRhythm();renderFocus(day().tasks);}},60000);
