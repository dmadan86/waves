/** Pure helpers behind the task-note formatting toolbar (`**bold**`, `_italic_`, `~~strike~~`). */

export interface Selection {
  start: number;
  end: number;
}

export type WrapMarker = '**' | '_' | '~~';

/** Move an offset off the middle of a surrogate pair so an emoji is never split. */
function snap(text: string, i: number, dir: -1 | 1): number {
  const at = Math.min(Math.max(i, 0), text.length);
  const c = at < text.length ? text.charCodeAt(at) : 0;
  return at > 0 && c >= 0xdc00 && c <= 0xdfff ? at + dir : at;
}

/**
 * Toggle `marker` around the selection. Wraps it, or unwraps when the selection
 * is already wrapped (markers just outside it, or at both of its edges). An empty
 * selection inserts a pair with the caret between, or removes an empty pair.
 */
export function toggleWrap(
  text: string,
  selection: Selection,
  marker: WrapMarker,
): { text: string; selection: Selection } {
  const lo = Math.min(selection.start, selection.end);
  const hi = Math.max(selection.start, selection.end);
  const start = snap(text, lo, lo === hi ? 1 : -1);
  const end = snap(text, hi, 1);
  const m = marker.length;
  const before = text.slice(0, start);
  const mid = text.slice(start, end);
  const after = text.slice(end);

  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text: before.slice(0, -m) + mid + after.slice(m),
      selection: { start: start - m, end: end - m },
    };
  }
  if (mid.length >= 2 * m && mid.startsWith(marker) && mid.endsWith(marker)) {
    return { text: before + mid.slice(m, -m) + after, selection: { start, end: end - 2 * m } };
  }
  return {
    text: before + marker + mid + marker + after,
    selection: { start: start + m, end: end + m },
  };
}
