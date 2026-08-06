import assert from 'node:assert/strict';
import test from 'node:test';

import { mapWithStaggeredStart, withTimeout } from './async';

const delay = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

test('starts staggered work concurrently while preserving result order', async () => {
  let activeOperations = 0;
  let maxActiveOperations = 0;
  const startOrder: number[] = [];

  const results = await mapWithStaggeredStart(
    [1, 2, 3],
    async (value) => {
      startOrder.push(value);
      activeOperations += 1;
      maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
      await delay(30);
      activeOperations -= 1;
      return value * 2;
    },
    5
  );

  assert.deepEqual(startOrder, [1, 2, 3]);
  assert.deepEqual(results, [2, 4, 6]);
  assert.ok(maxActiveOperations > 1);
});

test('returns an operation result before the deadline', async () => {
  await assert.doesNotReject(async () => {
    assert.equal(await withTimeout(Promise.resolve('ok'), 50, 'fast operation'), 'ok');
  });
});

test('rejects a slow operation with a bounded timeout', async () => {
  await assert.rejects(
    withTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 5, 'slow operation'),
    /slow operation timed out after 5ms/
  );
});
