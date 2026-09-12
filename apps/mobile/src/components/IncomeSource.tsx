/**
 * Where money came from — the income counterpart of the spend catalog.
 *
 * `SourceRow` + `SourceSheet` mirror `CategoryRow` + `CategorySheet` one file
 * over, deliberately and to the pixel: a settings row that names the field and
 * shows what is chosen, and the sheet of options behind it. Choosing a source
 * is the same gesture as choosing a category, and drawing it as a different
 * kind of control would suggest it is a different kind of decision. What
 * differs is only the vocabulary — `INCOME_SOURCES` rather than the spend
 * categories — because filing a salary under "Food & drink" was the whole
 * problem.
 *
 * There used to be a `SourcePicker` here as well: the same catalog as a lane of
 * chips, for the private ledger's form before it folded its details into rows.
 * It went when the last caller did rather than staying as a second way to
 * answer the same question — the two would have drifted, and a form that asked
 * "what for" as a row and "where from" as a chip lane looked like two forms.
 */

import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  incomeSource,
  incomeTags,
  INCOME_SOURCES,
  type CatalogEntry,
  type IncomeSource,
} from '@waves/core';
import { iconSize, useTheme } from '@waves/ui';

import { DetailRow } from '@/components/DetailRows';
import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { useCategoryTags } from '@/data/hooks';
import { useStrings, type UiStrings } from '@/i18n';

/** The stored id carries an `inc.` prefix so the two vocabularies can share one
 *  column without ever colliding; the string table keys off the bare name. */
function labelKey(id: string): keyof UiStrings['personal']['sources'] {
  return id.replace(/^inc\./, '') as keyof UiStrings['personal']['sources'];
}

export function useSourceLabel(): (id: string | null) => string | null {
  const { t } = useStrings();
  const tags = useCategoryTags().data;
  return (id) => {
    if (id === null) return null;
    const source = incomeSource(id);
    if (source) return t.personal.sources[labelKey(source.id)];
    // Not a built-in, so it is one of theirs — from a pack or made by hand. Their
    // own words are the best label there is; the raw id is the last resort for a
    // tag that has not synced to this device yet.
    return tags.find((tag) => tag.id === id)?.label ?? id;
  };
}

/** The small round glyph a source wears in a list, tinted like its chip. */
export function SourceGlyph({ id, size = 40 }: { id: string | null; size?: number }) {
  const theme = useTheme();
  const source = incomeSource(id);
  // An unknown id is a source the person made; it still gets a circle, in the
  // neutral tint, so a custom source is not visually second class.
  const tint = source ? theme.tint[source.tint] : theme.tint.mint;
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
        name={(source?.icon ?? 'cash-outline') as keyof typeof Ionicons.glyphMap}
        size={iconSize.md}
        color={tint.ink}
      />
    </View>
  );
}

/**
 * The chosen source as one row of a settings list: the field's name, then the
 * source's own glyph and label, then a chevron into {@link SourceSheet}.
 *
 * The sibling of `CategoryRow`, and deliberately identical to it. The private
 * ledger's form asks "what for" of an expense and "where from" of an income,
 * and those are different questions with the same shape — a short answer,
 * already filled in, changed from a sheet. Drawn as a lane of chips for one and
 * a row for the other, the same form would have looked like two forms depending
 * on which way the money went.
 *
 * Identical now down to the glyph. It used to wear {@link SourceGlyph}, the
 * filled circle a source gets in a *list*, shrunk to 24 and parked beside the
 * value; the category row beside it wore a bare mark in the tag's ink. Two rows
 * one above the other in the same card, asking the same question of the same
 * form, and only one of them had a disc behind its icon. The circle is right
 * where a source is the subject of its own row, which is the sources list, and
 * wrong where it is one answer among four.
 */
export function SourceRow({
  value,
  onPress,
}: {
  value: string | null;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const label = useSourceLabel()(value);
  const source = incomeSource(value);
  const tint = source ? theme.tint[source.tint] : theme.tint.mint;
  return (
    <DetailRow
      icon={(source?.icon ?? 'cash-outline') as keyof typeof Ionicons.glyphMap}
      iconColor={tint.ink}
      label={t.personal.source}
      value={label ?? t.personal.sources.other}
      onPress={onPress}
    />
  );
}

/**
 * The sources as a sheet of options — the fifteen built in, then the person's
 * own from a pack or made by hand, one per line with a check against the one in
 * force.
 *
 * Theirs come second rather than mixed in, so the list somebody learned does not
 * reorder itself the first time they install something.
 */
export function SourceSheet({
  value,
  onChange,
  onClose,
}: {
  value: string | null;
  onChange: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const mine = incomeTags(useCategoryTags().data).filter((entry) => !entry.hidden);

  return (
    <SheetOverlay title={t.personal.source} onClose={onClose}>
      <View style={{ gap: theme.spacing.xs }}>
        {INCOME_SOURCES.map((source: IncomeSource) => (
          <ChoiceRow
            key={source.id}
            label={t.personal.sources[labelKey(source.id)]}
            selected={source.id === value}
            leading={<SourceGlyph id={source.id} size={32} />}
            onPress={() => onChange(source.id)}
          />
        ))}

        {mine.map((entry: CatalogEntry) => (
          <ChoiceRow
            key={entry.key}
            label={entry.label}
            selected={entry.key === value}
            leading={<SourceGlyph id={entry.key} size={32} />}
            onPress={() => onChange(entry.key)}
          />
        ))}
      </View>
    </SheetOverlay>
  );
}
