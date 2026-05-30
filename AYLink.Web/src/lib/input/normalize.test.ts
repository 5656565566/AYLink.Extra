import { describe, expect, it } from 'vitest';
import {
  normalizeDeviceId,
  normalizePackageName,
  normalizeRemotePath,
  sanitizeDownloadFileName
} from './normalize';

describe('normalize helpers', () => {
  it('normalizes device ids by trimming and removing control characters', () => {
    expect(normalizeDeviceId('  abc\u0000\r\n ')).toBe('abc');
  });

  it('normalizes package names to safe characters', () => {
    expect(normalizePackageName(' com.demo.app ; rm -rf ')).toBe('com.demo.apprm-rf');
  });

  it('normalizes remote paths to slash-based absolute paths', () => {
    expect(normalizeRemotePath(' \\sdcard\\\\Download\\test/ ')).toBe('/sdcard/Download/test');
  });

  it('sanitizes download file names', () => {
    expect(sanitizeDownloadFileName('bad:file?.apk', 'fallback.apk')).toBe('bad_file_.apk');
  });
});
