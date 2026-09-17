/**
 * What a comment can and cannot do to the page it is rendered on.
 *
 * The first block is the one that matters. Comment bodies are written by other
 * people in the group, and the phone is safe from them structurally — it renders
 * through `<Text>`, which has no DOM. The browser is only safe because this
 * renderer builds elements and never sets HTML, so these tests assert that on
 * the markup itself rather than trusting the sanitiser upstream: a body stored
 * before that sanitiser existed is still whatever it is.
 *
 * The rest pin the subset to the phone's, because the same comment has to look
 * like the same comment in both clients.
 */

// No DOM environment: `renderToStaticMarkup` produces the markup as a string,
// which is the thing under test. Asserting on a string is also what makes
// "never emits a tag" checkable — a DOM would have already parsed it.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { CommentMarkdown } from '../src/components/CommentMarkdown';

const html = (source: string) => renderToStaticMarkup(<CommentMarkdown source={source} />);
/** Every element the renderer actually emitted, in order. */
const tags = (source: string) => (html(source).match(/<[a-z]+/g) ?? []).map((tag) => tag.slice(1));
/** What a reader actually sees, with the markup stripped back off. */
const text = (source: string) =>
  html(source)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');

describe('a comment cannot reach the page', () => {
  it('renders a script tag as characters, not as a script', () => {
    const out = html('<script>alert(1)</script>');
    expect(tags('<script>alert(1)</script>')).toEqual(['div', 'p']);
    expect(out).toContain('&lt;script&gt;');
    expect(text('<script>alert(1)</script>')).toContain('<script>alert(1)</script>');
  });

  it('renders an img onerror as characters', () => {
    const out = html('<img src=x onerror=alert(1)>');
    // The handler's text is allowed to appear — as text. What must not exist is
    // a tag carrying it, so the assertion is on the elements emitted, not on
    // whether the characters are present anywhere in the string.
    expect(tags('<img src=x onerror=alert(1)>')).toEqual(['div', 'p']);
    expect(out).toContain('&lt;img');
  });

  it('does not turn a javascript: URL into a link', () => {
    // The subset has no links at all, by design — so a URL is text, and there
    // is no href for a scheme to be smuggled into.
    const out = html('[click me](javascript:alert(1))');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href');
  });

  it('does not emit an event handler attribute from any marker', () => {
    const out = html('**bold** ~~gone~~ `code` *italic*');
    expect(out).not.toMatch(/ on[a-z]+=/);
  });

  it('escapes an unclosed tag rather than letting it swallow the rest', () => {
    // The wrapper is a div, so "contains <div" proves nothing either way; the
    // element list does. Two elements out means the one in the comment stayed
    // text, and the text round-trips unchanged.
    expect(tags('a < b and <div still text')).toEqual(['div', 'p']);
    expect(text('a < b and <div still text')).toBe('a < b and <div still text');
  });
});

describe('the supported subset', () => {
  it('renders bold, italic, strikethrough and code', () => {
    expect(html('**b**')).toContain('<strong>b</strong>');
    expect(html('*i*')).toContain('<em>i</em>');
    expect(html('~~s~~')).toContain('<del>s</del>');
    expect(html('`c`')).toContain('<code>c</code>');
  });

  it('prefers bold over italic when both could match', () => {
    const out = html('**both**');
    expect(out).toContain('<strong>both</strong>');
    expect(out).not.toContain('<em>');
  });

  it('leaves an unmatched marker as literal text', () => {
    // The failure this guards: an unbalanced `**` swallowing the paragraph.
    expect(text('a ** b')).toBe('a ** b');
    expect(html('a ** b')).not.toContain('<strong>');
  });

  it('gathers consecutive bullets into one list', () => {
    const out = html('- one\n- two\n- three');
    expect(out.match(/<ul/g)).toHaveLength(1);
    expect(out.match(/<li>/g)).toHaveLength(3);
  });

  it('starts a new list after a paragraph between two sets of bullets', () => {
    const out = html('- one\n\nnot a bullet\n\n- two');
    expect(out.match(/<ul/g)).toHaveLength(2);
  });

  it('renders inline markers inside a bullet', () => {
    expect(html('- **b**')).toContain('<strong>b</strong>');
  });

  it('keeps each line its own paragraph', () => {
    expect(html('one\ntwo').match(/<p>/g)).toHaveLength(2);
  });

  it('renders nothing for an empty body', () => {
    expect(text('')).toBe('');
  });

  it('survives a long run of markers without recursing on itself', () => {
    // Recursing inward on each match is how a pathological body becomes a
    // stack overflow; this renders iteratively.
    const out = html('*a*'.repeat(500));
    expect(out.match(/<em>/g)).toHaveLength(500);
  });
});
