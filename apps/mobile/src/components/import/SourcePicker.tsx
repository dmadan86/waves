/**
 * Step 1: where the expenses are coming from.
 *
 * Three doors in one soft card, then the examples link and the promise that
 * nothing is added unannounced. The source cards only decide which picker opens:
 * the format is read from the file itself, so choosing the "wrong" door costs
 * nothing.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  Badge,
  Callout,
  Card,
  directionalIcon,
  iconSize,
  ProgressBar,
  Text,
  useTheme,
} from '@waves/ui';

import { Disc } from '@/components/import/ImportChrome';
import { useStrings } from '@/i18n';
import type { ReadStage, SourceError } from '@/lib/groupImport/machine';
import { useReducedMotion } from '@/lib/reducedMotion';

export type SourceChoice = 'file' | 'splitwise' | 'screenshot';

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

  const rows: {
    choice: SourceChoice;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    hint: string;
    tint: { fill: string; ink: string };
    plus?: boolean;
  }[] = [
    {
      choice: 'file',
      icon: 'document-text-outline',
      title: t.groupImport.sourceFileTitle,
      hint: t.groupImport.sourceFileHint,
      tint: { fill: theme.color.brandSoft, ink: theme.color.brand },
    },
    {
      choice: 'splitwise',
      icon: 'swap-vertical-outline',
      title: t.groupImport.sourceSplitwiseTitle,
      hint: t.groupImport.sourceSplitwiseHint,
      tint: { fill: theme.color.positiveSoft, ink: theme.color.positive },
    },
    {
      choice: 'screenshot',
      icon: 'image-outline',
      title: t.groupImport.sourceShotTitle,
      hint: t.groupImport.sourceShotHint,
      tint: { fill: theme.color.warningSoft, ink: theme.color.warning },
      plus: true,
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

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <Text variant="body" tone="muted">
        {t.groupImport.sourceIntro}
      </Text>

      {error ? <Callout tone="negative">{errorText[error]}</Callout> : null}

      <Card padded={false}>
        {rows.map((row, index) => (
          <Pressable
            key={row.choice}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}. ${row.hint}${row.plus ? `. ${t.groupImport.plusBadge}` : ''}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => onChoose(row.choice)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              minHeight: 64,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.color.border,
              opacity: busy ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <Disc icon={row.icon} fill={row.tint.fill} ink={row.tint.ink} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {row.title}
                </Text>
                {row.plus ? <Badge label={t.groupImport.plusBadge} tone="brand" /> : null}
              </View>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {row.hint}
              </Text>
            </View>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.md}
              color={theme.color.textFaint}
            />
          </Pressable>
        ))}
      </Card>

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
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          minHeight: 44,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Ionicons name="reader-outline" size={iconSize.md} color={theme.color.brand} />
        <Text variant="body" tone="brand" style={{ flex: 1, fontWeight: '600' }}>
          {t.groupImport.seeExamples}
        </Text>
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons
          name="shield-checkmark-outline"
          size={iconSize.base}
          color={theme.color.textFaint}
        />
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          {t.groupImport.nothingAdded}
        </Text>
      </View>
    </View>
  );
}
