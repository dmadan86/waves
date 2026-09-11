import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  ListRow,
  MoneyText,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { type PickedContact } from '@/components/ContactPicker';
import {
  useAddGhostMember,
  useDecideMemberClaim,
  useGroup,
  useGroupLedger,
  useMemberClaims,
} from '@/data/hooks';
import { useBlockedUsers } from '@/data/blocked';
import { displayName, groupLabel, isBlockedMember, isGhost, payableAt } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { requestContacts } from '@/lib/contactPickerBridge';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { isPhoneCountryError } from '@/lib/phone';
import { useBottomClearance } from '@/lib/clearance';

export default function MembersScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const { profile } = useAuth();

  const { group, members } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, profile?.id ?? null);
  const { blockedIds } = useBlockedUsers();
  const addGhost = useAddGhostMember(groupId);
  const claims = useMemberClaims(groupId);
  const decide = useDecideMemberClaim(groupId);

  const [ghostName, setGhostName] = useState('');
  const [ghostContact, setGhostContact] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const currency = group.data?.default_currency ?? 'INR';
  const ghosts = (members.data ?? []).filter(isGhost);

  /**
   * Answering a claim (ADR-006).
   *
   * The refusals are worth their own sentences: an admin who taps Confirm a
   * second later than another admin, or on a place somebody has since taken,
   * is not looking at a failure — they are looking at an answer that already
   * happened, and "something went wrong" would send them to check the network.
   */
  const answer = (claimId: string, approve: boolean): void => {
    setClaimError(null);
    decide.mutate(
      { claimId, approve },
      {
        onSuccess: (verdict) => {
          if (verdict.ok) return;
          const said =
            verdict.reason === 'ALREADY_DECIDED'
              ? t.claims.alreadyDecided
              : verdict.reason === 'ALREADY_A_MEMBER'
                ? t.claims.theyAreAlreadyIn
                : verdict.reason === 'NOT_CLAIMABLE'
                  ? t.claims.placeTaken
                  : t.claims.decideFailed;
          setClaimError(said);
        },
        onError: (caught) =>
          setClaimError(friendlyError(caught, t.claims.decideFailed, 'claims.decide')),
      },
    );
  };

  /**
   * One field for the address, whichever kind it is. Asking somebody to first
   * declare "email or phone?" and then type it is a question the text itself
   * already answers.
   */
  const contactOf = (value: string): { email?: string; phone?: string } => {
    const trimmed = value.trim();
    if (!trimmed) return {};
    return trimmed.includes('@') ? { email: trimmed } : { phone: trimmed };
  };

  const add = (): void => {
    const name = ghostName.trim();
    const contact = contactOf(ghostContact);
    if (!name && !contact.email && !contact.phone) return;
    setError(null);
    addGhost.mutate(
      { name, ...contact },
      {
        onSuccess: () => {
          setGhostName('');
          setGhostContact('');
        },
        onError: (caught) =>
          setError(
            isPhoneCountryError(caught)
              ? t.people.phoneNeedsCountryCode
              : friendlyError(caught, t.misc.couldNotAddGeneric, 'members.addGhost'),
          ),
      },
    );
  };

  /**
   * Several people at once, one call each — the server takes one member per
   * request and batching them here would only hide which of them failed.
   *
   * They are added in sequence rather than in parallel because a batch of
   * simultaneous writes to the same group races the balance triggers for no
   * benefit; nobody picks contacts fast enough for the wait to show.
   *
   * A failure part-way does not undo the ones already in. Adding somebody is
   * not a transaction — it is five separate acts — so the honest report is
   * which names did not make it, not a rollback nobody asked for.
   */
  const addPicked = async (people: readonly PickedContact[]): Promise<void> => {
    setError(null);
    setAdding(true);
    const failed: string[] = [];
    let reason: string | null = null;
    for (const person of people) {
      try {
        await addGhost.mutateAsync({
          name: person.name,
          email: person.email,
          phone: person.phone,
        });
      } catch (caught) {
        failed.push(person.name);
        // Report every refusal (friendlyError's side effect sends each to
        // Sentry); keep only the first one's words for the UI, so the message
        // can say why rather than only which names did not make it.
        const message = isPhoneCountryError(caught)
          ? t.people.phoneNeedsCountryCode
          : friendlyError(caught, t.misc.tryAgainMoment, 'members.addPicked');
        if (!reason) reason = message;
      }
    }
    setAdding(false);
    if (failed.length === 0) return;
    setError(fill(t.misc.couldNotAddSome, { reason: reason ?? '' }));
  };

  // Contacts already used, so the picker can grey them out instead of letting
  // somebody add the same person twice. The server would collapse it anyway —
  // this just makes the reason visible.
  const alreadyAdded = new Set(
    (members.data ?? []).flatMap((member) =>
      [member.invite_email, member.invite_phone].filter((value): value is string => Boolean(value)),
    ),
  );

  // Opens the address book on its own screen rather than unfolding it inline.
  // Whoever is already in the group is greyed out there; the ticked people come
  // back through the bridge into `addPicked`.
  const openContactPicker = (): void => {
    requestContacts({
      initial: [],
      existing: alreadyAdded,
      onPicked: (people) => void addPicked(people),
    });
    router.push('/contact-picker');
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
          <Text variant="heading">{t.members}</Text>
          <Text variant="micro" tone="muted">
            {groupLabel(group.data, members.data ?? [])}
          </Text>
        </View>
        <IconButton label={t.people.invite} onPress={() => router.push(`/group/${groupId}/invite`)}>
          <Ionicons name="share-outline" size={iconSize.md} color={theme.color.brand} />
        </IconButton>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Above the member list, because it is a question and the list is not.
            Only admins ever see anything here: the function returns no rows to
            anybody else, so the screen does not have to know who is one. */}
        {(claims.data ?? []).length > 0 ? (
          <Card style={{ gap: theme.spacing.md }}>
            <Text variant="subheading">{t.claims.requestsTitle}</Text>
            {claimError ? <Callout tone="negative">{claimError}</Callout> : null}
            {(claims.data ?? []).map((claim) => (
              <View key={claim.id} style={{ gap: theme.spacing.sm }}>
                <Row style={{ gap: theme.spacing.md }}>
                  <Avatar name={claim.ghost_name ?? '?'} ghost />
                  <Text variant="body" style={{ flex: 1 }}>
                    {fill(t.claims.saysTheyAre, {
                      who: claim.requested_name ?? claim.requester_name ?? t.misc.unnamed,
                      name: claim.ghost_name ?? t.misc.unnamed,
                    })}
                  </Text>
                </Row>
                <Row style={{ gap: theme.spacing.sm }}>
                  <Button
                    label={t.claims.approve}
                    size="sm"
                    disabled={decide.isPending}
                    onPress={() => answer(claim.id, true)}
                  />
                  <Button
                    label={t.claims.decline}
                    size="sm"
                    variant="secondary"
                    disabled={decide.isPending}
                    onPress={() => answer(claim.id, false)}
                  />
                </Row>
              </View>
            ))}
          </Card>
        ) : null}

        <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
          {(members.data ?? []).map((member, index) => (
            <View key={member.id}>
              <ListRow
                title={displayName(member, profile?.id, blockedIds, t.misc.someone)}
                subtitle={
                  isGhost(member)
                    ? t.notJoinedYet
                    : isBlockedMember(member, blockedIds)
                      ? // A payment handle carries a name, an address or a
                        // phone number — masked for a blocked person.
                        t.misc.noUpiYet
                      : // `payableAt`, not the legacy column alone: the rail
                        // pair is where a handle lives now, and reading only
                        // `vpa`/`default_vpa` told everybody on Pix, PayID or
                        // Venmo that they had given nothing.
                        (payableAt(member)?.handle ?? t.misc.noUpiYet)
                }
                leading={
                  <Avatar
                    name={displayName(member, null, blockedIds, t.misc.someone)}
                    ghost={isGhost(member) || isBlockedMember(member, blockedIds)}
                  />
                }
                onPress={() => router.push(`/group/${groupId}/member/${member.id}`)}
                trailing={
                  <Row style={{ gap: theme.spacing.sm }}>
                    {member.role === 'admin' && !isGhost(member) ? (
                      <Badge label={t.people.admin} tone="brand" />
                    ) : null}
                    <MoneyText
                      amount={ledger.balances.get(member.id) ?? 0n}
                      currency={currency}
                      locale={locale}
                      mode="balance"
                    />
                  </Row>
                }
              />
              {index < (members.data?.length ?? 0) - 1 ? (
                <View style={{ height: 1, backgroundColor: theme.color.border }} />
              ) : null}
            </View>
          ))}
        </Card>

        {/* Adding somebody, with the two doors first and the typing second.
            
            It used to be two bare text fields stacked on top of each other —
            neither labelled, only placeheld — with a small Add beside the first
            that also committed the second, and "Browse my contacts" as a ghost
            button underneath them both. So the fastest way in was the last thing
            you saw, and the invite link was a text link in a different card
            further down the page, shown only once a ghost already existed.

            Every add-members screen worth copying puts the doors at the top as
            a row of tiles — Teams (share link / QR / camera), Discord (share /
            copy link / Messages / Gmail), GroupMe, Abode. Typing a name is the
            fallback, under a divider, which is what it actually is: ADR-006
            says a name alone is enough, not that a name alone is the first
            thing to reach for.

            Two tiles rather than the three or four those apps show, because our
            link and our QR are the same screen. A third tile pointing at the
            same place would be the second door that this app keeps deciding not
            to build. */}
        <Card style={{ gap: theme.spacing.lg }}>
          <Text variant="caption" tone="muted">
            {t.people.addSomeone}
          </Text>

          <Row style={{ gap: theme.spacing.sm }}>
            <AddTile
              icon="people-outline"
              label={t.people.browseContacts}
              onPress={openContactPicker}
            />
            <AddTile
              icon="link-outline"
              label={t.people.shareInvite}
              onPress={() => router.push(`/group/${groupId}/invite`)}
            />
          </Row>

          {/* A rule with the alternative written into it, so the fields below
              read as the other way rather than as the only way. */}
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
            <Text variant="micro" tone="faint">
              {t.people.orByName}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
          </Row>

          <View style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
              <TextInput
                value={ghostName}
                onChangeText={setGhostName}
                placeholder={t.people.namePlaceholder}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.common.name}
                onSubmitEditing={add}
                returnKeyType="done"
                style={{
                  flex: 1,
                  fontSize: 17,
                  fontWeight: '600',
                  color: theme.color.text,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  borderRadius: theme.radius.lg,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                }}
              />
              <Button
                label={t.add}
                size="sm"
                disabled={(!ghostName.trim() && !ghostContact.trim()) || addGhost.isPending}
                onPress={add}
              />
            </Row>

            {/* The contact is optional and looked compulsory: a second field of
                the same weight directly under the first reads as the rest of the
                form. It is a quieter, smaller row now, and says so in its own
                placeholder. */}
            <TextInput
              value={ghostContact}
              onChangeText={setGhostContact}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder={t.people.contactPlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.common.emailOrPhone}
              onSubmitEditing={add}
              returnKeyType="done"
              style={{
                fontSize: 15,
                color: theme.color.text,
                borderWidth: 1,
                borderColor: theme.color.border,
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
              }}
            />
            <Text variant="micro" tone="muted">
              {t.misc.nameAloneBody}
            </Text>
          </View>

          {addGhost.isPending || adding ? <ActivityIndicator color={theme.color.brand} /> : null}
          {error ? <Callout tone="negative">{error}</Callout> : null}
        </Card>

        {ghosts.length > 0 ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Badge label={plural(locale, ghosts.length, t.people.yetToJoin)} />
            <Text
              variant="caption"
              tone="brand"
              onPress={() => router.push(`/group/${groupId}/invite`)}
            >
              {t.people.sendInviteLink}
            </Text>
          </Row>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * One of the ways in, as a tile rather than a line of text.
 *
 * Half the width each and the same weight as each other, because they are two
 * answers to one question and neither is the recommended one — which is the
 * shape the reference boards all use for this row. A glyph over a label, so the
 * pair reads as a choice at a glance instead of two sentences to compare.
 */
function AddTile({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.brandSoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
      <Text variant="caption" tone="brand" numberOfLines={1} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}
