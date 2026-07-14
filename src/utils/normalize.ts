import { MangaStatus } from '../types/manga.types';

export function getLocalizedText(text: Record<string, string> | undefined, language: string) {
  if (!text) {
    return '';
  }

  const normalizedLanguage = language.trim().toLowerCase();
  const baseLanguage = normalizedLanguage.split('-')[0];
  const localizedEntries = Object.entries(text).filter(([, value]) => Boolean(value));
  const preferredLanguageCodes = Array.from(
    new Set([
      normalizedLanguage,
      baseLanguage,
      ...(baseLanguage === 'es' ? ['es-la', 'es-419'] : []),
      ...localizedEntries
        .map(([code]) => code.toLowerCase())
        .filter((code) => code.startsWith(`${baseLanguage}-`)),
    ]),
  );

  for (const languageCode of preferredLanguageCodes) {
    const localizedText = localizedEntries.find(([code]) => code.toLowerCase() === languageCode)?.[1];

    if (localizedText) {
      return localizedText;
    }
  }

  return text.en ?? localizedEntries[0]?.[1] ?? '';
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
