/**
 * Which words of a heard sentence were a person, and what a fix means for them.
 *
 * The saved expense knows who is in it, not which words said so, so the spans
 * are found again from the sentence with the same resolver the reader used. A
 * span is kept only when it points at somebody who is in the expense. When that
 * somebody is swapped for another, the swap answers the span: "raining" was
 * Renny, now it is Ravi, so "raining" is learned as Ravi (`voiceNames`).
 */

import {
  isMeWord,
  resolveSpokenName,
  type LearnedName,
  type VoiceNameCandidate,
} from '@waves/core';

import type { SavedState } from '@/lib/followUpApply';

export interface HeardName {
  /** The words as said, cut from the sentence. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly memberId: string;
}

export interface HeardSegment {
  readonly text: string;
  readonly name?: HeardName;
}

/** Longest run of words tried as one name ("Ravi Kumar"). */
const MAX_WORDS = 2;

/**
 * The spans of `transcript` that name each of `memberIds` (the viewer never
 * counts), best match first taken, no word used twice. A member nothing in the
 * sentence clearly names has no span.
 */
export function findHeardNames(
  transcript: string,
  members: readonly VoiceNameCandidate[],
  memberIds: readonly string[],
  learned: readonly LearnedName[] = [],
): HeardName[] {
  const words = [...transcript.matchAll(/\p{L}[\p{L}'’]*/gu)].map((m) => ({
    text: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const wanted = new Set(memberIds.filter((id) => !members.find((m) => m.id === id)?.isMe));
  const fits: { name: HeardName; score: number; from: number; to: number }[] = [];
  for (let from = 0; from < words.length; from++) {
    for (let size = 1; size <= MAX_WORDS && from + size <= words.length; size++) {
      const run = words.slice(from, from + size);
      const first = run[0];
      const last = run[run.length - 1];
      if (!first || !last || run.some((w) => w.text.length < 3 || isMeWord(w.text))) continue;
      const text = transcript.slice(first.start, last.end);
      // Only the words between are cut, so two words must touch with one space.
      if (!/^\S+(\s\S+)?$/u.test(text)) continue;
      const out = resolveSpokenName(text, members, { learned, span: 'weak' });
      if ((out.status !== 'resolved' && out.status !== 'suggested') || !wanted.has(out.id))
        continue;
      fits.push({
        name: { text, start: first.start, end: last.end, memberId: out.id },
        score: out.score,
        from,
        to: from + size,
      });
    }
  }
  // Highest score first; the shorter run wins a tie, so "and" is never swept in.
  fits.sort((a, b) => b.score - a.score || a.to - a.from - (b.to - b.from));
  const used = new Set<number>();
  const taken = new Set<string>();
  const out: HeardName[] = [];
  for (const fit of fits) {
    if (taken.has(fit.name.memberId)) continue;
    let free = true;
    for (let i = fit.from; i < fit.to; i++) if (used.has(i)) free = false;
    if (!free) continue;
    for (let i = fit.from; i < fit.to; i++) used.add(i);
    taken.add(fit.name.memberId);
    out.push(fit.name);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The sentence cut into plain runs and name spans, in order. */
export function heardSegments(transcript: string, names: readonly HeardName[]): HeardSegment[] {
  const out: HeardSegment[] = [];
  let at = 0;
  for (const name of [...names].sort((a, b) => a.start - b.start)) {
    if (name.start < at) continue;
    if (name.start > at) out.push({ text: transcript.slice(at, name.start) });
    out.push({ text: name.text, name });
    at = name.end;
  }
  if (at < transcript.length) out.push({ text: transcript.slice(at) });
  return out;
}

/**
 * The people in a saved expense, payers and sharers, once each.
 */
export function savedPeople(state: SavedState): string[] {
  return [...new Set([...Object.keys(state.payers ?? {}), ...state.participants])];
}

/**
 * What a change of people answered: exactly one heard name's person was swapped
 * for exactly one other. Anything wider (several swapped, somebody only added
 * or dropped) is not clearly a correction of what was heard, so it is none.
 */
export function swappedName(
  names: readonly HeardName[],
  before: readonly string[],
  after: readonly string[],
): { heard: string; from: string; to: string } | null {
  const removed = before.filter((id) => !after.includes(id));
  const added = after.filter((id) => !before.includes(id));
  const [from] = removed;
  const [to] = added;
  if (removed.length !== 1 || added.length !== 1 || !from || !to) return null;
  const name = names.find((n) => n.memberId === from);
  return name ? { heard: name.text, from, to } : null;
}

/** The expense with one person swapped for another, as payer and sharer alike. */
export function swapPerson(state: SavedState, from: string, to: string): SavedState {
  const swap = (id: string): string => (id === from ? to : id);
  let payers = state.payers;
  if (payers && from in payers) {
    const next: Record<string, bigint> = {};
    for (const [id, amount] of Object.entries(payers))
      next[swap(id)] = (next[swap(id)] ?? 0n) + amount;
    payers = next;
  }
  return { ...state, payers, participants: [...new Set(state.participants.map(swap))] };
}
