import { env } from '../config/env';
import { ValidationError } from './errors';

type StringOptions = {
  maxLength?: number;
  pattern?: RegExp;
};

export function getOptionalString(
  value: unknown,
  name: string,
  { maxLength = 256, pattern }: StringOptions = {}
) {
  if (value === undefined) {
    return '';
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be a string`);
  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {
    throw new ValidationError(`${name} must be at most ${maxLength} characters`);
  }

  if (normalized && pattern && !pattern.test(normalized)) {
    throw new ValidationError(`${name} has an invalid format`);
  }

  return normalized;
}

export function getRequiredString(value: unknown, name: string, options?: StringOptions) {
  const normalized = getOptionalString(value, name, options);

  if (!normalized) {
    throw new ValidationError(`${name} is required`);
  }

  return normalized;
}

export function getStringArray(
  value: unknown,
  name: string,
  { maxItems = 20, maxItemLength = 64, pattern }: { maxItems?: number; maxItemLength?: number; pattern?: RegExp } = {}
) {
  if (value === undefined) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];

  if (values.length > maxItems) {
    throw new ValidationError(`${name} must contain at most ${maxItems} values`);
  }

  return values.map((item, index) =>
    getRequiredString(item, `${name}[${index}]`, { maxLength: maxItemLength, pattern })
  );
}

export function getQueryInteger(value: unknown, name: string, fallback: number, min: number, max: number) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = getRequiredString(value, name, { maxLength: 16 });

  if (!/^-?\d+$/.test(normalized)) {
    throw new ValidationError(`${name} must be an integer`);
  }

  const parsed = Number(normalized);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${name} must be between ${min} and ${max}`);
  }

  return parsed;
}

export function getEnumValue<TValue extends string>(
  value: unknown,
  name: string,
  allowedValues: readonly TValue[],
  fallback: TValue
) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = getRequiredString(value, name, { maxLength: 40 });

  if (!allowedValues.includes(normalized as TValue)) {
    throw new ValidationError(`${name} must be one of: ${allowedValues.join(', ')}`);
  }

  return normalized as TValue;
}

export function getLanguage(value: unknown) {
  const language = value === undefined
    ? env.mangadexDefaultLanguage
    : getRequiredString(value, 'lang', { maxLength: 16, pattern: /^[a-z]{2}(?:-[a-z0-9]{2,3})?$/i }).toLowerCase();

  if (!env.allowedLanguages.includes(language)) {
    throw new ValidationError(`lang must be one of: ${env.allowedLanguages.join(', ')}`);
  }

  return language;
}

export function getSourceId(value: unknown, name = 'source') {
  return getRequiredString(value, name, {
    maxLength: 40,
    pattern: /^[a-z0-9][a-z0-9-]*$/i
  });
}

export function getResourceId(value: unknown, name: string) {
  const id = getRequiredString(value, name, { maxLength: 4096 });

  if (/\p{Cc}/u.test(id)) {
    throw new ValidationError(`${name} contains invalid characters`);
  }

  return id;
}
