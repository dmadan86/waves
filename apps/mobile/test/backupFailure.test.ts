import { describe, expect, it } from 'vitest';
import { backupFailure } from '../src/lib/backup/failure';
import { CloudAuthError } from '../src/lib/cloud/oauth';
import { CloudHttpError } from '../src/lib/cloud/http';

describe('backupFailure', () => {
  it.each(['not-set-up', 'play-services', 'failed'] as const)('classifies %s sign-in errors', (fault) => {
    expect(backupFailure(new CloudAuthError(fault, '10', 'private detail'))).toEqual({
      code: 'SIGNIN_10', kind: 'reconnect',
    });
    expect(backupFailure(new CloudAuthError(fault, null, 'private detail'))).toEqual({
      code: 'SIGNIN', kind: 'reconnect',
    });
  });

  it('prioritizes Drive quota over HTTP status', () => {
    const body = JSON.stringify({ error: { errors: [{ reason: 'storageQuotaExceeded' }] } });
    for (const status of [401, 403]) {
      expect(backupFailure(new CloudHttpError(status, body))).toEqual({
        code: 'DRIVE_QUOTA', kind: 'full',
      });
    }
  });

  it.each([401, 403, 429, 500])('classifies Drive HTTP %i', (status) => {
    expect(backupFailure(new CloudHttpError(status, 'private response'))).toEqual({
      code: `DRIVE_${status}`, kind: status === 401 ? 'reconnect' : 'other',
    });
  });

  it.each(['Network request failed', 'Failed to fetch', 'OFFLINE', 'Upload timed out', 'ENOTFOUND'])('classifies network error: %s', (message) => {
    expect(backupFailure(new Error(message))).toEqual({ code: 'NETWORK', kind: 'network' });
  });

  it.each(['ForegroundServiceStartNotAllowedException', 'Backup service timeout'])('classifies native service error: %s', (message) => {
    expect(backupFailure(new Error(message))).toEqual({ code: 'FGS_TIMEOUT', kind: 'other' });
  });

  it.each([null, undefined, 42, {}, new Error('token=secret person@example.com'), 'private detail'])('returns only a safe code and kind for unknown failures: %s', (caught) => {
    expect(backupFailure(caught)).toEqual({ code: 'UNKNOWN', kind: 'other' });
  });

  it('classifies string rejections without returning their contents', () => {
    expect(backupFailure('fetch failed token=secret person@example.com')).toEqual({
      code: 'NETWORK', kind: 'network',
    });
  });
});
