/**
 * Your own say in how findable you are, and how much of you shows.
 *
 * Two questions that look like one and are not, so the screen keeps them apart
 * with a section head each rather than stacking three switches in a list:
 *
 *   * **Can somebody who already has my number find me?** Per channel, because
 *     a work email address and a mobile number are not the same level of
 *     acquaintance, and plenty of people will happily be one and not the other.
 *   * **Can the people already in my groups read my number off my profile?**
 *     One choice, because a group-mate allowed to see one channel gains very
 *     little from being denied the other.
 *
 * Every hint under a control says what it actually does, including the thing
 * people most fear when they touch a privacy switch — turning discovery off
 * does not eject you from the groups you are in. A switch whose consequence is
 * unstated gets left alone, which makes it no switch at all.
 *
 * Saving is immediate and optimistic, and a failure puts the control back to
 * what the server still holds (the pattern in `settings/notifications`): a
 * privacy switch that appears to have moved when it has not is the one kind of
 * lie this screen must never tell.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import {
  Card,
  directionalIcon,
  Divider,
  IconButton,
  iconSize,
  Row,
  Screen,
  SectionHeader,
  Text,
  Toggle,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import {
  DEFAULT_DISCOVERY,
  fetchDiscoverySettings,
  saveDiscoverySettings,
  type DiscoverySettings,
} from '@/data/api';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';

export default function DiscoveryScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const { profile } = useAuth();

  const [settings, setSettings] = useState<DiscoverySettings>(DEFAULT_DISCOVERY);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    let active = true;
    void (async () => {
      try {
        const loaded = await fetchDiscoverySettings(profile.id);
        if (active) setSettings(loaded);
      } catch (caught: unknown) {
        if (active) setStatus(friendlyError(caught, t.loadError, 'discovery.load'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [profile?.id, t.loadError]);

  const apply = (next: DiscoverySettings): void => {
    if (!profile?.id) return;
    const previous = settings;
    setSettings(next);
    setStatus(null);
    void saveDiscoverySettings(profile.id, next)
      .then(() => setStatus(t.account.saved))
      .catch((caught: unknown) => {
        setSettings(previous);
        setStatus(friendlyError(caught, t.couldNotSave, 'discovery.save'));
      });
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
          <Text variant="heading" numberOfLines={1}>
            {t.person.discoveryTitle}
          </Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text tone="muted">{t.person.discoveryIntro}</Text>

        {loading ? (
          <ActivityIndicator color={theme.color.brand} />
        ) : (
          <>
            <View style={{ gap: theme.spacing.md }}>
              <SectionHeader title={t.person.findTitle} />
              <Card style={{ gap: theme.spacing.md }}>
                <SwitchRow
                  title={t.person.discoveryPhone}
                  hint={t.person.discoveryPhoneHint}
                  value={settings.discoverableByPhone}
                  onChange={(value) => apply({ ...settings, discoverableByPhone: value })}
                />
                <Divider />
                <SwitchRow
                  title={t.person.discoveryEmail}
                  hint={t.person.discoveryEmailHint}
                  value={settings.discoverableByEmail}
                  onChange={(value) => apply({ ...settings, discoverableByEmail: value })}
                />
              </Card>
            </View>

            <View style={{ gap: theme.spacing.md }}>
              <SectionHeader title={t.person.visibilityTitle} />
              <Card style={{ gap: theme.spacing.md }}>
                {/* Two mutually exclusive answers, so radios rather than a
                    switch — "off" would not say what the other state is. */}
                <ChoiceRow
                  title={t.person.visibilityGroups}
                  hint={t.person.visibilityGroupsHint}
                  selected={settings.contactVisibility === 'groups'}
                  onSelect={() => apply({ ...settings, contactVisibility: 'groups' })}
                />
                <Divider />
                <ChoiceRow
                  title={t.person.visibilityNobody}
                  hint={t.person.visibilityNobodyHint}
                  selected={settings.contactVisibility === 'nobody'}
                  onSelect={() => apply({ ...settings, contactVisibility: 'nobody' })}
                />
              </Card>
            </View>

            <Text variant="caption" tone="muted">
              {t.person.discoveryFootnote}
            </Text>

            {status ? (
              <Text variant="caption" tone="muted">
                {status}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SwitchRow({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="subheading">{title}</Text>
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      </View>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={title} />
    </Row>
  );
}

function ChoiceRow({
  title,
  hint,
  selected,
  onSelect,
}: {
  title: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      // Exact selected state, not `disabled` and not a checked-looking icon
      // alone: a screen reader has to be able to hear which of the two is on.
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={title}
      accessibilityHint={hint}
      onPress={onSelect}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading">{title}</Text>
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        </View>
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={iconSize.md}
          color={selected ? theme.color.brand : theme.color.textFaint}
        />
      </Row>
    </Pressable>
  );
}
