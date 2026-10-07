/**
 * The one question the voice review asks when a spoken amount could be read two
 * ways — "Was that ₹15 or ₹50?", "₹500 total or ₹500 each?", "US or Australian
 * dollars?" — and the answers it offers. Pure: the screen renders it and applies
 * the picked answer to the draft.
 */

import { minorToDecimal, type VoiceAmountReading } from '@waves/core';

export interface VoiceAmountChoiceStrings {
  /** "Was that {a} or {b}?" */
  amountWhich: string;
  /** "{amount} total or {amount} each?" */
  amountTotalOrEach: string;
  /** "{amount} total" */
  amountTotal: string;
  /** "{amount} each" */
  amountEach: string;
  /** "US or Australian dollars?" */
  whichDollars: string;
  /** Currency names for the dollar choice, by ISO code. */
  dollarNames: Readonly<Record<string, string>>;
}

export interface VoiceAmountAnswer {
  readonly key: string;
  readonly label: string;
  /** The draft's new amount, as a major decimal string — or unchanged when absent. */
  readonly amount?: string;
  /** The draft's new currency — or unchanged when absent. */
  readonly currency?: string;
}

export interface VoiceAmountQuestion {
  readonly kind: 'amount' | 'currency';
  readonly prompt: string;
  readonly answers: readonly VoiceAmountAnswer[];
}

/**
 * The amount question, if the reading has one. `currency` is the one the
 * reading's minor units are in (the spoken one, or null for the two-decimal
 * default); `format` renders a major decimal string for the screen; `people` is
 * how many share the bill (null when unknown, which leaves out the "each"
 * answer — it cannot be totalled).
 */
export function voiceAmountQuestion(
  reading: VoiceAmountReading | null,
  currency: string | null,
  people: number | null,
  strings: VoiceAmountChoiceStrings,
  formatMajor: (major: string) => string,
): VoiceAmountQuestion | null {
  const format = (minor: bigint): string => formatMajor(minorToDecimal(minor, currency));
  if (!reading || reading.options.length < 2) return null;
  const [first, second] = reading.options;
  if (reading.ambiguity === 'teen-vs-ty' || reading.ambiguity === 'decimal-or-hundreds') {
    const a = format(first.minor);
    const b = format(second.minor);
    return {
      kind: 'amount',
      prompt: strings.amountWhich.replace('{a}', a).replace('{b}', b),
      answers: [
        { key: 'a', label: a, amount: minorToDecimal(first.minor, currency) },
        { key: 'b', label: b, amount: minorToDecimal(second.minor, currency) },
      ],
    };
  }
  if (reading.ambiguity === 'total-or-each') {
    const share = first.minor;
    const shown = format(share);
    const answers: VoiceAmountAnswer[] = [
      {
        key: 'total',
        label: strings.amountTotal.replace('{amount}', shown),
        amount: minorToDecimal(share, currency),
      },
    ];
    if (people !== null && people > 0)
      answers.push({
        key: 'each',
        label: strings.amountEach.replace('{amount}', shown),
        amount: minorToDecimal(share * BigInt(people), currency),
      });
    return {
      kind: 'amount',
      prompt: strings.amountTotalOrEach.replace(/\{amount\}/g, shown),
      answers,
    };
  }
  return null;
}

/** The currency question, if the reading left the currency open. */
export function voiceCurrencyQuestion(
  reading: VoiceAmountReading | null,
  strings: VoiceAmountChoiceStrings,
): VoiceAmountQuestion | null {
  if (!reading || reading.currencyOptions.length < 2) return null;
  return {
    kind: 'currency',
    prompt: strings.whichDollars,
    answers: reading.currencyOptions.map((code) => ({
      key: code,
      label: strings.dollarNames[code] ?? code,
      currency: code,
    })),
  };
}
