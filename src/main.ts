import './style.css';
import './overview.css';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { createSaveQueue } from './save-queue.mjs';
import { createPropertyQueue } from './property-queue.mjs';
import { agentIcons, esc, icon, logo } from './html';
import { fieldKinds, operators, sortFields, readView, defaultView, type ProjectField, type PropertyValue, type Values, type Rule, type View } from './property-ui';
import { renderOverview, propertyControl } from './overview-ui';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { installBlockReason, downloadPercent } from './update-policy.mjs';
import { barHeight, createVoiceActivity } from './recording-meter.mjs';

interface Question { id: string; text: string; answer: string }
interface Project { id: string; name: string }
interface Group { id: string; projectId: string; name: string; questions: Question[] }
interface Session { id: string; projectId: string; title: string; person: string; date: string; questionnaireId: string|null; questionnaireName: string; questions: Question[]; notes: string }
interface Summary { id: string; title: string; person: string; date: string; questionnaireName: string; audioCount: number; values: Values }
interface Audio { id: string; name: string; path: string; byteLength: number; durationSecs: number|null; status: string }
interface Attachment { id:string; name:string; path:string; byteLength:number; caption:string }
interface Device { id: string; name: string }
interface Recording { active: boolean; finished: boolean; paused: boolean; sessionId: string|null; durationSecs: number; level: number; error: string|null }
interface Page { sessions: Summary[]; total: number; matching: number }

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const uid = () => crypto.randomUUID();
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const clock = (seconds: number) => { const n = Math.floor(seconds); return `${n >= 3600 ? Math.floor(n/3600)+':' : ''}${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; };
const initials = (name: string) => (name || '?').split(' ').slice(0,2).map(s=>s[0]).join('');
const state = { projects: [] as Project[], projectId: '', groups: [] as Group[], rows: [] as Summary[], total: 0, matching: 0, query: '', selected: new Set<string>(), page: 'list', session: null as Session|null, audio: [] as Audio[], attachments: [] as Attachment[], devices: [] as Device[], deviceId: localStorage.getItem('microphone') || '', dataDirectory: '', saveState: 'saved', propertySaveState: 'saved', fields: [] as ProjectField[], sessionValues: {} as Values, preferences: defaultView(), matchingSelected: 0, propertyCache: new Map<string,Values>() };
let recording: Recording = { active:false, finished:false, paused:false, sessionId:null, durationSecs:0, level:0, error:null };
let exportState = { ids: [] as string[], allIds: [] as string[], oneId: '', format: 'zip', preview: [] as Session[], filesOpen: false };
interface Handoff { folder: string; newCount: number; editedCount: number; unchangedCount: number; prompt: string }
let editor: { mode: 'project'|'session'; group: Group }|null = null;
let toastTimer: ReturnType<typeof setTimeout>, searchTimer: ReturnType<typeof setTimeout>, recordTimer: ReturnType<typeof setInterval>|undefined, searchRevision = 0, polling = false, actionBusy = false, pointerDown = false;
const project = () => state.projects.find(p=>p.id===state.projectId)!;
const current = () => { if (!state.session) throw Error('Open a session first.'); return state.session; };

function toast(message: string) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,4500); }
function failure(error: unknown) { const el=$('#error'); el.hidden=false; el.innerHTML=`<span>${esc(error instanceof Error ? error.message : error)}</span><button class="btn quiet" data-action="${(state.saveState==='error'||state.propertySaveState==='error')?'retry-save':'dismiss'}">${(state.saveState==='error'||state.propertySaveState==='error')?'Retry save':'Dismiss'}</button>`; }
function clearError() { $('#error').hidden=true; }
function savedStatus() {
  const states=[state.saveState,state.propertySaveState,captionSaveState,...(propertyDrafts.size?['pending']:[])],status=states.includes('error')?'error':states.includes('saving')?'saving':states.includes('pending')?'pending':'saved';
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
async function createProject(name: string) {
  const p=await invoke<Project>('create_project',{name});state.projects.push(p);closeModal();await chooseProject(p.id);
}
async function audio() { state.audio=await invoke('session_audio',{sessionId:current().id}); }
async function openSession(id: string) {
  await flushAll();state.session=await invoke('get_session',{sessionId:id});state.sessionValues=await invoke('property_values',{sessionId:id});state.propertyCache.set(id,state.sessionValues);await audio();await attachments();state.page='form';
  try{state.devices=await invoke('input_devices');}catch{state.devices=[];}render();
}

function render() {
  if(state.page==='start'){renderStart();return;}
  $('#app').innerHTML=`<section class="surface"><header class="topbar"><div class="projectbox"><div class="brand">${logo()}Fieldnote</div><span class="divider"></span><select id="project" aria-label="Project" ${recording.active?'disabled':''}>${state.projects.map(p=>`<option value="${p.id}" ${p.id===state.projectId?'selected':''}>${esc(p.name)}</option>`).join('')}</select><button class="textbtn" data-action="new-project" aria-label="Add project" ${recording.active?'disabled':''}>${icon('plus')}</button></div><button class="local" data-action="storage"><i class="dot"></i>On this computer</button></header><div class="content">${state.page==='list'?renderList():renderForm()}</div><footer class="appfooter"><span>No account needed · everything stays on this computer</span><span class="updatebox">${updateControl()}</span></footer></section>`;
  if(state.page==='list'){const all=document.querySelector<HTMLInputElement>('#select-all'),n=state.rows.filter(s=>state.selected.has(s.id)).length;if(all)all.indeterminate=n>0&&n<state.rows.length;}else{savedStatus();updateMeter();}savedStatus();restorePropertyValidity();
}
function renderStart() {
  const last=localStorage.getItem('project'),projects=[...state.projects].sort((a,b)=>Number(b.id===last)-Number(a.id===last));
  $('#app').innerHTML=`<section class="surface"><div class="content startscreen"><div class="startcard"><div class="brand">${logo()}Fieldnote</div><h1>Which project are you working on?</h1><p>Sessions, questionnaires, and columns stay separate for each project.</p>${projects.length?`<div class="startlist">${projects.map(p=>`<button class="startproject" data-action="start-project" data-id="${p.id}"><span>${esc(p.name)}</span>${p.id===last?'<span class="hint">Last used</span>':''}</button>`).join('')}</div>`:''}<form id="startform"><label class="field">${projects.length?'Or start a new project':'Project name'}<input id="start-project-name" required maxlength="200" placeholder="e.g. Onboarding interviews"></label><button class="btn primary" type="submit">${icon('plus')}Create project</button></form></div></div><footer class="appfooter"><span>No account needed · everything stays on this computer</span><span class="updatebox">${updateControl()}</span></footer></section>`;
  const form=$<HTMLFormElement>('#startform');
  form.onsubmit=async ev=>{ev.preventDefault();form.inert=true;try{await createProject($<HTMLInputElement>('#start-project-name').value);}catch(error){failure(error);form.inert=false;}};
  if(!projects.length)$<HTMLInputElement>('#start-project-name').focus();
}
function renderList() {
  return renderOverview({rows:state.rows,fields:state.fields,view:state.preferences,query:state.query,total:state.total,matching:state.matching,selected:state.selected,outside:state.selected.size-state.matchingSelected,draft:(sessionId,fieldId)=>propertyDrafts.get(propertyKey(sessionId,fieldId))?.raw});
}

function renderForm() {
  const s=current();
  return `<button class="back" data-action="back">${icon('back')}All sessions</button><div class="pagehead"><div><h1>${s.title==='Untitled session'?'New session':esc(s.title)}</h1><p>Fill in the answers as you talk.</p></div><button class="btn" data-action="export-one" ${recording.active?'disabled':''}>${icon('export')}Export${agentIcons()}</button></div><div class="form"><div class="fields"><label class="field">Session title<input data-session="title" value="${esc(s.title==='Untitled session'?'':s.title)}" maxlength="1000" placeholder="e.g. Call with Alex"></label><label class="field">Person<input data-session="person" value="${esc(s.person)}" maxlength="1000" placeholder="Who did you talk to?"></label><label class="field">Date<input type="date" data-session="date" value="${esc(s.date)}" required></label></div>${renderProjectFields()}${renderAudio()}${renderAttachments()}<div class="questionnaireline"><label class="field">Questionnaire<select id="questionnaire"><option value="" ${!s.questionnaireId?'selected':''}>Blank form</option>${state.groups.map(g=>`<option value="${g.id}" ${g.id===s.questionnaireId?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label><button class="textbtn" data-action="session-questions">Edit this session’s questions</button></div><div class="questions">${s.questions.map((q,i)=>`<label class="field"><span class="questionlabel"><span class="num">${String(i+1).padStart(2,'0')}</span>${esc(q.text)}</span><textarea data-answer="${q.id}" placeholder="Write their answer, a quote, or what you noticed…">${esc(q.answer)}</textarea></label>`).join('')||'<p class="hint">A blank session works with notes and audio alone. Add questions whenever you need them.</p>'}</div><details class="optional" ${s.notes||!s.questions.length?'open':''}><summary>${s.questions.length?'Additional notes':'Session notes'}</summary><label class="field"><textarea id="notes" aria-label="Additional notes" placeholder="Anything else worth keeping…">${esc(s.notes)}</textarea></label></details><div class="savebar"><span class="hint" id="save-status"></span><button class="btn primary" data-action="back">Done</button></div></div>`;
}
async function attachments() { state.attachments=await invoke('session_attachments',{sessionId:current().id}); }
function renderAttachments() {
  return `<section class="audio" id="attachments-panel"><div class="audiohead"><h2>Attachments</h2><button class="btn" data-action="attach">Add files</button></div><p class="hint">Drop any files here or paste a screenshot. Videos and screen recordings are welcome. Audio keeps recording while you add files.</p><div class="attachment-grid">${state.attachments.map(a=>{
    const ext=a.path.split('.').pop()?.toLowerCase()||'';
    const url=esc(convertFileSrc(a.path));
    const preview=['png','jpg','jpeg','gif','webp','bmp','avif'].includes(ext)?`<img src="${url}" alt="${esc(a.caption||a.name)}" loading="lazy">`:['mp4','webm','mov','m4v','ogv'].includes(ext)?`<video controls preload="metadata" src="${url}" aria-label="${esc(a.name)}"></video>`:'';
    return `<div class="attachment">${preview}<p class="filelabel">${esc(a.name)} ? ${Math.ceil(a.byteLength/1024)} KB</p><label class="field">Caption (optional)<textarea data-caption="${a.id}" maxlength="100000" placeholder="What should we notice?">${esc(a.caption)}</textarea></label><button class="textbtn" data-action="remove-attachment" data-id="${a.id}">Remove</button></div>`;
  }).join('')}</div></section>`;
}
function refreshAttachments() { const panel=document.querySelector('#attachments-panel'); if(panel)panel.outerHTML=renderAttachments(); }
let attachmentBusy=false;
async function addAttachments(paths?:string[], files?:File[]) {
  if(state.page!=='form'||attachmentBusy||actionBusy)return;
  attachmentBusy=true;
  const sessionId=current().id;
  try {
    if(paths?.length)await invoke('import_attachments',{sessionId,paths});
    for(const file of files||[])await invoke('paste_attachment',{sessionId,name:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});
    if(state.session?.id===sessionId){await attachments();refreshAttachments();}
    toast('Files added to session');
  } catch(error){if(state.session?.id===sessionId){await attachments();refreshAttachments();}failure(error);} finally{attachmentBusy=false;}
}
document.addEventListener('paste',ev=>{
  if(state.page!=='form'||!ev.clipboardData?.files.length)return;
  ev.preventDefault();void addAttachments(undefined,Array.from(ev.clipboardData.files));
});
// WebView file drops use native paths, avoiding loading large videos into JavaScript.
getCurrentWindow().onDragDropEvent(event=>{
  if(event.payload.type==='drop')void addAttachments(event.payload.paths);
}).catch(failure);
const captionQueues=new Map<string,ReturnType<typeof createSaveQueue>>();
let captionSaveState='saved';
async function flushCaptions(){for(const queue of captionQueues.values())await queue.flush();}
document.addEventListener('input',ev=>{
  const el=ev.target as HTMLTextAreaElement;
  const attachmentId=el.dataset.caption;if(!attachmentId)return;
  const sessionId=current().id;
  let queue=captionQueues.get(attachmentId);
  if(!queue){queue=createSaveQueue(async(caption:string)=>{await invoke('edit_attachment',{sessionId,attachmentId,caption});},(status:string,error?:unknown)=>{captionSaveState=status;savedStatus();if(error)failure(error);});captionQueues.set(attachmentId,queue);}
  const a=state.attachments.find(a=>a.id===attachmentId);if(a)a.caption=el.value;
  queue.enqueue(el.value);
});
const audioKinds={speaking:['Someone is speaking','Your voice is being recorded.'],waiting:['Listening…','Recording. Start talking whenever you are ready.'],'no-sound':['No sound from your microphone','Check that it isn’t muted. You can stop and choose another microphone.'],paused:['Paused','Nothing is being recorded right now.']};
function takeName(a: Audio,index: number) { return /^Recording-[0-9a-f]{8}\.wav$/.test(a.name)?`Recording ${index+1}`:a.name; }
function renderTake(a: Audio,index: number) {
  const empty=a.status!=='failed'&&a.byteLength<=44,note=a.status==='failed'?'This recording could not be finished.':empty?'No sound was captured in this recording.':a.status==='recovered'?'Saved after the app closed unexpectedly.':'',playable=a.status!=='failed'&&!empty;
  return `<div class="take"><div class="row between"><span class="takename">${esc(takeName(a,index))}</span>${playable&&a.durationSecs!==null?`<span class="timer">${clock(a.durationSecs)}</span>`:''}</div>${note?`<p class="hint">${note}</p>`:''}${playable?`<audio controls preload="metadata" src="${esc(convertFileSrc(a.path))}" aria-label="Play ${esc(takeName(a,index))}"></audio>`:''}</div>`;
}
function renderAudio() {
  const takes=state.audio.filter(a=>a.status!=='recording');
  return `<section class="audio" id="audio-panel"><div class="audiohead"><h2>Audio</h2>${!recording.active&&takes.length?`<span class="chip">${takes.length} recording${takes.length===1?'':'s'}</span>`:''}</div>${takes.map(renderTake).join('')}${recording.active?renderLiveRecording():renderRecordTools()}</section>`;
}
function renderRecordTools() {
  return `<div class="recordtools"><button class="btn primary" data-action="record">${icon('mic')}Record</button><button class="btn" data-action="import">Import audio</button><select id="microphone" aria-label="Microphone"><option value="">Default microphone</option>${state.devices.map(d=>`<option value="${esc(d.id)}" ${d.id===state.deviceId?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div><p class="hint" style="margin-top:9px">On an online call? This records your microphone only, so import the call’s recording to keep both sides.</p>`;
}
function renderLiveRecording() {
  return `<div class="live"><div class="livehead"><span class="recdot"></span><strong id="live-state"></strong><span class="livetimer" id="elapsed">${clock(recording.durationSecs)}</span></div><div class="voicewave" id="voice-wave" aria-hidden="true">${'<i></i>'.repeat(WAVE_BARS)}</div><p class="hint" id="live-hint" role="status"></p><div class="recordtools"><button class="btn stoprec" data-action="record">${icon('stop')}Stop and save</button><button class="btn" data-action="pause">${recording.paused?'Resume':'Pause'}</button></div></div>`;
}
function modal(title: string,subtitle: string,content: string) { const d=$<HTMLDialogElement>('#dialog');d.innerHTML=`<h2>${esc(title)}</h2><p class="subtitle">${esc(subtitle)}</p>${content}`;if(!d.open)d.showModal(); }
function closeModal(){ $<HTMLDialogElement>('#dialog').close(); }

let appVersion = '';
let availableUpdate: Update|null = null;
let updateBusy = false;
let updateProgress: number|null = null;
function updateControl() {
  if (updateProgress !== null) return `Installing update… ${updateProgress}%`;
  const version = `v${esc(appVersion)}`;
  return availableUpdate
    ? `${version} · <button class="textbtn" data-action="install-update">Install ${esc(availableUpdate.version)}</button>`
    : `${version} · <button class="textbtn" data-action="check-updates">Check for updates</button>`;
}
// Updates only the footer control so background checks never rebuild the page under the user's typing.
function setUpdateControl() { const el=document.querySelector('.updatebox'); if(el) el.innerHTML=updateControl(); }
async function checkForUpdates(manual: boolean) {
  if (updateBusy || updateProgress !== null) return;
  updateBusy = true;
  try {
    const update = await check();
    if (update) {
      availableUpdate = update;
      setUpdateControl();
      if (manual) openInstallModal(update);
      else toast(`Version ${update.version} is available. Install it from the footer.`);
    } else if (manual) toast('You have the latest version.');
  } catch (error) {
    if (manual) failure(error);
  } finally {
    updateBusy = false;
  }
}
function currentInstallBlock() {
  return installBlockReason({ recordingActive: recording.active, saveState: state.saveState, propertySaveState: state.propertySaveState });
}
function openInstallModal(update: Update) {
  const reason = currentInstallBlock();
  modal(`Install version ${update.version}`, `You are on version ${appVersion}. Sessions, answers, questionnaires, and recordings stay in the same data folder.`,
    `${update.body ? `<div class="exportlist">${esc(update.body)}</div>` : ''}${reason ? `<p class="hint save-error">${esc(reason)}</p>` : ''}<div class="buttons"><button class="btn" data-action="close">Later</button><button class="btn primary" data-action="confirm-install" ${reason ? 'disabled' : ''}>Download and restart</button></div>`);
}
async function installUpdate() {
  const update = availableUpdate;
  if (!update || updateBusy) return;
  const reason = currentInstallBlock();
  if (reason) throw Error(reason);
  updateBusy = true;
  let downloaded = 0, total = 0;
  closeModal();
  updateProgress = 0;
  setUpdateControl();
  try {
    await update.downloadAndInstall(event => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0;
      else if (event.event === 'Progress') { downloaded += event.data.chunkLength; updateProgress = downloadPercent(downloaded, total) ?? 0; setUpdateControl(); }
    });
    await relaunch();
  } catch (error) {
    updateProgress = null;
    updateBusy = false;
    setUpdateControl();
    throw error;
  }
}
function groupsModal(){modal('Questionnaires',`Reusable question groups for ${project().name}.`,state.groups.map(g=>`<div class="group"><div><h3>${esc(g.name)}</h3><p>${g.questions.length} question${g.questions.length===1?'':'s'}</p></div><button class="btn quiet" data-action="edit-group" data-id="${g.id}">Edit</button></div>`).join('')+`<div class="buttons"><button class="btn" data-action="close">Done</button><button class="btn primary" data-action="new-group">${icon('plus')}New questionnaire</button></div>`);}
function editQuestions(mode: 'project'|'session',id?: string){const old=state.groups.find(g=>g.id===id);editor={mode,group:mode==='session'?{id:uid(),projectId:state.projectId,name:current().questionnaireName,questions:structuredClone(current().questions)}:old?structuredClone(old):{id:uid(),projectId:state.projectId,name:'',questions:[{id:uid(),text:'',answer:''}]}};renderEditor();}
function renderEditor(){
  const e=editor!;
  modal(e.mode==='project'?'Edit questionnaire':'This session’s questions',e.mode==='project'?'Changes apply to future sessions. Existing answers stay unchanged.':'Changes apply only to this session. Existing answers are kept.',`<form id="questionform">${e.mode==='project'?`<label class="field">Group name<input id="group-name" value="${esc(e.group.name)}" maxlength="200" required placeholder="e.g. Follow-up"></label>`:''}${e.group.questions.map((q,i)=>`<div class="groupedit"><span class="num">${String(i+1).padStart(2,'0')}</span><input data-edit-question="${q.id}" value="${esc(q.text)}" aria-label="Question ${i+1}" required placeholder="Write a question…"><button type="button" data-action="remove-question" data-id="${q.id}" ${q.answer?'disabled title="Keep questions that have answers"':''} aria-label="Remove question ${i+1}">×</button></div>`).join('')}<button type="button" class="btn quiet" style="margin-top:13px" data-action="add-question">${icon('plus')}Add question</button><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">Save questions</button></div></form>`);
  $<HTMLFormElement>('#questionform').onsubmit=async ev=>{ev.preventDefault();const button=$<HTMLButtonElement>('#questionform button[type=submit]');button.disabled=true;try{if(e.mode==='project'){await invoke('save_questionnaire',{questionnaire:e.group});state.groups=await invoke('questionnaires',{projectId:state.projectId});groupsModal();}else{await flushAll();current().questions=structuredClone(e.group.questions);current().questionnaireName=current().questionnaireName.replace(/ · customized$/,'')+' · customized';changed();await flushAll();closeModal();render();}toast('Questions saved');}catch(error){failure(error);button.disabled=false;}};
}
async function showExport(ids: string[],oneId=''){await flushAll();if(recording.active&&ids.includes(recording.sessionId!))throw Error('Stop recording before exporting this session.');exportState.ids=ids;exportState.allIds=ids;exportState.oneId=oneId;exportState.filesOpen=false;await loadExportPreview();renderExport();}
async function loadExportPreview(){exportState.preview=await Promise.all(exportState.ids.slice(0,8).map(sessionId=>invoke<Session>('get_session',{sessionId})));}
async function exportFinished(){state.selected.clear();await selectionScope();if(state.page==='list')render();}
function renderExport(){
  const x=exportState,folder=agentFolder();
  modal(`Export ${x.ids.length} session${x.ids.length===1?'':'s'}`,`Only these sessions from ${project().name} will be included.`,`${x.oneId&&x.allIds.length>1?`<div class="exportscope"><button class="format ${x.ids.length>1?'active':''}" aria-pressed="${x.ids.length>1}" data-action="export-scope" data-scope="all">All sessions (${x.allIds.length})</button><button class="format ${x.ids.length===1?'active':''}" aria-pressed="${x.ids.length===1}" data-action="export-scope" data-scope="one">Only this session</button></div>`:''}<div class="exportlist">${x.preview.map(s=>`<div><strong>${esc(s.title)}</strong> · ${esc(s.person||'No person entered')}</div>`).join('')}${x.ids.length>8?`<div>…and ${x.ids.length-8} more sessions</div>`:''}</div>${!x.oneId&&x.ids.length>1&&!state.selected.size&&!hasFilter()?'<p class="hint" style="margin:-6px 0 14px">To send only a few, tick them in the list first.</p>':''}<section class="agentsend"><h3>${agentIcons()}For Claude Code or Codex</h3><p class="hint">Keeps a folder in your project up to date with your notes, recordings, and attachments, then gives you one message to paste.</p>${folder?`<div class="agentfolder"><span title="${esc(folder)}">${esc(folder)}</span><button class="textbtn" data-action="agent-folder">Change</button></div>`:''}<button class="btn primary" data-action="agent-prepare">${folder?'Update folder':'Choose your project folder'}</button></section><details class="optional savefile" ${x.filesOpen?'open':''}><summary>Or save a single file</summary><div class="formats">${[{id:'md',name:'Markdown',help:'Notes and answers as text'},{id:'json',name:'JSON',help:'Answers as structured data'},{id:'zip',name:'ZIP + files',help:'Everything, with recordings and attachments'}].map(f=>`<button class="format ${x.format===f.id?'active':''}" aria-pressed="${x.format===f.id}" data-action="format" data-format="${f.id}">${f.name}<small>${f.help}</small></button>`).join('')}</div><p class="hint">${x.format==='zip'?'Includes recordings and attachments.':'Original recordings and attachments are included in the ZIP.'}</p><button class="btn" style="margin-top:10px" data-action="download">${icon('export')}Choose location & save</button></details><div class="buttons"><button class="btn" data-action="close">Cancel</button></div>`);
}
function agentFolder(){return localStorage.getItem('agent-folder:'+state.projectId)||'';}
async function chooseAgentFolder(){const folder=await open({directory:true,multiple:false,title:'Choose your project folder',defaultPath:agentFolder()||undefined});if(typeof folder!=='string')return '';localStorage.setItem('agent-folder:'+state.projectId,folder);return folder;}
async function prepareForAgent(button:HTMLButtonElement){
  const folder=agentFolder()||await chooseAgentFolder();if(!folder){renderExport();return;}
  button.textContent='Updating…';
  const handoff=await invoke<Handoff>('prepare_for_agent',{projectId:state.projectId,sessionIds:exportState.ids,folder});
  await exportFinished();renderHandoff(handoff);
}
function renderHandoff(h:Handoff){
  const upToDate=!h.newCount&&!h.editedCount,changes=[h.newCount&&`${h.newCount} new`,h.editedCount&&`${h.editedCount} edited`,h.unchangedCount&&`${h.unchangedCount} unchanged`].filter(Boolean).join(', ');
  modal(upToDate?'Already up to date':'Ready to paste',`${upToDate?'Nothing has changed since your last export.':changes+'.'} Everything is in ${h.folder}`,`<p class="handoffhint">${upToDate?'To go through these sessions again, paste this message into Claude Code or Codex.':'Paste this message into Claude Code or Codex.'}</p><textarea id="handoff-text" class="handoff" readonly aria-label="Message to paste">${esc(h.prompt)}</textarea><div class="buttons"><span class="hint saved" id="handoff-status" role="status"></span><button class="btn" data-action="close">Done</button><button class="btn primary" data-action="agent-copy">Copy message</button></div>`);
}
async function copyHandoff(){
  const box=$<HTMLTextAreaElement>('#handoff-text');
  try{await navigator.clipboard.writeText(box.value);}catch{box.select();if(!document.execCommand('copy'))throw Error('Could not copy automatically. Select the message and press Ctrl+C.');}
  $('#handoff-status').textContent='Copied';
}
async function doExport(){const format=exportState.format;const destination=await save({defaultPath:project().name.replace(/[<>:"/\\|?*]/g,'-')+'-'+exportState.ids.length+'-sessions.'+format,filters:[{name:format==='zip'?'ZIP archive':format==='md'?'Markdown':'JSON',extensions:[format]}]});if(!destination)return;const button=$<HTMLButtonElement>('[data-action=download]');button.textContent='Exporting…';const result=await invoke<{sessionCount:number}>('export_sessions',{projectId:state.projectId,sessionIds:exportState.ids,format,destination});closeModal();await exportFinished();toast(`${result.sessionCount} session${result.sessionCount===1?'':'s'} exported`);}

const WAVE_BARS=56;
const voice=createVoiceActivity();
let waveHistory: {height:number;voice:boolean}[]=[],voiceState: 'speaking'|'waiting'|'no-sound'='waiting';
function resetMeter(){voice.reset();waveHistory=[];voiceState='waiting';}
function sampleMeter(){
  if(!recording.active||recording.paused)return;
  voiceState=voice.update(recording.level,performance.now()) as typeof voiceState;
  waveHistory.push({height:barHeight(recording.level),voice:voiceState==='speaking'});
  if(waveHistory.length>WAVE_BARS)waveHistory.shift();
}
function updateMeter(){
  const time=document.querySelector('#elapsed'),label=document.querySelector('#live-state'),hint=document.querySelector('#live-hint'),panel=document.querySelector<HTMLElement>('#audio-panel'),wave=document.querySelector('#voice-wave');
  if(time)time.textContent=clock(recording.durationSecs);
  if(!label||!hint||!panel||!wave)return;
  const kind=recording.paused?'paused':voiceState,[title,detail]=audioKinds[kind];
  panel.dataset.voice=kind;
  if(label.textContent!==title)label.textContent=title;
  if(hint.textContent!==detail)hint.textContent=detail;
  const offset=WAVE_BARS-waveHistory.length;
  [...wave.children].forEach((node,index)=>{const bar=node as HTMLElement,sample=waveHistory[index-offset];bar.style.height=`${Math.max(6,(sample?.height??0)*100)}%`;bar.classList.toggle('on',!!sample?.voice);});
}
async function stopRecording(){if(recordTimer)clearInterval(recordTimer);recordTimer=undefined;let error:unknown;try{await invoke('stop_recording');}catch(e){error=e;}recording={...recording,active:false,finished:false};await audio();render();if(error)throw error;toast('Recording saved');}
function pollRecording(){if(recordTimer)clearInterval(recordTimer);recordTimer=setInterval(async()=>{if(polling)return;polling=true;try{recording=await invoke('recording_status');sampleMeter();updateMeter();if(recording.finished){const message=recording.error;await stopRecording();if(message)failure(message);}}catch(error){failure(error);}finally{polling=false;}},100);}

async function action(button: HTMLButtonElement){
  if(button.dataset.action?.startsWith('property-')){await propertyAction(button);return;}
  switch(button.dataset.action){
    case 'new': await flushAll();{const s=await invoke<Session>('create_session',{projectId:state.projectId,questionnaireId:state.groups[0]?.id??null,date:localDate()});await openSession(s.id);}break;
    case 'start-project': await chooseProject(button.dataset.id!);break;
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
    case 'export-one':await showExport(await invoke<string[]>('session_ids',{projectId:state.projectId}),current().id);break;
    case 'export-scope':exportState.ids=button.dataset.scope==='one'?[exportState.oneId]:exportState.allIds;await loadExportPreview();renderExport();break;
    case 'format':exportState.format=button.dataset.format!;exportState.filesOpen=true;renderExport();break;
    case 'agent-folder':if(await chooseAgentFolder())renderExport();break;
    case 'agent-prepare':await prepareForAgent(button);break;
    case 'agent-copy':await copyHandoff();break;
    case 'download':await doExport();break;
    case 'retry-save':await flushAll();clearError();toast('Saved');break;
    case 'dismiss':clearError();break;
    case 'attach':{const sessionId=current().id;const paths=await open({multiple:true,directory:false});if(paths){try{await invoke('import_attachments',{sessionId,paths:Array.isArray(paths)?paths:[paths]});}finally{await attachments();refreshAttachments();}toast('Files added to session');}}break;
    case 'remove-attachment':{await invoke('edit_attachment',{sessionId:current().id,attachmentId:button.dataset.id,caption:null});await attachments();refreshAttachments();}break;
    case 'import':{await flushAll();const paths=await open({multiple:true,directory:false,filters:[{name:'Audio',extensions:['wav','mp3','m4a','aac','ogg','flac','webm','mp4']}]});if(paths){button.textContent='Copying…';try{await invoke('import_audio',{sessionId:current().id,paths:Array.isArray(paths)?paths:[paths]});}finally{await audio();render();}toast('Audio copied into this session');}}break;
    case 'record':if(recording.active){await stopRecording();}else{await flushAll();resetMeter();try{recording=await invoke('start_recording',{sessionId:current().id,deviceId:state.deviceId||null});render();pollRecording();}catch(e){recording=await invoke('recording_status');if(recording.active)pollRecording();await audio();render();throw e;}}break;
    case 'pause':recording=await invoke('pause_recording',{paused:!recording.paused});voice.reset();voiceState='waiting';render();break;
    case 'check-updates': await checkForUpdates(true); break;
    case 'install-update': if (availableUpdate) openInstallModal(availableUpdate); break;
    case 'confirm-install': await installUpdate(); break;
    case 'storage':modal('Saved on this computer','Nothing is uploaded. Your notes, recordings, and attachments are kept in this folder:',`<p class="hint" style="overflow-wrap:anywhere">${esc(state.dataDirectory)}</p><p class="hint" style="margin-top:15px">To keep a backup, export your sessions as a ZIP.</p><div class="buttons"><button class="btn" data-action="close">Done</button></div>`);break;
    case 'new-project':if(recording.active)throw Error('Stop recording before changing projects.');await flushAll();modal('New project','Each project keeps its own sessions and questionnaires.',`<form id="projectform"><label class="field">Project name<input id="project-name" required maxlength="200" placeholder="Project name"></label><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button type="submit" class="btn primary">Create project</button></div></form>`);$<HTMLFormElement>('#projectform').onsubmit=async ev=>{ev.preventDefault();const submit=$<HTMLButtonElement>('#projectform button[type=submit]');submit.disabled=true;try{await createProject($<HTMLInputElement>('#project-name').value);}catch(e){failure(e);submit.disabled=false;}};break;
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
document.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&(ev.target as HTMLElement).dataset.property){ev.preventDefault();(ev.target as HTMLInputElement).blur();return;}if(!(ev.ctrlKey||ev.metaKey))return;if(ev.key.toLowerCase()==='s'){ev.preventDefault();flushAll().then(()=>toast('Saved')).catch(failure);}else if(ev.key.toLowerCase()==='f'&&state.page==='list'){ev.preventDefault();document.querySelector<HTMLInputElement>('#search')?.focus();}});
window.addEventListener('blur',()=>{if(saves.dirty()||propertySaves.dirty()||[...captionQueues.values()].some(q=>q.dirty()))flushAll().catch(failure);});
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
async function flushAll(){capturePropertyEditors();await flushCaptions();await saves.flush();await propertySaves.flush();}
async function refreshAfterProperties(){if(!needsPropertyRefresh||state.page!=='list'||actionBusy||pointerDown||(document.activeElement as HTMLElement)?.dataset.property)return;await flushAll();if(actionBusy||pointerDown||state.page!=='list'||(document.activeElement as HTMLElement)?.dataset.property)return;needsPropertyRefresh=false;await list();if(actionBusy||pointerDown||state.page!=='list'||(document.activeElement as HTMLElement)?.dataset.property){needsPropertyRefresh=true;return;}render();}
function renderProjectFields(){if(!state.fields.length)return '';return `<section class="project-fields"><h2>Details</h2><div class="project-field-grid">${state.fields.map(f=>`<label class="field">${esc(f.name)}${propertyControl(f,state.sessionValues,current().id,propertyDrafts.get(propertyKey(current().id,f.id))?.raw,true)}</label>`).join('')}</div><button class="textbtn" style="margin-top:13px" data-action="property-add">+ Add another column</button></section>`;}

function addColumnModal(){
  modal('Add a column',`Track something extra for every session in ${project().name}, like a company or an email address.`,`<form id="columnform"><label class="field">Column name<input id="column-name" maxlength="80" required placeholder="e.g. Company"></label><label class="field">Type<select id="column-kind">${Object.entries(fieldKinds).map(([kind,name])=>`<option value="${kind}">${name}</option>`).join('')}</select></label><label class="field" id="column-options-field" hidden>Options, separated by commas<input id="column-options" placeholder="e.g. Yes, No, Maybe"></label><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button type="submit" class="btn primary">Add column</button></div></form>`);
  $<HTMLSelectElement>('#column-kind').onchange=()=>{$('#column-options-field').hidden=$<HTMLSelectElement>('#column-kind').value!=='select';};
  $<HTMLFormElement>('#columnform').onsubmit=async event=>{event.preventDefault();const form=$<HTMLFormElement>('#columnform');form.inert=true;try{
    await flushAll();const kind=$<HTMLSelectElement>('#column-kind').value as ProjectField['kind'];
    await invoke('save_project_field',{field:{id:uid(),projectId:state.projectId,name:$<HTMLInputElement>('#column-name').value,kind,options:kind==='select'?$<HTMLInputElement>('#column-options').value.split(',').map(v=>v.trim()).filter(Boolean):[]}});
    state.fields=await invoke('project_fields',{projectId:state.projectId});if(state.page==='list')await list();closeModal();render();toast('Column added');
  }catch(error){failure(error);form.inert=false;}};
}

function columnsModal(){modal('Columns','Choose which columns show in the table. Hidden columns keep their values.',state.fields.map(f=>`<div class="property-manager-row"><input type="checkbox" data-column-visible="${f.id}" ${state.preferences.hidden.includes(f.id)?'':'checked'} aria-label="Show ${esc(f.name)}"><div><h3>${esc(f.name)}</h3><p class="hint">${fieldKinds[f.kind]}</p></div><button class="btn quiet" style="margin-left:auto" data-action="property-rename" data-id="${f.id}">Rename</button></div>`).join('')+`<div class="buttons"><button class="btn" data-action="close">Done</button><button class="btn primary" data-action="property-add">+ Add column</button></div>`);}
function renameColumnModal(id:string){const field=state.fields.find(f=>f.id===id)!;modal('Rename column','Existing values are kept.',`<form id="rename-column-form"><label class="field">Column name<input id="rename-column" maxlength="80" required value="${esc(field.name)}"></label><p class="hint" style="margin-top:13px">Type: ${fieldKinds[field.kind]}. A column’s type can’t be changed later.</p><div class="buttons"><button type="button" class="btn" data-action="property-columns">Back</button><button class="btn primary" type="submit">Rename</button></div></form>`);$<HTMLFormElement>('#rename-column-form').onsubmit=async event=>{event.preventDefault();const form=$<HTMLFormElement>('#rename-column-form');form.inert=true;try{await invoke('save_project_field',{field:{...field,name:$<HTMLInputElement>('#rename-column').value}});state.fields=await invoke('project_fields',{projectId:state.projectId});if(state.page==='list')await list();render();columnsModal();toast('Column renamed');}catch(error){failure(error);form.inert=false;}};}

function newFilter():Rule{const field=state.fields[0]??sortFields(state.fields)[1];return {field:field.id,op:operators(field.kind)[0][0],value:null};}
function filterModal(fresh=false){
  if(fresh)filterDraft=structuredClone(state.preferences.filters.length?state.preferences.filters:[newFilter()]);
  const fields=sortFields(state.fields);
  modal('Filter sessions','Show only sessions that match every rule.',`<form id="property-filter-form">${filterDraft.map((rule,index)=>{const field=fields.find(f=>f.id===rule.field)!;return `<div class="property-filter-row"><div class="row"><select data-rule-field="${index}" aria-label="Filter field ${index+1}">${fields.map(f=>`<option value="${f.id}" ${f.id===rule.field?'selected':''}>${esc(f.name)}</option>`).join('')}</select><button type="button" class="btn quiet" data-action="property-delete-rule" data-index="${index}" aria-label="Remove filter ${index+1}">×</button></div><select data-rule-op="${index}" aria-label="Filter operator ${index+1}">${operators(field.kind).map(([op,name])=>`<option value="${op}" ${op===rule.op?'selected':''}>${name}</option>`).join('')}</select>${rule.op==='empty'||rule.op==='filled'?'':field.kind==='select'?`<select data-rule-value="${index}" aria-label="Filter value ${index+1}" required><option value="">Choose value</option>${field.options.map(value=>`<option value="${esc(value)}" ${value===rule.value?'selected':''}>${esc(value)}</option>`).join('')}</select>`:`<input data-rule-value="${index}" type="${field.kind==='number'?'number':field.kind==='date'?'date':'text'}" ${field.kind==='number'?'step="any"':''} aria-label="Filter value ${index+1}" value="${esc(rule.value??'')}" maxlength="10000" required placeholder="Value">`}</div>`;}).join('')}<button class="btn quiet" type="button" style="margin-top:12px" data-action="property-add-rule">+ Add rule</button><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">Apply filters</button></div></form>`);
  $<HTMLFormElement>('#property-filter-form').onsubmit=async event=>{event.preventDefault();const form=$<HTMLFormElement>('#property-filter-form');form.inert=true;const previous=state.preferences.filters;try{state.preferences.filters=structuredClone(filterDraft);await list();rememberView();closeModal();render();}catch(error){state.preferences.filters=previous;failure(error);form.inert=false;}};
}
function sortModal(){modal('Sort sessions','Choose the order for this list.',`<form id="property-sort-form"><label class="field">Sort by<select id="property-sort-key">${sortFields(state.fields).map(f=>`<option value="${f.id}" ${f.id===state.preferences.sort.key?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label><label class="field">Direction<select id="property-sort-direction"><option value="asc" ${state.preferences.sort.direction==='asc'?'selected':''}>Ascending · A → Z / low → high / oldest first</option><option value="desc" ${state.preferences.sort.direction==='desc'?'selected':''}>Descending · Z → A / high → low / newest first</option></select></label><div class="buttons"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">Apply sort</button></div></form>`);$<HTMLFormElement>('#property-sort-form').onsubmit=async event=>{event.preventDefault();const form=$<HTMLFormElement>('#property-sort-form');form.inert=true;try{state.preferences.sort={key:$<HTMLSelectElement>('#property-sort-key').value,direction:$<HTMLSelectElement>('#property-sort-direction').value as 'asc'|'desc'};await list();rememberView();closeModal();render();}catch(error){failure(error);form.inert=false;}};}

async function propertyAction(button:HTMLButtonElement){switch(button.dataset.action){
  case 'property-view':state.preferences.mode=button.dataset.mode as View['mode'];rememberView();await list();render();break;
  case 'property-add':addColumnModal();break;
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
    appVersion=await getVersion();
    const info=await invoke<{dataDirectory:string;recoveredRecordings:number}>('app_info');state.dataDirectory=info.dataDirectory;
    state.projects=await invoke('projects');if(state.projects.length===1)await chooseProject(state.projects[0].id);else{state.page='start';render();}
    if(info.recoveredRecordings)toast(`${info.recoveredRecordings} interrupted recordings recovered`);
    void checkForUpdates(false);
    let closing=false;
    await getCurrentWindow().onCloseRequested(async ev=>{if(closing)return;ev.preventDefault();try{capturePropertyEditors();$('#app').inert=true;await flushAll();if(recording.active)await stopRecording();closing=true;await getCurrentWindow().destroy();}catch(error){$('#app').inert=false;failure(error);}});
  }catch(error){failure(error);$('#app').innerHTML='<div class="loading">Fieldnote could not open local storage. Your existing files have not been deleted. Close and reopen the app after checking the error above.</div>';}
}
void boot();
