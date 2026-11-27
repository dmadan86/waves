/** Pure account/session guards used by the runtime and exercised without RN. */
export const ownerMismatch = (storedOwner: string | null, profileId: string): boolean =>
  storedOwner !== null && storedOwner !== profileId;

export const canAdoptLegacyOwner = (lastProfileId: string | null, profileId: string): boolean =>
  lastProfileId !== null && lastProfileId === profileId;

export class SessionGeneration {
  private value = 0;

  snapshot(): number {
    return this.value;
  }
  matches(captured: number): boolean {
    return captured === this.value;
  }

  bump(): () => boolean {
    const captured = ++this.value;
    return () => captured === this.value;
  }

  invalidate(): void {
    this.value += 1;
  }
}
