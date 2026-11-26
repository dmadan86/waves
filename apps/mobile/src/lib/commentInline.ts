/**
 * The inline markers a comment may carry, with no React in sight so the rule is testable.
 * `_` only opens or closes emphasis at a word edge, so "hello_from_B" or a file
 * name like "my_file_v2" stays literal text instead of losing its underscores.
 */
export type InlineKind = 'bold' | 'strike' | 'italic';

export const INLINE_MARKERS: { re: RegExp; kind: InlineKind; group: number }[] = [
  { re: /\*\*([\s\S]+?)\*\*/, kind: 'bold', group: 1 },
  { re: /~~([\s\S]+?)~~/, kind: 'strike', group: 1 },
  { re: /(\*)([\s\S]+?)\1/, kind: 'italic', group: 2 },
  {
    re: /(?<![\p{L}\p{N}_])(_)(?=\S)([\s\S]+?)(?<=\S)\1(?![\p{L}\p{N}_])/u,
    kind: 'italic',
    group: 2,
  },
];

/** The earliest inline match across all markers, or null when the text is plain. */
export function firstInlineMatch(
  text: string,
): { m: RegExpExecArray; kind: InlineKind; group: number } | null {
  let best: { m: RegExpExecArray; kind: InlineKind; group: number } | null = null;
  for (const marker of INLINE_MARKERS) {
    const m = marker.re.exec(text);
    // Strictly-smaller keeps ties on the first (higher-precedence) marker.
    if (m && (best === null || m.index < best.m.index)) {
      best = { m, kind: marker.kind, group: marker.group };
    }
  }
  return best;
}
