import assert from 'node:assert/strict';
import test from 'node:test';

import { withTimeout } from './async';

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
