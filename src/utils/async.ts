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
