/**
 * The split editor's pieces, shared by the full expense editor and the split
 * pop-up on the expense screen.
 *
 * Two pieces rather than one because the full editor puts "who paid" between
 * them: the row of split kinds sits under its heading, the payer card follows,
 * and the list of people with their figures comes after. The pop-up stacks the
 * two directly. Either way it is the same controls, the same keypads and the
 * same error line, so a split changed in the pop-up reads exactly like one
 * changed on the full screen.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';

import { currencySymbol, sanitiseMinorInput, type CurrencyCode, type MemberId } from '@waves/core';
import {
  amountKeyboard,
  Avatar,
  ChipRow,
  iconSize,
  MoneyText,
  Row,
  Text,
  useTheme,
} from '@waves/ui';

import { splitIcon } from '@/components/expense/splitIcon';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { SplitKind, type SplitEntries } from '@/lib/split';

/**
 * The number beside one person in a weighted or exact split.
 *
 * Its own component for two reasons. The obvious one: three kinds of field with
 * three keypads, three suffixes and three spoken labels is a lot of ternaries to
 * read inside a list of people. The load-bearing one: an exact field is *money*,
 * so it has to sanitise each keystroke against the expense's currency — and
 * doing that in the screen's own render meant `currency` was captured by a
 * closure the React Compiler could not prove safe, which cost the split preview
 * and the params their memoisation ("existing memoization could not be
 * preserved"). Held here, the currency is a prop this component reads, and the
 * screen above keeps its memos.
 */
export function SplitEntryField({
  kind,
  currency,
  value,
  onChange,
  name,
}: {
  kind: SplitKind;
  currency: string;
  value: string;
  /** Called with the text as it should be stored — already sanitised for money. */
  onChange: (text: string) => void;
  /** Whose figure this is, for the spoken label. */
  name: string;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const exact = kind === SplitKind.Exact;
  const percent = kind === SplitKind.Percent;

  return (
    <Row style={{ gap: 2, alignItems: 'center', flexGrow: 0, flexShrink: 0 }}>
      <TextInput
        value={value}
        onChangeText={(text) =>
          // Money is cleaned on the way in — the currency decides whether a
          // decimal point is offered at all, and a second one never lands in the
          // field. A weight or a percentage is stored as typed and judged by
          // `splitProblem`, which refuses rather than trims.
          onChange(exact ? sanitiseMinorInput(text, currency as CurrencyCode) : text)
        }
        keyboardType={
          exact ? amountKeyboard(currency as CurrencyCode) : percent ? 'decimal-pad' : 'number-pad'
        }
        selectTextOnFocus
        placeholder={kind === SplitKind.Shares ? '1' : '0'}
        placeholderTextColor={theme.color.textFaint}
        accessibilityLabel={
          exact
            ? fill(t.expense.exactShareLabel, { name })
            : percent
              ? `${name}'s percentage`
              : `${name}'s shares`
        }
        style={{
          // An amount needs more room than a weight: two decimals and a
          // thousands' worth of digits do not fit in 72.
          width: exact ? 104 : 72,
          // A 44pt floor makes the field a real tap target; `textAlignVertical`
          // keeps the digit centred in the taller box on Android.
          minHeight: 44,
          fontSize: 16,
          fontWeight: '700',
          textAlign: 'right',
          textAlignVertical: 'center',
          color: theme.color.text,
          backgroundColor: theme.color.bg,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
        }}
      />
      <Text variant="micro" tone="muted">
        {percent ? '%' : exact ? currencySymbol(currency) : '×'}
      </Text>
    </Row>
  );
}

/**
 * The four ways to split, as one scrolling lane of chips — word plus glyph, the
 * glyph being what the expense screen's split row wears afterwards. The lane
 * scrolls rather than wraps: four labelled modes do not fit one narrow line in
 * every language, and a fourth chip alone on a second row reads as broken.
 */
export function SplitKindChips({
  value,
  onChange,
}: {
  value: SplitKind;
  onChange: (next: SplitKind) => void;
}): React.JSX.Element {
  const { t } = useStrings();
  return (
    <ChipRow<SplitKind>
      value={value}
      onChange={onChange}
      options={[SplitKind.Equal, SplitKind.Shares, SplitKind.Percent, SplitKind.Exact].map(
        (kind) => ({
          value: kind,
          label:
            kind === SplitKind.Equal
              ? t.expense.equally
              : kind === SplitKind.Shares
                ? t.expense.shares
                : kind === SplitKind.Percent
                  ? t.expense.percent
                  : t.expense.exactly,
          icon: (color: string) => (
            <Ionicons name={splitIcon(kind)} size={iconSize.md} color={color} />
          ),
        }),
      )}
    />
  );
}

/**
 * Everybody in the group, each ticked in or out of the split, with the figure
 * field beside the ticked ones on a weighted or exact split and what each is
 * down for under their name. The name toggles; the field beside it must not, or
 * nobody could tap into it without dropping the person. The split's own
 * complaint, when it does not add up, is the last line.
 *
 * Drawn bare — the caller puts it on whatever surface it sits on (a Card on the
 * full editor, the sheet's own card in the pop-up).
 */
export function SplitParticipants({
  members,
  viewerId,
  participants,
  onToggle,
  splitKind,
  entries,
  onEntryChange,
  currency,
  amount,
  lineAmount,
  splitIssue,
}: {
  members: readonly MemberRow[];
  viewerId: string | null | undefined;
  participants: readonly MemberId[];
  onToggle: (memberId: MemberId) => void;
  splitKind: SplitKind;
  entries: SplitEntries;
  onEntryChange: (memberId: MemberId, text: string) => void;
  currency: string;
  amount: bigint;
  lineAmount: (memberId: MemberId) => bigint;
  splitIssue: string | null;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useStrings();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted">
          {t.expense.splitBetween}
        </Text>
        <Text variant="micro" tone="muted">
          {t.expense.ofCount
            .replace('{chosen}', String(participants.length))
            .replace('{total}', String(members.length))}
        </Text>
      </Row>

      {members.map((member) => {
        const selected = participants.includes(member.id);
        const name = displayName(member, viewerId);
        return (
          <View
            key={member.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              // The avatar is 38pt and the share field has a 44pt floor, so the
              // row is tall enough to tap without padding stretching it.
              paddingVertical: theme.spacing.xs,
            }}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={name}
              onPress={() => onToggle(member.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                flex: 1,
              }}
            >
              <Avatar name={displayName(member)} ghost={isGhost(member)} size={38} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="subheading" numberOfLines={1}>
                  {name}
                </Text>
                {selected && amount > 0n ? (
                  <MoneyText
                    amount={lineAmount(member.id)}
                    currency={currency}
                    locale={locale}
                    variant="caption"
                    // This person's share = money owed toward the bill, so it
                    // wears the owe colour, matching the who-owes-what list.
                    // Forced red: a positive share would read as "owed to you"
                    // under sign-derived colour.
                    tone="negative"
                  />
                ) : null}
              </View>
            </Pressable>

            {splitKind !== SplitKind.Equal && selected ? (
              <SplitEntryField
                kind={splitKind}
                currency={currency}
                value={entries[member.id] ?? ''}
                onChange={(text) => onEntryChange(member.id, text)}
                name={name}
              />
            ) : null}

            <Pressable accessible={false} onPress={() => onToggle(member.id)} hitSlop={8}>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={iconSize.xl}
                color={selected ? theme.color.brand : theme.color.textFaint}
              />
            </Pressable>
          </View>
        );
      })}

      {splitIssue ? (
        <Text
          variant="micro"
          tone="negative"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {splitIssue}
        </Text>
      ) : null}
    </View>
  );
}
