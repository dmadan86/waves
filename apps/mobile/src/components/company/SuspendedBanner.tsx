/**
 * Everything a suspended company shows and offers: the banner, a gate for add/edit screens,
 * and the "Report this company" sheet any member or vendor can open from the ⋮ menu.
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TextInput, View } from 'react-native';

import { Button, Chip, Sheet, Text, useTheme } from '@waves/ui';

import { reportCompany, useCompanySuspended } from '@/data/companyEntries';
import { useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';

export function SuspendedBanner() {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        marginHorizontal: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name="lock-closed" size={18} color={theme.color.brand} />
      <Text variant="caption" style={{ flex: 1 }}>
        {t.company.suspendedBanner}
      </Text>
    </View>
  );
}

/** Add/edit screens render this instead of their form while the company is suspended. */
export function SuspendedGate({ groupId, children }: { groupId: string; children: ReactNode }) {
  const suspended = useCompanySuspended(groupId);
  const theme = useTheme();
  const { t } = useStrings();
  if (!suspended) return <>{children}</>;
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.lg, padding: theme.spacing.lg }}>
      <Text style={{ textAlign: 'center' }}>{t.company.suspendedReadOnly}</Text>
      <Button label={t.common.back} onPress={() => router.back()} />
    </View>
  );
}

const CATEGORIES = ['fraud', 'illegal', 'harassment', 'wages', 'other'] as const;
type Category = (typeof CATEGORIES)[number];

export function ReportCompanySheet({
  groupId,
  visible,
  onClose,
}: {
  groupId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { notify } = useDialog();
  const [category, setCategory] = useState<Category>('fraud');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const labels: Record<Category, string> = {
    fraud: t.company.reportFraud,
    illegal: t.company.reportIllegal,
    harassment: t.company.reportHarassment,
    wages: t.company.reportWages,
    other: t.company.reportOther,
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await reportCompany(groupId, category, text.trim());
      setText('');
      onClose();
      await notify({
        title: t.company.reportTitle,
        body: result === 'sent' ? t.company.reportSent : t.company.reportLimit,
      });
    } catch {
      await notify({ title: t.company.reportTitle, body: t.company.reportFailed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close} title={t.company.reportTitle}>
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="caption" tone="muted">
          {t.company.reportBody}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {CATEGORIES.map((c) => (
            <Chip key={c} onCard label={labels[c]} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t.company.reportPlaceholder}
          placeholderTextColor={theme.color.textMuted}
          accessibilityLabel={t.company.reportPlaceholder}
          maxLength={1000}
          multiline
          style={{
            minHeight: 90,
            textAlignVertical: 'top',
            padding: theme.spacing.md,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.color.border,
            color: theme.color.text,
          }}
        />
        <Button label={t.company.reportSend} disabled={busy || text.trim() === ''} onPress={() => void send()} />
      </View>
    </Sheet>
  );
}
