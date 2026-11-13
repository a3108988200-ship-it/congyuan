'use strict';
const baseDimensions=[
 {id:'clients',label:'客户推进',emoji:'💬',color:'mint'},
 {id:'outreach',label:'新客户开发',emoji:'🌱',color:'pink'},
 {id:'startup',label:'工作启动',emoji:'☀',color:'peach'},
 {id:'orders',label:'成交与交付',emoji:'📦',color:'lavender'},
 {id:'content',label:'产品与营销',emoji:'🎨',color:'blue'},
 {id:'review',label:'CEO复盘',emoji:'✦',color:'yellow'}
];
let pendingDimension=null,boardMode='dimensions',displayedMonth=selected.slice(0,7);
function dimensions(){return [...baseDimensions,...(state.data.settings.dimensions||[])];}
function taskDimension(t){
 if(t.dimensionId&&dimensions().some(d=>d.id===t.dimensionId))return t.dimensionId;
 const map={inbox:'startup',followup:'clients',prospect:'outreach',deal:'orders',product:'content',review:'review','weekend-check':'startup','weekend-review':'review'};
 if(map[t.id])return map[t.id];
 return baseDimensions.find(d=>d.label===t.category)?.id||'other';
}
function addDate(date,days){return new Date(new Date(date+'T12:00:00Z').getTime()+days*86400000).toISOString().slice(0,10);}
function weekStart(date){const weekday=new Date(date+'T12:00:00Z').getUTCDay();return addDate(date,-((weekday+6)%7));}
function chooseBoardDate(date){selected=date;displayedMonth=date.slice(0,7);setView('today');}
function setBoardMode(mode){boardMode=mode;document.body.classList.toggle('timeline-mode',mode==='timeline');$('showDimensions').classList.toggle('selected',mode==='dimensions');$('showTimeline').classList.toggle('selected',mode==='timeline');}
function prepareDimensionSelect(t){$('editDimension').innerHTML=[...dimensions(),{id:'other',label:'其他事项'}].map(d=>`<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');$('editDimension').value=t?taskDimension(t):(pendingDimension||'startup');}
function selectedTaskDimension(){return $('editDimension').value||'other';}
function startBoardTask(dimension){pendingDimension=dimension||'startup';openDialog('add');}
function renderDimensionBoard(){
 const d=day(),start=weekStart(selected),tasks=d.tasks,done=tasks.filter(t=>t.status==='done').length;
 $('boardDate').textContent=`${Number(selected.slice(5,7))}月${Number(selected.slice(8,10))}日`;
 const weekdays=['MON','TUE','WED','THU','FRI','SAT','SUN'];
 $('weekStrip').innerHTML=weekdays.map((name,i)=>{const date=addDate(start,i);return `<button class="week-day ${date===selected?'selected':''} ${date===today()?'is-today':''}" data-board-date="${date}" aria-label="${date}"><small>${name}</small><strong>${Number(date.slice(8,10))}</strong><i></i></button>`;}).join('');
 const goals=state.data.settings.weekGoals?.[start]||[];
 $('weekRange').textContent=`${Number(start.slice(5,7))}/${Number(start.slice(8,10))}–${Number(addDate(start,6).slice(5,7))}/${Number(addDate(start,6).slice(8,10))}`;
 $('weekGoalsDone').textContent=`${goals.filter(g=>g.done).length}/${goals.length}`;
 const weekDates=Object.keys(state.data.days).filter(date=>date>=start&&date<=addDate(start,6));
 $('weekPending').textContent=String(weekDates.reduce((n,date)=>n+state.data.days[date].tasks.filter(t=>t.status!=='done').length,0));
 $('weekGoals').innerHTML=goals.length?goals.map(g=>`<label class="week-goal ${g.done?'finished':''}"><input type="checkbox" data-goal="${esc(g.id)}" ${g.done?'checked':''}><span>${esc(g.title)}</span></label>`).join(''):'<p class="empty-small">本周先专注哪几个成果？</p>';
 const percentage=tasks.length?Math.round(done/tasks.length*100):0;
 $('boardPercent').textContent=percentage+'%';$('boardProgressFill').style.setProperty('width',percentage+'%');$('boardProgressCount').textContent=`${done} / ${tasks.length} 完成`;
 const next=scheduledNext(tasks);$('boardNext').textContent=next?`${next.time} · ${next.title}`:(tasks.length?'当前任务已完成，可以写点心得。':'今天留白，添加你想做的事。');
 const groups=dimensions();if(tasks.some(t=>taskDimension(t)==='other'))groups.push({id:'other',label:'其他事项',emoji:'○',color:'gray'});
 $('dimensionGrid').innerHTML=groups.map(group=>{
 const list=tasks.filter(t=>taskDimension(t)===group.id).sort((a,b)=>a.time.localeCompare(b.time));
 return `<article class="dimension-card tone-${esc(group.color)}"><header><span class="dimension-title"><span>${esc(group.emoji)}</span> ${esc(group.label)}</span><span class="dimension-count">${list.filter(t=>t.status==='done').length} / ${list.length}</span></header><div class="dimension-tasks">${list.map(t=>`<div class="dimension-task ${t.status==='done'?'finished':''}"><button class="completion-circle" data-board-complete="${esc(t.id)}" aria-label="${t.status==='done'?'查看已完成成果':'确认完成'}：${esc(t.title)}">${t.status==='done'?'✓':''}</button><button class="dimension-task-copy" data-board-detail="${esc(t.id)}"><b>${esc(t.title)}</b><small>${esc(t.time)} · ${statusNames[t.status]}</small><span>${esc(t.status==='done'?t.result:t.target)}</span></button><button class="dimension-edit" data-board-edit="${esc(t.id)}" aria-label="编辑${esc(t.title)}">⋯</button></div>`).join('')||'<p class="empty-dimension">留一点空间，给重要的事。</p>'}</div><button class="dimension-add-task" data-add-to="${esc(group.id)}">＋ 添加任务到「${esc(group.label)}」</button></article>`;
 }).join('');
 $('boardJournal').value=draft().journal??d.journal??'';$('boardNote').value=draft().note??d.note??'';
 renderMonth();
}
function renderMonth(){
 const first=displayedMonth+'-01';const year=Number(first.slice(0,4)),month=Number(first.slice(5,7));
 $('monthTitle').textContent=`${month}月概览`;$('monthLabel').textContent=`${year} · ${String(month).padStart(2,'0')}`;
 const count=new Date(Date.UTC(year,month,0)).getUTCDate(),offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7;
 const cells=Array.from({length:offset},()=>'<span class="blank-day"></span>');
 for(let n=1;n<=count;n++){
 const date=`${displayedMonth}-${String(n).padStart(2,'0')}`,record=state.data.days[date];const complete=record?.tasks.filter(t=>t.status==='done').length||0;const density=record?.tasks.length&&complete?Math.ceil(complete/record.tasks.length*4):0;
 cells.push(`<button class="density-${density} ${date===selected?'selected':''} ${date===today()?'today':''}" data-board-date="${date}" aria-label="${date}，${complete}项已完成">${n}</button>`);
 }$('monthGrid').innerHTML=cells.join('');
}
function openBoardDetail(id){setBoardMode('timeline');openTask(id);}
$('showDimensions').onclick=()=>setBoardMode('dimensions');$('showTimeline').onclick=()=>setBoardMode('timeline');
$('weekStrip').onclick=$('monthGrid').onclick=event=>{const b=event.target.closest('[data-board-date]');if(b)chooseBoardDate(b.dataset.boardDate);};
$('dimensionGrid').onclick=event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.addTo)return startBoardTask(button.dataset.addTo);
 if(button.dataset.boardDetail)return openBoardDetail(button.dataset.boardDetail);
 if(button.dataset.boardEdit)return openDialog('edit',button.dataset.boardEdit);
 if(button.dataset.boardComplete){const id=button.dataset.boardComplete,t=day().tasks.find(t=>t.id===id);if(selected>today())return toast('请在实际执行日期确认成果。');if(t.status==='done')return openBoardDetail(id);openDialog('done',id);}
};
$('boardAdd').onclick=$('mobileAdd').onclick=()=>{setView('today');startBoardTask();};
$('boardNext').onclick=()=>{const next=scheduledNext(day().tasks);if(next)openBoardDetail(next.id);else{$('boardJournal').focus();}};
$('boardWrite').onclick=()=>{setBoardMode('dimensions');$('boardJournal').scrollIntoView({behavior:'smooth',block:'center'});$('boardJournal').focus();};
$('saveJournal').onclick=async()=>{const text=$('boardJournal').value.trim();if(await commit(()=>day().journal=text))toast('日记已保存到当前日期。');};
$('saveNote').onclick=async()=>{const text=$('boardNote').value.trim();if(await commit(()=>day().note=text))toast('便签已保存。');};
document.addEventListener('input',event=>{if(event.target.id==='boardJournal')draft().journal=event.target.value;if(event.target.id==='boardNote')draft().note=event.target.value;});
$('addWeekGoal').onclick=async()=>{const title=$('weekGoalInput').value.trim();if(!title)return toast('先写下一个本周成果。');const start=weekStart(selected);if(await commit(()=>{const settings=state.data.settings;settings.weekGoals=settings.weekGoals||{};settings.weekGoals[start]=settings.weekGoals[start]||[];settings.weekGoals[start].push({id:crypto.randomUUID(),title,done:false});}))$('weekGoalInput').value='';};
$('weekGoals').onchange=async event=>{const box=event.target;if(!box.dataset.goal)return;const checked=box.checked;const start=weekStart(selected);if(!await commit(()=>{state.data.settings.weekGoals[start].find(g=>g.id===box.dataset.goal).done=checked;}))box.checked=!checked;};
function changeMonth(offset){displayedMonth=new Date(Date.UTC(Number(displayedMonth.slice(0,4)),Number(displayedMonth.slice(5,7))-1+offset,1)).toISOString().slice(0,7);renderMonth();}
$('prevMonth').onclick=()=>changeMonth(-1);$('nextMonth').onclick=()=>changeMonth(1);
$('mobileCalendar').onclick=()=>{setView('today');setBoardMode('dimensions');document.body.classList.add('show-board-calendar');$('monthGrid').scrollIntoView({behavior:'smooth',block:'center'});};
document.querySelectorAll('[data-mobile-view]').forEach(b=>b.onclick=()=>{setView(b.dataset.mobileView);if(b.dataset.mobileView==='today')setBoardMode('dimensions');});
$('addDimension').onclick=()=>$('dimensionDialog').showModal();$('closeDimension').onclick=()=>$('dimensionDialog').close();
$('dimensionForm').onsubmit=async event=>{event.preventDefault();const label=$('dimensionName').value.trim(),emoji=$('dimensionEmoji').value.trim()||'✦',color=$('dimensionColor').value;if(!label)return toast('请填写维度名称。');if(await commit(()=>{state.data.settings.dimensions=state.data.settings.dimensions||[];state.data.settings.dimensions.push({id:'dim-'+crypto.randomUUID(),label,emoji,color});})){$('dimensionDialog').close();$('dimensionName').value='';}};
document.body.classList.add('dimension-design');setBoardMode('dimensions');
if(!$('shell').hidden)renderDimensionBoard();
