import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installBlockReason, downloadPercent } from '../src/update-policy.mjs';

test('installing is blocked while recording or while saves are unfinished', () => {
  assert.match(installBlockReason({ recordingActive: true, saveState: 'saved', propertySaveState: 'saved' }), /Stop recording/);
  assert.match(installBlockReason({ recordingActive: false, saveState: 'error', propertySaveState: 'saved' }), /not saved/);
  assert.match(installBlockReason({ recordingActive: false, saveState: 'saved', propertySaveState: 'pending' }), /still being saved/);
  assert.match(installBlockReason({ recordingActive: false, saveState: 'saving', propertySaveState: 'saved' }), /still being saved/);
});

test('installing is allowed when nothing is recording and everything is saved', () => {
  assert.equal(installBlockReason({ recordingActive: false, saveState: 'saved', propertySaveState: 'saved' }), null);
});

test('download progress is a bounded percentage or unknown without a total', () => {
  assert.equal(downloadPercent(50, 200), 25);
  assert.equal(downloadPercent(300, 200), 100);
  assert.equal(downloadPercent(10, 0), null);
  assert.equal(downloadPercent(10, undefined), null);
});
