import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barHeight, createVoiceActivity } from '../src/recording-meter.mjs';

const feed = (voice, levels, start = 0, stepMs = 100) => levels.map((level, i) => voice.update(level, start + i * stepMs)).at(-1);

test('ordinary speech fills a useful part of the meter even though its peaks are small', () => {
  // Peaks measured from a real laptop-mic recording: 5% typical, 12% loud.
  assert.ok(barHeight(0.05) > 0.5);
  assert.ok(barHeight(0.12) > 0.65);
  assert.equal(barHeight(0), 0);
  assert.equal(barHeight(1), 1);
  assert.ok(barHeight(0.001) < 0.1);
});

test('a voice is reported as soon as it is heard and survives the gaps between words', () => {
  const voice = createVoiceActivity();
  assert.equal(voice.update(0, 0), 'waiting');
  assert.equal(voice.update(0.05, 100), 'speaking');
  assert.equal(voice.update(0, 300), 'speaking');
  assert.equal(voice.update(0, 1000), 'waiting');
});

test('steady background noise is not mistaken for someone speaking', () => {
  const voice = createVoiceActivity();
  assert.equal(feed(voice, Array(40).fill(0.02)), 'waiting');
  assert.equal(voice.update(0.12, 4000), 'speaking');
});

test('a microphone delivering nothing is flagged, and clears when sound returns', () => {
  const voice = createVoiceActivity();
  assert.equal(voice.update(0, 0), 'waiting');
  assert.equal(voice.update(0, 7900), 'waiting');
  assert.equal(voice.update(0, 8000), 'no-sound');
  assert.equal(voice.update(0.05, 8100), 'speaking');
});

test('a quiet room with a little hiss is not reported as a dead microphone', () => {
  const voice = createVoiceActivity();
  assert.equal(feed(voice, Array(120).fill(0.002)), 'waiting');
});

test('time spent paused does not count as silence after resuming', () => {
  const voice = createVoiceActivity();
  voice.update(0.05, 0);
  voice.reset();
  assert.equal(voice.update(0, 60000), 'waiting');
});
