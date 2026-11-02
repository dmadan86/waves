import { isValidVpa } from '../settlement/apply';
import { billDueMinor, docNumberLabel } from './documents';

/**
 * `upi://pay` link for the amount still due on a bill, or null when there is nothing to scan:
 * not INR, nothing due, or a bad VPA. The company confirms receipt by hand, so the exact due amount is right.
 */
export function billUpiLink(input: {
  vpa: string;
  payeeName: string;
  totalMinor: bigint;
  paidMinor: bigint;
  currency: string;
  number: number | null;
}): string | null {
  const due = billDueMinor(input.totalMinor, input.paidMinor);
  if (input.currency !== 'INR' || due <= 0n || !isValidVpa(input.vpa)) return null;
  const am = `${due / 100n}.${String(due % 100n).padStart(2, '0')}`;
  const tn = docNumberLabel('bill', input.number).slice(0, 50);
  const q = encodeURIComponent;
  return `upi://pay?pa=${q(input.vpa)}&pn=${q(input.payeeName.trim().slice(0, 60) || input.vpa)}&am=${am}&cu=INR&tn=${q(tn)}`;
}
