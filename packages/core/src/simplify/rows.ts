/**
 * How the who-pays-whom screen is ordered and read.
 *
 * The screen used to be one undifferentiated stack of "A pays B" rows, and the
 * complaint about it was not that a number was wrong — it was that nobody could
 * tell what they were looking at. Two things caused that, and both are decided
 * here rather than in the JSX.
 *
 * The first is that a reader wants their own payments, and everybody else's are
 * context. So the list is split: the transfers that touch you, in the order the
 * ledger proposed them, then the rest under a heading of their own. The
 * headings appear only when there is something on both sides — a screen where
 * every row is yours does not need to be told so.
 *
 * The second is that a row about a pair has to point somewhere when it is
 * tapped, and "a pair" is not a destination. The counterparty is the person on
 * the row who is not you; on a row between two other people there is no such
 * person, so it leads with the payer — the one the sentence is about. One rule,
 * so the avatar, the tap and the words can never disagree about whose row it
 * is.
 */

export interface SimplifyTransfer {
  readonly from: string;
  readonly to: string;
  readonly currency: string;
  readonly amount: bigint;
}

/** Which of the three sentences a row is told with, and how its money reads. */
export enum SimplifySide {
  /** You are the payer: red money, "You pay {name}". */
  YouPay = 'youPay',
  /** You are the payee: the owed-to-you colour, "{name} pays you". */
  YouReceive = 'youReceive',
  /** Between two other people: a neutral amount, "{from} pays {to}". */
  Others = 'others',
}

export interface SimplifyRow {
  readonly kind: 'transfer';
  readonly key: string;
  readonly transfer: SimplifyTransfer;
  readonly side: SimplifySide;
  /**
   * The member the row leads with and a tap opens: the other person when you
   * are on the row, the payer when you are not.
   */
  readonly personId: string;
  /** Last of its section, so the hairline never runs into the heading below. */
  readonly isLast: boolean;
}

export interface SimplifyHeading {
  readonly kind: 'heading';
  readonly key: string;
  readonly section: 'yours' | 'others';
}

export type SimplifyItem = SimplifyRow | SimplifyHeading;

/**
 * The rows of the screen, in the order they are drawn.
 *
 * `myMemberId` is null until the members land (and for a person reading a group
 * they are not in) — everything is then "somebody else's", which is honest, and
 * it settles itself a frame later without the list changing shape.
 */
export function simplifyItems(
  transfers: readonly SimplifyTransfer[],
  myMemberId: string | null,
): SimplifyItem[] {
  const mine: SimplifyRow[] = [];
  const theirs: SimplifyRow[] = [];

  for (const transfer of transfers) {
    // The amount is part of the key: the pairwise view can propose two rows
    // between the same two people in different currencies, and a duplicated key
    // would make a recycling list draw one of them twice.
    const key = `${transfer.from}-${transfer.to}-${transfer.currency}-${transfer.amount}`;
    if (myMemberId && transfer.from === myMemberId) {
      mine.push({
        kind: 'transfer',
        key,
        transfer,
        side: SimplifySide.YouPay,
        personId: transfer.to,
        isLast: false,
      });
    } else if (myMemberId && transfer.to === myMemberId) {
      mine.push({
        kind: 'transfer',
        key,
        transfer,
        side: SimplifySide.YouReceive,
        personId: transfer.from,
        isLast: false,
      });
    } else {
      theirs.push({
        kind: 'transfer',
        key,
        transfer,
        side: SimplifySide.Others,
        personId: transfer.from,
        isLast: false,
      });
    }
  }

  const close = (rows: SimplifyRow[]): SimplifyRow[] =>
    rows.map((row, index) => ({ ...row, isLast: index === rows.length - 1 }));

  // Headings earn their place only by separating two things. One section on its
  // own is already unambiguous — the sentences say whose payment each row is.
  const split = mine.length > 0 && theirs.length > 0;
  const items: SimplifyItem[] = [];
  if (split) items.push({ kind: 'heading', key: 'heading-yours', section: 'yours' });
  items.push(...close(mine));
  if (split) items.push({ kind: 'heading', key: 'heading-others', section: 'others' });
  items.push(...close(theirs));
  return items;
}
