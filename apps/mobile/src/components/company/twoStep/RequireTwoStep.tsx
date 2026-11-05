import Ionicons from '@expo/vector-icons/Ionicons';

import { iconSize, Toggle, useTheme } from '@waves/ui';

import { ListRow, RowTile, StandardCard } from '@/components/standard';
import {
  membersNeedingUpdate,
  useSetRequireTwoStep,
  useTwoStepOverview,
} from '@/data/companyTwoStep';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { useFlagEnabled } from '@/lib/flags';
import { useToast } from '@/lib/toast';
import { useViewerRole } from '@/lib/useCompanyTab';

/** "Require two-step login": owner/manager only, and only while the flag is on. */
export function RequireTwoStep({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm } = useDialog();
  const toast = useToast();
  const flag = useFlagEnabled('company_two_step');
  const role = useViewerRole(groupId);
  const allowed = flag && (role === 'admin' || role === 'manager');
  const overview = useTwoStepOverview(groupId, allowed);
  const set = useSetRequireTwoStep(groupId);
  if (!allowed || !overview.data) return null;

  const on = overview.data.requireTwoStep;
  const change = async (next: boolean) => {
    if (next) {
      const old = membersNeedingUpdate(overview.data.members);
      const ok = await confirm({
        title: t.twoStep.requireConfirmTitle,
        body:
          old.length > 0
            ? fill(t.twoStep.requireConfirmOld, { names: old.map((m) => m.name).join(', ') })
            : t.twoStep.requireConfirmBody,
        confirmLabel: t.twoStep.requireOn,
      });
      if (!ok) return;
    }
    try {
      await set.mutateAsync(next);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      // Feature switched off server-side: the row has no business being here.
      if (code === 'FEATURE_OFF') void overview.refetch();
      toast.show(
        code === 'TWO_STEP_REQUIRED' ? t.twoStep.verifyFirst : t.twoStep.tryLater,
        'negative',
      );
    }
  };

  return (
    <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
      <ListRow
        leading={
          <RowTile tint={theme.color.brandSoft}>
            <Ionicons
              name="shield-checkmark-outline"
              size={iconSize.lg}
              color={theme.color.brand}
            />
          </RowTile>
        }
        title={t.twoStep.requireTitle}
        subtitle={t.twoStep.requireHint}
        subtitleLines={3}
        titleLines={2}
        trailing={
          <Toggle
            value={on}
            disabled={set.isPending}
            onValueChange={(next) => void change(next)}
            accessibilityLabel={t.twoStep.requireTitle}
          />
        }
      />
    </StandardCard>
  );
}
