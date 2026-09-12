import { type ReactNode, Children, Fragment, isValidElement } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

/**
 * The app's one way of stating a fact about a thing, and letting it be changed.
 *
 * This is the shape the expense screen settled on — a glyph and a muted label
 * on the left, the current value on the right, hairlines between — and it is
 * the shape the new-group screen now wears too. It used to live inline in
 * `expense/[expenseId].tsx` as `DetailLine`, where it could only ever describe a
 * bill; a second screen wanting the same idiom would have had to copy fourteen
 * lines of markup, and the two would have drifted the first time either was
 * touched. So it moved here instead of being duplicated.
 *
 * The glyph is what makes a stack of these scannable: four rows of grey words
 * read as a paragraph, where four marked rows read as a list you can find your
 * place in. It is not decoration — the split row's icon is the same one the
 * expense form's chips wear, so "how was this split" is answered by a mark as
 * well as by a word.
 *
 * Two things distinguish this from `ListRow` in @waves/ui, which is the other
 * row in the app and is deliberately not this one. `ListRow` is a list *entry*
 * — a thing, with a name and a subtitle, that you open. This is an *attribute* —
 * a named fact with a value, that you change in place. And this one takes an
 * Ionicons glyph name, which is why it is here in the app rather than in
 * @waves/ui: that package takes no icon dependency, by design, and every
 * component there that draws a glyph takes it as a render prop instead.
 */
export function DetailRow({
  icon,
  label,
  subtitle,
  value,
  placeholder = false,
  trailing,
  onPress,
  expanded,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** One line under the label, for a fact whose name does not explain it —
   *  "simplify debts" being the case this exists for. Most rows need none, and
   *  a row with one gives up the right-aligned value's share of the width. */
  subtitle?: string;
  /** The fact's current value, as one line. Omitted when `trailing` says it. */
  value?: string;
  /** True when `value` is a prompt ("Add") rather than an answer, so it is
   *  drawn as faint the way an unfilled input's placeholder is. */
  placeholder?: boolean;
  /** A control that states the value itself — a toggle, say — instead of a word.
   *  Mutually exclusive with `value` in practice; the row draws both if given
   *  both, which is a caller's mistake rather than a supported layout. */
  trailing?: ReactNode;
  /** Makes the row tappable and gives it a chevron. Left off, the row is a
   *  read-only statement — which is exactly what the expense screen wants. */
  onPress?: () => void;
  /** When the row's editor unfolds in place rather than pushing a screen, this
   *  says whether it is open: the chevron then points down/up like a
   *  disclosure, instead of forward like a door. Left undefined, it is a door. */
  expanded?: boolean;
  /** What a screen reader hears. Required on a tappable row, because "Kind" on
   *  its own does not say what the row currently holds — the value is drawn to
   *  the right of the label, and a reader that stops at the label learns half
   *  of it. */
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const chevron = onPress
    ? expanded === undefined
      ? directionalIcon('chevron-forward')
      : expanded
        ? 'chevron-up'
        : 'chevron-down'
    : null;

  const content = (
    <Row
      style={{
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        // A tappable row is a target before it is a statement, so it is floored
        // at the 44pt minimum even when its one line of text is shorter.
        minHeight: onPress ? 44 : undefined,
      }}
    >
      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.sm,
          // A bare label is as wide as its word and the value takes the rest;
          // a label with a hint under it is the wordy half, so it takes the
          // room instead and the value shrinks around it.
          flexShrink: subtitle ? 1 : 0,
          flex: subtitle ? 1 : undefined,
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          {subtitle ? (
            <Text variant="micro" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Row>
      <Row style={{ alignItems: 'center', gap: theme.spacing.xs, flexShrink: 1 }}>
        {value === undefined ? null : (
          <Text
            variant="body"
            tone={placeholder ? 'muted' : undefined}
            numberOfLines={1}
            style={{ flexShrink: 1, textAlign: 'right' }}
          >
            {value}
          </Text>
        )}
        {trailing}
        {chevron ? (
          <Ionicons name={chevron} size={iconSize.base} color={theme.color.textFaint} />
        ) : null}
      </Row>
    </Row>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      // Only claimed when the row actually folds something out. A row that
      // pushes a screen is not expandable, and announcing it as collapsed says
      // there is something here to unfold that never will.
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      accessibilityLabel={accessibilityLabel ?? `${label}${value ? `, ${value}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

/**
 * A stack of {@link DetailRow}s with a hairline between each pair.
 *
 * The divider belongs to the gap, not to the row — a row that drew its own
 * would leave a stray line under the last one, and every caller stitching them
 * in by hand is how the expense screen ended up with four copies of the same
 * one-pixel `View`. Non-element children (a `null` from a conditional row) are
 * dropped before the count, so a trip-only row that is absent takes its divider
 * with it rather than leaving two lines with nothing between them.
 *
 * This draws no background of its own: the caller wraps it in whatever surface
 * the screen uses, so the same stack sits on a Card here and a tinted panel
 * there without the rows knowing.
 */
export function DetailRows({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View>
      {rows.map((row, index) => (
        <Fragment key={row.key ?? index}>
          {index > 0 ? <View style={{ height: 1, backgroundColor: theme.color.border }} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}
