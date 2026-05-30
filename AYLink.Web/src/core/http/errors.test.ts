import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/i18n', () => ({
  t: (key: string, fallback = '') => `translated:${key}:${fallback}`
}));

import { readApiErrorMessage, resolveApiErrorMessage } from './errors';

describe('http errors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns string payloads directly', () => {
    expect(resolveApiErrorMessage('plain message', 'fallback')).toBe('plain message');
  });

  it('resolves nested error messages first', () => {
    expect(resolveApiErrorMessage({ error: { message: 'nested' } }, 'fallback')).toBe('nested');
  });

  it('uses translated message keys when available', () => {
    expect(resolveApiErrorMessage({ messageKey: 'Common.Denied', message: 'Denied' }, 'fallback')).toBe(
      'translated:Common.Denied:Denied'
    );
  });

  it('falls back when payload shape is unsupported', () => {
    expect(resolveApiErrorMessage(123, 'fallback')).toBe('fallback');
  });

  it('reads json error responses', async () => {
    const response = new Response(JSON.stringify({ message: 'Bad request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });

    await expect(readApiErrorMessage(response, 'fallback')).resolves.toBe('Bad request');
  });

  it('reads text error responses', async () => {
    const response = new Response('Plain failure', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });

    await expect(readApiErrorMessage(response, 'fallback')).resolves.toBe('Plain failure');
  });

  it('falls back when response parsing fails', async () => {
    const response = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: vi.fn(async () => {
        throw new Error('bad json');
      }),
      text: vi.fn(),
    } as unknown as Response;

    await expect(readApiErrorMessage(response, 'fallback')).resolves.toBe('fallback');
  });
});
