/**
 * The scene behind the Home and Personal heroes, and the switch for it.
 *
 * "Automatic" first, the default — the scene follows the time of day — then the
 * six scenes with a thumbnail each, the same shape as the theme and language
 * pickers: an override the app remembers on top of a rule it otherwise follows.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { ScrollView, View } from 'react-native';

import {
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  ListRow,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { SCENE_PHOTOS } from '@/components/home/PersonalHeroBackground';
import { useStrings } from '@/i18n';
import { useHeroScenePreference } from '@/lib/heroScenePreference';
import { router } from '@/lib/navigation';
import { Scene } from '@/lib/scene';

/** The picker's order: the day as it runs, then the season. */
const ORDER: readonly Scene[] = [
  Scene.Morning,
  Scene.Afternoon,
  Scene.Sunset,
  Scene.Evening,
  Scene.Night,
  Scene.Winter,
];

export default function SceneSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const { preference, setPreference } = useHeroScenePreference();

  const rows: {
    key: string;
    title: string;
    subtitle: string;
    value: Scene | null;
  }[] = [
    { key: 'auto', title: t.heroScene.auto, subtitle: t.heroScene.autoHint, value: null },
    ...ORDER.map((scene) => ({
      key: scene,
      title: t.heroScene.names[scene],
      subtitle: t.heroScene.hints[scene],
      value: scene,
    })),
  ];

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
          <Text variant="heading">{t.heroScene.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

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
        <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
          {rows.map((row, index) => {
            const chosen = preference === row.value;
            return (
              <View key={row.key}>
                <ListRow
                  title={row.title}
                  subtitle={row.subtitle}
                  onPress={() => setPreference(row.value)}
                  // A picker row, not a door: choosing is idempotent and every
                  // tap should land.
                  repeatable
                  accessibilityLabel={row.title}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  leading={
                    row.value ? (
                      <Image
                        source={SCENE_PHOTOS[row.value]}
                        contentFit="cover"
                        accessibilityElementsHidden
                        style={{ width: 56, height: 40, borderRadius: theme.radius.sm }}
                      />
                    ) : (
                      <View
                        style={{
                          width: 56,
                          height: 40,
                          borderRadius: theme.radius.sm,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: theme.color.brandSoft,
                        }}
                      >
                        <Ionicons
                          name="time-outline"
                          size={iconSize.lg}
                          color={theme.color.brand}
                        />
                      </View>
                    )
                  }
                  trailing={
                    chosen ? (
                      <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                    ) : null
                  }
                />
                {index < rows.length - 1 ? (
                  <View style={{ height: 1, backgroundColor: theme.color.border }} />
                ) : null}
              </View>
            );
          })}
        </Card>

        <Text variant="micro" tone="muted" align="center">
          {t.heroScene.footnote}
        </Text>
      </ScrollView>
    </Screen>
  );
}
