import assert from 'node:assert/strict';
import test from 'node:test';

import { NormalizedChapter, NormalizedMangaDetails } from '../types/manga.types';
import { MangaAggregatorService } from './mangaAggregator.service';
import { MangaSource } from './sources/mangaSource.interface';

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;
  const promise = new Promise<TValue>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createMangaDetails(title = 'Allowed manga'): NormalizedMangaDetails {
  return {
    id: 'manga-1',
    source: 'test',
    title,
    alternativeTitles: [],
    description: '',
    cover: null,
    status: 'ongoing',
    year: null,
    genres: [],
    language: 'es',
    authors: [],
    artists: [],
    chaptersCount: 1
  };
}

function createChapter(): NormalizedChapter {
  return {
    id: 'chapter-1',
    source: 'test',
    mangaId: 'manga-1',
    chapter: '1',
    title: null,
    volume: null,
    language: 'es',
    pages: 10,
    publishedAt: null
  };
}

function installSource(service: MangaAggregatorService, source: MangaSource) {
  (service as unknown as { sources: Map<string, MangaSource> }).sources = new Map([[source.id, source]]);
}

test('loads manga details and chapters concurrently', async () => {
  const service = new MangaAggregatorService();
  const details = createDeferred<NormalizedMangaDetails>();
  let chaptersStarted = false;
  const source: MangaSource = {
    id: 'test',
    name: 'Test',
    enabled: true,
    supportsSpanish: true,
    supportsPages: true,
    searchManga: async () => [],
    getMangaDetails: () => details.promise,
    getChapters: async () => {
      chaptersStarted = true;
      return [createChapter()];
    },
    getChapterPages: async () => []
  };
  installSource(service, source);

  const resultPromise = service.getChapters('test', 'manga-1', { lang: 'es' });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(chaptersStarted, true);
  details.resolve(createMangaDetails());
  assert.deepEqual(await resultPromise, [createChapter()]);
});

test('does not expose chapters when the manga policy rejects the title', async () => {
  const service = new MangaAggregatorService();
  const source: MangaSource = {
    id: 'test',
    name: 'Test',
    enabled: true,
    supportsSpanish: true,
    supportsPages: true,
    searchManga: async () => [],
    getMangaDetails: async () => createMangaDetails('One Piece'),
    getChapters: async () => [createChapter()],
    getChapterPages: async () => []
  };
  installSource(service, source);

  await assert.rejects(
    service.getChapters('test', 'manga-1', { lang: 'es' }),
    (error: unknown) => error instanceof Error && /not available/i.test(error.message)
  );
});
