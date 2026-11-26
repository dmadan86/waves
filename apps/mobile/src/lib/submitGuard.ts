/**
 * One save per intent. A second tap while a submit is in flight is a no-op
 * (checked synchronously, so it holds before React re-renders a `disabled`
 * button), and the record id is minted once per intent, not once per tap: a
 * retry after a failure re-sends the same id, so the server dedupes it.
 */
export function createSubmitGuard(mint: () => string) {
  let busy = false;
  let current: { key: string; id: string } | null = null;
  return {
    async run<T>(key: string, submit: (id: string) => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      if (current?.key !== key) current = { key, id: mint() };
      try {
        const result = await submit(current.id);
        current = null; // saved: the next submit is a new intent
        return result;
      } finally {
        busy = false;
      }
    },
  };
}
