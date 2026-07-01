import { MangaStatus } from '../types/manga.types';

export function getLocalizedText(text: Record<string, string> | undefined, language: string) {
  if (!text) {
    return '';
  }

  return text[language] ?? text.es ?? text.en ?? Object.values(text)[0] ?? '';
}

export function getAlternativeTitles(titles: Record<string, string>[] | undefined) {
  if (!titles) {
    return [];
  }

  return Array.from(new Set(titles.flatMap((title) => Object.values(title)).filter(Boolean)));
}

export function normalizeStatus(status: string | undefined): MangaStatus {
  if (status === 'ongoing' || status === 'completed' || status === 'hiatus' || status === 'cancelled') {
    return status;
  }

  return 'unknown';
}
