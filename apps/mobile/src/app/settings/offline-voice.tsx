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
 */

import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Platform, View } from 'react-native';

import {
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
} from '@waves/ui';

import { deviceLocale, LANGUAGE_NAMES, LANGUAGES, useStrings } from '@/i18n';
import { offlineVoiceModels, type OfflineVoiceModel } from '@/lib/dictation';
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
 * phone's own answer earned — including `failed`, which is a fact about this
 * device and not an error worth a red screen.
 */
interface RowProgress {
  readonly phase: 'working' | 'settled' | 'failed';
  readonly message: string;
}

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

/** Whether a rejected download was the platform refusing, not the network. */
function refusedAsUnsupported(caught: unknown): boolean {
  const code = (caught as { code?: unknown } | null)?.code;
  return code === 'not_supported';
}

export default function OfflineVoiceScreen() {
  const theme = useTheme();
  const clearance = useScreenClearance();
  const reduceMotion = useReducedMotion();
  const { t, locale } = useStrings();
  const [progress, setProgress] = useState<Record<string, RowProgress>>({});

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
        phase: 'settled',
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
      setRow(model.tag, {
        phase: 'failed',
        message: refusedAsUnsupported(caught) ? t.offlineVoice.tooOld : t.offlineVoice.failed,
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
    ...(models.alsoInstalled.length > 0
      ? [{ kind: 'header' as const, key: 'installed', title: t.offlineVoice.alsoInstalled }]
      : []),
    ...models.alsoInstalled.map((model): ListItem => ({ kind: 'model', key: model.tag, model })),
    ...(models.downloadable.length > 0
      ? [
          {
            kind: 'header' as const,
            key: 'other',
            title: t.offlineVoice.otherLanguages,
            hint: canDownload ? t.offlineVoice.otherLanguagesHint : undefined,
          },
        ]
      : []),
    ...models.downloadable.map((model): ListItem => ({ kind: 'model', key: model.tag, model })),
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
        extraData={[locale, theme.scheme, progress, locales.dataUpdatedAt]}
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
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <View style={{ paddingTop: theme.spacing.lg }}>
              <SectionHeader title={item.title} />
              {item.hint ? (
                <Text
                  variant="caption"
                  tone="muted"
                  style={{ marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }}
                >
                  {item.hint}
                </Text>
              ) : null}
            </View>
          ) : (
            <ModelRow
              model={item.model}
              progress={progress[item.model.tag]}
              canDownload={canDownload}
              reduceMotion={reduceMotion}
              onDownload={() => void download(item.model)}
            />
          )
        }
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
  | { kind: 'header'; key: string; title: string; hint?: string }
  | { kind: 'model'; key: string; model: OfflineVoiceModel };

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

  return (
    <Card style={{ marginBottom: theme.spacing.md, gap: theme.spacing.md }}>
      <Row style={{ gap: theme.spacing.md }}>
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
        {/* `unknown` draws nothing at all. A phone that cannot be asked what it
            holds gets no tick and no button — the notice in the header says
            where its dictation languages actually come from. */}
        {model.state === 'installed' ? (
          <Badge label={t.offlineVoice.installed} tone="positive" />
        ) : model.state === 'missing' ? (
          canDownload ? (
            <Button
              label={t.offlineVoice.download}
              size="sm"
              variant="secondary"
              disabled={working}
              onPress={onDownload}
            />
          ) : (
            <Badge label={t.offlineVoice.notInstalled} tone="neutral" />
          )
        ) : null}
      </Row>

      {progress ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone={progress.phase === 'failed' ? 'negative' : 'muted'}>
            {working ? `${progress.message} ${t.offlineVoice.noProgress}` : progress.message}
          </Text>
          {/* Indeterminate on purpose: Android hands the app a percentage and
              the library never passes it on, so there is no number to draw. */}
          {working ? <ProgressBar animated={!reduceMotion} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
