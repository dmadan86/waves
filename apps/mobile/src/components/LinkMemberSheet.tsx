/**
 * "Who is Renny?" — the sheet behind "Link to a Waves user" on a placeholder's
 * page (link_placeholder_member).
 *
 * One box and two lists. The box filters by name as you type; an address or a
 * number in it asks the server instead, under that person's own discovery
 * settings (`waves_find_person`, the same lookup as Friends → Find). The lists
 * are the people already in this group under their own account — picking one
 * is a merge — and the people the viewer shares any other group with, who
 * would have to be asked. Nothing here shows a person the viewer could not
 * already see on a member list.
 *
 * It only picks. What the pick means — merge now, or ask — is the screen's
 * decision, which is where the confirmation and the server call live.
 */

import { useState } from 'react';
import { ActivityIndicator, Platform, TextInput, View } from 'react-native';

import { Button, Callout, ListRow, Sheet, Text, useTheme } from '@waves/ui';

import { findPerson } from '@/data/api';
import { useMemberLinkCandidates } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { channelFor, matchPeople, type LinkPerson } from '@/lib/linkMember';

import { ProfileAvatar } from './ProfileAvatar';

type Lookup =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'found'; person: LinkPerson }
  | { state: 'none' }
  | { state: 'error'; message: string };

export function LinkMemberSheet({
  visible,
  groupId,
  placeholderName,
  inGroup,
  onPick,
  onClose,
}: {
  visible: boolean;
  groupId: string;
  placeholderName: string;
  /** Members of this group with an account, each a merge if picked. */
  inGroup: readonly LinkPerson[];
  onPick: (person: LinkPerson) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const candidates = useMemberLinkCandidates(groupId, visible);

  // A fresh box each time it opens: the last search belongs to the last ask.
  const [opened, setOpened] = useState(false);
  if (visible && !opened) {
    setOpened(true);
    setQuery('');
    setLookup({ state: 'idle' });
  }
  if (!visible && opened) setOpened(false);

  const channel = channelFor(query);
  const known: LinkPerson[] = (candidates.data ?? [])
    .map((row) => ({
      profileId: row.profile_id,
      name: row.display_name,
      avatarUrl: row.avatar_url,
      memberId: null,
    }))
    .filter((person) => !inGroup.some((member) => member.profileId === person.profileId));
  const hereMatches = matchPeople(query, inGroup);
  const knownMatches = matchPeople(query, known);

  const search = (): void => {
    if (!channel) return;
    const typed = query.trim();
    setLookup({ state: 'searching' });
    void findPerson(channel, typed)
      .then((person) => {
        if (!person) {
          setLookup({ state: 'none' });
          return;
        }
        const found: LinkPerson = {
          profileId: person.profile_id,
          name: person.display_name,
          avatarUrl: person.avatar_url,
          memberId: null,
        };
        // Already in this group under that account: a merge, not an ask.
        const member = inGroup.find((row) => row.profileId === found.profileId);
        setLookup({ state: 'found', person: member ?? found });
      })
      .catch((caught: unknown) => {
        const raw = caught instanceof Error ? caught.message : '';
        setLookup({
          state: 'error',
          message: raw.includes('LOOKUP_RATE_LIMIT')
            ? t.person.findRateLimited
            : friendlyError(caught, t.loadError, 'link.find'),
        });
      });
  };

  const row = (person: LinkPerson) => (
    <ListRow
      key={person.profileId}
      title={person.name || t.misc.someone}
      subtitle={person.memberId ? t.link.inThisGroup : undefined}
      leading={<ProfileAvatar name={person.name || '?'} avatarUrl={person.avatarUrl} size={36} />}
      onPress={() => onPick(person)}
    />
  );

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title">{t.link.sheetTitle.replace('{name}', placeholderName)}</Text>
          <Text variant="caption" tone="muted">
            {t.link.sheetHint}
          </Text>
        </View>

        <TextInput
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            if (lookup.state !== 'idle') setLookup({ state: 'idle' });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t.link.searchPlaceholder}
          placeholder={t.link.searchPlaceholder}
          placeholderTextColor={theme.color.textFaint}
          returnKeyType="search"
          onSubmitEditing={search}
          style={{
            borderWidth: 1,
            borderColor: theme.color.border,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: Platform.OS === 'ios' ? theme.spacing.md : theme.spacing.sm,
            fontSize: 16,
            color: theme.color.text,
            backgroundColor: theme.color.surface,
          }}
        />

        {/* An address or a number: one exact lookup, on Enter. */}
        {channel ? (
          lookup.state === 'searching' ? (
            <ActivityIndicator color={theme.color.brand} />
          ) : lookup.state === 'found' ? (
            row(lookup.person)
          ) : lookup.state === 'none' ? (
            <Text variant="caption" tone="muted">
              {t.link.notFound}
            </Text>
          ) : lookup.state === 'error' ? (
            <Callout tone="negative">{lookup.message}</Callout>
          ) : (
            <Button label={t.link.lookUp} variant="secondary" size="sm" onPress={search} />
          )
        ) : null}

        {hereMatches.length > 0 ? (
          <View>
            <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing.xs }}>
              {t.link.inThisGroup}
            </Text>
            {hereMatches.map(row)}
          </View>
        ) : null}

        {knownMatches.length > 0 ? (
          <View>
            <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing.xs }}>
              {t.link.peopleYouKnow}
            </Text>
            {knownMatches.map(row)}
          </View>
        ) : null}

        {!channel && hereMatches.length === 0 && knownMatches.length === 0 ? (
          candidates.isLoading ? (
            <ActivityIndicator color={theme.color.brand} />
          ) : (
            <Text variant="caption" tone="muted">
              {t.link.noMatches}
            </Text>
          )
        ) : null}
      </View>
    </Sheet>
  );
}
