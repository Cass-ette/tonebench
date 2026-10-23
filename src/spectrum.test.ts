import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpectrumFrame, nearestSpectrumBin } from './spectrum';

const frame = () => ({
  frequencies: Array.from(
    { length: 192 },
    (_, i) => 20 * 1000 ** ((i + 0.5) / 192),
  ),
  before: Array(192).fill(-60),
  after: Array(192).fill(-66),
  sampleRate: 48000,
  fftSize: 8192,
});

test('spectrum bridge validates shape, sample rate, sorted frequencies and finite dBFS', () => {
  assert.ok(isSpectrumFrame(frame()));
  assert.ok(!isSpectrumFrame(null));
  assert.ok(!isSpectrumFrame({ ...frame(), after: Array(191).fill(-60) }));
  assert.ok(!isSpectrumFrame({ ...frame(), sampleRate: 22050 }));
  assert.ok(!isSpectrumFrame({ ...frame(), fftSize: 123 }));
  for (const value of [NaN, Infinity, -121]) {
    const data = frame();
    data.before[10] = value;
    assert.ok(!isSpectrumFrame(data));
  }
  const data = frame();
  data.frequencies[10] = data.frequencies[9];
  assert.ok(!isSpectrumFrame(data));
  const lowRate = frame();
  lowRate.sampleRate = 32000;
  assert.ok(!isSpectrumFrame(lowRate)); // Above Nyquist.
});

test('spectrum cursor selects nearest bin on a logarithmic frequency axis', () => {
  assert.equal(nearestSpectrumBin([20, 100, 1000, 10000], 600), 2);
  assert.equal(nearestSpectrumBin([20, 100, 1000, 10000], 20), 0);
  assert.equal(nearestSpectrumBin([20, 100, 1000, 10000], 20000), 3);
});
