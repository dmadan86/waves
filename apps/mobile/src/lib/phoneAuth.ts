/**
 * Signing in with a phone number, which is two different systems shaking hands.
 *
 * Firebase sends the code and checks it — it is the only way to deliver an SMS
 * worldwide without a registered company, a DLT filing per country, or a monthly
 * bill. What Firebase cannot do is hand out a Waves session, so once it has
 * proved the number the assertion goes to `phone-verify`, which checks Google's
 * signature and mints a Supabase session the ordinary way (see that function's
 * header for why it cannot simply be minted).
 *
 * Firebase is a **native module**, and that is the whole reason this file is
 * shaped the way it is. Requiring it at the top level would mean an app whose
 * JavaScript was updated over the air, on a binary built before this change,
 * dies at launch — not on the phone screen, at launch, with nothing local to
 * catch it. So it is required lazily, behind a check that cannot throw, and
 * `phoneSignInAvailable()` is the honest answer to "can this build do this at
 * all" for anything that would otherwise offer a door to nowhere.
 */

import { backend } from '@/lib/backend';

/** What Firebase hands back between sending a code and checking it. */
interface PhoneConfirmation {
  confirm(code: string): Promise<{ user: { getIdToken(): Promise<string> } } | null>;
}

interface FirebaseAuth {
  (): {
    signInWithPhoneNumber(phone: string): Promise<PhoneConfirmation>;
    signOut(): Promise<void>;
  };
}

/**
 * `undefined` means nobody has looked yet; `null` means we looked and this build
 * has no Firebase in it. The distinction matters — the check runs once and its
 * answer, including the negative, is kept.
 */
let module_: FirebaseAuth | null | undefined;

function firebaseAuth(): FirebaseAuth | null {
  if (module_ !== undefined) return module_;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('@react-native-firebase/auth') as { default?: FirebaseAuth };
    module_ = loaded.default ?? null;
  } catch {
    module_ = null;
  }
  return module_;
}

/** Whether this build can sign somebody in by phone at all. */
export function phoneSignInAvailable(): boolean {
  return firebaseAuth() !== null;
}

/**
 * The verification in flight.
 *
 * One at a time, because one screen is asking: the code screen follows the
 * number screen and there is no way to have two going at once. Held here rather
 * than in the screen's state so a remount mid-flow does not lose it.
 */
let pending: { phone: string; confirmation: PhoneConfirmation } | null = null;

export class PhoneSignInUnavailable extends Error {
  constructor() {
    super('This version of the app cannot sign in by phone.');
    this.name = 'PhoneSignInUnavailable';
  }
}

/** Firebase sends the SMS. Nothing of ours is called until the code is right. */
export async function sendPhoneCode(phone: string): Promise<void> {
  const auth = firebaseAuth();
  if (!auth) throw new PhoneSignInUnavailable();
  const confirmation = await auth().signInWithPhoneNumber(phone);
  pending = { phone, confirmation };
}

/**
 * Check the code with Firebase, then trade its assertion for a Waves session.
 *
 * The Firebase session is signed out immediately afterwards, and deliberately:
 * it was only ever a way to prove the number, this app keeps no state in it, and
 * leaving one signed in means a token sitting on the device that `phone-verify`
 * would accept as proof for the next ten minutes.
 */
/**
 * Check the code with Firebase and come away with its signed assertion.
 *
 * Shared by both things a proved number can be used for, because the proving is
 * identical and only what follows differs. The Firebase session is signed out
 * the moment the token is in hand: it was never more than a way to prove the
 * number, and leaving one signed in means a token on the device that
 * `phone-verify` would accept for the next ten minutes.
 */
async function proveNumber(phone: string, code: string): Promise<string> {
  const auth = firebaseAuth();
  if (!auth) throw new PhoneSignInUnavailable();
  if (!pending || pending.phone !== phone) {
    // The number changed under the code screen, or the flow was resumed from
    // somewhere that never sent a code. Asking Firebase to confirm against a
    // stale verification would fail with something unreadable.
    throw new Error('Ask for a new code.');
  }

  const credential = await pending.confirmation.confirm(code);
  if (!credential?.user) throw new Error('That code did not work.');

  try {
    return await credential.user.getIdToken();
  } finally {
    pending = null;
    await auth()
      .signOut()
      .catch(() => undefined);
  }
}

export async function confirmPhoneCode(phone: string, code: string): Promise<void> {
  const idToken = await proveNumber(phone, code);

  const { data, error } = await backend.functions.invoke('phone-verify', {
    body: { idToken },
  });
  if (error) throw error;

  const session = data as { access_token?: string; refresh_token?: string } | null;
  if (!session?.access_token || !session.refresh_token) {
    throw new Error('Could not sign you in just now.');
  }

  const { error: setError } = await backend.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (setError) throw setError;
}

/**
 * Attach the proved number to the account already signed in, rather than
 * signing in as whoever owns it.
 *
 * The same code, the same proof — a different thing to do with it. The account
 * keeps its id, so nothing entered before the number was added moves or is lost,
 * and the number becomes a second way back to the same place (ADR-006).
 */
export async function attachPhoneCode(phone: string, code: string): Promise<void> {
  const idToken = await proveNumber(phone, code);
  const { data, error } = await backend.functions.invoke('phone-verify', {
    body: { idToken, mode: 'attach' },
  });
  if (error) throw error;
  if (!(data as { attached?: boolean } | null)?.attached) {
    throw new Error('Could not add that number just now.');
  }

  // Nobody is signed out and nothing is re-entered — but the user held on this
  // device was read before the number existed, so without this the account
  // screen goes on offering to add a phone that is already attached, until the
  // access token happens to roll. Refreshing is the whole of "seamless" here.
  await backend.auth.refreshSession();
}

/** Forget any verification in flight — the screen leaving, or starting over. */
export function forgetPendingPhoneCode(): void {
  pending = null;
}
