/** Pure account/session guards used by the runtime and exercised without RN. */
export const ownerMismatch = (storedOwner: string | null, profileId: string): boolean =>
  storedOwner !== profileId;

export class SessionGeneration {
  private value = 0;

  bump(): () => boolean {
    const captured = ++this.value;
    return () => captured === this.value;
  }

  invalidate(): void {
    this.value += 1;
  }
}
