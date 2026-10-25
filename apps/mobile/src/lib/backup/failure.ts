import { CloudAuthError } from '../cloud/oauth';
import { CloudHttpError } from '../cloud/http';

export function backupFailure(caught: unknown): {
  code: string;
  kind: 'reconnect' | 'full' | 'network' | 'other';
} {
  if (caught instanceof CloudAuthError) {
    return { code: caught.status ? `SIGNIN_${caught.status}` : 'SIGNIN', kind: 'reconnect' };
  }
  if (caught instanceof CloudHttpError) {
    if (caught.code === 'quota') return { code: 'DRIVE_QUOTA', kind: 'full' };
    return {
      code: `DRIVE_${caught.status}`,
      kind:
        caught.status === 401 || (caught.status === 403 && !caught.code) ? 'reconnect' : 'other',
    };
  }
  const message =
    caught instanceof Error ? caught.message : typeof caught === 'string' ? caught : '';
  if (/network|fetch|offline|timed out|ENOTFOUND/i.test(message)) {
    return { code: 'NETWORK', kind: 'network' };
  }
  if (/ForegroundServiceStartNotAllowed|timeout/i.test(message)) {
    return { code: 'FGS_TIMEOUT', kind: 'other' };
  }
  return { code: 'UNKNOWN', kind: 'other' };
}
