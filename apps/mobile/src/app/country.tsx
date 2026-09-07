/**
 * Where a group — or a person — settles.
 *
 * Not a flag-and-dial-code control: this only decides two things, and saying
 * which is more useful than a pretty list. **Which payment rails the settle
 * screen offers**, and what currency a new group starts in. A group in the UAE
 * gets Aani and dirhams; the same group set to India gets UPI and rupees.
 *
 * The list is deliberately short and ordered by market rather than
 * alphabetically (see `COUNTRIES` in `@waves/core`), because somebody in the
 * Gulf should not scroll past forty countries to find theirs. "Not set" is a
 * real, supported answer and stays first: a group with no country falls back to
 * bank, cash and the cross-border wallets, which is the right behaviour for a
 * group whose members are in four places.
 *
 * A route rather than the `Modal` this used to be. As a modal it rose from the
 * bottom edge and framed itself by hand, so it was the one full-screen page in
 * the app that neither slid in from the leading edge nor wore the standard
 * header — and, missing the bottom inset, its last country sat under the system
 * navigation bar. As a route it inherits the app's push animation (which follows
 * the writing direction, so Arabic still arrives from the left) and the same
 * header, padding and clearance as every other pushed screen. The caller leaves
 * its intent in `countryPickerBridge` first, because a pushed route cannot
 * return a value the way the inline callback did.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { COUNTRIES, countryFlag, railsFor } from '@waves/core';
import {
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useScreenClearance,
  useTheme,
} from '@waves/ui';

import { useStrings } from '@/i18n';

import { takeCountryRequest } from '@/lib/countryPickerBridge';

export default function CountryScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const clearance = useScreenClearance();

  // Taken once on mount — this captures the request and clears the bridge in
  // one step, so the route owns it outright and no re-render or later open can
  // see a stale request. Nothing else clears it; this screen is the sole owner.
  const [request] = useState(() => takeCountryRequest());

  // Opened with no pending request (a deep link, a stray navigation) has nothing
  // to answer — close rather than show a picker whose choice would go nowhere.
  useEffect(() => {
    if (!request) router.back();
  }, [request]);

  const choose = (countryCode: string | null): void => {
    request?.onPicked(countryCode);
    router.back();
  };

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.misc.whereSettle}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          // The app draws edge-to-edge, so without the system inset the last
          // country in the list sits under the navigation bar.
          paddingBottom: clearance,
          gap: theme.spacing.sm,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" tone="muted" style={{ paddingBottom: theme.spacing.xs }}>
          {t.pickers.countryNote}
        </Text>

        <Choice
          flag="🌐"
          label={t.pickers.notSet}
          hint={t.pickers.notSetRails}
          selected={(request?.initial ?? null) === null}
          onPress={() => choose(null)}
        />
        {COUNTRIES.map((country) => (
          <Choice
            key={country.code}
            flag={countryFlag(country.code) ?? '🌐'}
            label={country.name}
            hint={railsFor(country.code)
              .slice(0, 3)
              .map((rail) => rail.label)
              .join(', ')}
            selected={request?.initial === country.code}
            onPress={() => choose(country.code)}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

function Choice({
  flag,
  label,
  hint,
  selected,
  onPress,
}: {
  flag: string;
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={{
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.md,
        backgroundColor: selected ? theme.color.brandSoft : theme.color.surface,
      }}
    >
      <Row style={{ justifyContent: 'space-between', gap: theme.spacing.md }}>
        <Text style={{ fontSize: 26 }}>{flag}</Text>
        <View style={{ flex: 1 }}>
          <Text variant="subheading">{label}</Text>
          <Text variant="micro" tone="muted">
            {hint}
          </Text>
        </View>
        {selected ? (
          <Text variant="subheading" tone="brand">
            ✓
          </Text>
        ) : null}
      </Row>
    </Pressable>
  );
}
