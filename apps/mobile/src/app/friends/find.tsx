/**
 * Finding one person by something you already know about them.
 *
 * Deliberately the narrowest search in the app. There is no name search, no
 * prefix, no browse — one exact email address or one exact phone number, and
 * a result only if that person has left the matching channel discoverable
 * (Settings → Privacy → How people find you). Anything looser turns the whole
 * user table into something a stranger can walk.
 *
 * The screen never distinguishes "nobody uses that" from "they have turned this
 * off", because the server refuses to: if the two answers looked different, the
 * setting would itself become the oracle it exists to close. One sentence
 * covers both, and says so plainly rather than implying the account exists.
 *
 * What the result *does* show back is whatever you typed. That is not a leak —
 * you had it a moment ago — and showing it is how somebody checks they have
 * found the right Priya before adding her to a trip.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { findPerson, type FoundPerson } from '@/data/api';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';

/** What the box holds decides which channel is searched — no second control. */
function channelFor(query: string): 'email' | 'phone' | null {
  const value = query.trim();
  if (value.includes('@')) return value.length > 2 ? 'email' : null;
  // Six digits is not a valid number anywhere; it is just the floor below which
  // a search cannot mean anything and should not spend one of the daily few.
  return value.replace(/[^0-9]/g, '').length >= 6 ? 'phone' : null;
}

type Outcome =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'found'; person: FoundPerson; typed: string }
  | { state: 'none' }
  | { state: 'error'; message: string };

export default function FindPersonScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();

  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });

  const channel = channelFor(query);

  const search = (): void => {
    if (!channel) return;
    const typed = query.trim();
    setOutcome({ state: 'searching' });
    void findPerson(channel, typed)
      .then((person) => {
        setOutcome(person ? { state: 'found', person, typed } : { state: 'none' });
      })
      .catch((caught: unknown) => {
        // The one server error worth its own words: the daily ceiling. Anything
        // else goes through the shared mapper, which never shows a raw message.
        const raw = caught instanceof Error ? caught.message : '';
        setOutcome({
          state: 'error',
          message: raw.includes('LOOKUP_RATE_LIMIT')
            ? t.person.findRateLimited
            : friendlyError(caught, t.loadError, 'person.find'),
        });
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
            {t.person.findTitle}
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
          gap: theme.spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text tone="muted">{t.person.findHint}</Text>

        <Card>
          <TextInput
            value={query}
            onChangeText={(next) => {
              setQuery(next);
              // A stale result under a changed box reads as the answer to the
              // new query. Clear it the moment the question changes.
              if (outcome.state !== 'idle') setOutcome({ state: 'idle' });
            }}
            accessibilityLabel={t.person.findPlaceholder}
            placeholder={t.person.findPlaceholder}
            placeholderTextColor={theme.color.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
            returnKeyType="search"
            onSubmitEditing={search}
            autoFocus
            // An address or a number is Latin text whatever the interface
            // language is, so the box stays left-to-right even in Arabic.
            style={{
              fontSize: 18,
              color: theme.color.text,
              paddingVertical: theme.spacing.xs,
              writingDirection: 'ltr',
              textAlign: 'left',
            }}
          />
        </Card>

        <Button
          label={t.person.findAction}
          onPress={search}
          disabled={!channel || outcome.state === 'searching'}
          fullWidth
        />

        {outcome.state === 'searching' ? <ActivityIndicator color={theme.color.brand} /> : null}

        {outcome.state === 'none' ? (
          <Card style={{ gap: theme.spacing.xs }}>
            <Text variant="subheading">{t.person.findNoMatch}</Text>
            <Text tone="muted">{t.person.findNoMatchBody}</Text>
          </Card>
        ) : null}

        {outcome.state === 'error' ? (
          <Card>
            <Text tone="muted">{outcome.message}</Text>
          </Card>
        ) : null}

        {outcome.state === 'found' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={outcome.person.display_name}
            onPress={() =>
              router.push({
                pathname: '/friends/person/[key]',
                params: { key: outcome.person.profile_id, name: outcome.person.display_name },
              })
            }
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Card>
              <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                <ProfileAvatar
                  name={outcome.person.display_name}
                  avatarUrl={outcome.person.avatar_url}
                  size={48}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="subheading" numberOfLines={1}>
                    {outcome.person.display_name}
                  </Text>
                  {/* What you typed, given back. It reveals nothing and it is
                      the only way to be sure this is the right person. */}
                  <Text
                    variant="caption"
                    tone="muted"
                    numberOfLines={1}
                    style={{ writingDirection: 'ltr' }}
                  >
                    {outcome.typed}
                  </Text>
                  {outcome.person.already_shared ? (
                    <Row>
                      <Badge label={t.person.alreadyShared} tone="brand" />
                    </Row>
                  ) : null}
                </View>
                <Ionicons
                  name={directionalIcon('chevron-forward')}
                  size={iconSize.md}
                  color={theme.color.textFaint}
                />
              </Row>
            </Card>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
