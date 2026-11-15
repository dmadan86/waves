import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import {
  docNumberLabel,
  inquiryAmount,
  inquiryDocs,
  inquiryLabel,
  inquiryStatus,
} from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { useMoney } from '@/components/company/dashboard/parts';
import { InquirySheet, InquiryStatusPill } from '@/components/company/clients/InquiryParts';
import { useWhen } from '@/components/company/clients/parts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { ListRow, ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
import {
  useClientMoney,
  useCompanyClients,
  useRejectInquiry,
  useRemoveInquiry,
} from '@/data/companyClients';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

/** One inquiry of a client: its status, amount and details, the estimates and bills behind it, and what can be done next. */
export function InquiryDetail({ groupId, inquiryId }: { groupId: string; inquiryId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyClients;
  const clearance = useBottomClearance();
  const { confirm, choose } = useDialog();
  const view = useCompanyClients(groupId);
  const entries = useCompanyEntries(groupId);
  const suspended = useCompanySuspended(groupId);
  const money = useClientMoney(groupId);
  const fmt = useMoney(view.currency);
  const when = useWhen();
  const reject = useRejectInquiry(groupId);
  const remove = useRemoveInquiry(groupId);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const inquiry = view.inquiries.find((i) => i.id === inquiryId);
  const client = view.clients.find((c) => c.id === inquiry?.clientId);
  const today = todayIso();
  const canWrite = view.canAdd && !suspended && client?.stage !== 'lost';
  const docsAllowed = entries.isAdmin && !suspended;
  const docs = inquiry ? inquiryDocs(inquiry.id, money.docs) : [];
  const status = inquiry ? inquiryStatus(inquiry, money.docs) : 'open';
  const amount = inquiry ? inquiryAmount(inquiry, money.docs) : null;

  const askReject = async () => {
    const reason = await choose({
      title: s.inqRejectWhy,
      options: [
        { id: s.lostPrice, label: s.lostPrice },
        { id: s.lostOther, label: s.lostOther },
        { id: s.lostSilent, label: s.lostSilent },
        { id: '', label: s.lostSkip },
      ],
    });
    if (reason !== null && inquiry)
      reject.mutate({ inquiryId: inquiry.id, rejected: true, reason: reason || null });
  };
  const items: OverflowMenuItem[] = inquiry
    ? [
        ...(canWrite
          ? [
              {
                icon: 'pencil-outline' as const,
                label: s.inqEdit,
                onPress: () => setEditing(true),
              },
            ]
          : []),
        ...(view.canManage && !suspended
          ? [
              {
                icon: 'trash-outline' as const,
                label: s.inqRemove,
                tone: 'danger' as const,
                onPress: () => {
                  void confirm({
                    title: s.inqRemoveConfirm,
                    confirmLabel: s.inqRemove,
                    tone: 'danger',
                  }).then((yes) => {
                    if (yes) remove.mutate(inquiry.id, { onSuccess: () => router.back() });
                  });
                },
              },
            ]
          : []),
      ]
    : [];
  const round = {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.scheme === 'dark' ? 'rgba(20,20,34,0.82)' : '#FFFFFF',
  };
  return (
    <Screen edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: clearance + theme.spacing.xl }}
      >
        <ScenicHeader
          title={inquiry ? inquiryLabel(inquiry.number) : s.inqTitle}
          subtitle={client?.name}
          circleBack
          action={
            items.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={s.more}
                onPress={() => setMenu(true)}
                style={round}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={theme.color.text} />
              </Pressable>
            ) : undefined
          }
        />
        <ScenicBody>
          {inquiry ? (
            <>
              <StandardCard style={{ gap: theme.spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: '800' }}>
                      {inquiry.title}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {`${inquiryLabel(inquiry.number)} · ${when(inquiry.inquiryDate, today)}`}
                    </Text>
                  </View>
                  <InquiryStatusPill status={status} />
                </View>
                {amount != null ? (
                  <View>
                    <Text variant="caption" tone="muted">
                      {s.inqAmount}
                    </Text>
                    <Text tabular style={{ fontSize: 26, lineHeight: 32, fontWeight: '800' }}>
                      {fmt(amount)}
                    </Text>
                  </View>
                ) : null}
                {status === 'rejected' && inquiry.rejectReason ? (
                  <Text tone="negative">
                    {fill(s.inqRejectedFor, { reason: inquiry.rejectReason })}
                  </Text>
                ) : null}
                {inquiry.details ? (
                  <View>
                    <Text variant="caption" tone="muted">
                      {s.inqDetails}
                    </Text>
                    <Text>{inquiry.details}</Text>
                  </View>
                ) : null}
              </StandardCard>
              {docsAllowed || docs.length > 0 ? (
                <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
                  <Text variant="caption" tone="muted" style={{ paddingTop: theme.spacing.sm }}>
                    {s.inqDocs}
                  </Text>
                  {docs.length === 0 ? (
                    <Text tone="muted" style={{ paddingVertical: theme.spacing.md }}>
                      {s.inqNoDocs}
                    </Text>
                  ) : (
                    docs.map((d, index) => (
                      <ListRow
                        key={d.id}
                        title={docNumberLabel(d.docType, d.number)}
                        subtitle={`${t.companyDocs[d.status]} · ${when(d.docDate, today)}`}
                        amount={fmt(d.totalMinor)}
                        leading={
                          <Ionicons
                            name="document-text-outline"
                            size={20}
                            color={theme.color.textMuted}
                          />
                        }
                        onPress={() => router.push(`/group/${groupId}/company-bill?docId=${d.id}`)}
                        divider={index < docs.length - 1}
                      />
                    ))
                  )}
                </StandardCard>
              ) : null}
              <View style={{ gap: theme.spacing.sm }}>
                {/* Won: the bill above is the next step, so no new estimate and no rejecting. */}
                {docsAllowed && status !== 'rejected' && status !== 'won' ? (
                  <Button
                    label={s.inqCreateEstimate}
                    variant="brand"
                    onPress={() =>
                      router.push(
                        `/group/${groupId}/company-bill-form?type=estimate&clientId=${inquiry.clientId}&inquiryId=${inquiry.id}`,
                      )
                    }
                  />
                ) : null}
                {canWrite && status !== 'rejected' && status !== 'won' ? (
                  <Button
                    label={s.inqReject}
                    variant="secondary"
                    disabled={reject.isPending}
                    onPress={() => void askReject()}
                  />
                ) : null}
                {canWrite && status === 'rejected' ? (
                  <Button
                    label={s.inqReopen}
                    variant="secondary"
                    disabled={reject.isPending}
                    onPress={() => reject.mutate({ inquiryId: inquiry.id, rejected: false })}
                  />
                ) : null}
              </View>
            </>
          ) : (
            <StandardCard>
              <Text tone="muted">{s.inqNotFound}</Text>
            </StandardCard>
          )}
        </ScenicBody>
      </ScrollView>
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
      {inquiry && canWrite ? (
        <InquirySheet
          key={inquiry.id + inquiry.title}
          visible={editing}
          onClose={() => setEditing(false)}
          groupId={groupId}
          clientId={inquiry.clientId}
          inquiry={inquiry}
          currency={view.currency}
        />
      ) : null}
    </Screen>
  );
}
