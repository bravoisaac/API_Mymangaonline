import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getEnumValue,
  getLanguage,
  getOptionalString,
  getQueryInteger,
  getRequiredString,
  getResourceId,
  getSourceId,
  getStringArray
} from './requestValidation';

test('accepts and normalizes valid scalar inputs', () => {
  assert.equal(getRequiredString('  berserk  ', 'q', { maxLength: 20 }), 'berserk');
  assert.equal(getOptionalString(undefined, 'source'), '');
  assert.equal(getQueryInteger('15', 'limit', 10, 1, 100), 15);
  assert.equal(getEnumValue('desc', 'order', ['asc', 'desc'] as const, 'asc'), 'desc');
  assert.equal(getLanguage('PT-BR'), 'pt-br');
  assert.equal(getSourceId('mangadex'), 'mangadex');
  assert.equal(getResourceId('safe_base64-url', 'id'), 'safe_base64-url');
});

test('rejects arrays and objects where a scalar is required', () => {
  assert.throws(() => getRequiredString(['one', 'two'], 'q'), /q must be a string/);
  assert.throws(() => getOptionalString({ value: 'one' }, 'q'), /q must be a string/);
});

test('rejects oversized and out-of-range values instead of silently clamping them', () => {
  assert.throws(() => getRequiredString('12345', 'q', { maxLength: 4 }), /at most 4/);
  assert.throws(() => getQueryInteger('101', 'limit', 10, 1, 100), /between 1 and 100/);
  assert.throws(() => getQueryInteger('1.5', 'limit', 10, 1, 100), /must be an integer/);
});

test('enforces language, enum, source and collection allowlists', () => {
  assert.throws(() => getLanguage('de'), /lang must be one of/);
  assert.throws(() => getEnumValue('sideways', 'order', ['asc', 'desc'] as const, 'asc'), /must be one of/);
  assert.throws(() => getSourceId('../internal'), /invalid format/);
  assert.throws(() => getStringArray(['1', '2', '3'], 'tagIds', { maxItems: 2 }), /at most 2/);
});

test('rejects control characters in resource ids', () => {
  assert.throws(() => getResourceId('safe\u0000unsafe', 'id'), /invalid characters/);
});
