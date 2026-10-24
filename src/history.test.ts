import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyReducer } from './history';

test('restore reverses a complete tuning operation and leaves its original snapshot intact', () => {
  const initial = {
    bands: [0, 0],
    preamp: -1,
    autoPreamp: false,
    bypass: true,
    target: 'reference',
  };
  let history = createHistory(initial);
  history = historyReducer(history, {
    type: 'change',
    patch: { bands: [6, -3], preamp: -7, autoPreamp: true, bypass: false },
  });
  history = historyReducer(history, {
    type: 'change',
    patch: { target: 'custom' },
  });
  history = historyReducer(history, { type: 'undo' });
  assert.equal(history.current.target, 'reference');
  assert.deepEqual(history.current.bands, [6, -3]);
  history = historyReducer(history, { type: 'undo' });
  assert.equal(history.current, initial);
  assert.deepEqual(initial.bands, [0, 0]);
  assert.equal(historyReducer(history, { type: 'undo' }), history);
});

test('a pointer drag is one restore step, while later parameter edits remain separate', () => {
  let history = createHistory({ frequency: 1000, gain: 0 });
  history = historyReducer(history, { type: 'begin' });
  for (let gain = 1; gain <= 12; gain++)
    history = historyReducer(history, {
      type: 'change',
      patch: { gain, frequency: 1000 + gain * 10 },
    });
  history = historyReducer(history, { type: 'end' });
  assert.equal(history.past.length, 1);
  history = historyReducer(history, {
    type: 'change',
    patch: { frequency: 3000 },
  });
  history = historyReducer(history, { type: 'undo' });
  assert.deepEqual(history.current, { frequency: 1120, gain: 12 });
  history = historyReducer(history, { type: 'undo' });
  assert.deepEqual(history.current, { frequency: 1000, gain: 0 });
});

test('no-op edits and clicks without dragging do not consume restore steps', () => {
  let history = createHistory({ gain: 0 });
  assert.equal(
    historyReducer(history, { type: 'change', patch: { gain: 0 } }),
    history,
  );
  history = historyReducer(history, { type: 'begin' });
  history = historyReducer(history, { type: 'end' });
  assert.equal(history.past.length, 0);
  history = historyReducer(history, { type: 'begin' });
  history = historyReducer(history, { type: 'change', patch: { gain: 0 } });
  history = historyReducer(history, { type: 'change', patch: { gain: 3 } });
  assert.equal(history.past.length, 1);
  history = historyReducer(history, { type: 'undo' });
  assert.equal(history.current.gain, 0);
  assert.equal(history.grouping, false);
});

test('history is bounded, accepts edits after restoring, and starts fresh at a new baseline', () => {
  let history = createHistory({ gain: 0 });
  for (let gain = 1; gain <= 70; gain++)
    history = historyReducer(history, { type: 'change', patch: { gain } });
  assert.equal(history.past.length, 50);
  for (let i = 0; i < 50; i++)
    history = historyReducer(history, { type: 'undo' });
  assert.equal(history.current.gain, 20);
  history = historyReducer(history, { type: 'change', patch: { gain: -3 } });
  history = historyReducer(history, { type: 'undo' });
  assert.equal(history.current.gain, 20);
  history = historyReducer(history, { type: 'reset', current: { gain: 0 } });
  assert.equal(history.past.length, 0);
  assert.equal(history.current.gain, 0);
});
