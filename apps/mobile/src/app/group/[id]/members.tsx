import { useMemo, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Image, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  Chip,
  ChipRow,
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

import { familyOf } from '@/lib/families';
import { useFlagEnabled } from '@/lib/flags';
import { type PickedContact } from '@/components/ContactPicker';
import {
  useAddCompanyPastPeople,
  useAddGhostMember,
  useCompanyPastPeople,
  useDecideMemberClaim,
  useGroup,
  useGroupLedger,
  useMemberClaims,
} from '@/data/hooks';
import { useBlockedUsers } from '@/data/blocked';
import {
  useAssignCompanyMember,
  useCompanyProjects,
  useSetMemberProjects,
} from '@/data/companyEntries';
import {
  displayName,
  groupLabel,
  GroupType,
  isBlockedMember,
  isGhost,
  isViewer,
  payableAt,
} from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { requestContacts } from '@/lib/contactPickerBridge';
import { foldPastPeople, searchPastPeople } from '@/lib/companyPastPeople';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { isPhoneCountryError } from '@/lib/phone';
import { useBottomClearance } from '@/lib/clearance';
import { PersonAvatar } from '@/components/PersonAvatar';

const TEAM = require('../../../../assets/images/company/team.webp') as number;

export default function MembersScreen() {
  const theme = useTheme();
  const inputStyle = {
    flex: 1,
    fontSize: 16,
    color: theme.color.text,
    paddingVertical: theme.spacing.sm,
  } as const;
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const { profile, session } = useAuth();

  const { group, members } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, profile?.id ?? null);
  const { blockedIds } = useBlockedUsers();
  const addGhost = useAddGhostMember(groupId);
  const claims = useMemberClaims(groupId);
  const decide = useDecideMemberClaim(groupId);

  const addPast = useAddCompanyPastPeople(groupId);
  const assign = useAssignCompanyMember(groupId);
  const setSites = useSetMemberProjects(groupId);
  const sites = useCompanyProjects(groupId).filter((p) => !p.archived_at);
  // Where the new person reports ('' = the owners) and which sites they are on.
  const [reportsTo, setReportsTo] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);

  const [pastOpen, setPastOpen] = useState(false);
  const [pastQuery, setPastQuery] = useState('');
  const [pastPicked, setPastPicked] = useState<ReadonlySet<string>>(new Set());
  const [ghostName, setGhostName] = useState('');
  const [ghostContact, setGhostContact] = useState('');
  const [ghostEmail, setGhostEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const currency = group.data?.default_currency ?? 'INR';
  const familiesOn = useFlagEnabled('group_units');
  const ghosts = (members.data ?? []).filter(isGhost);

  // A company's roster is private: only its admins add people (the server
  // refuses anybody else). Normal groups are unchanged — any member adds.
  const isCompany = group.data?.type === GroupType.Company;
  const iAmAdmin = (members.data ?? []).some(
    (member) => isViewer(member, profile?.id) && member.role === 'admin' && !member.left_at,
  );
  // A manager adds employees to their own team (the server forces the team); only owners pick from past companies.
  const iAmManager = (members.data ?? []).some(
    (member) => isViewer(member, profile?.id) && member.role === 'manager' && !member.left_at,
  );
  const canAdd = !isCompany || iAmAdmin || iAmManager;
  const companyManagers = (members.data ?? []).filter(
    (member) => member.role === 'manager' && !member.left_at,
  );
  const past = useCompanyPastPeople(groupId, isCompany && iAmAdmin && pastOpen);
  const pastPeople = useMemo(() => foldPastPeople(past.data ?? []), [past.data]);
  const pastShown = useMemo(() => searchPastPeople(pastPeople, pastQuery), [pastPeople, pastQuery]);
  const addPastPicked = (): void => {
    setError(null);
    // Keyed by a stable source id, so a refetch can never shift a tick onto someone else.
    const ids = pastPeople
      .filter((person) => pastPicked.has(person.sourceMemberIds[0]!))
      .flatMap((person) => person.sourceMemberIds);
    addPast.mutate(ids, {
      onSuccess: () => {
        setPastPicked(new Set());
        setPastOpen(false);
      },
      onError: (caught) =>
        setError(friendlyError(caught, t.misc.couldNotAddGeneric, 'members.addPastPeople')),
    });
  };

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
                  : verdict.reason === 'HAS_HISTORY'
                    ? t.claims.theyHaveHistory
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

  // Queued behind the add with the id chosen here, so offline it lands in order. A manager's hire
  // is on their own team already (the server forces it); only an owner picks the reporting line.
  const placeNewPerson = (memberId: string): void => {
    if (!isCompany) return;
    if (iAmAdmin && reportsTo) assign.mutate({ memberId, managerId: reportsTo, reason: '' });
    if (siteIds.length > 0) setSites.mutate({ memberId, projectIds: siteIds });
  };

  const add = (): void => {
    const name = ghostName.trim();
    // A company asks phone and email in their own fields; other groups keep the one address field.
    const contact = isCompany
      ? { phone: ghostContact.trim() || undefined, email: ghostEmail.trim() || undefined }
      : contactOf(ghostContact);
    if (isCompany ? !name : !name && !contact.email && !contact.phone) return;
    setError(null);
    addGhost.mutate(
      { name, ...contact },
      {
        onSuccess: (memberId) => {
          placeNewPerson(memberId);
          setReportsTo('');
          setSiteIds([]);
          setGhostName('');
          setGhostContact('');
          setGhostEmail('');
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
        placeNewPerson(
          await addGhost.mutateAsync({
            name: person.name,
            email: person.email,
            phone: person.phone,
          }),
        );
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
        <View style={{ flex: 1 }}>
          <Text variant="heading">{t.members}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {groupLabel(group.data, members.data ?? [])}
          </Text>
        </View>
        {canAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.people.invite}
            onPress={() => router.push(`/group/${groupId}/invite`)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 36,
              paddingHorizontal: 14,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="share-outline" size={iconSize.md} color={theme.color.brand} />
            <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
              {t.people.invite}
            </Text>
          </Pressable>
        ) : null}
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
                  <PersonAvatar name={claim.ghost_name ?? '?'} ghost />
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
                  isCompany && isViewer(member, profile?.id)
                    ? // A company roster shows the address, not a payment handle.
                      (session?.user?.email ?? undefined)
                    : isCompany && !isBlockedMember(member, blockedIds)
                      ? (member.invite_email ?? member.invite_phone ?? undefined) ||
                        (isGhost(member) ? t.notJoinedYet : undefined)
                      : isGhost(member)
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
                  <PersonAvatar
                    member={member}
                    name={displayName(member, null, blockedIds, t.misc.someone)}
                    ghost={isGhost(member) || isBlockedMember(member, blockedIds)}
                  />
                }
                onPress={() => router.push(`/group/${groupId}/member/${member.id}`)}
                trailing={
                  <Row style={{ gap: theme.spacing.sm }}>
                    {familiesOn && familyOf(group.data?.units, member.id) ? (
                      <Badge label={familyOf(group.data?.units, member.id)?.name ?? ''} />
                    ) : null}
                    {member.role === 'manager' ? (
                      <Badge label={t.company.manager} tone="brand" />
                    ) : null}
                    {member.role === 'admin' && !isGhost(member) ? (
                      <Badge
                        label={t.people.admin}
                        tone="brand"
                        icon={(color) => (
                          <MaterialCommunityIcons name="crown" size={12} color={color} />
                        )}
                      />
                    ) : null}
                    <MoneyText
                      amount={ledger.balances.get(member.id) ?? 0n}
                      currency={currency}
                      locale={locale}
                      mode="balance"
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={displayName(
                        member,
                        profile?.id,
                        blockedIds,
                        t.misc.someone,
                      )}
                      hitSlop={12}
                      onPress={() => router.push(`/group/${groupId}/member/${member.id}`)}
                    >
                      <Ionicons
                        name="ellipsis-vertical"
                        size={iconSize.md}
                        color={theme.color.textMuted}
                      />
                    </Pressable>
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
        {canAdd ? (
          <Card style={{ gap: theme.spacing.lg }}>
            <Row style={{ alignItems: 'flex-start', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text variant="heading">
                  {isCompany ? t.company.addEmployee : t.people.addSomeone}
                </Text>
                <Text variant="caption" tone="muted">
                  {isCompany ? t.company.addEmployeeBody : t.people.addSomeoneBody}
                </Text>
              </View>
              {isCompany ? (
                <Image
                  source={TEAM}
                  accessibilityIgnoresInvertColors
                  fadeDuration={0}
                  style={{ width: 112, height: 69, borderRadius: 10 }}
                />
              ) : null}
            </Row>

            <Row style={{ gap: theme.spacing.sm, alignItems: 'stretch' }}>
              <AddTile
                icon="people-outline"
                label={isCompany ? t.company.fromContacts : t.people.browseContacts}
                body={isCompany ? t.company.fromContactsBody : t.people.browseContactsBody}
                onPress={openContactPicker}
                tone="violet"
              />
              {isCompany ? (
                <AddTile
                  icon="business-outline"
                  label={t.company.fromPastCompany}
                  body={t.company.fromPastCompanyBody}
                  onPress={() => setPastOpen((open) => !open)}
                  tone="blue"
                />
              ) : (
                <AddTile
                  icon="link-outline"
                  label={t.people.shareInvite}
                  body={t.people.shareInviteBody}
                  onPress={() => router.push(`/group/${groupId}/invite`)}
                  tone="violet"
                />
              )}
            </Row>

            {isCompany && pastOpen ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Field icon="search-outline">
                  <TextInput
                    value={pastQuery}
                    onChangeText={setPastQuery}
                    placeholder={t.company.pastSearch}
                    placeholderTextColor={theme.color.textFaint}
                    accessibilityLabel={t.company.pastSearch}
                    style={{
                      flex: 1,
                      fontSize: 16,
                      color: theme.color.text,
                      paddingVertical: theme.spacing.sm,
                    }}
                  />
                </Field>
                {past.isLoading ? <ActivityIndicator color={theme.color.brand} /> : null}
                {past.isError ? (
                  <Callout tone="negative">{t.company.pastLoadFailed}</Callout>
                ) : null}
                {past.data && pastShown.length === 0 ? (
                  <Text variant="caption" tone="muted">
                    {t.company.pastEmpty}
                  </Text>
                ) : null}
                {pastShown.map((person) => {
                  const key = person.sourceMemberIds[0]!;
                  const on = pastPicked.has(key);
                  return (
                    <Pressable
                      key={person.sourceMemberIds[0]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      onPress={() =>
                        setPastPicked((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                    >
                      <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
                        <PersonAvatar name={person.name} ghost />
                        <View style={{ flex: 1 }}>
                          <Text variant="body" numberOfLines={1}>
                            {person.name}
                          </Text>
                          <Text variant="micro" tone="muted" numberOfLines={1}>
                            {fill(t.company.pastFrom, { companies: person.companies.join(', ') })}
                          </Text>
                        </View>
                        <Ionicons
                          name={on ? 'checkbox' : 'square-outline'}
                          size={iconSize.lg}
                          color={on ? theme.color.brand : theme.color.textMuted}
                        />
                      </Row>
                    </Pressable>
                  );
                })}
                <Button
                  label={fill(t.company.pastAddSelected, { n: String(pastPicked.size) })}
                  disabled={pastPicked.size === 0 || addPast.isPending}
                  onPress={addPastPicked}
                />
              </View>
            ) : null}

            {/* A rule with the alternative written into it, so the fields below
              read as the other way rather than as the only way. */}
            <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
              <Text variant="micro" tone="faint">
                {t.people.orAddManually}
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
            </Row>

            <View style={{ gap: theme.spacing.sm }}>
              <Field icon="person-outline">
                <TextInput
                  value={ghostName}
                  onChangeText={setGhostName}
                  placeholder={isCompany ? t.company.fullNameRequired : t.people.namePlaceholder}
                  placeholderTextColor={theme.color.textFaint}
                  accessibilityLabel={t.common.name}
                  onSubmitEditing={add}
                  returnKeyType="done"
                  style={inputStyle}
                />
              </Field>
              {isCompany ? <Helper>{t.people.namePlaceholder}</Helper> : null}
              {isCompany ? (
                <>
                  <Field icon="call-outline">
                    <TextInput
                      value={ghostContact}
                      onChangeText={setGhostContact}
                      keyboardType="phone-pad"
                      placeholder={t.company.phoneOptional}
                      placeholderTextColor={theme.color.textFaint}
                      accessibilityLabel={t.company.phoneOptional}
                      returnKeyType="next"
                      style={inputStyle}
                    />
                  </Field>
                  <Helper>{t.company.phoneHelper}</Helper>
                  <Field icon="mail-outline">
                    <TextInput
                      value={ghostEmail}
                      onChangeText={setGhostEmail}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholder={t.company.emailOptional}
                      placeholderTextColor={theme.color.textFaint}
                      accessibilityLabel={t.company.emailOptional}
                      onSubmitEditing={add}
                      returnKeyType="done"
                      style={inputStyle}
                    />
                  </Field>
                  <Helper>{t.company.emailHelper}</Helper>
                  {iAmAdmin && companyManagers.length > 0 ? (
                    <View style={{ gap: theme.spacing.xs }}>
                      <Text variant="caption" tone="muted">
                        {t.company.reportsTo}
                      </Text>
                      <ChipRow
                        wrap
                        options={[
                          { value: '', label: t.company.owners },
                          ...companyManagers.map((m) => ({
                            value: m.id as string,
                            label: displayName(m, null, null, t.misc.someone),
                          })),
                        ]}
                        value={reportsTo}
                        onChange={setReportsTo}
                      />
                    </View>
                  ) : null}
                  {sites.length > 0 ? (
                    <View style={{ gap: theme.spacing.xs }}>
                      <Text variant="caption" tone="muted">
                        {t.company.sites}
                      </Text>
                      <View
                        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}
                      >
                        {sites.map((site) => {
                          const on = siteIds.includes(site.id);
                          return (
                            <Chip
                              key={site.id}
                              label={site.name}
                              selected={on}
                              repeatable
                              onPress={() =>
                                setSiteIds((cur) =>
                                  on ? cur.filter((id) => id !== site.id) : [...cur, site.id],
                                )
                              }
                            />
                          );
                        })}
                      </View>
                    </View>
                  ) : null}
                </>
              ) : (
                <Field icon="at-outline">
                  <TextInput
                    value={ghostContact}
                    onChangeText={setGhostContact}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    placeholder={t.people.contactOptional}
                    placeholderTextColor={theme.color.textFaint}
                    accessibilityLabel={t.common.emailOrPhone}
                    onSubmitEditing={add}
                    returnKeyType="done"
                    style={inputStyle}
                  />
                </Field>
              )}
              <Row
                style={{
                  alignItems: 'flex-start',
                  gap: theme.spacing.md,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={iconSize.md}
                  color={theme.color.brand}
                />
                <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                  {isCompany ? t.company.nameAloneBody : t.misc.nameAloneBody}
                </Text>
              </Row>
              <Button
                label={isCompany ? t.company.qaAddEmployee : t.people.addToGroupButton}
                fullWidth
                disabled={
                  (isCompany ? !ghostName.trim() : !ghostName.trim() && !ghostContact.trim()) ||
                  addGhost.isPending
                }
                onPress={add}
              />
            </View>

            {addGhost.isPending || adding || addPast.isPending ? (
              <ActivityIndicator color={theme.color.brand} />
            ) : null}
            {error ? <Callout tone="negative">{error}</Callout> : null}
          </Card>
        ) : null}

        {canAdd && ghosts.length > 0 ? (
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
  body,
  onPress,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  body: string;
  onPress: () => void;
  tone: 'violet' | 'blue';
}) {
  const theme = useTheme();
  const blue = tone === 'blue' && theme.scheme !== 'dark';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${body}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        gap: theme.spacing.xs,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: blue ? '#E4EEFF' : theme.color.brandSoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: blue ? '#CFE0FF' : theme.color.surface,
          }}
        >
          <Ionicons name={icon} size={iconSize.md} color={blue ? '#2F6FE0' : theme.color.brand} />
        </View>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surface,
          }}
        >
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={12}
            color={blue ? '#2F6FE0' : theme.color.brand}
          />
        </View>
      </Row>
      <Text variant="body" style={{ fontWeight: '700' }}>
        {label}
      </Text>
      <Text variant="micro" tone="muted">
        {body}
      </Text>
    </Pressable>
  );
}

/** A bordered input row with a leading glyph. */
function Field({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.sm,
        borderWidth: 1,
        borderColor: theme.color.border,
        borderRadius: theme.radius.lg,
        paddingHorizontal: theme.spacing.md,
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
      {children}
    </Row>
  );
}

/** A muted helper line under a field, inset to line up with the text. */
function Helper({ children }: { children: ReactNode }) {
  return (
    <Text variant="micro" tone="muted" style={{ marginTop: -4, marginStart: 40 }}>
      {children}
    </Text>
  );
}
