import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVideoDuration, validateVideoTotal } from '../src/utils/qcEvidence.ts';

test('two 30-second clips and exactly 2:30 combined are allowed', () => {
  validateVideoTotal([31, 27]);
  validateVideoTotal([75, 75]);
  validateVideoTotal(Array(1500).fill(0.1));
  validateVideoTotal([]);
});

test('fractions are summed before comparing against the limit', () => {
  assert.throws(() => validateVideoTotal([75, 75.001]), /2:30/);
  assert.throws(() => validateVideoTotal([151]), /2:30/);
  assert.throws(() => validateVideoTotal([60, 60, 31]), /2:30/);
});

test('unreadable duration is not silently counted as zero', () => {
  for (const duration of [NaN, Infinity, 0, -1]) {
    assert.throws(() => validateVideoTotal([duration]), /duracion/);
  }
});

test('time display includes minutes and seconds', () => {
  assert.equal(formatVideoDuration(150), '2:30');
  assert.equal(formatVideoDuration(58), '0:58');
});
