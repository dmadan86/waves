/**
 * Step 1: where the expenses are coming from.
 *
 * A beach banner naming the group, three doors as their own tinted cards, the
 * examples link and the promise that nothing is added unannounced. The source
 * cards only decide which picker opens: the format is read from the file
 * itself, so choosing the "wrong" door costs nothing.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { I18nManager, Pressable, View } from 'react-native';

import {
  Badge,
  Callout,
  directionalIcon,
  IconButton,
  iconSize,
  ProgressBar,
  Text,
  useTheme,
} from '@waves/ui';

import { useStrings } from '@/i18n';
import type { ReadStage, SourceError } from '@/lib/groupImport/machine';
import { useReducedMotion } from '@/lib/reducedMotion';

export type SourceChoice = 'file' | 'splitwise' | 'screenshot';

// The beach behind the group's name; the suitcase sits on the right, clear of the text.
const BANNER = require('../../../assets/images/import-banner.webp') as number;
const BANNER_HEIGHT = 178;

// The spreadsheet green is the file's own colour (Sheets, Excel), not a money
// hue, so it lives here rather than in the palette.
const SHEET_GREEN = {
  light: { fill: '#E3F4E8', ink: '#1E8E3E' },
  dark: { fill: '#1C3A28', ink: '#7FD69B' },
};

/** The banner and the group's name, with the back arrow over the sky. */
export function ImportHero({
  groupName,
  onBack,
}: {
  groupName: string;
  onBack: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const rtl = I18nManager.isRTL;
  return (
    <View style={{ height: BANNER_HEIGHT, marginHorizontal: -theme.spacing.xl }}>
      <Image
        source={BANNER}
        contentFit="cover"
        contentPosition={rtl ? 'left' : 'right'}
        style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
        accessibilityIgnoresInvertColors
      />
      {/* The sky fades to the page behind the text, and the sand into the cards. */}
      <LinearGradient
        colors={[theme.color.bg, `${theme.color.bg}00`]}
        start={{ x: rtl ? 1 : 0, y: 0 }}
        end={{ x: rtl ? 0 : 1, y: 0 }}
        locations={[0.2, 0.62]}
        style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
      />
      <LinearGradient
        colors={[`${theme.color.bg}00`, theme.color.bg]}
        locations={[0.7, 1]}
        style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
      />
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.xs }}>
        <IconButton label={t.common.back} onPress={onBack}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
      </View>
      <View style={{ paddingHorizontal: theme.spacing.xl, maxWidth: '62%', gap: 2 }}>
        <Text variant="caption" tone="muted">
          {t.groupImport.titleLead}
        </Text>
        <Text variant="title" numberOfLines={1} accessibilityRole="header">
          {groupName}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {t.groupImport.sourceIntro}
        </Text>
      </View>
    </View>
  );
}

export function SourcePicker({
  stage,
  error,
  errorValues,
  onChoose,
  onExamples,
}: {
  stage: ReadStage | null;
  error: SourceError | null;
  errorValues: { mb: number; n: number };
  onChoose: (choice: SourceChoice) => void;
  onExamples: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const reduceMotion = useReducedMotion();
  const busy = stage !== null;
  const dark = theme.scheme === 'dark';
  const sheet = dark ? SHEET_GREEN.dark : SHEET_GREEN.light;

  const rows: {
    choice: SourceChoice;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    hint: string;
    disc: { fill: string; ink: string };
    /** The card's wash; null is the plain surface. */
    wash: string | null;
    art: (keyof typeof Ionicons.glyphMap)[];
    chips?: string[];
    pro?: boolean;
    /** Draw the spreadsheet mark instead of `icon`. */
    sheetGlyph?: boolean;
  }[] = [
    {
      choice: 'file',
      icon: 'grid-outline',
      sheetGlyph: true,
      title: t.groupImport.sourceFileTitle,
      hint: t.groupImport.sourceFileHint,
      disc: sheet,
      wash: null,
      art: [],
      chips: ['.CSV', '.XLSX', '.XLS'],
    },
    {
      choice: 'splitwise',
      icon: 'swap-vertical',
      title: t.groupImport.sourceSplitwiseTitle,
      hint: t.groupImport.sourceSplitwiseHint,
      disc: { fill: theme.tint.sky.bg, ink: theme.color.positive },
      wash: theme.tint.peach.bg,
      art: ['document-text-outline'],
    },
    {
      choice: 'screenshot',
      icon: 'image-outline',
      title: t.groupImport.sourceShotTitle,
      hint: t.groupImport.sourceShotHint,
      disc: { fill: theme.tint.pink.bg, ink: theme.color.negative },
      wash: theme.tint.pink.bg,
      art: ['phone-portrait-outline', 'image-outline'],
      pro: true,
    },
  ];

  const errorText = {
    too_large: t.groupImport.errTooLarge.replace('{mb}', String(errorValues.mb)),
    too_many_rows: t.groupImport.errTooMany.replaceAll('{n}', String(errorValues.n)),
    empty: t.groupImport.errEmpty,
    encoding: t.groupImport.errEncoding,
    unreadable: t.groupImport.errUnreadable,
    no_columns: t.groupImport.errNoColumns,
    no_rows: t.groupImport.errNoRows,
  } as const;

  const chevron = (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: theme.color.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.md}
        color={theme.color.text}
      />
    </View>
  );

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {error ? <Callout tone="negative">{errorText[error]}</Callout> : null}

      {rows.map((row) => (
        <Pressable
          key={row.choice}
          accessibilityRole="button"
          accessibilityLabel={`${row.title}. ${row.hint}${row.pro ? `. ${t.groupImport.proBadge}` : ''}`}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => onChoose(row.choice)}
          style={({ pressed }) => [
            {
              borderRadius: theme.radius.lg,
              backgroundColor: theme.color.surface,
              opacity: busy ? 0.5 : pressed ? 0.8 : 1,
            },
            theme.shadow.soft,
          ]}
        >
          <View style={{ borderRadius: theme.radius.lg, overflow: 'hidden' }}>
            {row.wash ? (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  start: 0,
                  end: 0,
                  backgroundColor: row.wash,
                  opacity: dark ? 0.5 : 0.35,
                }}
              />
            ) : null}
            {row.art.length > 0 ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  position: 'absolute',
                  end: 52,
                  bottom: -8,
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  opacity: 0.16,
                }}
              >
                {row.art.map((glyph, index) => (
                  <Ionicons
                    key={glyph}
                    name={glyph}
                    size={index === 0 ? 44 : 28}
                    color={row.disc.ink}
                    style={index > 0 ? { marginStart: -10, marginBottom: 12 } : undefined}
                  />
                ))}
              </View>
            ) : null}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
              }}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: row.disc.fill,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {row.sheetGlyph ? (
                  <MaterialCommunityIcons
                    name="google-spreadsheet"
                    size={26}
                    color={row.disc.ink}
                  />
                ) : (
                  <Ionicons name={row.icon} size={22} color={row.disc.ink} />
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {row.title}
                  </Text>
                  {row.pro ? <Badge label={t.groupImport.proBadge} tone="brand" /> : null}
                </View>
                <Text variant="caption" tone="muted" numberOfLines={2}>
                  {row.hint}
                </Text>
                {row.chips ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: theme.spacing.xs,
                      marginTop: theme.spacing.xs,
                    }}
                  >
                    {row.chips.map((chip) => (
                      <View
                        key={chip}
                        style={{
                          paddingHorizontal: theme.spacing.sm,
                          paddingVertical: 2,
                          borderRadius: theme.radius.pill,
                          backgroundColor: theme.color.brandSoft,
                        }}
                      >
                        <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                          {chip}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
              {chevron}
            </View>
          </View>
        </Pressable>
      ))}

      {busy ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityLabel={stage === 'reading' ? t.groupImport.reading : t.groupImport.parsing}
          style={{ gap: theme.spacing.sm }}
        >
          <ProgressBar animated={!reduceMotion} height={4} />
          <Text variant="caption" tone="muted" align="center">
            {stage === 'reading' ? t.groupImport.reading : t.groupImport.parsing}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t.groupImport.seeExamples}
        onPress={onExamples}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            minHeight: 48,
            paddingHorizontal: theme.spacing.lg,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.surface,
            opacity: pressed ? 0.7 : 1,
          },
          theme.shadow.soft,
        ]}
      >
        <Ionicons name="document-text" size={iconSize.md} color={theme.color.brand} />
        <Text
          variant="caption"
          tone="brand"
          numberOfLines={1}
          style={{ flex: 1, fontWeight: '600' }}
        >
          {t.groupImport.seeExamples}
        </Text>
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.md}
          color={theme.color.brand}
        />
      </Pressable>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.tint.sky.bg,
        }}
      >
        <Ionicons name="shield-checkmark-outline" size={24} color={theme.color.positive} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" style={{ fontWeight: '700' }}>
            {t.groupImport.nothingAdded}
          </Text>
          <Text variant="caption" tone="muted">
            {t.groupImport.nothingAddedBody}
          </Text>
        </View>
      </View>
    </View>
  );
}
