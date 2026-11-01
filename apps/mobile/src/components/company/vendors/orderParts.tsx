/** Shared bits of the order screens: status chip, unit labels, one order row. */
import type { VendorOrder, VendorOrderStatus } from '@waves/core';
import { orderLabel, orderTotal } from '@waves/core';

import { Pill } from '@/components/company/vendors/parts';
import { ListRow } from '@/components/standard';
import { fill, useStrings } from '@/i18n';

export function useOrderLabels() {
  const { t } = useStrings();
  const s = t.companyVendors;
  const status: Record<VendorOrderStatus, string> = {
    sent: s.ordSent,
    accepted: s.ordAccepted,
    rejected: s.ordRejected,
    delivered: s.ordDelivered,
    cancelled: s.ordCancelled,
  };
  const unit: Record<string, string> = {
    bags: s.unitBags,
    pieces: s.unitPieces,
    kg: s.unitKg,
    litres: s.unitLitres,
    metres: s.unitMetres,
    other: s.unitOther,
  };
  return { status, unit };
}

export function OrderStatusChip({ order }: { order: Pick<VendorOrder, 'status' | 'pending'> }) {
  const { status } = useOrderLabels();
  const { t } = useStrings();
  if (order.pending) return <Pill label={t.companyVendors.pending} />;
  const tone =
    order.status === 'delivered'
      ? 'good'
      : order.status === 'rejected' || order.status === 'cancelled'
        ? 'bad'
        : order.status === 'sent'
          ? 'warn'
          : undefined;
  return <Pill label={status[order.status]} tone={tone} />;
}

export function OrderRow({
  order,
  money,
  title,
  onPress,
  divider,
}: {
  order: VendorOrder;
  money: (minor: bigint) => string;
  /** Vendor name, when the list spans vendors. */
  title?: string;
  onPress: () => void;
  divider?: boolean;
}) {
  const { t } = useStrings();
  const s = t.companyVendors;
  return (
    <ListRow
      title={[orderLabel(order.orderNo), title].filter(Boolean).join(' · ') || s.newOrder}
      subtitle={fill(s.itemsCount, { n: String(order.items.length) })}
      amount={money(orderTotal(order.items))}
      footer={<OrderStatusChip order={order} />}
      onPress={onPress}
      divider={divider}
    />
  );
}
