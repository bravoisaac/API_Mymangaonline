import assert from 'node:assert/strict';
import test from 'node:test';

import { TtlCache } from './cache';

test('deduplicates equal pending keys and rejects new work when the pending budget is full', async () => {
  const cache = new TtlCache<string>(60_000, 10, 1);
  let resolveFirst: ((value: string) => void) | undefined;
  let loaderCalls = 0;
  const first = cache.getOrSet('first', () => {
    loaderCalls += 1;
    return new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
  });
  const duplicate = cache.getOrSet('first', async () => {
    loaderCalls += 1;
    return 'unexpected';
  });

  await assert.rejects(
    cache.getOrSet('second', async () => 'second'),
    (error: unknown) => error instanceof Error && /queue is full/i.test(error.message)
  );

  resolveFirst?.('first value');

  assert.equal(await first, 'first value');
  assert.equal(await duplicate, 'first value');
  assert.equal(loaderCalls, 1);
});
