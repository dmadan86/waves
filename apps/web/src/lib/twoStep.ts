/** Company two-step login: the pure rules (redirect decision, `next` sanitiser, error codes). */

export interface TwoStepStatus {
  sessionVerified: boolean;
  hasPhone: boolean;
  hasAuthenticator: boolean;
  pendingDevice: boolean;
  requiring: { groupId: string; name: string }[];
}

/** Only same-origin relative paths: one leading '/', never '//' or '/\'. Anything else is '/'. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f]/.test(next)) return '/';
  return next;
}

/** Where to send this page's reader to verify, or null to leave them where they are. */
export function needsTwoStep(
  pathname: string,
  status: TwoStepStatus | null,
  search = '',
): string | null {
  if (!status || status.sessionVerified) return null;
  const groupId = /^\/c\/([^/]+)/.exec(pathname)?.[1];
  if (!groupId || !status.requiring.some((c) => c.groupId === groupId)) return null;
  return `/auth/two-step?next=${encodeURIComponent(safeNext(pathname + search))}`;
}

/** The `{ code }` an edge function put in its error body, or null. */
export async function invokeErrorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { code?: string };
      return body.code ?? null;
    } catch {
      // not JSON
    }
  }
  return null;
}
