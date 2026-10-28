/**
 * One pattern for every permission ask: check first; granted proceeds silently;
 * not yet asked shows OUR explainer, and only its "Continue" reaches the native
 * dialog; permanently denied offers Settings instead. Our explainer and the
 * native dialog are never up together, and the native request is never called
 * before the explainer resolves.
 *
 * The decision and the sequencing are plain functions over injected callbacks so
 * they are testable; `PermissionHost` registers the real explainer sheet.
 */

import { setOverlayBusy } from '@/lib/firstRun';

export type PermissionKind =
  'mic' | 'contacts' | 'notifications' | 'location' | 'camera' | 'photos';

export interface PermissionState {
  granted: boolean;
  canAskAgain: boolean;
}

export type PermissionStep = 'proceed' | 'explain' | 'settings';

/** Pure: what to do given the current status. */
export function permissionStep(state: PermissionState): PermissionStep {
  if (state.granted) return 'proceed';
  return state.canAskAgain ? 'explain' : 'settings';
}

export type ExplainResult = 'continue' | 'settings' | 'cancel';
export type Explainer = (
  kind: PermissionKind,
  step: 'explain' | 'settings',
) => Promise<ExplainResult>;

let explainer: Explainer | null = null;

export function registerPermissionExplainer(next: Explainer): () => void {
  explainer = next;
  return () => {
    if (explainer === next) explainer = null;
  };
}

export interface PermissionOps {
  check: () => Promise<PermissionState>;
  request: () => Promise<PermissionState>;
  openSettings?: () => void | Promise<void>;
  /** Overrides the registered explainer (tests). */
  explain?: Explainer;
}

/**
 * Resolves the final state. Never throws on a refusal; `granted: false` is the
 * answer. With no explainer mounted (boot, tests) it asks natively directly.
 */
export function ensurePermission(
  kind: PermissionKind,
  ops: PermissionOps,
): Promise<PermissionState> {
  // One ask at a time: the whole check -> explainer -> native transaction is
  // serialised, and the status is re-read inside it, so a second caller sees the
  // first one's answer instead of stacking its own explainer on the dialog.
  const run = chain.then(() => ask(kind, ops));
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let chain: Promise<void> = Promise.resolve();

/** Lets the explainer finish its exit animation before the system dialog opens. */
export const EXPLAINER_SETTLE_MS = 300;

async function ask(kind: PermissionKind, ops: PermissionOps): Promise<PermissionState> {
  const current = await ops.check();
  const step = permissionStep(current);
  if (step === 'proceed') return current;

  const explain = ops.explain ?? explainer;
  if (explain) {
    const choice = await explain(kind, step);
    if (choice === 'settings') {
      if (step === 'settings') await ops.openSettings?.();
      return current;
    }
    if (choice === 'cancel') return current;
  } else if (step === 'settings') {
    return current;
  }
  if (step === 'settings') return current;

  // The explainer is closed; the native dialog is the only thing up now.
  setOverlayBusy('permission', true);
  try {
    if (explain) await new Promise((resolve) => setTimeout(resolve, EXPLAINER_SETTLE_MS));
    return await ops.request();
  } finally {
    setOverlayBusy('permission', false);
  }
}
