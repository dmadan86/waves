/**
 * The one summary card (docs/design-standard.md): a brand-blue gradient with a title (a tappable
 * month with a caret when `onTitlePress` is set), up to two figures with a green down-arrow / red
 * up-arrow disc and a third in a tinted pill (green, red when `negative`). Transactions,
 * Recurring, Budgets and Loans draw it (every figure is optional; `headline` and `progress` are optional extras); amounts arrive formatted, so currency rules stay with the caller.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, View } from 'react-native';

import { Row, Text, useTheme } from '@waves/ui';

const GREEN = '#16935B';
const RED = '#C8283E';
const SOFT = '#FFFFFFCC';

export interface SummaryFigure {
  label: string;
  value: string;
}

export function SummaryCard({
  title,
  titleHint,
  onTitlePress,
  money,
  expense,
  net,
  negative,
  footnote,
  headline,
  progress,
}: {
  title: string;
  /** Accessibility label for the tappable title. */
  titleHint?: string;
  onTitlePress?: () => void;
  /** Money in (green down-arrow disc). */
  money?: SummaryFigure;
  /** Money out (red up-arrow disc). */
  expense?: SummaryFigure;
  /** What is left / the net, in the tinted pill. */
  net?: SummaryFigure;
  negative?: boolean;
  footnote?: string;
  /** A large figure under the title (Loans: the total outstanding). */
  headline?: string;
  /** Share used, 0..1 (not clamped above 1 for display; the bar fills at most): a bar under the figures. */
  progress?: { ratio: number; over?: boolean };
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const titleText = (
    <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFFFFF' }}>{title}</Text>
  );
  return (
    <LinearGradient
      colors={dark ? ['#0B3A73', '#0A4C96'] : ['#0A4FA8', '#0A66C2']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: theme.radius.lg, padding: theme.spacing.md, gap: theme.spacing.sm }}
    >
      {onTitlePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={titleHint ?? title}
          onPress={onTitlePress}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
        >
          {titleText}
          <Ionicons name="caret-down" size={14} color="#FFFFFF" />
        </Pressable>
      ) : (
        titleText
      )}
      {headline ? (
        <Text
          style={{ fontSize: 26, lineHeight: 32, fontWeight: '800', color: '#FFFFFF' }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {headline}
        </Text>
      ) : null}
      {money || expense || net ? (
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          {(
            [
              [money, 'arrow-down', GREEN],
              [expense, 'arrow-up', RED],
            ] as const
          )
            .flatMap(([figure, icon, color]) => (figure ? [[figure, icon, color] as const] : []))
            .map(([figure, icon, color]) => (
              <Row
                key={figure.label}
                style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 6 }}
              >
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: theme.radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#FFFFFFE6',
                  }}
                >
                  <Ionicons name={icon} size={15} color={color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 11, color: SOFT }} numberOfLines={1}>
                    {figure.label}
                  </Text>
                  <Text
                    style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {figure.value}
                  </Text>
                </View>
              </Row>
            ))}
          {net ? (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 11, color: SOFT }} numberOfLines={1}>
                {net.label}
              </Text>
              <View
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '100%',
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 8,
                  backgroundColor: negative ? '#FDE3E6' : '#DDF5E8',
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '700',
                    color: negative ? '#A81E31' : '#0F7A48',
                  }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {net.value}
                </Text>
              </View>
            </View>
          ) : null}
        </Row>
      ) : null}
      {progress ? (
        <View
          style={{ height: 6, borderRadius: 3, backgroundColor: '#FFFFFF40', overflow: 'hidden' }}
        >
          <View
            style={{
              height: 6,
              width: `${Math.round(Math.min(1, Math.max(0, progress.ratio)) * 100)}%`,
              backgroundColor: progress.over ? '#FF8A98' : '#FFFFFF',
            }}
          />
        </View>
      ) : null}
      {footnote ? <Text style={{ fontSize: 12, color: SOFT }}>{footnote}</Text> : null}
    </LinearGradient>
  );
}
