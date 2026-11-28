/**
 * Preferred language — a standalone screen, reachable from the welcome gateway
 * and the sign-in header before there is any account.
 *
 * The settings tab is the home for this once somebody is inside the app; this
 * is the same choice offered flat at the front door, for a person who opened
 * the app in a script they cannot read. It renders the same
 * `LanguageChoiceList` as the settings screen — script badges, the brand fill
 * on the chosen row, the restart banner — because the front door is where the
 * design matters most, and it used to be the thinner of the two.
 *
 * A public route (see `_layout`), so it works with no session. What differs
 * from the settings screen is only the framing: a back target that falls back
 * to the welcome gateway rather than assuming a stack, a chevron in the brand's
 * primary ink, and a safe-area inset in place of the tab-bar clearance.
 */

import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen, useTheme } from '@waves/ui';

import { LanguageChoiceList } from '@/components/LanguageChoiceList';
import { PlainHeader } from '@/components/standard';
import { useStrings } from '@/i18n';
import { useGoBack } from '@/lib/navigation';

export default function LanguageScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();
  const goBack = useGoBack('/welcome');

  return (
    <Screen edges={[]}>
      <PlainHeader title={t.language} onBack={goBack} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xxxl,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <LanguageChoiceList />
      </ScrollView>
    </Screen>
  );
}
