/**
 * Backing the private "Me" ledger up to the person's own Google Drive.
 *
 * THE SHAPE, AND WHY IT CHANGED. This was WhatsApp's chat-backup screen — six
 * peer sections: back up now, account, key, schedule, network, restore. That
 * shape assumes the feature already works. It does not until three separate
 * things are true (an account is linked, this device holds the key, and the
 * person has kept a copy of it), and until then four of the six sections were
 * inert: "Back up now" a grey slab with no reason attached, "Check for a
 * backup" the same, and the one control that unblocked either — "Create a key"
 * — a small chip two screens further down, under a heading that gave no hint it
 * gated everything above it. A setup flow wearing a settings screen's clothes
 * reads, correctly, as a screen that is broken.
 *
 * So the screen now has two modes and one anchor.
 *
 * The anchor is the card at the top, which always says the same three things in
 * the same place: whether the ledger is protected, when it last was, and that
 * the lock is a key only this person holds. That is WhatsApp's own status card
 * (Chat backup: last backup, total size, "End-to-end encrypted"), and it is
 * first because "am I safe" is the question somebody opened this screen with.
 *
 * Below the fold of that card the screen forks. **Until a backup can run**, the
 * card continues into a three-step checklist and the outstanding step — and
 * only that one — carries a button. Steps already taken collapse to a line with
 * "Done" beside them; steps further out are dimmed and silent. That is Uber
 * Eats' account checkup, where the item needing attention expands in place with
 * its own action and the satisfied ones shrink to checked rows. **Once it can
 * run**, the checklist disappears entirely and the card continues into "Back up
 * now" — an ordinary settings screen, with no scaffolding left to nag somebody
 * whose backups have been running for a year.
 *
 * THE ORDERING, in the order it is rendered:
 *
 * 1. Status + the one thing to do. Both answers within a thumb of the top.
 * 2. The promise ("nothing legible leaves the phone"), because *what to do*
 *    outranks *why* on a screen somebody came to with a problem.
 * 3. Account, and then the key — but each only once it is no longer a step.
 *    While a step is outstanding the checklist owns its buttons, so the two are
 *    never on screen at the same time offering the same tap.
 * 4. The schedule, which now refuses to lie. "Daily" with no key backs nothing
 *    up, so when the steps are unfinished the schedule says so directly under
 *    the picker rather than sitting there looking live.
 * 5. Which networks.
 * 6. Restore, last: it is the half people need once, at the worst moment, and
 *    burying it would be cruel — but putting it near "Back up now" invites the
 *    wrong tap. Unchanged, and deliberately so.
 *
 * THE RULE THE WHOLE FILE OBEYS: no control is ever disabled and silent. Either
 * the reason is written next to it, or the control is not rendered at all and
 * the step that unblocks it stands in its place.
 *
 * The one promise this screen makes, and must keep: nothing legible leaves the
 * phone. What goes to Drive is a sealed blob; the key that opens it is shown to
 * the person and never sent anywhere.
 */

import { useCallback, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  ListRow,
  Popup,
  Row,
  Screen,
  SectionHeader,
  Sheet,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { plural, useStrings } from '@/i18n';
import { formatBytes } from '@/lib/bytes';
import { useBackup, type BackupOutcome } from '@/lib/backup/useBackup';
import { BackupFrequency } from '@/lib/backup/schedule';
import { formatRecoveryKey } from '@/lib/backup/recoveryKey';
import { backupSetup, BackupStep } from '@/lib/backup/setup';
import type { RestoreScan } from '@/lib/backup/engine';
import { CloudAuthError } from '@/lib/cloud/oauth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { SyncNetworkPreference } from '@/lib/syncNetwork';

/** A found backup, held while the person decides whether to take it. */
type FoundBackup = Extract<RestoreScan, { ok: true }>;

/** A brand name, not copy — the same word in every locale, so not translated. */
const PROVIDER_LABEL = 'Google Drive';

/** The checklist mark's diameter, and so the indent its buttons hang under. */
const STEP_MARK = 26;

/**
 * The disc at the head of a checklist row: a tick once the step is taken, its
 * number in the brand colour while it is the one being asked for, and a hollow
 * outline for the steps still ahead.
 *
 * Three states rather than two, because "done" and "not done" cannot express
 * the thing this screen exists to say — which of the not-done ones is *yours to
 * do right now*. Every checklist that works (Chime's "Finish setup", Plum's
 * "Get set up", Shopify's "Get ready to sell") draws that distinction.
 */
function StepMark({ number, done, active }: { number: number; done: boolean; active: boolean }) {
  const theme = useTheme();
  const fill = done ? theme.color.positive : active ? theme.color.brand : 'transparent';
  return (
    <View
      style={{
        width: STEP_MARK,
        height: STEP_MARK,
        borderRadius: STEP_MARK / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: fill,
        borderWidth: done || active ? 0 : 1,
        borderColor: theme.color.border,
      }}
    >
      {done ? (
        <Ionicons name="checkmark" size={iconSize.base} color={theme.color.onBrand} />
      ) : (
        <Text variant="micro" tone={active ? 'onBrand' : 'faint'}>
          {String(number)}
        </Text>
      )}
    </View>
  );
}

export default function BackupSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const backup = useBackup();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [entering, setEntering] = useState(false);
  const [typedKey, setTypedKey] = useState('');
  const [typedInvalid, setTypedInvalid] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [found, setFound] = useState<FoundBackup | null>(null);
  const [restored, setRestored] = useState<number | null>(null);

  const dateTime = useCallback(
    (at: number): string =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(at),
      ),
    [locale],
  );

  /** The one sentence for a refusal — each has a different way out. */
  const refusalLine = (outcome: BackupOutcome): string => {
    if (outcome.kind === 'ok') return plural(locale, outcome.records, t.backup.backedUp);
    switch (outcome.refusal) {
      case 'not-configured':
        return t.backup.unavailable;
      case 'not-connected':
        return t.backup.refusedNotConnected;
      case 'no-key':
        return t.backup.refusedNoKey;
      case 'offline':
        return t.backup.refusedOffline;
      case 'network-policy':
        return t.backup.refusedNetwork;
      case 'auth':
        return t.backup.refusedAuth;
      case 'no-backup':
        return t.backup.refusedNoBackup;
      default:
        return t.backup.refusedBusy;
    }
  };

  const phaseLine =
    backup.phase === 'collecting'
      ? t.backup.phaseCollecting
      : backup.phase === 'sealing'
        ? t.backup.phaseSealing
        : backup.phase === 'uploading'
          ? t.backup.phaseUploading
          : null;

  /**
   * Why linking failed, said in a way that points at whoever can fix it.
   *
   * "Try again" is honest advice for a dropped connection and a lie for a build
   * Google refuses to issue tokens to — no client registered for this package
   * name and signing certificate, or no client id in the bundle at all. Those
   * are settled before the app is installed and no tap changes them, so they
   * get the same sentence the screen already uses for a build that cannot do
   * this: "not available in this build".
   *
   * The status code is the whole diagnosis for whoever is building and noise
   * for everybody else, so it is appended in development only. It is already in
   * the crash report either way — `lib/cloud/nativeGoogle` files these on the
   * way out, which is also why this does not run a `CloudAuthError` back
   * through `friendlyError`: that would report the same failure twice.
   */
  const connectFailure = (caught: unknown): string => {
    if (!(caught instanceof CloudAuthError)) {
      return friendlyError(caught, t.backup.connectFailed, 'backup.connect');
    }
    // `play-services` deserves its own sentence — Google's services being
    // absent or stale is the one fault here the person can fix themselves — and
    // will get one as soon as `backup.connectNoPlayServices` exists in all four
    // locale tables. Until then it reads as an ordinary failure, which is at
    // least not wrong.
    const sentence = caught.fault === 'not-set-up' ? t.backup.unavailable : t.backup.connectFailed;
    return __DEV__ && caught.status ? `${sentence} (${caught.status})` : sentence;
  };

  const onConnect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await backup.connect();
    } catch (caught) {
      setError(connectFailure(caught));
    } finally {
      setBusy(false);
    }
  };

  const onBackUpNow = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await backup.backupNow();
    } catch (caught) {
      setError(friendlyError(caught, t.backup.backupFailed, 'backup.run'));
    } finally {
      setBusy(false);
    }
  };

  const onCreateKey = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setCopied(false);
      setShownKey(await backup.createKey());
    } catch (caught) {
      setError(friendlyError(caught, t.backup.backupFailed, 'backup.createKey'));
    } finally {
      setBusy(false);
    }
  };

  const onShowKey = async (): Promise<void> => {
    setCopied(false);
    setShownKey(await backup.revealKey());
  };

  const onEnterKey = (): void => {
    setTypedKey('');
    setTypedInvalid(false);
    setEntering(true);
  };

  const onAcceptKey = async (): Promise<void> => {
    if (!(await backup.acceptKey(typedKey))) {
      setTypedInvalid(true);
      return;
    }
    setEntering(false);
    setTypedKey('');
    setTypedInvalid(false);
  };

  const onCheckForBackup = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setRestored(null);
    try {
      const result = await backup.scan();
      if (result.ok) setFound(result);
      else setError(refusalLine({ kind: 'refused', refusal: result.refusal }));
    } catch (caught) {
      // A key that does not open the file throws out of the AEAD. That is the
      // whole diagnosis and it is worth saying precisely; anything else is a
      // transport failure whose text must not reach the screen.
      const wrongKey =
        caught instanceof Error && /Poly1305|invalid tag|decrypt/i.test(caught.message);
      setError(
        wrongKey
          ? t.backup.restoreWrongKey
          : friendlyError(caught, t.backup.restoreFailed, 'backup.scan'),
      );
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async (): Promise<void> => {
    if (!found) return;
    setBusy(true);
    try {
      setRestored(await backup.applyRestore(found));
      setFound(null);
    } catch (caught) {
      setFound(null);
      setError(friendlyError(caught, t.backup.restoreFailed, 'backup.restore'));
    } finally {
      setBusy(false);
    }
  };

  const onUnlink = async (): Promise<void> => {
    setUnlinking(false);
    setBusy(true);
    try {
      await backup.disconnect();
    } catch (caught) {
      setError(friendlyError(caught, t.backup.connectFailed, 'backup.disconnect'));
    } finally {
      setBusy(false);
    }
  };

  const frequencies: { value: BackupFrequency; label: string }[] = [
    { value: BackupFrequency.Off, label: t.backup.freqOff },
    { value: BackupFrequency.Daily, label: t.backup.freqDaily },
    { value: BackupFrequency.Weekly, label: t.backup.freqWeekly },
    { value: BackupFrequency.Monthly, label: t.backup.freqMonthly },
  ];

  const networks: { value: SyncNetworkPreference; label: string }[] = [
    { value: SyncNetworkPreference.Wifi, label: t.backup.networkWifi },
    { value: SyncNetworkPreference.Both, label: t.backup.networkAny },
  ];

  const running = backup.phase !== null;
  const setup = backupSetup({
    configured: backup.configured,
    connected: backup.connected,
    hasKey: backup.hasKey,
    keySeen: backup.settings.keySeen,
  });
  const last = backup.settings.last;

  /**
   * The status card's face. `loading` gets its own one rather than borrowing
   * "not set up": the hook's first pass reads two stores *and* asks Drive who
   * the linked account is, so on a slow network a fully configured phone would
   * otherwise open on "Not backing up yet" and correct itself a second later —
   * the one sentence on this screen that must never be shown wrongly.
   */
  const settled = !backup.loading;
  const statusTone: 'warning' | 'brand' | 'positive' =
    !settled || (setup.complete && !last) ? 'brand' : setup.complete ? 'positive' : 'warning';
  const statusColor =
    statusTone === 'positive'
      ? { fg: theme.color.positive, bg: theme.color.positiveSoft }
      : statusTone === 'brand'
        ? { fg: theme.color.brand, bg: theme.color.brandSoft }
        : { fg: theme.color.warning, bg: theme.color.warningSoft };

  const statusTitle = !settled
    ? t.backup.statusChecking
    : setup.complete
      ? last
        ? t.backup.statusOn
        : t.backup.statusReady
      : t.backup.statusOff;

  const statusDetail = !settled
    ? null
    : setup.unavailable
      ? t.backup.unavailable
      : setup.complete
        ? last
          ? t.backup.lastLine
              .replace('{date}', dateTime(last.at))
              .replace('{size}', formatBytes(last.size, locale))
          : t.backup.never
        : plural(locale, setup.total - setup.done, t.backup.stepsLeft);

  /** One title and one sentence per step; the sentence shows only on the active one. */
  const stepCopy: Record<BackupStep, { title: string; body: string }> = {
    [BackupStep.Account]: { title: t.backup.stepAccountTitle, body: t.backup.stepAccountBody },
    [BackupStep.Key]: { title: t.backup.stepKeyTitle, body: t.backup.stepKeyBody },
    [BackupStep.SaveKey]: { title: t.backup.stepSaveTitle, body: t.backup.stepSaveBody },
  };

  /**
   * The buttons the outstanding step carries. "I already have a key" rides
   * along with both key steps, because somebody restoring onto a new phone is
   * *at* one of those two moments and typing their old key is the whole answer
   * — it satisfies the step and the one after it in a single tap.
   */
  const stepActions = (step: BackupStep): ReactNode => {
    if (step === BackupStep.Account) {
      return (
        <Button
          label={t.backup.connect}
          onPress={() => void onConnect()}
          disabled={busy}
          fullWidth
        />
      );
    }
    const primary =
      step === BackupStep.Key
        ? { label: t.backup.keyCreate, run: onCreateKey }
        : { label: t.backup.keyShow, run: onShowKey };
    return (
      <>
        <Button
          label={primary.label}
          onPress={() => void primary.run()}
          disabled={busy}
          fullWidth
        />
        <Button
          label={t.backup.keyEnter}
          variant="ghost"
          size="sm"
          onPress={onEnterKey}
          disabled={busy}
          fullWidth
        />
      </>
    );
  };

  /**
   * Why "Check for a backup" cannot run, in the person's terms, beside the
   * button rather than instead of it — a restore has to stay findable even when
   * it is not yet possible, because the moment somebody needs it is the moment
   * they have nothing else.
   */
  const restoreReason = !backup.configured
    ? t.backup.unavailable
    : !backup.connected
      ? t.backup.refusedNotConnected
      : !backup.hasKey
        ? t.backup.refusedNoKey
        : null;

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.backup.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {error ? <Callout tone="negative">{error}</Callout> : null}

        {/* The anchor: where things stand, and — under the same rule — either
            the one step outstanding or the button that is now possible. */}
        <Card style={{ gap: theme.spacing.lg }}>
          <Row gap={theme.spacing.md} style={{ alignItems: 'flex-start' }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: statusColor.bg,
              }}
            >
              {settled ? (
                <Ionicons
                  name={
                    setup.complete
                      ? last
                        ? 'cloud-done'
                        : 'cloud-upload-outline'
                      : 'cloud-offline-outline'
                  }
                  size={iconSize.xxl}
                  color={statusColor.fg}
                />
              ) : (
                <ActivityIndicator size="small" color={statusColor.fg} />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{statusTitle}</Text>
              {statusDetail ? (
                <Text variant="caption" tone="muted">
                  {statusDetail}
                </Text>
              ) : null}
              {/* WhatsApp's "End-to-end encrypted" line: the reassurance belongs
                  where the good news is, not three sections further down. */}
              {settled && setup.complete ? (
                <Row gap={theme.spacing.xs} style={{ marginTop: 2 }}>
                  <Ionicons name="lock-closed" size={iconSize.xs} color={theme.color.textFaint} />
                  <Text variant="micro" tone="faint">
                    {t.backup.statusSealed}
                  </Text>
                </Row>
              ) : null}
            </View>
          </Row>

          {settled && setup.complete ? (
            <>
              <Divider />
              <View style={{ gap: theme.spacing.md }}>
                <Button
                  label={t.backup.backUpNow}
                  onPress={() => void onBackUpNow()}
                  disabled={busy || running}
                  fullWidth
                  icon={
                    running ? (
                      <ActivityIndicator size="small" color={theme.color.onBrand} />
                    ) : (
                      <Ionicons
                        name="cloud-upload-outline"
                        size={iconSize.md}
                        color={theme.color.onBrand}
                      />
                    )
                  }
                />
                {/* Never a grey button on its own: a run in progress says which
                    part it is on, a button held down by something else on the
                    screen says so, and a finished run says what it did. */}
                {phaseLine ? (
                  <Text variant="micro" tone="muted" align="center">
                    {phaseLine}
                  </Text>
                ) : busy ? (
                  <Text variant="micro" tone="muted" align="center">
                    {t.backup.busy}
                  </Text>
                ) : backup.outcome ? (
                  <Text
                    variant="micro"
                    tone={backup.outcome.kind === 'ok' ? 'muted' : 'faint'}
                    align="center"
                  >
                    {refusalLine(backup.outcome)}
                  </Text>
                ) : null}
              </View>
            </>
          ) : settled && !setup.unavailable ? (
            <>
              <Divider />
              <View style={{ gap: theme.spacing.lg }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="micro" tone="faint">
                    {t.backup.setupSection}
                  </Text>
                  <Text variant="micro" tone="faint">
                    {t.backup.setupProgress
                      .replace('{done}', String(setup.done))
                      .replace('{total}', String(setup.total))}
                  </Text>
                </Row>
                {setup.steps.map(({ step, done }, index) => {
                  const active = setup.outstanding === step;
                  const copy = stepCopy[step];
                  return (
                    <View key={step} style={{ gap: theme.spacing.md }}>
                      <Row gap={theme.spacing.md} style={{ alignItems: 'flex-start' }}>
                        <StepMark number={index + 1} done={done} active={active} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="subheading" tone={active ? 'default' : 'muted'}>
                            {copy.title}
                          </Text>
                          {active ? (
                            <Text variant="caption" tone="muted">
                              {copy.body}
                            </Text>
                          ) : null}
                        </View>
                        {done ? (
                          <Text variant="micro" tone="positive">
                            {t.backup.stepDone}
                          </Text>
                        ) : null}
                      </Row>
                      {active ? (
                        // Hung under the row's text rather than the mark, so the
                        // button reads as belonging to this step and not to the
                        // list. `paddingStart` so it hangs off the right edge in
                        // Arabic.
                        <View
                          style={{
                            paddingStart: STEP_MARK + theme.spacing.md,
                            gap: theme.spacing.sm,
                          }}
                        >
                          {stepActions(step)}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}
        </Card>

        <Text variant="body" tone="muted">
          {t.backup.intro}
        </Text>

        {/* Which Google account. Only once linking is no longer a step: while it
            is, the checklist above holds the only "Link Google Drive" button. */}
        {backup.connected ? (
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.backup.accountSection} />
            <Card style={{ gap: theme.spacing.md }}>
              <Row style={{ gap: theme.spacing.md }}>
                <Ionicons name="logo-google" size={iconSize.xl} color={theme.color.brand} />
                {/* The linked address when Drive will say who it is, and the
                    destination's own name when it will not — never a guess, and
                    never a blank row that reads as "not connected". */}
                <Text variant="body" style={{ flex: 1 }}>
                  {backup.account ?? PROVIDER_LABEL}
                </Text>
              </Row>
              <Button
                label={t.backup.disconnect}
                variant="ghostDanger"
                onPress={() => setUnlinking(true)}
                disabled={busy}
                fullWidth
              />
            </Card>
          </View>
        ) : null}

        {/* The key, once it is settled. Making one and saving one are steps and
            live in the checklist; what is left here is showing it again and
            replacing it with the key from another phone. */}
        {setup.complete ? (
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader title={t.backup.keySection} />
            <Card style={{ gap: theme.spacing.md }}>
              <Row style={{ gap: theme.spacing.sm }}>
                <Ionicons name="key" size={iconSize.md} color={theme.color.brand} />
                <Text variant="body">{t.backup.keyPresent}</Text>
              </Row>
              <Text variant="micro" tone="muted">
                {t.backup.keyIntro}
              </Text>
              <Row style={{ gap: theme.spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t.backup.keyShow}
                    variant="secondary"
                    size="sm"
                    onPress={() => void onShowKey()}
                    disabled={busy}
                    fullWidth
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t.backup.keyEnter}
                    variant="ghost"
                    size="sm"
                    onPress={onEnterKey}
                    disabled={busy}
                    fullWidth
                  />
                </View>
              </Row>
            </Card>
          </View>
        ) : null}

        {/* How often — and, when it cannot yet run, saying so rather than
            sitting there reading "Daily" over a key that does not exist. */}
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.backup.frequencySection} />
          <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
            {frequencies.map((option, index) => {
              const chosen = backup.settings.frequency === option.value;
              return (
                <View key={option.value}>
                  <ListRow
                    title={option.label}
                    onPress={() => void backup.setFrequency(option.value)}
                    // A picker row, not a door: every tap should land.
                    repeatable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: chosen }}
                    accessibilityLabel={`${option.label}${chosen ? `, ${t.backup.selected}` : ''}`}
                    trailing={
                      chosen ? (
                        <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                      ) : null
                    }
                  />
                  {index < frequencies.length - 1 ? (
                    <View style={{ height: 1, backgroundColor: theme.color.border }} />
                  ) : null}
                </View>
              );
            })}
          </Card>
          {/* Not in a build that cannot back up at all: the card at the top
              already says why, and "the steps above" would point at nothing. */}
          {settled &&
          !setup.complete &&
          !setup.unavailable &&
          backup.settings.frequency !== BackupFrequency.Off ? (
            <Callout tone="warning">{t.backup.frequencyBlocked}</Callout>
          ) : null}
          <Text variant="micro" tone="faint">
            {t.backup.frequencyNote}
          </Text>
        </View>

        {/* Over which networks. The same vocabulary the sync setting uses. */}
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.backup.networkSection} />
          <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
            {networks.map((option, index) => {
              const chosen = backup.settings.network === option.value;
              return (
                <View key={option.value}>
                  <ListRow
                    title={option.label}
                    onPress={() => void backup.setNetwork(option.value)}
                    // A picker row, not a door: every tap should land.
                    repeatable
                    accessibilityRole="radio"
                    accessibilityState={{ selected: chosen }}
                    accessibilityLabel={`${option.label}${chosen ? `, ${t.backup.selected}` : ''}`}
                    leading={
                      <Ionicons
                        name={
                          option.value === SyncNetworkPreference.Wifi
                            ? 'wifi-outline'
                            : 'globe-outline'
                        }
                        size={iconSize.xl}
                        color={theme.color.text}
                      />
                    }
                    trailing={
                      chosen ? (
                        <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                      ) : null
                    }
                  />
                  {index < networks.length - 1 ? (
                    <View style={{ height: 1, backgroundColor: theme.color.border }} />
                  ) : null}
                </View>
              );
            })}
          </Card>
        </View>

        {/* Getting it back. Last, and deliberately not beside "Back up now". */}
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.backup.restoreSection} />
          <Card style={{ gap: theme.spacing.md }}>
            <Text variant="micro" tone="muted">
              {t.backup.restoreIntro}
            </Text>
            {restored !== null ? (
              <Text variant="body" tone="muted">
                {plural(locale, restored, t.backup.restoreDone)}
              </Text>
            ) : null}
            <Button
              label={t.backup.restoreCheck}
              variant="secondary"
              onPress={() => void onCheckForBackup()}
              disabled={restoreReason !== null || busy}
              fullWidth
            />
            {restoreReason ? (
              <Text variant="micro" tone="faint" align="center">
                {restoreReason}
              </Text>
            ) : null}
          </Card>
        </View>
      </ScrollView>

      {/* The key, shown once — or again, on request. */}
      <Sheet
        visible={shownKey !== null}
        onClose={() => setShownKey(null)}
        closeLabel={t.common.close}
      >
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.keyTitle}</Text>
          <Card flat style={{ backgroundColor: theme.color.surfaceMuted }}>
            <Text
              variant="body"
              // Monospace so the groups line up and a mistyped character is
              // visible; selectable so it can be dragged out as well as copied.
              selectable
              style={{ fontFamily: 'monospace', letterSpacing: 1, lineHeight: 24 }}
            >
              {shownKey ? formatRecoveryKey(shownKey) : ''}
            </Text>
          </Card>
          <Callout tone="warning">{t.backup.keyWarning}</Callout>
          <Row style={{ gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label={copied ? t.backup.keyCopied : t.backup.keyCopy}
                variant="secondary"
                onPress={() => {
                  if (!shownKey) return;
                  void Clipboard.setStringAsync(formatRecoveryKey(shownKey));
                  setCopied(true);
                }}
                fullWidth
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t.backup.keyConfirm}
                onPress={() => {
                  void backup.confirmKeySeen();
                  setShownKey(null);
                }}
                fullWidth
              />
            </View>
          </Row>
        </View>
      </Sheet>

      {/* A key brought over from the phone that made the backup. */}
      <Sheet visible={entering} onClose={() => setEntering(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.keyEnterTitle}</Text>
          <Text variant="micro" tone="muted">
            {t.backup.keyEnterBody}
          </Text>
          <Card flat style={{ backgroundColor: theme.color.surfaceMuted }}>
            <TextInput
              value={typedKey}
              onChangeText={(value) => {
                setTypedKey(value);
                setTypedInvalid(false);
              }}
              placeholder={t.backup.keyEnterPlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.backup.keyEnterTitle}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={{
                minHeight: 72,
                fontSize: 16,
                fontFamily: 'monospace',
                color: theme.color.text,
                textAlignVertical: 'top',
                // A key is hexadecimal in either direction; forcing LTR keeps it
                // readable, and typed correctly, in an Arabic layout.
                writingDirection: 'ltr',
              }}
            />
          </Card>
          {typedInvalid ? <Callout tone="negative">{t.backup.keyEnterInvalid}</Callout> : null}
          <Button label={t.backup.keyEnterSave} onPress={() => void onAcceptKey()} fullWidth />
        </View>
      </Sheet>

      {/* What a restore would bring back, before it brings anything back. */}
      <Sheet visible={found !== null} onClose={() => setFound(null)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.restoreSection}</Text>
          {found ? (
            <>
              <Text variant="micro" tone="muted">
                {t.backup.restoreFrom.replace(
                  '{date}',
                  found.body.createdAt ? dateTime(Date.parse(found.body.createdAt)) : '—',
                )}
              </Text>
              <Text variant="body">
                {found.plan.restore.length === 0
                  ? t.backup.restoreNothingNew
                  : plural(locale, found.plan.restore.length, t.backup.restoreFound)}
              </Text>
              {found.plan.restore.length > 0 ? (
                <Button
                  label={t.backup.restoreConfirm}
                  onPress={() => void onRestore()}
                  disabled={busy}
                  fullWidth
                />
              ) : null}
            </>
          ) : null}
        </View>
      </Sheet>

      <Popup visible={unlinking} onClose={() => setUnlinking(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t.backup.disconnectTitle}</Text>
          <Text variant="body" tone="muted">
            {t.backup.disconnectBody}
          </Text>
          <Row style={{ gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t.common.cancel}
                variant="ghost"
                onPress={() => setUnlinking(false)}
                fullWidth
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t.backup.disconnect}
                variant="danger"
                onPress={() => void onUnlink()}
                fullWidth
              />
            </View>
          </Row>
        </View>
      </Popup>
    </Screen>
  );
}
