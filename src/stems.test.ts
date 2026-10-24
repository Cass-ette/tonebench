import test from 'node:test';
import assert from 'node:assert/strict';
import { initialStems, parseStemStatus, STEM_IDS, stemTime } from './stems';
test('stem bridge rejects malformed playback state and duplicate source ids', () => {
  assert.ok(parseStemStatus(initialStems));
  assert.equal(parseStemStatus({ ...initialStems, duration: NaN }), null);
  assert.equal(
    parseStemStatus({ ...initialStems, duration: 2, position: 3 }),
    null,
  );
  assert.equal(
    parseStemStatus({
      ...initialStems,
      stems: Array(STEM_IDS.length).fill(initialStems.stems[0]),
    }),
    null,
  );
  assert.equal(
    parseStemStatus({
      ...initialStems,
      stems: [
        { ...initialStems.stems[0], gain: 50 },
        ...initialStems.stems.slice(1),
      ],
    }),
    null,
  );
  assert.equal(parseStemStatus({ ...initialStems, phase: 'imaginary' }), null);
  assert.equal(stemTime(61.9), '1:01');
});
test('six-source status includes independent guitar and piano and rejects incomplete results', () => {
  const status = {
    ...initialStems,
    phase: 'ready',
    stems: initialStems.stems.map((row) =>
      row.id === 'guitar'
        ? { ...row, gain: -3, solo: true }
        : row.id === 'piano'
          ? { ...row, gain: 2, muted: true }
          : row,
    ),
  };
  assert.ok(parseStemStatus(status));
  assert.equal(
    parseStemStatus({
      ...status,
      stems: status.stems.filter((row) => row.id !== 'piano'),
    }),
    null,
  );
  assert.equal(
    parseStemStatus({
      ...status,
      stems: status.stems.map((row) =>
        row.id === 'guitar' ? { ...row, id: 'cello' } : row,
      ),
    }),
    null,
  );
});
