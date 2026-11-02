import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readView } from '../src/property-ui.ts';

const fields=[{id:'score',projectId:'p',name:'Score',kind:'number',options:[]},{id:'email',projectId:'p',name:'Email',kind:'email',options:[]},{id:'excitement',projectId:'p',name:'Excitement',kind:'select',options:['Low','Medium','High']}];

test('project preferences restore typed zero, filters and hidden columns independently',()=>{
  const storage=new Map([['overview:p',JSON.stringify({mode:'table',sort:{key:'score',direction:'desc'},filters:[{field:'score',op:'is',value:0},{field:'excitement',op:'is',value:'High'}],hidden:['email']})]]);
  globalThis.localStorage={getItem:key=>storage.get(key)??null};
  const view=readView('p',fields);
  assert.equal(view.mode,'table');assert.equal(view.filters[0].value,0);assert.deepEqual(view.hidden,['email']);
  assert.equal(readView('other',fields).mode,'list');
});

test('invalid and stale view preferences cannot prevent a project from opening',()=>{
  globalThis.localStorage={getItem:()=>JSON.stringify({mode:'table',sort:{key:'deleted',direction:'desc'},filters:[{field:'score',op:'is',value:'0'},{field:'deleted',op:'empty',value:null},{field:'excitement',op:'is',value:'Unknown'}],hidden:['email','deleted']})};
  const view=readView('p',fields);
  assert.deepEqual(view.sort,{key:'date',direction:'desc'});assert.deepEqual(view.filters,[]);assert.deepEqual(view.hidden,['email']);
  globalThis.localStorage={getItem:()=>'{broken'};assert.equal(readView('p',fields).mode,'list');
});
