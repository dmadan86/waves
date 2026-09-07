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

import { router } from 'expo-router';

import { countryFlag, countryName, railsFor } from '@waves/core';
import { Card, ListRow, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

import { requestCountry } from '@/lib/countryPickerBridge';

export function CountryRow({
  countryCode,
  onChange,
}: {
  countryCode: string | null;
  onChange: (countryCode: string | null) => void;
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
    router.push('/country');
  };

  return (
    <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
      <ListRow
        // A globe stands in for "no country set", where a flag would be a lie.
        leading={<Text style={{ fontSize: 26 }}>{countryFlag(countryCode) ?? '🌐'}</Text>}
        title={t.pickers.country}
        subtitle={t.pickers.settlesWith
          .replace(
            '{country}',
            countryCode ? (countryName(countryCode) ?? countryCode) : t.pickers.notSet,
          )
          .replace('{rails}', rails)}
        onPress={open}
      />
    </Card>
  );
}
