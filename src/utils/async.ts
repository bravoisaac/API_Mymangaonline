export async function filterAsyncWithConcurrency<TItem>(
  items: TItem[],
  predicate: (item: TItem, index: number) => Promise<boolean>,
  concurrency = 4
) {
  const matches = new Array<boolean>(items.length).fill(false);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        matches[currentIndex] = await predicate(items[currentIndex], currentIndex);
      }
    })
  );

  return items.filter((_item, index) => matches[index]);
}

export function mapWithStaggeredStart<TItem, TResult>(
  items: TItem[],
  mapper: (item: TItem, index: number) => Promise<TResult>,
  staggerMs = 0
): Promise<TResult[]> {
  const normalizedStaggerMs = Math.max(0, staggerMs);

  return Promise.all(
    items.map(async (item, index) => {
      const startDelayMs = index * normalizedStaggerMs;

      if (startDelayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, startDelayMs);
        });
      }

      return mapper(item, index);
    })
  );
}

export async function withTimeout<TValue>(promise: Promise<TValue>, timeoutMs: number, operation: string) {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
