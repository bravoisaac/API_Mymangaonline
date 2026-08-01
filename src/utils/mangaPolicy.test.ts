import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMangaAllowed, filterAllowedMangas, isMangaBlocked } from './mangaPolicy';

test('blocks One Piece regardless of casing and punctuation', () => {
  assert.equal(isMangaBlocked({ title: 'One Piece' }), true);
  assert.equal(isMangaBlocked({ title: 'ONE-PIECE' }), true);
});

test('blocks a manga when an alternative title matches One Piece', () => {
  assert.equal(isMangaBlocked({ title: 'Wan Pisu', alternativeTitles: ['One Piece'] }), true);
});

test('does not block distinct titles or spin-offs', () => {
  assert.equal(isMangaBlocked({ title: 'One Piece Party' }), false);
  assert.equal(isMangaBlocked({ title: 'One Piece of Advice' }), false);
});

test('filters blocked results and rejects direct access', () => {
  const allowed = filterAllowedMangas([{ title: 'One Piece' }, { title: 'Berserk' }]);

  assert.deepEqual(allowed, [{ title: 'Berserk' }]);
  assert.throws(() => assertMangaAllowed({ title: 'One Piece' }), /Manga not available/);
});
