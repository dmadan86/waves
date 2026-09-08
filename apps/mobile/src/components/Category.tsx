/**
 * The category, as a thing you can see and change.
 *
 * `CategoryBadge` is the tinted circle that stands in for an expense in a list
 * — a fork for dinner, an auto for the ride — which is worth more than the two
 * initials of a description at a glance. It renders a built-in from its id, or a
 * custom tag from the {label, icon, tint} snapshot carried on the expense
 * (`meta`), so a groupmate without the author's catalog still sees it.
 *
 * `CategoryPicker` is the row of chips under the description on the capture and
 * personal screens. It draws the person's whole catalog — built-ins plus their
 * own tags, in their chosen order — and ends with a "＋ New tag" chip. It is
 * pre-selected from what was typed (`guessCategory`), and the moment somebody
 * taps a chip themselves the guess stops overriding them.
 *
 * `CategoryRow` + `CategorySheet` are the same catalog said as a list instead:
 * a settings row that names the field and shows what is chosen, and the sheet
 * of options behind it. The group add-expense form folds its details into a
 * list of such rows, where a lane of chips read as a second form rather than as
 * one more setting with an answer.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { guessIcon, normaliseTint, resolveCategory, type CategoryMeta } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import { ChoiceRow, SettingRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { useCategoryCatalog } from '@/data/hooks';
import { useStrings } from '@/i18n';

export function CategoryBadge({
  category,
  meta,
  description,
  size = 42,
}: {
  category: string | null | undefined;
  /** The custom tag's denormalised display, when the value is a custom tag. */
  meta?: CategoryMeta | null;
  /** The expense's own words. When given, the badge draws the specific icon for
   *  what was typed (a coffee cup for a chai) and falls back to the category
   *  icon when nothing matches. Omit on aggregate badges (per-category rows in
   *  insights/budgets), where only the category itself is meaningful. Never
   *  overrides a custom tag's chosen icon. */
  description?: string | null;
  size?: number;
}) {
  const theme = useTheme();
  const resolved = resolveCategory(category, meta ?? null);
  const tint = theme.tint[resolved.tint];
  // A custom tag keeps the icon its author picked; only built-ins get the
  // description-specific refinement over their single category icon.
  const icon = resolved.custom ? resolved.icon : (guessIcon(description) ?? resolved.icon);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint.bg,
      }}
    >
      <Ionicons
        name={icon as keyof typeof Ionicons.glyphMap}
        size={Math.round(size * 0.5)}
        color={tint.ink}
      />
    </View>
  );
}

export function CategoryPicker({
  value,
  onChange,
  onCreate,
}: {
  value: string | null;
  /** The chosen category's key and, for a custom tag, its display snapshot to
   *  carry onto the expense (null for a built-in). */
  onChange: (key: string, meta: CategoryMeta | null) => void;
  /** Opens the create-tag sheet; the "＋ New tag" chip shows only when set. */
  onCreate?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { visible } = useCategoryCatalog((id) => t.categories[id as keyof typeof t.categories]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.xl }}
    >
      {visible.map((entry) => {
        const selected = entry.key === value;
        const meta: CategoryMeta | null = entry.custom
          ? { label: entry.label, icon: entry.icon, tint: normaliseTint(entry.tint) }
          : null;
        return (
          <Pressable
            key={entry.key}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={entry.label}
            onPress={() => onChange(entry.key, meta)}
            // One chip shape for built-ins and custom tags, so the person's own
            // tags read as first-class rather than an afterthought.
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              minHeight: 44,
              paddingVertical: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: selected ? theme.color.brand : theme.color.border,
              backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons
              name={entry.icon as keyof typeof Ionicons.glyphMap}
              size={iconSize.md}
              color={selected ? theme.color.brand : theme.color.textMuted}
            />
            <Text variant="body" style={{ color: selected ? theme.color.brand : theme.color.text }}>
              {entry.label}
            </Text>
          </Pressable>
        );
      })}

      {onCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.tags.newTag}
          onPress={onCreate}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            minHeight: 44,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.color.border,
            borderStyle: 'dashed',
            backgroundColor: theme.color.surface,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
          <Text variant="body" style={{ color: theme.color.brand }}>
            {t.tags.newTag}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

/**
 * The chosen category as one row of a settings list: the field's name, then the
 * tag's own glyph and label, then a chevron into {@link CategorySheet}.
 *
 * The value is read from the person's catalog first — that is where a renamed
 * or re-coloured built-in lives — and only falls back to resolving the stored
 * key when the catalog has not loaded yet, or when the tag is one this device no
 * longer has (an old expense keeps its `meta` snapshot for exactly that).
 */
export function CategoryRow({
  value,
  meta,
  onPress,
}: {
  value: string | null;
  /** The custom tag's denormalised display, when the value is a custom tag. */
  meta?: CategoryMeta | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { visible } = useCategoryCatalog((id) => t.categories[id as keyof typeof t.categories]);

  const entry = visible.find((it) => it.key === value);
  const resolved = resolveCategory(value, meta ?? null);
  const label =
    entry?.label ??
    (resolved.builtinId
      ? t.categories[resolved.builtinId as keyof typeof t.categories]
      : resolved.label);
  const tint = theme.tint[entry ? normaliseTint(entry.tint) : resolved.tint];

  return (
    <SettingRow
      label={t.whatFor}
      value={label}
      leading={
        <Ionicons
          name={(entry?.icon ?? resolved.icon) as keyof typeof Ionicons.glyphMap}
          size={iconSize.md}
          color={tint.ink}
        />
      }
      onPress={onPress}
    />
  );
}

/**
 * The catalog as a sheet of options — the same entries, order and "＋ New tag"
 * escape hatch the chip picker offers, one per line with a check against the
 * one in force.
 *
 * `onChange` hands back the same pair the chip picker does: the key to store and,
 * for a custom tag only, the display snapshot to carry onto the expense. A
 * built-in's own overrides are the author's, not the expense's, so it stores no
 * snapshot — which is why the badge below is built from a display meta the row
 * never passes on.
 */
export function CategorySheet({
  value,
  onChange,
  onCreate,
  onClose,
}: {
  value: string | null;
  onChange: (key: string, meta: CategoryMeta | null) => void;
  /** Opens the create-tag editor; the "＋ New tag" row shows only when set. */
  onCreate?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { visible } = useCategoryCatalog((id) => t.categories[id as keyof typeof t.categories]);

  return (
    <SheetOverlay title={t.whatFor} onClose={onClose}>
      <View style={{ gap: theme.spacing.xs }}>
        {visible.map((entry) => {
          const display: CategoryMeta = {
            label: entry.label,
            icon: entry.icon,
            tint: normaliseTint(entry.tint),
          };
          return (
            <ChoiceRow
              key={entry.key}
              label={entry.label}
              selected={entry.key === value}
              leading={<CategoryBadge category={entry.key} meta={display} size={32} />}
              onPress={() => onChange(entry.key, entry.custom ? display : null)}
            />
          );
        })}

        {onCreate ? (
          <ChoiceRow
            label={t.tags.newTag}
            leading={
              <View style={{ width: 32, alignItems: 'center' }}>
                <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
              </View>
            }
            onPress={onCreate}
          />
        ) : null}
      </View>
    </SheetOverlay>
  );
}
