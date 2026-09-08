import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/icons';
import { checkPassword, issueToken } from '@/lib/session';
import { clientAddress, recordLoginAttempt } from '@/lib/loginThrottle';
import { assertSameOrigin, RequestRejected } from '@/lib/csrf';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function signIn(formData: FormData) {
    'use server';

    // Reject a cross-site POST at the login form too — a forged login is a way
    // to fixate a session on somebody. There is no session-bound token yet, so
    // this leans on the Origin check alone.
    try {
      await assertSameOrigin();
    } catch (caught) {
      if (caught instanceof RequestRejected) redirect('/login?error=1');
      throw caught;
    }

    // Throttle next, on the address, so a locked source cannot even test a
    // guess. Counts this attempt whether or not the password is right — the
    // operator logs in a handful of times a day and never meets the limit.
    const address = clientAddress((await headers()).get('x-forwarded-for'));
    const gate = await recordLoginAttempt(address);
    if (!gate.allowed) {
      redirect('/login?error=locked');
    }

    const password = String(formData.get('password') ?? '');
    if (!(await checkPassword(password))) {
      // No detail, and the same wording whatever went wrong. There is one
      // account here; telling a stranger anything about why they failed only
      // helps them.
      redirect('/login?error=1');
    }

    const token = await issueToken();
    (await cookies()).set(token.name, token.value, {
      httpOnly: true,
      sameSite: 'lax',
      // Off on localhost, on everywhere else — a Secure cookie is never sent
      // over the plain-HTTP dev server, which would lock you out of your own
      // machine.
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: token.maxAge,
    });
    redirect('/');
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <span className="login-mark">{Icon.cube}</span>
        <h1>Waves admin</h1>
        <p className="muted small">Private console. Contains personal data.</p>

        <form action={signIn}>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoFocus
              autoComplete="current-password"
              required
              // The message is deliberately the same whatever went wrong, so
              // the field points at it rather than describing the failure.
              aria-describedby={error ? 'login-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
          </label>
          <button type="submit" className="btn">
            Sign in
          </button>
          {error ? (
            <p id="login-error" className="banner banner-danger" role="alert">
              {Icon.alert}
              <span>
                {error === 'locked'
                  ? 'Too many attempts. Wait a few minutes and try again.'
                  : 'That did not work.'}
              </span>
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
