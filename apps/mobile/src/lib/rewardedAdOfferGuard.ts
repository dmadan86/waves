/** A blur invalidates pending work even if the screen refocuses before it resolves. */
export function createOfferGuard() {
  let focused = false;
  let generation = 0;
  return {
    setFocused(value: boolean) {
      if (focused !== value) ++generation;
      focused = value;
    },
    begin: () => ++generation,
    isCurrent: (request: number) => focused && request === generation,
  };
}
