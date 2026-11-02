import './style.css';
import './overview.css';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { createSaveQueue } from './save-queue.mjs';
import { createPropertyQueue } from './property-queue.mjs';
import { esc, icon } from './html';
import { fieldKinds, operators, sortFields, readView, defaultView, type ProjectField, type PropertyValue, type Values, type Rule, type View } from './property-ui';
import { renderOverview, propertyControl } from './overview-ui';

interface Question { id: string; text: string; answer: string }
interface Project { id: string; name: string }
interface Group { id: string; projectId: string; name: string; questions: Question[] }
interface Session { id: string; projectId: string; title: string; person: string; date: string; questionnaireId: string|null; questionnaireName: string; questions: Question[]; notes: string }
interface Summary { id: string; title: string; person: string; date: string; questionnaireName: string; audioCount: number; values: Values }
interface Audio { id: string; name: string; path: string; byteLength: number; durationSecs: number|null; status: string }
interface Device { id: string; name: string }
interface Recording { active: boolean; finished: boolean; paused: boolean; sessionId: string|null; durationSecs: number; level: number; error: string|null }
interface Page { sessions: Summary[]; total: number; matching: number }

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const uid = () => crypto.randomUUID();
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const clock = (seconds: number) => { const n = Math.floor(seconds); return `${n >= 3600 ? Math.floor(n/3600)+':' : ''}${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; };
const initials = (name: string) => (name || '?').split(' ').slice(0,2).map(s=>s[0]).join('');
const state = { projects: [] as Project[], projectId: '', groups: [] as Group[], rows: [] as Summary[], total: 0, matching: 0, query: '', selected: new Set<string>(), page: 'list', session: null as Session|null, audio: [] as Audio[], devices: [] as Device[], deviceId: localStorage.getItem('microphone') || '', dataDirectory: '', saveState: 'saved', propertySaveState: 'saved', fields: [] as ProjectField[], sessionValues: {} as Values, preferences: defaultView(), matchingSelected: 0, propertyCache: new Map<string,Values>() };
let recording: Recording = { active:false, finished:false, paused:false, sessionId:null, durationSecs:0, level:0, error:null };
let exportState = { ids: [] as string[], format: 'zip', preview: [] as Session[] };
let editor: { mode: 'project'|'session'; group: Group }|null = null;
let toastTimer: ReturnType<typeof setTimeout>, searchTimer: ReturnType<typeof setTimeout>, recordTimer: ReturnType<typeof setInterval>|undefined, searchRevision = 0, polling = false, actionBusy = false, pointerDown = false;
const project = () => state.projects.find(p=>p.id===state.projectId)!;
const current = () => { if (!state.session) throw Error('Open a session first.'); return state.session; };

function toast(message: string) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,4500); }
function failure(error: unknown) { const el=$('#error'); el.hidden=false; el.innerHTML=`<span>${esc(error instanceof Error ? error.message : error)}</span><button class="btn quiet" data-action="${(state.saveState==='error'||state.propertySaveState==='error')?'retry-save':'dismiss'}">${(state.saveState==='error'||state.propertySaveState==='error')?'Retry save':'Dismiss'}</button>`; }
function clearError() { $('#error').hidden=true; }
function savedStatus() {
  const states=[state.saveState,state.propertySaveState,...(propertyDrafts.size?['pending']:[])],status=states.includes('error')?'error':states.includes('saving')?'saving':states.includes('pending')?'pending':'saved';
  for(const el of document.querySelectorAll('#save-status,#property-save-status')){el.textContent=status==='saved'?'Saved on this computer':status==='error'?'Not saved; retry before closing':status==='saving'?'Saving…':'Unsaved changes';el.className='hint '+(status==='saved'?'saved':status==='error'?'save-error':'');}
}
const saves = createSaveQueue(async (session: Session) => { await invoke('save_session',{session}); }, (status: string,error?: unknown) => { state.saveState=status; savedStatus(); if(status==='error')failure(error); },350);
function changed() { saves.enqueue(current()); }

async function list(append=false) {
  const revision=++searchRevision, projectId=state.projectId, query=state.query, options=overviewQuery();
  const result=await invoke<Page>('overview',{query:{...options,offset:append?state.rows.length:0}});
  if(revision!==searchRevision||projectId!==state.projectId||query!==state.query)return;
  for(const row of result.sessions){const cached=state.propertyCache.get(row.id);if(cached&&propertySaves.dirty())row.values=cached;else state.propertyCache.set(row.id,row.values);}
  state.rows=append?[...state.rows,...result.sessions]:result.sessions;state.total=result.total;state.matching=result.matching;
  await selectionScope();
}
async function chooseProject(id: string) {
  await flushAll();state.projectId=id;state.query='';state.selected.clear();state.page='list';state.session=null;propertyDrafts.clear();state.propertyCache.clear();localStorage.setItem('project',id);
  [state.groups,state.fields]=await Promise.all([invoke<Group[]>('questionnaires',{projectId:id}),invoke<ProjectField[]>('project_fields',{projectId:id})]);
  state.preferences=readView(id,state.fields);await list();render();
}
async function audio() { state.audio=await invoke('session_audio',{sessionId:current().id}); }
async function openSession(id: string) {
  await flushAll();state.session=await invoke('get_session',{sessionId:id});state.sessionValues=await invoke('property_values',{sessionId:id});state.propertyCache.set(id,state.sessionValues);await audio();state.page='form';
  try{state.devices=await invoke('input_devices');}catch{state.devices=[];}render();
}

function render() {
  $('#app').innerHTML=`<section class="surface"><header class="topbar"><div class="projectbox"><div class="brand"><span class="mark">${icon('note')}</span>Research</div><span class="divider"></span><select id="project" aria-label="Project" ${recording.active?'disabled':''}>${state.projects.map(p=>`<option value="${p.id}" ${p.id===state.projectId?'selected':''}>${esc(p.name)}</option>`).join('')}</select><button class="textbtn" data-action="new-project" aria-label="Add project" ${recording.active?'disabled':''}>${icon('plus')}</button></div><button class="local" data-action="storage"><i class="dot"></i>On this computer</button></header><div class="content">${state.page==='list'?renderList():renderForm()}</div><footer class="appfooter"><span>${state.page==='list'?'No account · your projects stay local':'Written feedback and original audio stay together'}</span><span>${state.page==='list'?state.total+' sessions in '+esc(project().name):'Microphone capture · original audio kept'}</span></footer></section>`;
  if(state.page==='list'){const all=$<HTMLInputElement>('#select-all');const n=state.rows.filter(s=>state.selected.has(s.id)).length;all.indeterminate=n>0&&n<state.rows.length;}else{savedStatus();updateMeter();}savedStatus();restorePropertyValidity();
}
function renderList() {
  return renderOverview({rows:state.rows,fields:state.fields,view:state.preferences,query:state.query,total:state.total,matching:state.matching,selected:state.selected,outside:state.selected.size-state.matchingSelected,draft:(sessionId,fieldId)=>propertyDrafts.get(propertyKey(sessionId,fieldId))?.raw});
}

function renderForm() {
  const s=current();
  return `<button class="back" data-action="back">${icon('back')}All sessions</button><div class="pagehead"><div><h1>${s.title==='Untitled session'?'New session':esc(s.title)}</h1><p>Fill in the answers as you talk.</p></div><button class="btn" data-action="export-one" ${recording.active?'disabled':''}>${icon('export')}Export</button></div><div class="form"><div class="fields"><label class="field">Session title<input data-session="title" value="${esc(s.title==='Untitled session'?'':s.title)}" maxlength="1000" placeholder="e.g. First experience with Moneo"></label><label class="field">Person<input data-session="person" value="${esc(s.person)}" maxlength="1000" placeholder="Name or alias"></label><label class="field">Date<input type="date" data-session="date" value="${esc(s.date)}" required></label></div>${renderProjectFields()}${renderAudio()}<div class="questionnaireline"><label class="field">Questionnaire<select id="questionnaire"><option value="" ${!s.questionnaireId?'selected':''}>Blank form</option>${state.groups.map(g=>`<option value="${g.id}" ${g.id===s.questionnaireId?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label><button class="textbtn" data-action="session-questions">Edit this session’s questions</button></div><div class="questions">${s.questions.map((q,i)=>`<label class="field"><span class="questionlabel"><span class="num">${String(i+1).padStart(2,'0')}</span>${esc(q.text)}</span><textarea data-answer="${q.id}" placeholder="Write their answer, a quote, or what you noticed…">${esc(q.answer)}</textarea></label>`).join('')||'<p class="hint">A blank session works with notes and audio alone. Add questions whenever you need them.</p>'}</div><details class="optional" ${s.notes||!s.questions.length?'open':''}><summary>${s.questions.length?'Additional notes':'Session notes'}</summary><label class="field"><textarea id="notes" aria-label="Additional notes" placeholder="Anything else worth keeping…">${esc(s.notes)}</textarea></label></details><div class="savebar"><span class="hint" id="save-status"></span><button class="btn primary" data-action="back">Done</button></div></div>`;
}
function renderAudio() {
  return `<section class="audio"><div class="audiohead"><div><h2>Audio</h2><p>Keep the original conversation with this session.</p></div><span class="chip">${recording.active?(recording.paused?'Paused':'Recording'):state.audio.length?state.audio.length+' file'+(state.audio.length===1?'':'s'):'Optional'}</span></div>${state.audio.filter(a=>a.status!=='recording').map(a=>`<div style="margin-top:13px"><div class="row between"><span class="filelabel">${esc(a.name)}${a.status==='recovered'?' · recovered after interruption':''}</span><span class="timer">${a.durationSecs!==null?clock(a.durationSecs):''}</span></div>${a.status==='failed'?'<p class="hint">This take could not be completed. Any original file has been retained.</p>':`<audio controls preload="none" src="${esc(convertFileSrc(a.path))}" aria-label="Play ${esc(a.name)}"></audio>`}</div>`).join('')}<div class="recordtools"><button class="btn ${!recording.active?'primary':''}" data-action="record">${icon('mic')}${recording.active?'Stop & keep':'Record'}</button>${recording.active?`<button class="btn" data-action="pause">${recording.paused?'Resume':'Pause'}</button><span class="timer" id="elapsed">${clock(recording.durationSecs)}</span><progress class="meter" id="meter" value="0" max="100" aria-label="Microphone input level"></progress>`:`<button class="btn" data-action="import">Import audio</button><select id="microphone" aria-label="Microphone"><option value="">Default microphone</option>${state.devices.map(d=>`<option value="${esc(d.id)}" ${d.id===state.deviceId?'selected':''}>${esc(d.name)}</option>`).join('')}</select>`}</div><p class="hint" style="margin-top:9px">Microphone only. Import a call recording if you need both sides of an online interview.</p></section>`;
}
function modal(title: string,subtitle: string,content: string) { const d=$<HTMLDialogElement>('#dialog');d.innerHTML=`<h2>${esc(title)}</h2><p class="subtitle">${esc(subtitle)}</p>${content}`;if(!d.open)d.showModal(); }
function closeModal(){ $<HTMLDialogElement>('#dialog').close(); }
function groupsModal(){modal('Questionnaires',`Reusable question groups for ${project().name}.`,state.groups.map(g=>`<div class="group"><div><h3>${esc(g.name)}</h3><p>${g.questions.length} question${g.questions.length===1?'':'s'}</p></div><button class="btn quiet" data-action="edit-group" data-id="${g.id}">Edit</button></div>`).join('')+`<div class="buttons"><button class="btn" data-action="close">Done</button><button class="btn primary" data-action="new-group">${icon('plus')}New questionnaire</button></div>`);}
function editQuestions(mode: 'project'|'session',id?: string){const old=state.groups.find(g=>g.id===id);editor={mode,group:mode==='session'?{id:uid(),projectId:state.projectId,name:current().questionnaireName,questions:structuredClone(current().questions)}:old?structuredClone(old):{id:uid(),projectId:state.projectId,name:'',questions:[{id:uid(),text:'',answer:''}]}};renderEditor();}
function renderEditor(){
  const e=editor!;
  modal(e.mode==='project'?'Edit questionnaire':'This session’s questions',e.mode==='project'?'Changes apply to future sessions. Existing answers stay unchanged.':'Changes apply only to this session. Existing answers are kept.',`<form id="questionform">${e.mode==='project'?`<label class="field">Group name<input id="group-name" value="${esc(e.group.name)}" maxlength="200" required placeholder="e.g. Follow-up"></label>`:''}${e.group.questions.map((q,i)=>`<div class="groupedit"><span class="num">${String(i+1).padStart(2,'0')}</span><input data-edit-question="${q.id}" value="${esc(q.text)}" aria-label="Question ${i+1}" required placeholder="Write a question…"><button type="button" data-action="remove-question" data-id="${q.id}" ${q.answer?'disabled title="Keep questions that have answers"':''} aria-label="Remove question ${i+1}">×</button></div>`).join('')}<button type="button" class="btn quiet" style="margin-top:13px" data-action="add-question">${icon('plus')}Add question</button><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">Save questions</button></div></form>`);
  $<HTMLFormElement>('#questionform').onsubmit=async ev=>{ev.preventDefault();const button=$<HTMLButtonElement>('#questionform button[type=submit]');button.disabled=true;try{if(e.mode==='project'){await invoke('save_questionnaire',{questionnaire:e.group});state.groups=await invoke('questionnaires',{projectId:state.projectId});groupsModal();}else{await flushAll();current().questions=structuredClone(e.group.questions);current().questionnaireName=current().questionnaireName.replace(/ · customized$/,'')+' · customized';changed();await flushAll();closeModal();render();}toast('Questions saved');}catch(error){failure(error);button.disabled=false;}};
}
async function showExport(ids: string[]){await flushAll();if(recording.active&&ids.includes(recording.sessionId!))throw Error('Stop recording before exporting this session.');exportState.ids=ids;exportState.preview=await Promise.all(ids.slice(0,8).map(sessionId=>invoke<Session>('get_session',{sessionId})));renderExport();}
function renderExport(){const x=exportState;modal(`Export ${x.ids.length} session${x.ids.length===1?'':'s'}`,`Only these sessions from ${project().name} will be included.`,`<div class="exportlist">${x.preview.map(s=>`<div><strong>${esc(s.title)}</strong> · ${esc(s.person||'No person entered')}</div>`).join('')}${x.ids.length>8?`<div>…and ${x.ids.length-8} more selected sessions</div>`:''}</div><div class="formats">${[{id:'md',name:'Markdown',help:'Written feedback for coding agents'},{id:'json',name:'JSON',help:'Structured questions and answers'},{id:'zip',name:'ZIP + audio',help:'Notes, JSON, and original files'}].map(f=>`<button class="format ${x.format===f.id?'active':''}" aria-pressed="${x.format===f.id}" data-action="format" data-format="${f.id}">${f.name}<small>${f.help}</small></button>`).join('')}</div><p class="hint">${x.format==='zip'?'Original recordings are copied into the ZIP unchanged.':'Audio files are bundled with ZIP exports only.'}</p><p class="hint" style="margin-top:10px">All project columns and values are included, even columns hidden from the table.</p><p class="hint" style="margin-top:10px">Give the written notes to Codex, Claude Code, or another tool. Your questions and answers are preserved as entered.</p><div class="buttons"><button class="btn" data-action="close">Cancel</button><button class="btn primary" data-action="download">${icon('export')}Choose location & export</button></div>`);}
async function doExport(){const format=exportState.format;const destination=await save({defaultPath:project().name.replace(/[<>:"/\\|?*]/g,'-')+'-'+exportState.ids.length+'-sessions.'+format,filters:[{name:format==='zip'?'ZIP archive':format==='md'?'Markdown':'JSON',extensions:[format]}]});if(!destination)return;const button=$<HTMLButtonElement>('[data-action=download]');button.textContent='Exporting…';const result=await invoke<{sessionCount:number}>('export_sessions',{projectId:state.projectId,sessionIds:exportState.ids,format,destination});closeModal();toast(`${result.sessionCount} session${result.sessionCount===1?'':'s'} exported`);}

function updateMeter(){const time=document.querySelector('#elapsed');if(time)time.textContent=clock(recording.durationSecs);const meter=document.querySelector<HTMLProgressElement>('#meter');if(meter)meter.value=recording.paused?0:Math.min(100,recording.level*100);}
async function stopRecording(){if(recordTimer)clearInterval(recordTimer);recordTimer=undefined;let error:unknown;try{await invoke('stop_recording');}catch(e){error=e;}recording={...recording,active:false,finished:false};await audio();render();if(error)throw error;toast('Recording saved');}
function pollRecording(){if(recordTimer)clearInterval(recordTimer);recordTimer=setInterval(async()=>{if(polling)return;polling=true;try{recording=await invoke('recording_status');updateMeter();if(recording.finished){const message=recording.error;await stopRecording();if(message)failure(message);}}catch(error){failure(error);}finally{polling=false;}},250);}

async function action(button: HTMLButtonElement){
  if(button.dataset.action?.startsWith('property-')){await propertyAction(button);return;}
  switch(button.dataset.action){
    case 'new': await flushAll();{const s=await invoke<Session>('create_session',{projectId:state.projectId,questionnaireId:state.groups[0]?.id??null,date:localDate()});await openSession(s.id);}break;
    case 'open': await openSession(button.dataset.id!);break;
    case 'back': if(recording.active)throw Error('Stop recording before leaving this session.');await flushAll();state.page='list';await list();render();break;
    case 'questionnaires':groupsModal();break;
    case 'new-group':editQuestions('project');break;
    case 'edit-group':editQuestions('project',button.dataset.id);break;
    case 'session-questions':editQuestions('session');break;
    case 'add-question':if(editor!.group.questions.length>=200)throw Error('A questionnaire can have up to 200 questions.');editor!.group.questions.push({id:uid(),text:'',answer:''});renderEditor();break;
    case 'remove-question':editor!.group.questions=editor!.group.questions.filter(q=>q.id!==button.dataset.id||q.answer.length>0);renderEditor();break;
    case 'close':closeModal();break;
    case 'clear':state.selected.clear();await selectionScope();render();break;
    case 'select-results':state.selected=new Set(await invoke<string[]>('overview_ids',{query:overviewQuery()}));await selectionScope();render();break;
    case 'more':await list(true);render();break;
    case 'export':await showExport(state.selected.size?[...state.selected]:await invoke<string[]>('overview_ids',{query:overviewQuery()}));break;
    case 'export-one':await showExport([current().id]);break;
    case 'format':exportState.format=button.dataset.format!;renderExport();break;
    case 'download':await doExport();break;
    case 'retry-save':await flushAll();clearError();toast('Saved');break;
    case 'dismiss':clearError();break;
    case 'import':{await flushAll();const paths=await open({multiple:true,directory:false,filters:[{name:'Audio',extensions:['wav','mp3','m4a','aac','ogg','flac','webm','mp4']}]});if(paths){button.textContent='Copying…';try{await invoke('import_audio',{sessionId:current().id,paths:Array.isArray(paths)?paths:[paths]});}finally{await audio();render();}toast('Audio copied into this session');}}break;
    case 'record':if(recording.active){await stopRecording();}else{await flushAll();try{recording=await invoke('start_recording',{sessionId:current().id,deviceId:state.deviceId||null});render();pollRecording();}catch(e){recording=await invoke('recording_status');if(recording.active)pollRecording();await audio();render();throw e;}}break;
    case 'pause':recording=await invoke('pause_recording',{paused:!recording.paused});render();break;
    case 'storage':modal('Local storage','Your research belongs to this computer.',`<p class="hint">Database and original recordings:</p><p class="hint" style="overflow-wrap:anywhere;margin-top:10px">${esc(state.dataDirectory)}</p><p class="hint" style="margin-top:15px">Export all sessions as ZIP to keep a portable copy of your notes, answers, and recordings somewhere separate. This version does not sync to a cloud service.</p><div class="buttons"><button class="btn" data-action="close">Done</button></div>`);break;
    case 'new-project':if(recording.active)throw Error('Stop recording before changing projects.');await flushAll();modal('New project','Its own sessions and reusable questionnaires.',`<form id="projectform"><label class="field">Project name<input id="project-name" required maxlength="200" placeholder="Project name"></label><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button type="submit" class="btn primary">Create project</button></div></form>`);$<HTMLFormElement>('#projectform').onsubmit=async ev=>{ev.preventDefault();const submit=$<HTMLButtonElement>('#projectform button[type=submit]');submit.disabled=true;try{const p=await invoke<Project>('create_project',{name:$<HTMLInputElement>('#project-name').value});state.projects.push(p);closeModal();await chooseProject(p.id);}catch(e){failure(e);submit.disabled=false;}};break;
  }
}

document.addEventListener('click',async ev=>{
  const b=(ev.target as Element).closest<HTMLButtonElement>('button[data-action]');if(!b||b.disabled||actionBusy)return;
  const original=b.innerHTML,skip=['record','pause','close','dismiss'].includes(b.dataset.action!);
  try{if(!skip)capturePropertyEditors();}catch(error){failure(error);return;}
  b.disabled=true;actionBusy=true;$('#app').inert=true;
  try{if(!skip)await flushAll();await action(b);}catch(error){failure(error);}finally{$('#app').inert=false;actionBusy=false;if(b.isConnected){b.disabled=false;b.innerHTML=original;}}
});

document.addEventListener('input',ev=>{
  const el=ev.target as HTMLInputElement;
  if(el.dataset.property){el.setCustomValidity('');propertyDrafts.set(propertyKey(el.dataset.propertySession!,el.dataset.property),{raw:el.value,bad:!el.checkValidity()});savedStatus();}
  else if(el.dataset.ruleValue!==undefined){const rule=filterDraft[Number(el.dataset.ruleValue)],field=sortFields(state.fields).find(f=>f.id===rule.field)!;rule.value=field.kind==='number'&&el.value!==''?Number(el.value):el.value;}
  else if(el.id==='search'){state.query=el.value;clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{try{await list();if(state.page!=='list')return;const input=$<HTMLInputElement>('#search'),start=input.selectionStart,focused=document.activeElement===input;render();if(focused){$<HTMLInputElement>('#search').focus();$<HTMLInputElement>('#search').setSelectionRange(start,start);}}catch(e){failure(e);}},150);}
  else if(el.dataset.session){const field=el.dataset.session as 'title'|'person'|'date';current()[field]=field==='title'&&!el.value.trim()?'Untitled session':el.value;changed();}
  else if(el.dataset.answer){current().questions.find(q=>q.id===el.dataset.answer)!.answer=el.value;changed();}
  else if(el.id==='notes'){current().notes=el.value;changed();}
  else if(el.id==='group-name'&&editor){editor.group.name=el.value;}
  else if(el.dataset.editQuestion&&editor){editor.group.questions.find(q=>q.id===el.dataset.editQuestion)!.text=el.value;}
});
document.addEventListener('change',async ev=>{
  const el=ev.target as HTMLInputElement;
  if(el.dataset.property){try{commitProperty(el);await propertySaves.flush();await refreshAfterProperties();}catch(error){failure(error);}return;}
  if(el.dataset.columnVisible){try{await flushAll();const hidden=state.preferences.hidden;state.preferences.hidden=el.checked?hidden.filter(id=>id!==el.dataset.columnVisible):[...new Set([...hidden,el.dataset.columnVisible])];rememberView();render();}catch(error){failure(error);}return;}
  if(el.dataset.ruleField!==undefined){const index=Number(el.dataset.ruleField),field=sortFields(state.fields).find(f=>f.id===el.value)!;filterDraft[index]={field:field.id,op:operators(field.kind)[0][0],value:null};filterModal();return;}
  if(el.dataset.ruleOp!==undefined){filterDraft[Number(el.dataset.ruleOp)].op=el.value;filterModal();return;}
  if(el.dataset.ruleValue!==undefined){const rule=filterDraft[Number(el.dataset.ruleValue)],field=sortFields(state.fields).find(f=>f.id===rule.field)!;rule.value=field.kind==='number'&&el.value!==''?Number(el.value):el.value;return;}
  const navigating=el.id==='project'||el.id==='questionnaire'||el.dataset.select!==undefined||el.id==='select-all';
  if(navigating){if(actionBusy){render();return;}try{capturePropertyEditors();}catch(error){failure(error);return;}actionBusy=true;$('#app').inert=true;}
  try{
    if(el.dataset.select){await flushAll();el.checked?state.selected.add(el.dataset.select):state.selected.delete(el.dataset.select);await selectionScope();render();}
    else if(el.id==='select-all'){await flushAll();for(const s of state.rows)el.checked?state.selected.add(s.id):state.selected.delete(s.id);await selectionScope();render();}
    else if(el.id==='project'){if(recording.active)throw Error('Stop recording before changing projects.');await chooseProject(el.value);}
    else if(el.id==='microphone'){state.deviceId=el.value;localStorage.setItem('microphone',el.value);}
    else if(el.id==='questionnaire'){await flushAll();const s=current();if(s.questions.some(q=>q.answer.trim())){toast('Answers are already entered. Edit this session’s questions to keep them, or start another session.');render();return;}const g=state.groups.find(g=>g.id===el.value);s.questionnaireId=g?.id??null;s.questionnaireName=g?.name??'Blank form';s.questions=(g?.questions??[]).map(q=>({...q,answer:''}));changed();await flushAll();render();}
  }catch(error){failure(error);render();}finally{if(navigating){actionBusy=false;$('#app').inert=false;}}
});
document.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&(ev.target as HTMLElement).dataset.property){ev.preventDefault();(ev.target as HTMLInputElement).blur();return;}if(!(ev.ctrlKey||ev.metaKey))return;if(ev.key.toLowerCase()==='s'){ev.preventDefault();flushAll().then(()=>toast('Saved')).catch(failure);}else if(ev.key.toLowerCase()==='f'&&state.page==='list'){ev.preventDefault();$<HTMLInputElement>('#search').focus();}});
window.addEventListener('blur',()=>{if(saves.dirty()||propertySaves.dirty())flushAll().catch(failure);});
document.addEventListener('focusout',event=>{if((event.target as HTMLElement).dataset.property)setTimeout(()=>refreshAfterProperties().catch(failure),0);});
// Keep a blur-triggered refresh from replacing the button between pointerdown and click.
document.addEventListener('pointerdown',()=>{pointerDown=true;},true);
const releasePointer=()=>{setTimeout(()=>{pointerDown=false;refreshAfterProperties().catch(failure);},0);};
window.addEventListener('pointerup',releasePointer);
window.addEventListener('pointercancel',releasePointer);

interface PropertyPatch {projectId:string;sessionId:string;fieldId:string;value:PropertyValue}
const propertyDrafts=new Map<string,{raw:string;bad:boolean}>();
const propertyKey=(sessionId:string,fieldId:string)=>sessionId+':'+fieldId;
let needsPropertyRefresh=false,filterDraft:Rule[]=[];
const propertySaves=createPropertyQueue(async(patch:PropertyPatch)=>{
  const normalized=await invoke<PropertyValue>('set_property',{...patch});
  const update=(values:Values)=>{if(Object.is(values[patch.fieldId]??null,patch.value)){if(normalized===null)delete values[patch.fieldId];else values[patch.fieldId]=normalized;}};
  if(state.session?.id===patch.sessionId)update(state.sessionValues);
  const cached=state.propertyCache.get(patch.sessionId);if(cached)update(cached);const row=state.rows.find(s=>s.id===patch.sessionId);if(row&&row.values!==cached)update(row.values);
},(status:string,error?:unknown)=>{state.propertySaveState=status;savedStatus();if(status==='error')failure(error);},100);

function overviewQuery(){return {projectId:state.projectId,search:state.query,sort:state.preferences.sort,filters:state.preferences.filters,offset:0};}
function rememberView(){localStorage.setItem('overview:'+state.projectId,JSON.stringify(state.preferences));}
function hasFilter(){return !!state.query||state.preferences.filters.length>0;}
async function selectionScope(){if(!state.selected.size){state.matchingSelected=0;return;}if(!hasFilter()){state.matchingSelected=state.selected.size;return;}const ids=await invoke<string[]>('overview_ids',{query:overviewQuery()});state.matchingSelected=ids.filter(id=>state.selected.has(id)).length;}
function propertyValuesFor(sessionId:string):Values {if(state.session?.id===sessionId&&state.page==='form')return state.sessionValues;const cached=state.propertyCache.get(sessionId);if(!cached)throw Error('Reopen this session before editing.');return cached;}
function commitProperty(el:HTMLInputElement|HTMLSelectElement){
  if(!el.checkValidity()){el.reportValidity();throw Error('Correct the highlighted project field, or clear it to leave it empty.');}
  const fieldId=el.dataset.property!,sessionId=el.dataset.propertySession!,field=state.fields.find(f=>f.id===fieldId);if(!field)throw Error('Column not found in this project.');
  const value:PropertyValue=el.value.trim()===''?null:field.kind==='number'?Number(el.value):el.value;
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('Enter a finite number or clear the field.');
  const values=propertyValuesFor(sessionId);propertyDrafts.delete(propertyKey(sessionId,fieldId));
  if(Object.is(values[fieldId]??null,value))return;
  if(value===null)delete values[fieldId];else values[fieldId]=value;
  propertySaves.enqueue(propertyKey(sessionId,fieldId),{projectId:state.projectId,sessionId,fieldId,value} satisfies PropertyPatch);needsPropertyRefresh=true;
}
function capturePropertyEditors(){
  const editors=[...document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-property]')];
  for(const el of editors){if(!el.checkValidity()){el.reportValidity();throw Error('Correct the highlighted project field, or clear it to leave it empty.');}}
  for(const el of editors)commitProperty(el);
}
function restorePropertyValidity(){for(const el of document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-property]')){if(propertyDrafts.get(propertyKey(el.dataset.propertySession!,el.dataset.property!))?.bad)el.setCustomValidity('Finish this value or clear it explicitly.');}}
async function flushAll(){capturePropertyEditors();await saves.flush();await propertySaves.flush();}
async function refreshAfterProperties(){if(!needsPropertyRefresh||state.page!=='list'||actionBusy||pointerDown||(document.activeElement as HTMLElement)?.dataset.property)return;await flushAll();if(actionBusy||pointerDown||state.page!=='list'||(document.activeElement as HTMLElement)?.dataset.property)return;needsPropertyRefresh=false;await list();if(actionBusy||pointerDown||state.page!=='list'||(document.activeElement as HTMLElement)?.dataset.property){needsPropertyRefresh=true;return;}render();}
function renderProjectFields(){return `<section class="project-fields"><div class="row between"><h2>Project fields</h2><span class="hint">All optional</span></div><p class="hint" style="margin-top:6px">The same values appear in this project's table.</p><div class="project-field-grid">${state.fields.map(f=>`<label class="field">${esc(f.name)}${propertyControl(f,state.sessionValues,current().id,propertyDrafts.get(propertyKey(current().id,f.id))?.raw,true)}</label>`).join('')||'<p class="hint">Add a project column to track details such as email or excitement.</p>'}</div><button class="textbtn" style="margin-top:13px" data-action="property-add">+ Add a project column</button></section>`;}

function addColumnModal(preset?:string){
  const seed=preset==='email'?{name:'Email',kind:'email',options:''}:preset==='excitement'?{name:'Excitement',kind:'select',options:'Low, Medium, High'}:{name:'',kind:'text',options:''};
  modal('Add a project column',`Optional in every existing and future session in ${project().name}.`,`<div class="property-presets"><span class="hint">Quick start</span><button class="btn quiet" data-action="property-preset" data-preset="email">Email</button><button class="btn quiet" data-action="property-preset" data-preset="excitement">Excitement</button></div><form id="columnform"><label class="field">Column name<input id="column-name" maxlength="80" required value="${esc(seed.name)}" placeholder="e.g. Company, Email, Excitement"></label><label class="field">Type<select id="column-kind">${Object.entries(fieldKinds).map(([kind,name])=>`<option value="${kind}" ${kind===seed.kind?'selected':''}>${name}</option>`).join('')}</select></label><label class="field" id="column-options-field" ${seed.kind==='select'?'':'hidden'}>Options, in sort order<input id="column-options" value="${esc(seed.options)}" placeholder="Low, Medium, High"></label><p class="hint" style="margin-top:13px">Existing sessions start empty. Questions, answers, notes, and recordings stay as they are.</p><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button type="submit" class="btn primary">Add column</button></div></form>`);
  $<HTMLSelectElement>('#column-kind').onchange=()=>{$('#column-options-field').hidden=$<HTMLSelectElement>('#column-kind').value!=='select';};
  $<HTMLFormElement>('#columnform').onsubmit=async event=>{event.preventDefault();const form=$<HTMLFormElement>('#columnform');form.inert=true;try{
    await flushAll();const kind=$<HTMLSelectElement>('#column-kind').value as ProjectField['kind'];
    await invoke('save_project_field',{field:{id:uid(),projectId:state.projectId,name:$<HTMLInputElement>('#column-name').value,kind,options:kind==='select'?$<HTMLInputElement>('#column-options').value.split(',').map(v=>v.trim()).filter(Boolean):[]}});
    state.fields=await invoke('project_fields',{projectId:state.projectId});if(state.page==='list')await list();closeModal();render();toast('Column added. Every session can leave it empty.');
  }catch(error){failure(error);form.inert=false;}};
}

function columnsModal(){modal('Project columns','Hiding changes this overview. Values stay in sessions and exports.',state.fields.map(f=>`<div class="property-manager-row"><input type="checkbox" data-column-visible="${f.id}" ${state.preferences.hidden.includes(f.id)?'':'checked'} aria-label="Show ${esc(f.name)}"><div><h3>${esc(f.name)}</h3><p class="hint">${fieldKinds[f.kind]} · optional in every session</p></div><button class="btn quiet" style="margin-left:auto" data-action="property-rename" data-id="${f.id}">Rename</button></div>`).join('')+`<div class="buttons"><button class="btn" data-action="close">Done</button><button class="btn primary" data-action="property-add">+ Add column</button></div>`);}
function renameColumnModal(id:string){const field=state.fields.find(f=>f.id===id)!;modal('Rename column','Its values stay attached to the same field.',`<form id="rename-column-form"><label class="field">Column name<input id="rename-column" maxlength="80" required value="${esc(field.name)}"></label><p class="hint" style="margin-top:13px">Type: ${fieldKinds[field.kind]}. Types and options stay fixed after creation to protect existing values.</p><div class="buttons"><button type="button" class="btn" data-action="property-columns">Back</button><button class="btn primary" type="submit">Rename</button></div></form>`);$<HTMLFormElement>('#rename-column-form').onsubmit=async event=>{event.preventDefault();const form=$<HTMLFormElement>('#rename-column-form');form.inert=true;try{await invoke('save_project_field',{field:{...field,name:$<HTMLInputElement>('#rename-column').value}});state.fields=await invoke('project_fields',{projectId:state.projectId});if(state.page==='list')await list();render();columnsModal();toast('Column renamed; values preserved.');}catch(error){failure(error);form.inert=false;}};}

function newFilter():Rule{const field=state.fields.find(f=>f.name.toLowerCase()==='excitement')??state.fields[0]??sortFields(state.fields)[1];return {field:field.id,op:operators(field.kind)[0][0],value:field.kind==='select'?field.options.at(-1)??null:null};}
function filterModal(fresh=false){
  if(fresh)filterDraft=structuredClone(state.preferences.filters.length?state.preferences.filters:[newFilter()]);
  const fields=sortFields(state.fields);
  modal('Filter sessions','Match all rules below. This searches the whole project, across all pages.',`<form id="property-filter-form">${filterDraft.map((rule,index)=>{const field=fields.find(f=>f.id===rule.field)!;return `<div class="property-filter-row"><div class="row"><select data-rule-field="${index}" aria-label="Filter field ${index+1}">${fields.map(f=>`<option value="${f.id}" ${f.id===rule.field?'selected':''}>${esc(f.name)}</option>`).join('')}</select><button type="button" class="btn quiet" data-action="property-delete-rule" data-index="${index}" aria-label="Remove filter ${index+1}">×</button></div><select data-rule-op="${index}" aria-label="Filter operator ${index+1}">${operators(field.kind).map(([op,name])=>`<option value="${op}" ${op===rule.op?'selected':''}>${name}</option>`).join('')}</select>${rule.op==='empty'||rule.op==='filled'?'':field.kind==='select'?`<select data-rule-value="${index}" aria-label="Filter value ${index+1}" required><option value="">Choose value</option>${field.options.map(value=>`<option value="${esc(value)}" ${value===rule.value?'selected':''}>${esc(value)}</option>`).join('')}</select>`:`<input data-rule-value="${index}" type="${field.kind==='number'?'number':field.kind==='date'?'date':'text'}" ${field.kind==='number'?'step="any"':''} aria-label="Filter value ${index+1}" value="${esc(rule.value??'')}" maxlength="10000" required placeholder="Value">`}</div>`;}).join('')}<button class="btn quiet" type="button" style="margin-top:12px" data-action="property-add-rule">+ Add rule</button><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">Apply filters</button></div></form>`);
  $<HTMLFormElement>('#property-filter-form').onsubmit=async event=>{event.preventDefault();const form=$<HTMLFormElement>('#property-filter-form');form.inert=true;const previous=state.preferences.filters;try{state.preferences.filters=structuredClone(filterDraft);await list();rememberView();closeModal();render();}catch(error){state.preferences.filters=previous;failure(error);form.inert=false;}};
}
function sortModal(){modal('Sort sessions','Empty values stay at the bottom in either direction.',`<form id="property-sort-form"><label class="field">Sort by<select id="property-sort-key">${sortFields(state.fields).map(f=>`<option value="${f.id}" ${f.id===state.preferences.sort.key?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label><label class="field">Direction<select id="property-sort-direction"><option value="asc" ${state.preferences.sort.direction==='asc'?'selected':''}>Ascending · A → Z / low → high / oldest first</option><option value="desc" ${state.preferences.sort.direction==='desc'?'selected':''}>Descending · Z → A / high → low / newest first</option></select></label><p class="hint" style="margin-top:12px">Select columns follow the option order you gave them. Column headers also sort directly.</p><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">Apply sort</button></div></form>`);$<HTMLFormElement>('#property-sort-form').onsubmit=async event=>{event.preventDefault();const form=$<HTMLFormElement>('#property-sort-form');form.inert=true;try{state.preferences.sort={key:$<HTMLSelectElement>('#property-sort-key').value,direction:$<HTMLSelectElement>('#property-sort-direction').value as 'asc'|'desc'};await list();rememberView();closeModal();render();}catch(error){failure(error);form.inert=false;}};}

async function propertyAction(button:HTMLButtonElement){switch(button.dataset.action){
  case 'property-view':state.preferences.mode=button.dataset.mode as View['mode'];rememberView();await list();render();break;
  case 'property-add':addColumnModal();break;
  case 'property-preset':addColumnModal(button.dataset.preset);break;
  case 'property-columns':columnsModal();break;
  case 'property-rename':renameColumnModal(button.dataset.id!);break;
  case 'property-filter':filterModal(true);break;
  case 'property-sort':sortModal();break;
  case 'property-sort-header':state.preferences.sort={key:button.dataset.key!,direction:state.preferences.sort.key===button.dataset.key&&state.preferences.sort.direction==='asc'?'desc':'asc'};await list();rememberView();render();break;
  case 'property-remove-filter':state.preferences.filters.splice(Number(button.dataset.index),1);await list();rememberView();render();break;
  case 'property-reset':state.preferences.filters=[];state.query='';await list();rememberView();render();break;
  case 'property-add-rule':if(filterDraft.length>=20)throw Error('Use up to 20 filter rules.');filterDraft.push(newFilter());filterModal();break;
  case 'property-delete-rule':filterDraft.splice(Number(button.dataset.index),1);filterModal();break;
}}

async function boot(){
  try{
    const info=await invoke<{dataDirectory:string;recoveredRecordings:number}>('app_info');state.dataDirectory=info.dataDirectory;
    state.projects=await invoke('projects');const previous=localStorage.getItem('project');await chooseProject(state.projects.find(p=>p.id===previous)?.id??state.projects[0].id);
    if(info.recoveredRecordings)toast(`${info.recoveredRecordings} interrupted recordings recovered`);
    let closing=false;
    await getCurrentWindow().onCloseRequested(async ev=>{if(closing)return;ev.preventDefault();try{capturePropertyEditors();$('#app').inert=true;await flushAll();if(recording.active)await stopRecording();closing=true;await getCurrentWindow().destroy();}catch(error){$('#app').inert=false;failure(error);}});
  }catch(error){failure(error);$('#app').innerHTML='<div class="loading">Research could not open local storage. Your existing files have not been deleted. Close and reopen the app after checking the error above.</div>';}
}
void boot();
