import { env } from '../config/env';
import { createCacheKey, TtlCache } from '../utils/cache';
import { httpClient } from '../utils/httpClient';

type MyMemoryResponse = {
  responseData?: {
    translatedText?: string;
  };
  responseStatus?: number | string;
};

const MAX_SEGMENT_BYTES = 450;

function getTranslationLanguage(language: string) {
  const normalizedLanguage = language.trim().toLowerCase();

  if (normalizedLanguage === 'es-la' || normalizedLanguage === 'es-419') {
    return 'es';
  }

  if (normalizedLanguage === 'pt-br') {
    return 'pt-BR';
  }

  return normalizedLanguage;
}

function getByteLength(value: string) {
  return Buffer.byteLength(value, 'utf8');
}

function splitText(text: string) {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const word of text.trim().split(/\s+/)) {
    const candidate = currentChunk ? `${currentChunk} ${word}` : word;

    if (getByteLength(candidate) <= MAX_SEGMENT_BYTES) {
      currentChunk = candidate;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
      currentChunk = '';
    }

    if (getByteLength(word) <= MAX_SEGMENT_BYTES) {
      currentChunk = word;
      continue;
    }

    let oversizedChunk = '';

    for (const character of word) {
      const nextChunk = `${oversizedChunk}${character}`;

      if (getByteLength(nextChunk) > MAX_SEGMENT_BYTES) {
        chunks.push(oversizedChunk);
        oversizedChunk = character;
      } else {
        oversizedChunk = nextChunk;
      }
    }

    currentChunk = oversizedChunk;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export class TranslationService {
  private readonly cache = new TtlCache<string>(env.translationCacheTtlMs, env.queryCacheMaxEntries);

  async translate(text: string, targetLanguage: string, sourceLanguage = 'en') {
    const normalizedText = text.trim();
    const target = getTranslationLanguage(targetLanguage);
    const source = getTranslationLanguage(sourceLanguage);

    if (!env.translationEnabled || !normalizedText || target === source) {
      return text;
    }

    try {
      return await this.cache.getOrSet(createCacheKey('translation', source, target, normalizedText), async () => {
        const translatedChunks: string[] = [];

        for (const chunk of splitText(normalizedText)) {
          const response = await httpClient.get<MyMemoryResponse>(env.translationApiUrl, {
            params: {
              q: chunk,
              langpair: `${source}|${target}`,
              mt: 1,
            },
          });
          const status = Number(response.data.responseStatus ?? response.status);
          const translatedText = response.data.responseData?.translatedText?.trim();

          if (status < 200 || status >= 300 || !translatedText) {
            throw new Error('Translation service returned an invalid response');
          }

          translatedChunks.push(decodeHtmlEntities(translatedText));
        }

        return translatedChunks.join(' ');
      });
    } catch {
      return text;
    }
  }
}

export const translationService = new TranslationService();
