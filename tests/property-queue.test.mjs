import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPropertyQueue } from '../src/property-queue.mjs';

test('different cells and newer edits survive an in-flight property write', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const writes = [];
  const queue = createPropertyQueue(async value => { writes.push(value); if (value === 'first') await gate; }, () => {}, 10000);
  queue.enqueue('email', 'first');
  const saving = queue.flush();
  await new Promise(resolve => setImmediate(resolve));
  queue.enqueue('email', 'new email');
  queue.enqueue('excitement', 'High');
  finish();
  await saving;
  assert.deepEqual(writes, ['first','new email','High']);
  await queue.flush();
});

test('property failures preserve all cells for retry', async () => {
  let fail = true;
  const writes = [];
  const queue = createPropertyQueue(async value => { if (fail) throw Error('disk full'); writes.push(value); }, () => {}, 10000);
  queue.enqueue('number', 0);
  queue.enqueue('email', null);
  await assert.rejects(queue.flush(), /disk full/);
  assert.equal(queue.dirty(), true);
  fail = false;
  await queue.flush();
  assert.deepEqual(writes, [0,null]);
});
