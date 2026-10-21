/**
 * The row that shows where a group — or a person — settles, and opens the
 * picker.
 *
 * Not a flag-and-dial-code control: the choice only decides two things, and
 * saying which is more useful than a pretty list. **Which payment rails the
 * settle screen offers**, and what currency a new group starts in. A group in
 * the UAE gets Aani and dirhams; the same group set to India gets UPI and
 * rupees, so the row says as much under its title.
 *
 * The list itself lives on the `/country` route rather than in a `Modal` opened
 * from here, so it arrives with the same push as every other full-screen page.
 * A pushed route cannot hand a value back the way an inline callback could, so
 * the answer comes back through `countryPickerBridge`.
 */

import Ionicons from '@expo/vector-icons/Ionicons';

import { countryFlag, countryName, railsFor } from '@waves/core';
import { Card, directionalIcon, iconSize, ListRow, Text, useTheme } from '@waves/ui';

import { RowTile } from '@/components/standard/RowTile';
import { useStrings } from '@/i18n';

import { requestCountry } from '@/lib/countryPickerBridge';
import { router } from '@/lib/navigation';

export function CountryRow({
  countryCode,
  onChange,
  onOpen,
  tile = false,
}: {
  countryCode: string | null;
  onChange: (countryCode: string | null) => void;
  /** Called just before the picker route opens, for a host that has to get out of its way (a sheet). */
  onOpen?: () => void;
  /** A bare row for a shared card: a 44dp circular pink tile for the flag and a chevron, no card of its own. */
  tile?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();

  // What this choice actually buys, said in the row rather than in a help page.
  const rails = railsFor(countryCode)
    .slice(0, 3)
    .map((rail) => rail.label)
    .join(', ');

  // The intent is stashed before the navigation, not passed as a route param: a
  // param can carry the country we start from but not the callback that has to
  // receive the answer.
  const open = (): void => {
    requestCountry({ initial: countryCode, onPicked: onChange });
    onOpen?.();
    router.push('/country');
  };

  const flag = countryFlag(countryCode) ?? '🌐';
  const subtitle = t.pickers.settlesWith
    .replace(
      '{country}',
      countryCode ? (countryName(countryCode) ?? countryCode) : t.pickers.notSet,
    )
    .replace('{rails}', rails);

  if (tile) {
    // Just the country's name under the title; the rails it unlocks are in the picker.
    const name = countryCode ? (countryName(countryCode) ?? countryCode) : t.pickers.notSet;
    return (
      <ListRow
        leading={
          <RowTile tint={theme.scheme === 'dark' ? '#E5566D38' : '#FDE8EC'}>
            <Text style={{ fontSize: 22 }}>{flag}</Text>
          </RowTile>
        }
        title={t.pickers.country}
        subtitle={name}
        trailing={
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.md}
            color={theme.color.textMuted}
          />
        }
        onPress={open}
      />
    );
  }

  return (
    <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
      <ListRow
        // A globe stands in for "no country set", where a flag would be a lie.
        leading={<Text style={{ fontSize: 26 }}>{flag}</Text>}
        title={t.pickers.country}
        subtitle={subtitle}
        onPress={open}
      />
    </Card>
  );
}
