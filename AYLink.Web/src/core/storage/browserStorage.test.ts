import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readLocalBoolean,
  readLocalJson,
  readLocalString,
  readSessionJson,
  readSessionString,
  removeLocalValue,
  removeSessionValue,
  writeLocalBoolean,
  writeLocalJson,
  writeLocalString,
  writeSessionJson,
  writeSessionString,
} from './browserStorage';

describe('browserStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('reads and writes local string and boolean values', () => {
    writeLocalString('token', 'abc');
    writeLocalBoolean('enabled', true);

    expect(readLocalString('token')).toBe('abc');
    expect(readLocalBoolean('enabled')).toBe(true);
    expect(readLocalBoolean('missing', true)).toBe(true);
  });

  it('reads and writes session json values', () => {
    writeSessionJson('tabs', [{ key: 'a' }]);

    expect(readSessionJson<{ key: string }[]>('tabs')).toEqual([{ key: 'a' }]);
  });

  it('returns null for invalid json payloads', () => {
    window.localStorage.setItem('broken', '{');
    window.sessionStorage.setItem('broken', '{');

    expect(readLocalJson('broken')).toBeNull();
    expect(readSessionJson('broken')).toBeNull();
  });

  it('swallows storage read and write failures', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => writeLocalString('token', 'abc')).not.toThrow();
    expect(readLocalString('token')).toBeNull();
  });

  it('removes stored values without throwing', () => {
    writeLocalJson('profile', { id: 1 });
    writeSessionString('active', 'tab-1');

    removeLocalValue('profile');
    removeSessionValue('active');

    expect(readLocalJson('profile')).toBeNull();
    expect(readSessionString('active')).toBeNull();
  });
});
