/** Core's rail hints are written about someone else ("Their UPI ID"); your own page says "Your". */
export function ownRailHint(hint: string): string {
  return hint.replace(/^Their /, 'Your ').replace(/ their /g, ' your ');
}
