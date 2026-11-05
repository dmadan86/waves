import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import type { MenuAnchor } from '@/components/SortMenu';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import {
  useDecideDevice,
  useResetTwoStep,
  useTwoStepOverview,
  type TwoStepOverview,
} from '@/data/companyTwoStep';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { useFlagEnabled } from '@/lib/flags';
import { useToast } from '@/lib/toast';
import { useViewerRole } from '@/lib/useCompanyTab';

type Member = TwoStepOverview['members'][number];

/** New-phone approvals and "Reset two-step", for owners and managers of a company that requires it. */
export function TwoStepPeople({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm } = useDialog();
  const toast = useToast();
  const flag = useFlagEnabled('company_two_step');
  const role = useViewerRole(groupId);
  const viewerIsOwner = role === 'admin';
  const overview = useTwoStepOverview(groupId, flag && (viewerIsOwner || role === 'manager'));
  const decide = useDecideDevice(groupId);
  const reset = useResetTwoStep(groupId);
  const data = overview.data;
  if (!flag || !data?.requireTwoStep) return null;

  const resettable = data.members.filter((m) => m.hasFactor && m.canReset);
  if (data.pendingDevices.length === 0 && resettable.length === 0) return null;

  const fail = () => toast.show(t.twoStep.tryLater, 'negative');
  const answer = async (requestId: string, name: string, approve: boolean) => {
    const ok = await confirm({
      title: fill(approve ? t.twoStep.approveTitle : t.twoStep.declineTitle, { name }),
      body: approve ? t.twoStep.approveBody : t.twoStep.declineBody,
      confirmLabel: approve ? t.twoStep.approve : t.twoStep.decline,
      tone: approve ? undefined : 'danger',
    });
    if (ok) await decide.mutateAsync({ requestId, approve }).catch(fail);
  };
  const resetMember = async (member: Member) => {
    const ok = await confirm({
      title: fill(t.twoStep.resetTitle, { name: member.name }),
      body: t.twoStep.resetBody,
      confirmLabel: t.twoStep.reset,
      tone: 'danger',
    });
    if (ok) await reset.mutateAsync(member.memberId).catch(fail);
  };
  const pill = (label: string, onPress: () => void, filled: boolean) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        height: 32,
        justifyContent: 'center',
        borderRadius: 999,
        backgroundColor: filled ? theme.color.brand : theme.color.brandSoft,
      }}
    >
      <Text
        variant="caption"
        style={{ fontWeight: '700', color: filled ? theme.color.onBrand : theme.color.brand }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader title={t.twoStep.peopleTitle} />
      <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
        {data.pendingDevices.map((device, index) => (
          <ListRow
            key={device.requestId}
            divider={index < data.pendingDevices.length - 1 || resettable.length > 0}
            leading={<PersonAvatar name={device.name} size={28} />}
            title={device.name}
            subtitle={fill(t.twoStep.newPhoneRow, { platform: device.platform ?? '' })}
            trailing={
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {pill(
                  t.twoStep.decline,
                  () => void answer(device.requestId, device.name, false),
                  false,
                )}
                {pill(
                  t.twoStep.approve,
                  () => void answer(device.requestId, device.name, true),
                  true,
                )}
              </View>
            }
          />
        ))}
        {resettable.map((member, index) => (
          <MemberRow
            key={member.memberId}
            member={member}
            divider={index < resettable.length - 1}
            onReset={() => void resetMember(member)}
          />
        ))}
      </StandardCard>
    </View>
  );
}

function MemberRow({
  member,
  divider,
  onReset,
}: {
  member: Member;
  divider: boolean;
  onReset: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | 'open' | null>(null);
  return (
    <>
      <ListRow
        divider={divider}
        leading={<PersonAvatar name={member.name} size={28} />}
        title={member.name}
        subtitle={t.twoStep.memberOn}
        trailing={
          <View ref={ref} collapsable={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={member.name}
              hitSlop={8}
              onPress={() =>
                ref.current?.measureInWindow((x, y, width, height) =>
                  setAnchor(width > 0 ? { x, y, width, height } : 'open'),
                )
              }
            >
              <Ionicons name="ellipsis-vertical" size={iconSize.md} color={theme.color.textMuted} />
            </Pressable>
          </View>
        }
      />
      <OverflowMenu
        visible={anchor !== null}
        onClose={() => setAnchor(null)}
        anchor={anchor === 'open' ? null : anchor}
        items={[
          { icon: 'refresh-outline', label: t.twoStep.reset, tone: 'danger', onPress: onReset },
        ]}
      />
    </>
  );
}
