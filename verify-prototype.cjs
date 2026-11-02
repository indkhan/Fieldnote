// Run: node verify-prototype.cjs; checks the standalone concept without a server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, 'research-app.prototype.html'), 'utf8');
const elements = new Map(), listeners = {};
const element = key => {
  if (!elements.has(key)) elements.set(key, {
    innerHTML: '', textContent: '', hidden: true, open: false, value: '',
    showModal() { this.open = true; }, close() { this.open = false; },
    focus() {}, setSelectionRange() {}, click() {}
  });
  return elements.get(key);
};
const context = {
  structuredClone, Blob, TextEncoder, URL,
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  document: {
    querySelector: element,
    addEventListener: (name, fn) => { listeners[name] = fn; },
    createElement: () => ({ click() {} })
  }
};
vm.createContext(context);
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const run = code => vm.runInContext(code, context);
assert.match(element('#app').innerHTML, /Your conversations, questions, and recordings/);
assert.equal(run('exportIds().length'), 3, 'No selection explicitly exports all');
run("toggleSelection('s01',true)");
assert.equal(run('exportIds().join()'), 's01');
run("toggleSelection('s03',true)");
assert.equal(run('exportIds().length'), 2);
assert.equal(run('exportData(exportIds()).sessions.length'), 2);
run("state.query='Sam'");
assert.equal(run('visibleSessions().length'), 1);
assert.equal(run('exportIds().length'), 2, 'Search must not silently change selection');
run("state.query=''; state.selected.clear(); createSession('followup')");
assert.equal(run('session().questionnaireName'), 'Follow-up');
assert.equal(run('session().questions.length'), 3);
assert.equal(run("session().questions[0].text"), 'Have you used it again since we last spoke?');
run("project().questionnaires[2].questions[0].text='Updated template'");
assert.notEqual(run('session().questions[0].text'), 'Updated template', 'Sessions own a questionnaire snapshot');
assert.equal(run("setQuestionnaire('blank')"), true);
assert.equal(run('session().questions.length'), 0);
run("setQuestionnaire('first')");
listeners.input({ target: { id: '', dataset: { answer: 'q1' }, value: 'An answer worth keeping' } });
assert.equal(run('session().questions[0].answer'), 'An answer worth keeping');
assert.equal(run("setQuestionnaire('usability')"), false, 'Changing templates must not erase answers');
assert.equal(run('session().questions[0].answer'), 'An answer worth keeping');
run("editQuestions('session'); editState.questions.push({id:'extra',text:'A custom question',answer:'Extra answer'})");
element('#questionform').onsubmit({ preventDefault() {} });
assert.equal(run('session().questions.length'), 4);
assert.equal(run('project().questionnaires[0].questions.length'), 3, 'Session edits must not mutate a reusable group');
assert.equal(run('session().questions[0].answer'), 'An answer worth keeping');
run("state.session='s01'; state.page='form';render();record();state.seconds=10;record()");
assert.equal(run('session().audio[0].name'), 'conversation.wav', 'Recording another take keeps originals');
assert.equal(run('session().audio.length'), 2);
run("session().audio.push({id:'binary',name:'test.wav',file:new Blob([new Uint8Array([0,1,2,255])]),demo:false})");
const entries = run("exportEntries(['s01','s03'])");
assert.ok(Object.hasOwn(entries, 'audio/s01/binary-test.wav'));
const exported = JSON.parse(entries['sessions.json']);
assert.deepEqual(exported.sessions.map(s => s.id), ['s01','s03']);
assert.equal(exported.sessions[0].audio[0].path, null, 'Demo audio cannot claim a real file');
assert.match(entries['sessions.md'], /Where did you get stuck/);
assert.ok(!entries['sessions.md'].includes('Trying the main workflow'), 'Unselected session content must be absent');
run("data.projects.push({id:'other',name:'Other',questionnaires:[]});state.project='other'");
assert.equal(run("exportData(['s01']).sessions.length"), 0, 'Project boundaries are enforced');
assert.equal(run("esc('<script>')"), '&lt;script&gt;');
(async () => {
  const blob = await context.zip(entries);
  fs.writeFileSync(path.join(__dirname, '.prototype-export.check.zip'), Buffer.from(await blob.arrayBuffer()));
  console.log('PASS: one/many/all export, selection across search, template snapshots, blank forms, answer protection, session customization, audio retention, and project isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
