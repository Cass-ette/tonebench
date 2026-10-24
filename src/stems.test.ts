import test from 'node:test';
import assert from 'node:assert/strict';
import { initialStems, parseStemStatus, stemTime } from './stems';
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
      stems: Array(4).fill(initialStems.stems[0]),
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
