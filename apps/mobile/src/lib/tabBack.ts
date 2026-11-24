/**
 * Back from a bar tab root whose siblings replace each other (household, company):
 * one function runs for both the hardware button and every header chevron, so the
 * two can never disagree. Pure over injected deps so a test can drive both paths.
 */
export interface TabBackDeps {
  /** Sets (or clears) the override the guarded router's `back()` consults. */
  readonly setOverride: (fn: (() => void) | null) => void;
  /** Registers a hardware-back listener; a true return consumes the press. */
  readonly addHardwareBack: (handler: () => boolean) => { remove: () => void };
}

/** Installs `back` on both paths; returns the cleanup, or undefined when there is nothing to do. */
export function installTabBack(
  back: (() => void) | null,
  deps: TabBackDeps,
): (() => void) | undefined {
  if (back === null) return undefined;
  deps.setOverride(back);
  const listener = deps.addHardwareBack(() => {
    back();
    return true;
  });
  return () => {
    deps.setOverride(null);
    listener.remove();
  };
}
