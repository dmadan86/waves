/**
 * The speech models this phone holds, and the one screen that adds to them.
 *
 * Voice quick-add asks for on-device recognition only when a model for the
 * language is actually installed — asking for one that is not there returns
 * silence, which is the quiet failure `dictation.ts` documents at length. Until
 * now the only cure was a network recogniser, and on some OEM ROMs that service
 * is dead: the mic hears you and answers nothing, with no way out inside the
 * app. Downloading a model was something a person had to go and find in Android
 * settings, which is to say something almost nobody found.
 *
 * So the download lives here instead. What the platform actually allows is
 * narrower than it looks, and the screen says so rather than pretending:
 *
 *  - **Android 14+** fetches a model on request. The native side is handed a
 *    percentage by `ModelDownloadListener.onProgress`, but the library drops it
 *    on the floor — nothing reaches JS but a promise that settles. So the bar is
 *    indeterminate and the copy says the phone is working, rather than animating
 *    a number nobody measured.
 *  - **Android 13** cannot download in the background at all: the request opens
 *    the system's own dialog and resolves immediately, so the row says the phone
 *    has taken over and offers a refresh for when it is done.
 *  - **Android 12 and below** name no locales and reject the download outright,
 *    so no button is drawn and a notice points at Android's own settings.
 *  - **iPhone** has no download API whatsoever, *and* cannot be asked what it
 *    holds — its module returns the supported list under both names, so every
 *    locale it can recognise at all would come back ticked. Drawing those ticks
 *    would be the silence bug arriving through the UI: somebody reads "Tamil —
 *    on this phone", trusts it, and the mic answers nothing, with no button here
 *    to recover with. So iPhone gets the four languages the mic asks for, no
 *    claim about any of them, and the one thing a person can actually do —
 *    where in Settings the dictation languages live.
 *
 * Two things about the shape of the page are worth saying, because both were
 * wrong before.
 *
 * **The list folds.** The four languages Waves speaks are the reason anybody
 * opens this screen; the other two groups are the phone's own inventory, which
 * on Android runs to dozens of rows. Those two now start shut, each behind a
 * header that says how many it is holding. The app's four never fold — a
 * screen whose entire point is "download Tamil" that opens with Tamil hidden is
 * a worse screen than one that scrolls.
 *
 * **A refusal is decoded, not flattened.** The download call rejects with a
 * code, and on Android 14+ that code is the `SpeechRecognizer` error constant
 * handed through untouched. This screen used to read exactly one of them and
 * say "your phone couldn't download that one" to everything else — including,
 * routinely, Tamil. Every app language is offered a Download button whether or
 * not the recogniser has ever heard of it (it cannot be known in advance; see
 * `SpeechLocales.locales`, which is a union that quietly folds in the
 * network-only languages), so the tap *is* the probe, and the probe's answer is
 * the only place the truth lives. `offlineDownloadReason` reads it. "There is
 * no model for this language" and "the model exists and did not arrive" are now
 * different sentences, because they are different problems.
 */

import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Platform, Pressable, View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Text,
  useScreenClearance,
  useTheme,
  type Theme,
} from '@waves/ui';

import { deviceLocale, LANGUAGE_NAMES, LANGUAGES, plural, useStrings } from '@/i18n';
import {
  offlineDownloadReason,
  offlineVoiceModels,
  type OfflineDownloadReason,
  type OfflineVoiceModel,
} from '@/lib/dictation';
import { useReducedMotion } from '@/lib/reducedMotion';
import { speechModels } from '@/lib/speechModels';

/**
 * How long a download may run before the screen stops claiming to know.
 *
 * On Android 14+ the promise settles from a `ModelDownloadListener`, and nothing
 * guarantees that listener ever fires. A promise that never settles would leave
 * the bar sliding forever behind a lock nothing can clear and a button nothing
 * can re-enable — the row would be dead for the life of the screen. So after a
 * while the row stops asserting and becomes tappable again. Generous, because a
 * model is a real download on a real connection and finishing late is normal; a
 * late answer still overwrites what this leaves behind.
 */
const DOWNLOAD_WATCHDOG_MS = 3 * 60_000;

/**
 * What a row is doing since it was last tapped.
 *
 * `working` is the only state that draws a bar. The rest are sentences the
 * phone's own answer earned — `done` for a model that landed, `settled` for the
 * several ways it can be neither here nor lost, and `failed`, which is a fact
 * about this device and not an error worth a red screen.
 */
interface RowProgress {
  readonly phase: 'working' | 'done' | 'settled' | 'failed';
  readonly message: string;
}

/** The two groups that fold away; the app's own languages never do. */
type FoldKey = 'installed' | 'other';

/**
 * `Intl.DisplayNames` per app language, built at most once each.
 *
 * The constructor is absent from the Hermes build this app ships — `intlPolyfill`
 * backfills `RelativeTimeFormat` and its prerequisites, not this one — so on most
 * phones every lookup here returns null and a row is named by its bare tag. Held
 * in a module-level cache because the alternative is constructing a formatter
 * inside a list renderer, once per row, on every render.
 */
const displayNames = new Map<string, Intl.DisplayNames | null>();

/** The language a tag names, in the reader's own language, or null. */
function localeName(tag: string, locale: string): string | null {
  if (!displayNames.has(locale)) {
    try {
      displayNames.set(locale, new Intl.DisplayNames([locale], { type: 'language' }));
    } catch {
      displayNames.set(locale, null);
    }
  }
  try {
    const name = displayNames.get(locale)?.of(tag.replace(/_/g, '-'));
    return name && name !== tag ? name : null;
  } catch {
    return null;
  }
}

export default function OfflineVoiceScreen() {
  const theme = useTheme();
  const clearance = useScreenClearance();
  const reduceMotion = useReducedMotion();
  const { t, locale } = useStrings();
  const [progress, setProgress] = useState<Record<string, RowProgress>>({});
  // Both shut to begin with. The phone's inventory is dozens of rows of things
  // nobody came here for, and burying the four that matter under it is what the
  // screen used to do.
  const [openSections, setOpenSections] = useState<Record<FoldKey, boolean>>({
    installed: false,
    other: false,
  });

  // Which tags have a native download in flight, and every watchdog still
  // pending. Refs, not state: the lock has to be readable and writable *now*, in
  // the tap handler, before any render has committed (see `download`).
  //
  // The lock holds a token per run rather than the bare tag, so a run that ends
  // late — after its own watchdog gave up and a second attempt started — cannot
  // release somebody else's lock on the way out.
  const inFlight = useRef(new Map<string, symbol>());
  const watchdogs = useRef(new Set<ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);

  useEffect(() => {
    const timers = watchdogs.current;
    return () => {
      mounted.current = false;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const supportsOnDevice = speechModels?.supportsOnDevice() ?? false;
  const canDownload = speechModels?.canDownload() ?? false;
  const reportsInstalled = speechModels?.reportsInstalled() ?? false;

  // The phone's own lists. A read, never a write: nothing here downloads
  // anything until a row is tapped. Not asked at all when the native module is
  // missing (an older binary shows its explanation instead of a spinner that
  // resolves to nothing), nor on a phone whose answer means nothing — iPhone
  // returns its supported list under both names, and nothing on this screen
  // reads it.
  const locales = useQuery({
    queryKey: ['speech-locales'],
    queryFn: () => speechModels?.listLocales() ?? Promise.resolve(null),
    enabled: speechModels !== null && reportsInstalled,
  });

  const models = offlineVoiceModels(
    LANGUAGES,
    deviceLocale(),
    locales.data?.locales,
    locales.data?.installedLocales,
    reportsInstalled ? 'reported' : 'unknowable',
  );

  const setRow = (tag: string, row: RowProgress): void => {
    if (!mounted.current) return;
    setProgress((current) => ({ ...current, [tag]: row }));
  };

  /**
   * The phone's reason for refusing, in words a person can act on.
   *
   * Every branch names something different to go and do, which is the whole
   * point of decoding the code rather than swallowing it. `language-missing` is
   * the one this screen was built blind to: the recogniser has no model for that
   * language at all, so no amount of retrying, waiting for Wi-Fi or freeing
   * space will produce one.
   */
  const reasonText = (reason: OfflineDownloadReason): string => {
    switch (reason) {
      case 'too-old':
        return t.offlineVoice.tooOld;
      case 'language-missing':
        return t.offlineVoice.languageMissing;
      case 'not-downloaded':
        return t.offlineVoice.notDownloaded;
      case 'network':
        return t.offlineVoice.networkFailed;
      case 'busy':
        return t.offlineVoice.serviceBusy;
      case 'started':
        return t.offlineVoice.handedOff;
      case 'refused':
      default:
        return t.offlineVoice.failed;
    }
  };

  const download = async (model: OfflineVoiceModel): Promise<void> => {
    // The lock is a ref rather than a read of `progress`, because two taps
    // inside one frame share a render closure: a state read there sees the
    // same "not working" both times, and `disabled` has not been committed yet
    // either. Both taps would reach the native call.
    if (!speechModels || inFlight.current.has(model.tag)) return;
    const run = Symbol(model.tag);
    const release = (): void => {
      if (inFlight.current.get(model.tag) === run) inFlight.current.delete(model.tag);
    };
    inFlight.current.set(model.tag, run);
    setRow(model.tag, { phase: 'working', message: t.offlineVoice.downloading });

    const watchdog = setTimeout(() => {
      watchdogs.current.delete(watchdog);
      release();
      setRow(model.tag, { phase: 'settled', message: t.offlineVoice.stillWorking });
    }, DOWNLOAD_WATCHDOG_MS);
    watchdogs.current.add(watchdog);

    try {
      const status = await speechModels.download(model.tag);
      setRow(model.tag, {
        phase: status === 'download_success' ? 'done' : 'settled',
        message:
          status === 'download_success'
            ? t.offlineVoice.ready
            : status === 'download_scheduled'
              ? t.offlineVoice.scheduled
              : t.offlineVoice.dialogOpened,
      });
      // Only a completed download changes what the phone holds; re-reading after
      // a dialog or a queued job would just redraw the same "not downloaded".
      if (status === 'download_success') await locales.refetch();
    } catch (caught) {
      const reason = offlineDownloadReason(caught);
      // `started` arrives as a rejection and is not a failure: the service took
      // the request and only declined to narrate it. Drawing it in red under a
      // sentence about not being able to download would be the screen lying
      // about something that is at that moment working.
      setRow(model.tag, {
        phase: reason === 'started' ? 'settled' : 'failed',
        message: reasonText(reason),
      });
    } finally {
      clearTimeout(watchdog);
      watchdogs.current.delete(watchdog);
      release();
    }
  };

  const showList = speechModels !== null && supportsOnDevice;
  // A phone that answered, and named nothing at all. Worth saying out loud: the
  // app rows below are then the only ones on the screen, and their absence of
  // company is the phone's doing rather than a list still loading.
  const namedNothing =
    locales.isSuccess &&
    (locales.data?.locales.length ?? 0) === 0 &&
    (locales.data?.installedLocales.length ?? 0) === 0;

  // One notice at a time, most disqualifying first. Each says what this
  // particular phone can do, and none of them promises a download that will not
  // happen.
  const notice: { tone: 'warning' | 'info'; text: string } | null =
    speechModels === null
      ? { tone: 'warning', text: t.offlineVoice.unavailable }
      : !supportsOnDevice
        ? { tone: 'warning', text: t.offlineVoice.noOnDevice }
        : Platform.OS === 'ios'
          ? { tone: 'info', text: t.offlineVoice.iosNote }
          : !canDownload
            ? { tone: 'warning', text: t.offlineVoice.tooOld }
            : namedNothing
              ? { tone: 'info', text: t.offlineVoice.empty }
              : null;

  /**
   * A group that folds: its header always, its rows only when open.
   *
   * An empty group draws nothing at all — not even a header saying zero, which
   * is a row of furniture standing in for information.
   */
  const foldedSection = (
    key: FoldKey,
    title: string,
    hint: string | undefined,
    group: OfflineVoiceModel[],
  ): ListItem[] => {
    if (group.length === 0) return [];
    const open = openSections[key];
    return [
      // The hint explains the rows, so it keeps them company rather than
      // sitting under a shut header explaining nothing visible.
      {
        kind: 'header',
        key,
        title,
        hint: open ? hint : undefined,
        fold: { key, open, count: group.length },
      },
      ...(open ? group.map((model): ListItem => ({ kind: 'model', key: model.tag, model })) : []),
    ];
  };

  // One flat list of headers and rows rather than three lists in a scroll view:
  // the "other languages" group is every locale the recogniser knows, which on
  // Android runs to dozens, and only a virtualised list keeps that cheap.
  const items: ListItem[] = [
    {
      kind: 'header',
      key: 'app',
      title: t.offlineVoice.appSection,
      hint: t.offlineVoice.appSectionHint,
    },
    ...models.app.map((model): ListItem => ({ kind: 'model', key: model.tag, model })),
    ...foldedSection('installed', t.offlineVoice.alsoInstalled, undefined, models.alsoInstalled),
    ...foldedSection(
      'other',
      t.offlineVoice.otherLanguages,
      canDownload ? t.offlineVoice.otherLanguagesHint : undefined,
      models.downloadable,
    ),
  ];

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          alignItems: 'center',
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.offlineVoice.title}</Text>
        </View>
        {/* A model can also arrive from outside the app — the Android 13 dialog,
            or a download the system queued for Wi-Fi — and nothing tells us when
            it lands. This is how somebody sees it appear. It is only offered
            where there is a list to re-read: on a phone that reports nothing,
            refreshing would redraw the same four rows and mean nothing. The
            spacer keeps the title centred in its absence. */}
        {reportsInstalled ? (
          <IconButton label={t.offlineVoice.refresh} onPress={() => void locales.refetch()}>
            <Ionicons name="refresh" size={iconSize.md} color={theme.color.text} />
          </IconButton>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </Row>

      <FlashList<ListItem>
        data={showList ? items : []}
        keyExtractor={(item) => `${item.kind}-${item.key}`}
        // A heading and a model card are nothing like each other in height, and
        // folding a section shuffles which is which — recycling one into the
        // other is how a list starts measuring wrong.
        getItemType={(item) => item.kind}
        extraData={[locale, theme.scheme, progress, openSections, locales.dataUpdatedAt]}
        drawDistance={1500}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, paddingVertical: theme.spacing.lg }}>
            <Text variant="body" tone="muted">
              {t.offlineVoice.intro}
            </Text>
            {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
            {locales.isError ? (
              <Card style={{ gap: theme.spacing.sm }}>
                <Text variant="subheading">{t.loadError}</Text>
                <Text variant="body" tone="muted">
                  {t.loadErrorBody}
                </Text>
                <Button label={t.retry} fullWidth onPress={() => void locales.refetch()} />
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === 'model') {
            return (
              <ModelRow
                model={item.model}
                progress={progress[item.model.tag]}
                canDownload={canDownload}
                reduceMotion={reduceMotion}
                onDownload={() => void download(item.model)}
              />
            );
          }
          // Read out of the item before the closure, so the toggle carries the
          // section's own key rather than reaching back through a maybe-absent
          // field to find it.
          const fold = item.fold;
          return (
            <SectionFold
              item={item}
              onToggle={
                fold
                  ? () =>
                      setOpenSections((current) => ({ ...current, [fold.key]: !current[fold.key] }))
                  : undefined
              }
            />
          );
        }}
        ListFooterComponent={
          <Text variant="micro" tone="muted" style={{ paddingVertical: theme.spacing.xl }}>
            {t.offlineVoice.footnote}
          </Text>
        }
      />
    </Screen>
  );
}

/** A section heading or one model — the two things the list draws. */
type ListItem =
  | {
      kind: 'header';
      key: string;
      title: string;
      hint?: string;
      /** Absent on a heading that does not fold, which is the app's own four. */
      fold?: { key: FoldKey; open: boolean; count: number };
    }
  | { kind: 'model'; key: string; model: OfflineVoiceModel };

/**
 * A section heading, tappable when its group folds.
 *
 * The count is the only thing a shut section can honestly show, so it is what
 * it shows: the header is not hiding "some more languages", it is hiding
 * sixty-three of them, and that number is what decides whether anybody opens it.
 *
 * It is handed to a screen reader as the control's *value* rather than glued to
 * its name, so the announcement stays three separate facts — "Other languages,
 * 63 languages, collapsed" — instead of one run-on label. What is lost is the
 * heading role: React Native cannot make one element both a heading and a
 * button, and a control somebody has to be able to press wins over a landmark
 * they can jump to. The unfolding sections keep the plain heading.
 */
function SectionFold({
  item,
  onToggle,
}: {
  item: Extract<ListItem, { kind: 'header' }>;
  onToggle: (() => void) | undefined;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();

  const hint = item.hint ? (
    <Text
      variant="caption"
      tone="muted"
      style={{ marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }}
    >
      {item.hint}
    </Text>
  ) : null;

  if (!item.fold) {
    return (
      <View style={{ paddingTop: theme.spacing.lg }}>
        <SectionHeader title={item.title} />
        {hint}
      </View>
    );
  }

  const { open, count } = item.fold;
  const countText = plural(locale, count, t.offlineVoice.sectionCount);

  return (
    <View style={{ paddingTop: theme.spacing.lg }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.title}
        accessibilityValue={{ text: countText }}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <SectionHeader
          title={item.title}
          action={
            <Row style={{ gap: theme.spacing.sm }}>
              <Text variant="caption" tone="muted">
                {countText}
              </Text>
              {/* Up and down, never forward and back: a fold opens downward in
                  Arabic exactly as it does in English, so there is nothing here
                  for `directionalIcon` to mirror. */}
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            </Row>
          }
        />
      </Pressable>
      {open ? hint : null}
    </View>
  );
}

/** The glyph, colour and text tone a row's progress line is drawn in. */
function progressLook(
  theme: Theme,
  phase: RowProgress['phase'],
): {
  icon:
    'cloud-download-outline' | 'checkmark-circle' | 'alert-circle' | 'information-circle-outline';
  color: string;
  tone: 'muted' | 'positive' | 'negative';
} {
  switch (phase) {
    case 'working':
      return { icon: 'cloud-download-outline', color: theme.color.brand, tone: 'muted' };
    case 'done':
      return { icon: 'checkmark-circle', color: theme.color.positive, tone: 'positive' };
    case 'failed':
      return { icon: 'alert-circle', color: theme.color.negative, tone: 'negative' };
    case 'settled':
    default:
      return { icon: 'information-circle-outline', color: theme.color.textMuted, tone: 'muted' };
  }
}

/**
 * A state, said twice: once as a shape and a colour, once in words.
 *
 * Neither carries it alone. The glyph is for the eye running down the column,
 * the badge is for everybody the glyph does not reach — somebody who cannot
 * tell the green disc from the grey one, and every screen reader.
 */
function StateMark({
  icon,
  color,
  label,
  tone,
}: {
  icon: 'checkmark-circle' | 'cloud-offline-outline' | 'help-circle-outline';
  color: string;
  label: string;
  tone: 'positive' | 'neutral';
}) {
  const theme = useTheme();
  return (
    <Row style={{ gap: theme.spacing.sm, flexShrink: 0 }}>
      <Ionicons name={icon} size={iconSize.lg} color={color} />
      <Badge label={label} tone={tone} />
    </Row>
  );
}

function ModelRow({
  model,
  progress,
  canDownload,
  reduceMotion,
  onDownload,
}: {
  model: OfflineVoiceModel;
  progress: RowProgress | undefined;
  canDownload: boolean;
  reduceMotion: boolean;
  onDownload: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();

  // An app language is named in its own script, because somebody looking for
  // Tamil is scanning for the shape of Tamil. Anything else falls back to the
  // phone's name for the tag — and, when the phone has no name to give, to the
  // tag alone rather than the tag printed twice.
  const named = model.language ? LANGUAGE_NAMES[model.language].own : localeName(model.tag, locale);
  const title = named ?? model.tag;
  const subtitle = model.language
    ? `${LANGUAGE_NAMES[model.language].english} · ${model.tag}`
    : named
      ? model.tag
      : null;
  const working = progress?.phase === 'working';
  const look = progress ? progressLook(theme, progress.phase) : null;

  return (
    <Card style={{ marginBottom: theme.spacing.md, gap: theme.spacing.md }}>
      <Row style={{ gap: theme.spacing.md }}>
        {/* Deliberately not a flag. A language is not a country — Tamil, Hindi,
            Arabic and English are each spoken across many of them, and picking
            one flag to stand for the rest is the oldest mistake in
            localisation. The mark is the language's own script instead, த and ह
            and ا, which is the shape somebody scanning this list is actually
            looking for. A locale Waves does not speak gets a neutral globe
            rather than a Latin initial guessed off a tag.

            Hidden from a screen reader on purpose: the title beside it says the
            same word, and hearing it twice is not twice the information. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Avatar
            name={model.language ? title : model.tag}
            size={44}
            mark={
              model.language
                ? undefined
                : (color) => <Ionicons name="globe-outline" size={iconSize.lg} color={color} />
            }
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {/* `unknown` gets a question mark and says so. It used to draw nothing,
            which read as an answer of its own — a row with no tick looks
            uninstalled. "Can't tell" is the true statement, and the notice in
            the header explains why iPhone cannot be asked. What it still does
            not get is a button, because there is nothing here to press. */}
        {model.state === 'installed' ? (
          <StateMark
            icon="checkmark-circle"
            color={theme.color.positive}
            label={t.offlineVoice.installed}
            tone="positive"
          />
        ) : model.state === 'missing' ? (
          canDownload ? (
            <Button
              label={t.offlineVoice.download}
              size="sm"
              variant="secondary"
              icon={
                <Ionicons
                  name="cloud-download-outline"
                  size={iconSize.md}
                  color={theme.color.brand}
                />
              }
              disabled={working}
              onPress={onDownload}
            />
          ) : (
            <StateMark
              icon="cloud-offline-outline"
              color={theme.color.textMuted}
              label={t.offlineVoice.notInstalled}
              tone="neutral"
            />
          )
        ) : (
          <StateMark
            icon="help-circle-outline"
            color={theme.color.textMuted}
            label={t.offlineVoice.cannotTell}
            tone="neutral"
          />
        )}
      </Row>

      {progress && look ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Row style={{ gap: theme.spacing.sm, alignItems: 'flex-start' }}>
            <Ionicons
              name={look.icon}
              size={iconSize.md}
              color={look.color}
              style={{ marginTop: 2 }}
            />
            <Text variant="caption" tone={look.tone} style={{ flex: 1 }}>
              {working ? `${progress.message} ${t.offlineVoice.noProgress}` : progress.message}
            </Text>
          </Row>
          {/* Indeterminate on purpose: Android hands the app a percentage and
              the library never passes it on, so there is no number to draw. */}
          {working ? <ProgressBar animated={!reduceMotion} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
