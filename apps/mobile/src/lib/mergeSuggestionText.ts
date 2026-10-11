/**
 * The words on the merge screen's "Likely duplicates" rows.
 *
 * Split from `data/mergePeople` so that module stays free of i18n: finding the
 * sets is data, saying why they were found is copy. Pure, so the reason line a
 * person reads before an irreversible merge is something a test can pin down.
 */
import type { DuplicateSet } from '@/data/mergePeople';
import { fill, plural, type PluralForms } from '@/i18n';
import { displayPhone } from '@/lib/phone';

/** The strings the reason line needs, a subset of `t.mergePeople`. */
export interface DuplicateReasonStrings {
  readonly reasonSameName: string;
  readonly reasonSamePhone: string;
  readonly reasonSameEmail: string;
  readonly reasonJoin: string;
  readonly groupCount: PluralForms;
}

/** Left-to-right isolate: a number or address keeps its order in an RTL line. */
const LRI = '⁦';
const PDI = '⁩';

/** "Renny · Renny": the names in the set, joined the way the design draws them. */
export function duplicateNames(set: DuplicateSet): string {
  return set.people.map((row) => row.display_name).join(' · ');
}

/**
 * The muted line under a suggestion: which signal matched, then how far the set
 * reaches, e.g. "Same name · 2 groups" or "Same phone +91 97138 12345 · 1 group".
 *
 * The signal is named because it is the evidence the person is being asked to
 * weigh: a shared number is near-proof, a shared name is a hint, and the row
 * must not let the two read alike. The number or address is isolated as LTR so
 * an Arabic line does not reverse "+91" to the far end.
 */
export function duplicateReason(
  set: DuplicateSet,
  locale: string,
  t: DuplicateReasonStrings,
): string {
  const signal =
    set.signal.kind === 'phone'
      ? fill(t.reasonSamePhone, {
          phone: `${LRI}${displayPhone(set.signal.phone) || set.signal.phone}${PDI}`,
        })
      : set.signal.kind === 'email'
        ? fill(t.reasonSameEmail, { email: `${LRI}${set.signal.email}${PDI}` })
        : t.reasonSameName;
  return fill(t.reasonJoin, {
    signal,
    groups: plural(locale, set.groupCount, t.groupCount),
  });
}
