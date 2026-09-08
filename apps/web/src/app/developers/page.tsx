'use client';

/**
 * The developer console: the three things a person needs to build on Waves and
 * the one thing they need to stop somebody else from.
 *
 * **Tokens** are for your own scripts — a credential that is you, narrowed to
 * the permissions you ticked. **Applications** are for software other people
 * connect to their own accounts. **Connected apps** is the other side of that
 * relationship, and it is here rather than in Settings on purpose: the list of
 * who is acting for you belongs next to the machinery that let them.
 *
 * Two rules run through the whole page.
 *
 * A minted credential is shown **once**. The server hands back the plaintext in
 * the response to the request that created it and keeps only a SHA-256; there
 * is no endpoint anywhere that can produce it again. So the callout that
 * carries it says so in as many words, rather than letting somebody discover it
 * by coming back tomorrow.
 *
 * Every mutation takes the same lock. One `busy` key means a double-click on
 * "Create token" cannot mint two tokens, and — because a second in-flight
 * request would race the refetch that follows the first — nothing else on the
 * page can be started while one is running.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import {
  apiBase,
  createApp,
  createToken,
  deleteApp,
  disconnect,
  formatDay,
  listApps,
  listConnections,
  listScopes,
  listTokens,
  revokeToken,
  rotateSecret,
  serverSentence,
  splitRedirectUris,
  tokenState,
  updateApp,
  type Connection,
  type CreatedToken,
  type DeveloperApp,
  type DeveloperToken,
  type ScopeInfo,
} from '@/lib/developerApi';

export default function DevelopersPage() {
  return <AppFrame current={Section.Developers}>{() => <Developers />}</AppFrame>;
}

function Developers() {
  const { t, locale } = useStrings();

  // Read once: it is a build-time constant, and re-deriving it per render would
  // suggest it could change while somebody is looking at the page.
  const configured = useMemo(() => apiBase() !== null, []);

  const [tokens, setTokens] = useState<DeveloperToken[]>([]);
  const [apps, setApps] = useState<DeveloperApp[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);

  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the retry button; re-running the effect is the whole retry. */
  const [attempt, setAttempt] = useState(0);

  /** Which mutation is in flight. Null means the page is idle and accepting. */
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  /** The plaintext of a credential, held only until the page is left. */
  const [newToken, setNewToken] = useState<CreatedToken | null>(null);
  const [newSecret, setNewSecret] = useState<{ name: string; secret: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void (async () => {
      try {
        const [nextTokens, nextApps, nextConnections, nextScopes] = await Promise.all([
          listTokens(),
          listApps(),
          listConnections(),
          listScopes(),
        ]);
        if (!active) return;
        setTokens(nextTokens);
        setApps(nextApps);
        setConnections(nextConnections);
        setScopes(nextScopes);
        setError(null);
      } catch (caught) {
        // Without this, a failed request reads as "you have no tokens" — which
        // is the one sentence somebody who has three should never be shown.
        if (active)
          setError(
            friendlyError(caught, 'web.developers.load', {
              fallback: serverSentence(caught) ?? t.errors.couldNotLoad,
              offline: t.errors.offline,
              tooMany: t.errors.tooMany,
            }),
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, configured, t.errors.couldNotLoad, t.errors.offline, t.errors.tooMany]);

  /**
   * One mutation at a time, and its refusal said in the reader's language.
   *
   * The server's own sentence becomes the *fallback* rather than being printed
   * directly, so `friendlyError` still logs the original and still overrides it
   * when the real fault was the connection.
   */
  const run = useCallback(
    async (key: string, where: string, fallback: string, work: () => Promise<void>) => {
      if (busy) return;
      setBusy(key);
      setActionError(null);
      try {
        await work();
      } catch (caught) {
        setActionError(
          friendlyError(caught, where, {
            fallback: serverSentence(caught) ?? fallback,
            offline: t.errors.offline,
            tooMany: t.errors.tooMany,
          }),
        );
      } finally {
        setBusy(null);
      }
    },
    [busy, t.errors.offline, t.errors.tooMany],
  );

  const copy = useCallback(
    async (value: string, key: string) => {
      try {
        if (!navigator.clipboard) throw new Error('no clipboard');
        await navigator.clipboard.writeText(value);
        setCopied(key);
      } catch {
        // Not worth Sentry: a page served over http, or a browser that says no.
        setActionError(t.developers.copyFailed);
      }
    },
    [t.developers.copyFailed],
  );

  const copyButton = (value: string, key: string) => (
    <button type="button" className="btn soft" onClick={() => void copy(value, key)}>
      {copied === key ? t.developers.copied : t.developers.copy}
    </button>
  );

  // ────────────────────────────────────────────────────────────── actions ──

  const onCreateToken = (name: string, chosen: string[], days: number | null, done: () => void) =>
    run('token.create', 'web.developers.createToken', t.errors.couldNotSave, async () => {
      const created = await createToken({ name, scopes: chosen, expiresInDays: days });
      setNewToken(created);
      setTokens(await listTokens());
      done();
    });

  const onRevokeToken = (token: DeveloperToken) =>
    run(
      `token.revoke.${token.id}`,
      'web.developers.revokeToken',
      t.errors.couldNotSave,
      async () => {
        await revokeToken(token.id);
        setTokens(await listTokens());
      },
    );

  const onCreateApp = (
    input: {
      name: string;
      description: string;
      websiteUrl: string | null;
      redirectUris: string[];
      scopes: string[];
      confidential: boolean;
    },
    done: () => void,
  ) =>
    run('app.create', 'web.developers.createApp', t.errors.couldNotSave, async () => {
      const created = await createApp(input);
      if (created.client_secret) {
        setNewSecret({ name: created.name, secret: created.client_secret });
      }
      setApps(await listApps());
      done();
    });

  const onRotate = (app: DeveloperApp) =>
    run(`app.secret.${app.id}`, 'web.developers.rotateSecret', t.errors.couldNotSave, async () => {
      const { client_secret: secret } = await rotateSecret(app.id);
      setNewSecret({ name: app.name, secret });
    });

  const onToggleApp = (app: DeveloperApp) =>
    run(`app.disable.${app.id}`, 'web.developers.updateApp', t.errors.couldNotSave, async () => {
      await updateApp(app.id, { disabled: app.disabled_at === null });
      setApps(await listApps());
    });

  const onDeleteApp = (app: DeveloperApp) => {
    // Two deliberate clicks. The first only arms the button; deleting an
    // application breaks every integration anybody built on it.
    if (confirmDelete !== app.id) {
      setConfirmDelete(app.id);
      return;
    }
    void run(
      `app.delete.${app.id}`,
      'web.developers.deleteApp',
      t.errors.couldNotSave,
      async () => {
        await deleteApp(app.id);
        setConfirmDelete(null);
        setApps(await listApps());
      },
    );
  };

  const onDisconnect = (connection: Connection) =>
    run(
      `connection.${connection.app_id}`,
      'web.developers.disconnect',
      t.errors.couldNotSave,
      async () => {
        await disconnect(connection.app_id);
        setConnections(await listConnections());
      },
    );

  // ───────────────────────────────────────────────────────────── the page ──

  if (!configured) {
    return (
      <div className="app-body">
        <div className="app-main">
          <div className="page-head">
            <h1>{t.developers.title}</h1>
          </div>
          <section className="panel">
            <p className="error">{t.developers.notConfigured}</p>
            <p className="faint">{t.developers.notConfiguredBody}</p>
          </section>
        </div>
        <aside className="detail" />
      </div>
    );
  }

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.developers.title}</h1>
        </div>
        <p className="faint" style={{ marginBlockEnd: 16 }}>
          {t.developers.intro}
        </p>

        {error ? (
          <section className="panel">
            <p className="error">{error}</p>
            <button
              type="button"
              className="btn soft"
              onClick={() => {
                setLoading(true);
                setAttempt((n) => n + 1);
              }}
            >
              {t.errors.tryAgain}
            </button>
          </section>
        ) : (
          <>
            {newToken ? (
              <ShownOnce
                title={t.developers.tokens.createdTitle}
                body={t.developers.tokens.onlyOnce}
                secret={newToken.token}
                action={copyButton(newToken.token, 'token')}
              />
            ) : null}
            {newSecret ? (
              <ShownOnce
                title={t.developers.apps.secretTitle}
                body={`${newSecret.name} · ${t.developers.apps.secretOnce}`}
                secret={newSecret.secret}
                action={copyButton(newSecret.secret, 'secret')}
              />
            ) : null}
            {actionError ? (
              <p className="error" role="alert" style={{ marginBlockEnd: 12 }}>
                {actionError}
              </p>
            ) : null}

            {/* ── personal tokens ── */}
            <section className="panel">
              <div className="panel-head">
                <h2>{t.developers.tokens.title}</h2>
              </div>
              <p className="faint" style={{ marginBlock: 10 }}>
                {t.developers.tokens.body}
              </p>

              {loading ? (
                <SkeletonRows rows={3} amount={false} />
              ) : tokens.length === 0 ? (
                <p className="muted">{t.developers.tokens.empty}</p>
              ) : (
                <div className="list">
                  {tokens.map((token) => {
                    const state = tokenState(token);
                    const key = `token.revoke.${token.id}`;
                    return (
                      <div className="item-pair" key={token.id}>
                        <div className="item" style={{ cursor: 'default' }}>
                          <span className="tile-emoji" aria-hidden>
                            🔑
                          </span>
                          <span className="grow">
                            <span className="title">
                              {token.name}
                              {state === 'revoked' ? (
                                <span className="pill-badge">{t.developers.tokens.revokedTag}</span>
                              ) : state === 'expired' ? (
                                <span className="pill-badge warn">
                                  {t.developers.tokens.expiredTag}
                                </span>
                              ) : null}
                            </span>
                            <span className="meta">
                              <span className="code" dir="ltr">
                                {token.token_prefix}
                              </span>
                              {' · '}
                              <span className="code" dir="ltr">
                                {token.scopes.join(' ')}
                              </span>
                            </span>
                            <span className="meta">
                              {token.expires_at
                                ? fill(t.developers.tokens.expires, {
                                    date: formatDay(locale, token.expires_at),
                                  })
                                : t.developers.tokens.neverExpires}
                              {' · '}
                              {token.last_used_at
                                ? fill(t.developers.tokens.lastUsed, {
                                    date: formatDay(locale, token.last_used_at),
                                  })
                                : t.developers.tokens.neverUsed}
                            </span>
                          </span>
                        </div>
                        {state === 'live' ? (
                          <button
                            type="button"
                            className="btn soft"
                            disabled={busy !== null}
                            aria-busy={busy === key}
                            onClick={() => void onRevokeToken(token)}
                          >
                            {busy === key
                              ? t.developers.tokens.revoking
                              : t.developers.tokens.revoke}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              <NewTokenForm
                scopes={scopes}
                busy={busy}
                disabled={loading}
                onSubmit={onCreateToken}
              />
            </section>

            {/* ── applications ── */}
            <section className="panel">
              <div className="panel-head">
                <h2>{t.developers.apps.title}</h2>
              </div>
              <p className="faint" style={{ marginBlock: 10 }}>
                {t.developers.apps.body}
              </p>

              {loading ? (
                <SkeletonRows rows={2} amount={false} />
              ) : apps.length === 0 ? (
                <p className="muted">{t.developers.apps.empty}</p>
              ) : (
                <div className="list">
                  {apps.map((app) => (
                    <div
                      className="item"
                      key={app.id}
                      style={{ cursor: 'default', alignItems: 'flex-start', flexWrap: 'wrap' }}
                    >
                      <span className="tile-emoji" aria-hidden>
                        🧩
                      </span>
                      <span className="grow">
                        <span className="title">
                          {app.name}
                          {app.disabled_at ? (
                            <span className="pill-badge warn">{t.developers.apps.disabledTag}</span>
                          ) : null}
                        </span>
                        {app.description ? <span className="meta">{app.description}</span> : null}
                        <span className="meta">
                          {t.developers.apps.clientId}
                          {': '}
                          <span className="code" dir="ltr">
                            {app.client_id}
                          </span>
                        </span>
                        <span className="meta">
                          <span className="code" dir="ltr">
                            {app.redirect_uris.join(' ')}
                          </span>
                        </span>
                        <span className="meta">
                          <span className="code" dir="ltr">
                            {app.scopes.join(' ')}
                          </span>
                        </span>
                        {app.confidential === false ? (
                          <span className="meta">{t.developers.apps.publicNote}</span>
                        ) : null}
                      </span>
                      <span className="people">
                        {copyButton(app.client_id, `client.${app.id}`)}
                        {/* A public client has no secret to rotate, and the API
                            refuses unless asked to *convert* it — which would
                            change its type and break every installed copy. That
                            is not an action to leave sitting next to Copy, so
                            the row says what it is instead of offering it. */}
                        {app.confidential === false ? null : (
                          <button
                            type="button"
                            className="btn soft"
                            disabled={busy !== null}
                            aria-busy={busy === `app.secret.${app.id}`}
                            onClick={() => void onRotate(app)}
                          >
                            {busy === `app.secret.${app.id}`
                              ? t.developers.apps.rotating
                              : t.developers.apps.rotate}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn soft"
                          disabled={busy !== null}
                          aria-busy={busy === `app.disable.${app.id}`}
                          onClick={() => void onToggleApp(app)}
                        >
                          {app.disabled_at ? t.developers.apps.enable : t.developers.apps.disable}
                        </button>
                        <button
                          type="button"
                          className="btn soft"
                          disabled={busy !== null}
                          aria-busy={busy === `app.delete.${app.id}`}
                          onClick={() => onDeleteApp(app)}
                        >
                          {busy === `app.delete.${app.id}`
                            ? t.developers.apps.deleting
                            : confirmDelete === app.id
                              ? t.developers.apps.deleteConfirm
                              : t.developers.apps.delete}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <NewAppForm scopes={scopes} busy={busy} disabled={loading} onSubmit={onCreateApp} />
            </section>

            {/* ── what is acting for me ── */}
            <section className="panel">
              <div className="panel-head">
                <h2>{t.developers.connections.title}</h2>
              </div>
              <p className="faint" style={{ marginBlock: 10 }}>
                {t.developers.connections.body}
              </p>

              {loading ? (
                <SkeletonRows rows={2} amount={false} />
              ) : connections.length === 0 ? (
                <p className="muted">{t.developers.connections.empty}</p>
              ) : (
                <div className="list">
                  {connections.map((connection) => {
                    const key = `connection.${connection.app_id}`;
                    return (
                      <div className="item-pair" key={connection.app_id}>
                        <div className="item" style={{ cursor: 'default' }}>
                          <span className="tile-emoji" aria-hidden>
                            🔗
                          </span>
                          <span className="grow">
                            <span className="title">{connection.name}</span>
                            <span className="meta">
                              <span className="code" dir="ltr">
                                {(connection.scopes ?? []).join(' ')}
                              </span>
                            </span>
                            <span className="meta">
                              {connection.connected_at
                                ? fill(t.developers.connections.connected, {
                                    date: formatDay(locale, connection.connected_at),
                                  })
                                : ''}
                              {connection.connected_at ? ' · ' : ''}
                              {connection.last_used_at
                                ? fill(t.developers.connections.lastUsed, {
                                    date: formatDay(locale, connection.last_used_at),
                                  })
                                : t.developers.connections.neverUsed}
                            </span>
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn soft"
                          disabled={busy !== null}
                          aria-busy={busy === key}
                          onClick={() => void onDisconnect(connection)}
                        >
                          {busy === key
                            ? t.developers.connections.disconnecting
                            : t.developers.connections.disconnect}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <aside className="detail" />
    </div>
  );
}

/**
 * A credential, on the one occasion it exists in a browser. Loud on purpose:
 * closing this page without copying it means minting another one.
 */
function ShownOnce({
  title,
  body,
  secret,
  action,
}: {
  title: string;
  body: string;
  secret: string;
  action: ReactNode;
}) {
  return (
    <div className="banner" role="status">
      <span className="tile-emoji" aria-hidden>
        ⚠️
      </span>
      <span className="grow">
        <span className="b-title">{title}</span>
        <span className="b-body"> {body}</span>
        {/* Left-to-right whatever the page's direction: a credential that
            reorders itself in Arabic is a credential somebody mistypes. */}
        <code className="secret" dir="ltr">
          {secret}
        </code>
      </span>
      {action}
    </div>
  );
}

/**
 * The scope catalogue as checkboxes, described in the reader's language where
 * this app has words for it and in the server's own where it does not — a scope
 * added on the server and not here still appears, with its English sentence,
 * rather than silently going missing from the form.
 */
function ScopePicker({
  scopes,
  chosen,
  onToggle,
  disabled,
}: {
  scopes: ScopeInfo[];
  chosen: Set<string>;
  onToggle: (scope: string, on: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useStrings();
  const words: Record<string, string> = t.developers.scope;

  return (
    <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="field-label">{t.developers.permissions}</legend>
      {scopes.map((entry) => (
        <label className="item" key={entry.scope} style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={chosen.has(entry.scope)}
            disabled={disabled}
            onChange={(event) => onToggle(entry.scope, event.target.checked)}
            style={{ width: 16, flex: 'none' }}
          />
          <span className="grow">
            <span className="title" dir="ltr">
              {entry.scope}
            </span>
            <span className="meta">{words[entry.scope] ?? entry.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function NewTokenForm({
  scopes,
  busy,
  disabled,
  onSubmit,
}: {
  scopes: ScopeInfo[];
  busy: string | null;
  disabled: boolean;
  onSubmit: (
    name: string,
    scopes: string[],
    days: number | null,
    done: () => void,
  ) => Promise<void>;
}) {
  const { t } = useStrings();
  const [name, setName] = useState('');
  const [days, setDays] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const working = busy === 'token.create';
  const ready = name.trim().length > 0 && chosen.size > 0;

  return (
    <form
      style={{
        marginBlockStart: 14,
        borderBlockStart: '1px solid var(--color-line)',
        paddingBlockStart: 14,
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || busy) return;
        const parsed = Number.parseInt(days, 10);
        void onSubmit(
          name.trim(),
          [...chosen],
          Number.isFinite(parsed) && parsed > 0 ? parsed : null,
          () => {
            setName('');
            setDays('');
            setChosen(new Set());
          },
        );
      }}
    >
      <label className="field">
        <span className="field-label">{t.developers.tokens.name}</span>
        <input
          value={name}
          disabled={disabled || busy !== null}
          placeholder={t.developers.tokens.namePlaceholder}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">{t.developers.tokens.expiryDays}</span>
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={days}
          disabled={disabled || busy !== null}
          onChange={(event) => setDays(event.target.value)}
        />
        <span className="faint">{t.developers.tokens.expiryBody}</span>
      </label>

      <ScopePicker
        scopes={scopes}
        chosen={chosen}
        disabled={disabled || busy !== null}
        onToggle={(scope, on) =>
          setChosen((current) => {
            const next = new Set(current);
            if (on) next.add(scope);
            else next.delete(scope);
            return next;
          })
        }
      />

      <button type="submit" className="btn" disabled={!ready || busy !== null} aria-busy={working}>
        {working ? t.developers.tokens.creating : t.developers.tokens.create}
      </button>
    </form>
  );
}

function NewAppForm({
  scopes,
  busy,
  disabled,
  onSubmit,
}: {
  scopes: ScopeInfo[];
  busy: string | null;
  disabled: boolean;
  onSubmit: (
    input: {
      name: string;
      description: string;
      websiteUrl: string | null;
      redirectUris: string[];
      scopes: string[];
      confidential: boolean;
    },
    done: () => void,
  ) => Promise<void>;
}) {
  const { t } = useStrings();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [redirects, setRedirects] = useState('');
  const [confidential, setConfidential] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const working = busy === 'app.create';
  const uris = splitRedirectUris(redirects);
  const ready = name.trim().length > 0 && chosen.size > 0 && uris.length > 0;

  return (
    <form
      style={{
        marginBlockStart: 14,
        borderBlockStart: '1px solid var(--color-line)',
        paddingBlockStart: 14,
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || busy) return;
        void onSubmit(
          {
            name: name.trim(),
            description: description.trim(),
            websiteUrl: website.trim() || null,
            redirectUris: uris,
            scopes: [...chosen],
            confidential,
          },
          () => {
            setName('');
            setDescription('');
            setWebsite('');
            setRedirects('');
            setConfidential(true);
            setChosen(new Set());
          },
        );
      }}
    >
      <label className="field">
        <span className="field-label">{t.developers.apps.name}</span>
        <input
          value={name}
          disabled={disabled || busy !== null}
          placeholder={t.developers.apps.namePlaceholder}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">{t.developers.apps.description}</span>
        <input
          value={description}
          disabled={disabled || busy !== null}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">{t.developers.apps.website}</span>
        <input
          type="url"
          dir="ltr"
          value={website}
          disabled={disabled || busy !== null}
          placeholder="https://"
          onChange={(event) => setWebsite(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">{t.developers.apps.redirects}</span>
        <textarea
          className="textarea"
          dir="ltr"
          rows={3}
          value={redirects}
          disabled={disabled || busy !== null}
          onChange={(event) => setRedirects(event.target.value)}
        />
        <span className="faint">{t.developers.apps.redirectsBody}</span>
      </label>

      <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="field-label">{t.developers.apps.kind}</legend>
        <label className="row-field" style={{ marginBlockEnd: 6 }}>
          <input
            type="radio"
            name="app-kind"
            checked={confidential}
            disabled={disabled || busy !== null}
            onChange={() => setConfidential(true)}
            style={{ width: 16, flex: 'none' }}
          />
          <span>{t.developers.apps.confidential}</span>
        </label>
        <label className="row-field">
          <input
            type="radio"
            name="app-kind"
            checked={!confidential}
            disabled={disabled || busy !== null}
            onChange={() => setConfidential(false)}
            style={{ width: 16, flex: 'none' }}
          />
          <span>{t.developers.apps.publicClient}</span>
        </label>
        {confidential ? null : <p className="faint">{t.developers.apps.publicNote}</p>}
      </fieldset>

      <ScopePicker
        scopes={scopes}
        chosen={chosen}
        disabled={disabled || busy !== null}
        onToggle={(scope, on) =>
          setChosen((current) => {
            const next = new Set(current);
            if (on) next.add(scope);
            else next.delete(scope);
            return next;
          })
        }
      />

      <button type="submit" className="btn" disabled={!ready || busy !== null} aria-busy={working}>
        {working ? t.developers.apps.registering : t.developers.apps.register}
      </button>
    </form>
  );
}
