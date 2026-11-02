import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue } from '../src/save-queue.mjs';

test('autosaves serialize edits arriving during an in-flight write', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const writes = [];
  const queue = createSaveQueue(async value => { writes.push(value); if (value.version === 1) await gate; }, () => {}, 10000);
  queue.enqueue({ version: 1 });
  const saving = queue.flush();
  await new Promise(resolve => setImmediate(resolve));
  queue.enqueue({ version: 2 });
  finish();
  await saving;
  assert.deepEqual(writes, [{ version: 1 }, { version: 2 }]);
  await queue.flush();
});

test('failed saves retain the latest draft and can be retried', async () => {
  let fail = true;
  const writes = [];
  const queue = createSaveQueue(async value => { if (fail) throw Error('disk full'); writes.push(value); }, () => {}, 10000);
  queue.enqueue({ answer: 'keep this' });
  await assert.rejects(queue.flush(), /disk full/);
  assert.equal(queue.dirty(), true);
  fail = false;
  await queue.flush();
  assert.deepEqual(writes, [{ answer: 'keep this' }]);
});
