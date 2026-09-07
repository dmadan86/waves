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
 *  - **Android 12 and below** report no locales and refuse the download outright.
 *  - **iOS** has no download API whatsoever, and its `installedLocales` is just
 *    its supported list repeated — so iPhone gets an explanation of where the
 *    setting lives and no button that would lie about what it does.
 */

import { useState } from 'react';
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
 * The language a tag names, in the reader's own language, or null.
 *
 * `Intl.DisplayNames` is present in Hermes builds with full ICU and absent in
 * others, and a locale list is worth showing either way — so a missing
 * implementation (or a tag it cannot parse) falls back to the bare tag rather
 * than throwing inside a list renderer.
 */
function localeName(tag: string, locale: string): string | null {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'language' });
    const name = names.of(tag.replace(/_/g, '-'));
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

  // The phone's own lists. A read, never a write: nothing here downloads
  // anything until a row is tapped. Disabled outright when the native module is
  // missing, so an older binary shows its explanation instead of a spinner that
  // resolves to nothing.
  const locales = useQuery({
    queryKey: ['speech-locales'],
    queryFn: () => speechModels?.listLocales() ?? Promise.resolve(null),
    enabled: speechModels !== null,
  });

  const supportsOnDevice = speechModels?.supportsOnDevice() ?? false;
  const canDownload = speechModels?.canDownload() ?? false;
  const models = offlineVoiceModels(
    LANGUAGES,
    deviceLocale(),
    locales.data?.locales,
    locales.data?.installedLocales,
  );

  const download = async (model: OfflineVoiceModel): Promise<void> => {
    if (!speechModels || progress[model.tag]?.phase === 'working') return;
    setProgress((current) => ({
      ...current,
      [model.tag]: { phase: 'working', message: t.offlineVoice.downloading },
    }));
    try {
      const status = await speechModels.download(model.tag);
      setProgress((current) => ({
        ...current,
        [model.tag]: {
          phase: 'settled',
          message:
            status === 'download_success'
              ? t.offlineVoice.ready
              : status === 'download_scheduled'
                ? t.offlineVoice.scheduled
                : t.offlineVoice.dialogOpened,
        },
      }));
      // Only a completed download changes what the phone holds; re-reading after
      // a dialog or a queued job would just redraw the same "not downloaded".
      if (status === 'download_success') await locales.refetch();
    } catch (caught) {
      setProgress((current) => ({
        ...current,
        [model.tag]: {
          phase: 'failed',
          message: refusedAsUnsupported(caught) ? t.offlineVoice.tooOld : t.offlineVoice.failed,
        },
      }));
    }
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
            it lands. This is how somebody sees it appear. */}
        <IconButton label={t.offlineVoice.refresh} onPress={() => void locales.refetch()}>
          <Ionicons name="refresh" size={iconSize.md} color={theme.color.text} />
        </IconButton>
      </Row>

      <FlashList<ListItem>
        data={speechModels === null || !supportsOnDevice ? [] : items}
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
            {speechModels === null ? (
              <Callout tone="warning">{t.offlineVoice.unavailable}</Callout>
            ) : !supportsOnDevice ? (
              <Callout tone="warning">{t.offlineVoice.noOnDevice}</Callout>
            ) : Platform.OS === 'ios' ? (
              <Callout tone="info">{t.offlineVoice.iosNote}</Callout>
            ) : null}
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
        ListEmptyComponent={
          // Only reachable once the module is there and can work offline: the
          // two cases above already say their piece in the header.
          speechModels !== null && supportsOnDevice && !locales.isLoading ? (
            <Text variant="body" tone="muted">
              {t.offlineVoice.empty}
            </Text>
          ) : null
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
  // phone's name for the tag, and then to the tag itself.
  const title = model.language
    ? LANGUAGE_NAMES[model.language].own
    : (localeName(model.tag, locale) ?? model.tag);
  const subtitle = model.language
    ? `${LANGUAGE_NAMES[model.language].english} · ${model.tag}`
    : model.tag;
  const working = progress?.phase === 'working';

  return (
    <Card style={{ marginBottom: theme.spacing.md, gap: theme.spacing.md }}>
      <Row style={{ gap: theme.spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {model.installed ? (
          <Badge label={t.offlineVoice.installed} tone="positive" />
        ) : canDownload ? (
          <Button
            label={t.offlineVoice.download}
            size="sm"
            variant="secondary"
            disabled={working}
            onPress={onDownload}
          />
        ) : (
          <Badge label={t.offlineVoice.notInstalled} tone="neutral" />
        )}
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
