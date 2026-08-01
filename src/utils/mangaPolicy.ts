import { AppError } from './errors';

type MangaTitleCandidate = {
  title: string;
  alternativeTitles?: string[];
};

const BLOCKED_MANGA_TITLES = new Set(['one piece']);

function normalizeMangaTitle(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isMangaBlocked(manga: MangaTitleCandidate) {
  return [manga.title, ...(manga.alternativeTitles ?? [])].some((title) =>
    BLOCKED_MANGA_TITLES.has(normalizeMangaTitle(title))
  );
}

export function filterAllowedMangas<TManga extends MangaTitleCandidate>(mangas: TManga[]) {
  return mangas.filter((manga) => !isMangaBlocked(manga));
}

export function assertMangaAllowed(manga: MangaTitleCandidate) {
  if (isMangaBlocked(manga)) {
    throw new AppError('Manga not available', 404);
  }
}
