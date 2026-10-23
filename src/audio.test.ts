import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoFit,
  bandResponse,
  DEMOS,
  deviation,
  eqResponse,
  equalizerApo,
  FREQUENCIES,
  initialBands,
  interpolate,
  isPreset,
  normalize,
  parseMeasurement,
  suggestedPreamp,
  TARGETS,
} from './audio';
import type { Band } from './audio';

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
const peak: Band = {
  id: 'test',
  enabled: true,
  kind: 'PK',
  frequency: 1000,
  gain: 6,
  q: 1,
};

test('peaking filter reaches the specified gain at its center and is transparent at 0 dB', () => {
  close(bandResponse(peak, 1000), 6);
  for (const frequency of [20, 100, 1000, 8000, 20000])
    close(bandResponse({ ...peak, gain: 0 }, frequency), 0);
  close(bandResponse({ ...peak, gain: -6 }, 1000), -6);
  close(bandResponse({ ...peak, enabled: false }, 1000), 0);
});

test('shelf filters have the expected DC and Nyquist gains', () => {
  close(bandResponse({ ...peak, kind: 'LSC' }, 0), 6);
  close(bandResponse({ ...peak, kind: 'LSC' }, 24000), 0);
  close(bandResponse({ ...peak, kind: 'HSC' }, 0), 0);
  close(bandResponse({ ...peak, kind: 'HSC' }, 24000), 6);
});

test('cascaded response sums in dB and headroom covers the complete filter bank', () => {
  close(eqResponse([peak, { ...peak, id: 'second' }], 1000), 12);
  const preamp = suggestedPreamp([peak, { ...peak, id: 'second' }]);
  assert.ok(preamp <= -12.5 && preamp >= -12.6);
  close(suggestedPreamp([]), 0);
  close(suggestedPreamp(initialBands()), 0);
});

test('log-frequency interpolation and 1 kHz normalization retain the curve shape', () => {
  close(
    interpolate(
      [
        { frequency: 100, db: 0 },
        { frequency: 10000, db: 20 },
      ],
      1000,
    ),
    10,
  );
  const points = normalize([
    { frequency: 100, db: 70 },
    { frequency: 1000, db: 80 },
    { frequency: 10000, db: 90 },
  ]);
  close(interpolate(points, 1000), 0);
  close(points[0].db, -10);
});

test('CSV, TSV, whitespace and REW-style comments import with sorted, normalized data', () => {
  const source = [20, 40, 100, 500, 1000, 2000, 8000, 20000].reverse();
  for (const separator of [',', '\t', ' ', ';']) {
    const csv =
      '\uFEFF# measurement\nFrequency' +
      separator +
      'SPL\n' +
      source.map((f) => `${f}${separator}80`).join('\n');
    const measurement = parseMeasurement(csv, 'my-ears.csv');
    assert.equal(measurement.name, 'my-ears');
    assert.equal(measurement.points.length, 8);
    assert.equal(measurement.demo, false);
    close(interpolate(measurement.points, 1000), 0);
    assert.ok(measurement.points.every((p) => p.db === 0));
  }
});

test('malformed, duplicate and insufficient-range measurements are rejected', () => {
  assert.throws(
    () => parseMeasurement('20,NaN\n1000,80', 'bad.csv'),
    /第 1 行/,
  );
  assert.throws(
    () => parseMeasurement('20,80\n1000,80', 'short.csv'),
    /至少需要 8/,
  );
  const frequencies = [20, 40, 100, 500, 1000, 2000, 8000, 20000];
  assert.throws(
    () =>
      parseMeasurement(
        [...frequencies, 1000].map((f) => `${f},80`).join('\n'),
        'duplicate.csv',
      ),
    /重复频率/,
  );
  assert.throws(
    () =>
      parseMeasurement(
        frequencies.map((f) => `${Math.max(f, 200)},80`).join('\n'),
        'range.csv',
      ),
    /频率范围/,
  );
  assert.throws(
    () => parseMeasurement('a'.repeat(1_000_001), 'huge.csv'),
    /文件过大/,
  );
});

test('automatic EQ reduces deviation for every demo and target and respects constraints', () => {
  for (const measurement of DEMOS)
    for (const target of TARGETS) {
      const before = deviation(measurement, target.id);
      const bands = autoFit(measurement, target.id, 6, 6);
      const after = deviation(measurement, target.id, bands);
      assert.ok(
        after < before * 0.65,
        `${measurement.name} / ${target.name}: ${before} → ${after}`,
      );
      assert.ok(
        bands.every(
          (b) =>
            b.gain <= 6 &&
            b.gain >= -12 &&
            b.q >= 0.35 &&
            b.q <= 4 &&
            b.frequency >= 25 &&
            b.frequency <= 7500,
        ),
      );
      assert.ok(
        FREQUENCIES.every((f) => Number.isFinite(eqResponse(bands, f))),
      );
    }
  const cutsOnly = autoFit(DEMOS[1], 'balanced', 4, 0);
  assert.ok(cutsOnly.every((b) => b.gain <= 0));
});

test('JSON preset round trip validates measurement and filter bounds, APO retains disabled bands', () => {
  const preset = {
    id: 'one',
    name: 'Demo\nPreamp: 100',
    savedAt: new Date().toISOString(),
    measurement: DEMOS[0],
    target: 'balanced',
    bands: initialBands(),
    preamp: -4,
  };
  const roundTrip: unknown = JSON.parse(JSON.stringify(preset));
  assert.ok(isPreset(roundTrip));
  assert.equal(
    isPreset({ ...preset, bands: [{ ...peak, frequency: 25000 }] }),
    false,
  );
  assert.equal(isPreset({ ...preset, preamp: 20 }), false);
  assert.equal(
    isPreset({ ...preset, measurement: { ...DEMOS[0], points: [] } }),
    false,
  );
  assert.equal(
    isPreset({
      ...preset,
      measurement: { ...DEMOS[0], points: Array(8).fill(null) },
    }),
    false,
  );
  assert.equal(isPreset({ ...preset, bands: [null] }), false);
  assert.equal(isPreset({ ...preset, bands: [peak, peak] }), false);
  const text = equalizerApo(
    [peak, { ...peak, id: 'off', enabled: false, kind: 'LSC' }],
    -6.5,
    preset.name,
  );
  assert.ok(text.includes('Preamp: -6.5 dB'));
  assert.ok(text.includes('Filter 1: ON PK Fc 1000 Hz Gain 6.0 dB Q 1.00'));
  assert.ok(text.includes('Filter 2: OFF LSC'));
  assert.ok(!text.includes('\nPreamp: 100'));
});
