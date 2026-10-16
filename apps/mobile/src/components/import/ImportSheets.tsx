/**
 * The two sheets the source step opens: the CSV examples (with a template to
 * share) and the screenshot upsell.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { Button, iconSize, Row, SegmentedTabs, Sheet, Text, useTheme } from '@waves/ui';

import { Disc } from '@/components/import/ImportChrome';
import { useStrings } from '@/i18n';
import { EXAMPLE_IDS, EXAMPLES, type ExampleId } from '@/lib/groupImport/examples';

export function ExamplesSheet({
  visible,
  busy,
  onShare,
  onCopy,
  onClose,
}: {
  visible: boolean;
  /** The template is being written for sharing. */
  busy: boolean;
  onShare: () => void;
  onCopy: (text: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const [tab, setTab] = useState<ExampleId>('simple');

  const label: Record<ExampleId, string> = {
    simple: t.groupImport.exTabSimple,
    split: t.groupImport.exTabSplit,
    splitwise: t.groupImport.exTabSplitwise,
  };
  const meaning: Record<ExampleId, string> = {
    simple: t.groupImport.exSimple,
    split: t.groupImport.exSplit,
    splitwise: t.groupImport.exSplitwise,
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t.groupImport.examplesTitle}
      closeLabel={t.common.close}
      style={{ maxHeight: '88%' }}
    >
      <View style={{ gap: theme.spacing.md }}>
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={EXAMPLE_IDS.map((id) => ({ value: id, label: label[id] }))}
        />
        {/* Monospace, and scrolling sideways rather than wrapping: a CSV that
            wraps stops looking like columns. Read-only; "Copy example" is the way out. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={EXAMPLES[tab]}
          style={{ backgroundColor: theme.color.surfaceMuted, borderRadius: theme.radius.md }}
          contentContainerStyle={{ padding: theme.spacing.md }}
        >
          <Text variant="caption" selectable style={{ fontFamily: 'Courier', lineHeight: 20 }}>
            {EXAMPLES[tab]}
          </Text>
        </ScrollView>
        <Row style={{ alignItems: 'flex-start', gap: theme.spacing.sm }}>
          <Ionicons
            name="information-circle-outline"
            size={iconSize.md}
            color={theme.color.brand}
          />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {meaning[tab]} {t.groupImport.headersNote}
          </Text>
        </Row>
        <Row style={{ gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              label={t.groupImport.shareTemplate}
              variant="brand"
              fullWidth
              disabled={busy}
              icon={
                <Ionicons name="share-outline" size={iconSize.md} color={theme.color.onBrand} />
              }
              onPress={onShare}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t.groupImport.copyExample}
              variant="secondary"
              fullWidth
              icon={<Ionicons name="copy-outline" size={iconSize.md} color={theme.color.brand} />}
              onPress={() => onCopy(EXAMPLES[tab])}
            />
          </View>
        </Row>
      </View>
    </Sheet>
  );
}

/**
 * Screenshot import is a Pro feature. Until it ships, the card opens this: what
 * it will do, a way to the plans, and the free road that works today.
 */
export function UpsellSheet({
  visible,
  onPlans,
  onCsv,
  onClose,
}: {
  visible: boolean;
  onPlans: () => void;
  onCsv: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.lg, alignItems: 'center' }}>
        <Disc icon="image-outline" fill={theme.color.brandSoft} ink={theme.color.brand} size={64} />
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title" align="center">
            {t.groupImport.upsellTitle}
          </Text>
          <Text variant="body" tone="muted" align="center">
            {t.groupImport.upsellBody}
          </Text>
        </View>
        <View style={{ gap: theme.spacing.sm, alignSelf: 'stretch' }}>
          <Button
            label={t.groupImport.seePlans}
            variant="brand"
            size="lg"
            fullWidth
            onPress={onPlans}
          />
          <Button label={t.groupImport.useCsv} variant="ghost" fullWidth onPress={onCsv} />
        </View>
      </View>
    </Sheet>
  );
}
