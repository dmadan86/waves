/**
 * The language, from inside the app.
 *
 * The list itself is `LanguageChoiceList` — shared with the public `/language`
 * route reached from the welcome and sign-in headers, so the choice looks the
 * same whether somebody finds it before an account or after one. What this
 * screen owns is the settings framing: the standard header and a scroll
 * container that clears the tab bar.
 */

import { ScrollView } from 'react-native';

import { Screen, useTabBarClearance, useTheme } from '@waves/ui';

import { LanguageChoiceList } from '@/components/LanguageChoiceList';
import { PlainHeader } from '@/components/standard/PlainHeader';
import { useStrings } from '@/i18n';

export default function LanguageSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();

  return (
    <Screen edges={[]}>
      <PlainHeader title={t.language} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <LanguageChoiceList />
      </ScrollView>
    </Screen>
  );
}
