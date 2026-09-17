/**
 * Rendering a comment's Markdown in a browser.
 *
 * The phone renders the same bodies through `<Text>`, which has no DOM: a
 * `<script>` in a comment is five literal characters there whatever anybody
 * stored. A browser has no such luxury, so the rule here is absolute and worth
 * stating rather than assuming:
 *
 * **This never produces HTML.** No `dangerouslySetInnerHTML`, no innerHTML, no
 * parsing of tags. It walks the text and builds React elements, so every
 * character that is not one of the four markers below reaches the page as text.
 * The sanitiser in @waves/core strips HTML-shaped tags on the way *in*, but a
 * body written before that existed — or by a client that never ran it — is
 * still whatever it is, and this renderer must be safe against that on its own.
 * Anything that would change that rule is a security change, not a styling one.
 *
 * The supported subset matches the phone exactly, because the same comment has
 * to look like the same comment in both places: bold, italic, strikethrough,
 * inline code, and `-`/`*` bullet lists. Everything else is literal — an
 * unmatched `**` renders as two asterisks rather than swallowing the rest of
 * the paragraph.
 */

import type { ReactNode } from 'react';

/** The inline markers, longest first so `**` wins over `*`. */
const INLINE: { re: RegExp; wrap: (inner: ReactNode, key: string) => ReactNode }[] = [
  { re: /\*\*([^*]+)\*\*/, wrap: (inner, key) => <strong key={key}>{inner}</strong> },
  { re: /~~([^~]+)~~/, wrap: (inner, key) => <del key={key}>{inner}</del> },
  { re: /`([^`]+)`/, wrap: (inner, key) => <code key={key}>{inner}</code> },
  { re: /\*([^*]+)\*/, wrap: (inner, key) => <em key={key}>{inner}</em> },
];

/** The earliest marker in the line, so nesting resolves left to right. */
function firstMatch(text: string) {
  let best: { at: number; marker: (typeof INLINE)[number]; m: RegExpExecArray } | null = null;
  for (const marker of INLINE) {
    const m = marker.re.exec(text);
    if (!m) continue;
    if (!best || m.index < best.at) best = { at: m.index, marker, m };
  }
  return best;
}

/**
 * One line, with its inline markers turned into elements.
 *
 * Recursive on the text *after* the match rather than inside it: the subset has
 * no nesting, and recursing inward is how a pathological comment turns into a
 * stack overflow.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let n = 0;

  for (;;) {
    const hit = firstMatch(rest);
    if (!hit) {
      if (rest) nodes.push(rest);
      return nodes;
    }
    const before = rest.slice(0, hit.m.index);
    if (before) nodes.push(before);
    nodes.push(hit.marker.wrap(hit.m[1] ?? '', `${keyPrefix}-${n}`));
    rest = rest.slice(hit.m.index + hit.m[0].length);
    n += 1;
  }
}

const BULLET = /^[ \t]*[-*][ \t]+(.*)$/;

export function CommentMarkdown({ source }: { source: string }) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];

  // Consecutive bullet lines become one list, so a three-item list is a list
  // and not three lists of one.
  let bullets: string[] = [];
  const flush = (at: number) => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`ul-${at}`} className="comment-list">
        {items.map((item, index) => (
          <li key={index}>{inline(item, `li-${at}-${index}`)}</li>
        ))}
      </ul>,
    );
  };

  lines.forEach((line, index) => {
    const bullet = BULLET.exec(line);
    if (bullet) {
      bullets.push(bullet[1] ?? '');
      return;
    }
    flush(index);
    // A blank line is the paragraph break the sanitiser preserved; it needs no
    // element of its own because the paragraphs around it carry the spacing.
    if (line.trim() === '') return;
    blocks.push(<p key={`p-${index}`}>{inline(line, `p-${index}`)}</p>);
  });
  flush(lines.length);

  return <div className="comment-body">{blocks}</div>;
}
