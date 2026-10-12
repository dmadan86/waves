/**
 * The sentence for a refused undo, shared by the Result screen and the banner so
 * the two never say different things about the same error.
 */

import type { UiStrings } from '@/i18n';

export function undoErrorText(caught: unknown, g: UiStrings['groupImport']): string {
  const code = (caught as { code?: string } | null)?.code;
  if (code === 'IMPORT_EDITED') return g.undoEdited;
  if (code === 'IMPORT_UNDO_EXPIRED') return g.undoExpired;
  if (code === 'NOT_ALLOWED') return g.undoNotAllowed;
  return g.undoFailed;
}
