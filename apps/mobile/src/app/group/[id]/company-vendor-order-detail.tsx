import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import {
  orderActions,
  orderLabel,
  orderLineTotal,
  orderTotal,
  type VendorOrderStatus,
} from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { OrderStatusChip, useOrderLabels } from '@/components/company/vendors/orderParts';
import { useVendorFormat } from '@/components/company/vendors/parts';
import { PlainHeader, ScenicBody, SectionHeader, StandardCard } from '@/components/standard';
import { useCompanyEntries, useCompanySuspended } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useVendorOrders, useVendorOrderStatus } from '@/data/companyVendorOrders';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import { renderOrderHtml, shareHtmlAsPdf } from '@/lib/vendorPdf';

export default function CompanyVendorOrderDetailScreen() {
  const { id = '', orderId = '' } = useLocalSearchParams<{ id: string; orderId?: string }>();
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const view = useCompanyVendors(id);
  const company = useCompanyEntries(id);
  const suspended = useCompanySuspended(id);
  const order = useVendorOrders(id).find((o) => o.id === orderId);
  const vendor = order ? view.vendors.find((v) => v.id === order.vendorId) : undefined;
  const f = useVendorFormat(view.currency);
  const labels = useOrderLabels();
  const change = useVendorOrderStatus(id);
  const { confirm } = useDialog();
  const [pdfError, setPdfError] = useState(false);
  if (!order)
    return (
      <Screen edges={[]}>
        <PlainHeader title={s.orderTitle} />
        <ScenicBody flush>
          <Text tone="muted">{s.notFound}</Text>
        </ScenicBody>
      </Screen>
    );
  const side = view.isVendor ? 'vendor' : 'company';
  const actions = suspended || order.pending ? [] : orderActions(side, order.status);
  const run = (to: VendorOrderStatus) => change.mutate({ orderId: order.id, to });
  const canEdit = side === 'company' && view.canManage && !suspended && order.status === 'sent';
  const pdf = async () => {
    setPdfError(false);
    try {
      const html = renderOrderHtml(
        order,
        vendor?.name ?? '',
        company.name,
        {
          purchaseOrder: s.purchaseOrder,
          companyLabel: s.companyLabel,
          vendorLabel: s.vendorLabel,
          itemName: s.itemName,
          itemQty: s.itemQty,
          amountLabel: s.amountLabel,
          expectedOn: s.expectedOn,
          total: s.orderTotal,
          units: labels.unit,
        },
        f,
      );
      if (!(await shareHtmlAsPdf(html, `${s.purchaseOrder} ${orderLabel(order.orderNo)}`)))
        setPdfError(true);
    } catch {
      setPdfError(true);
    }
  };
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}>
        <PlainHeader title={`${s.purchaseOrder} ${orderLabel(order.orderNo)}`.trim()} />
        <ScenicBody flush>
          <StandardCard style={{ gap: theme.spacing.md }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontWeight: '700' }}>{vendor?.name ?? ''}</Text>
              <OrderStatusChip order={order} />
            </View>
            {order.expectedOn ? (
              <Text variant="caption" tone="muted">
                {fill(s.expectedOn, { date: f.date(order.expectedOn) })}
              </Text>
            ) : null}
            {order.note ? <Text variant="caption">{order.note}</Text> : null}
          </StandardCard>
          <SectionHeader title={s.orderItems} />
          <StandardCard style={{ gap: theme.spacing.md }}>
            {order.items.map((i) => (
              <View key={i.position} style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text>{i.name}</Text>
                  <Text variant="caption" tone="muted">
                    {`${i.qty.includes('.') ? i.qty.replace(/\.?0+$/, '') : i.qty} ${labels.unit[i.unit]} × ${f.money(i.unitPrice)}`}
                  </Text>
                </View>
                <Text tabular style={{ fontWeight: '600' }}>
                  {f.money(orderLineTotal(i.qty, i.unitPrice))}
                </Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700' }}>{s.orderTotal}</Text>
              <Text tabular style={{ fontWeight: '800' }}>
                {f.money(orderTotal(order.items))}
              </Text>
            </View>
            <Text variant="caption" tone="muted">
              {s.orderNotBill}
            </Text>
          </StandardCard>
          <SectionHeader title={s.orderTimeline} />
          <StandardCard style={{ gap: theme.spacing.sm }}>
            {order.events.map((e, index) => (
              <Text key={index} variant="caption">
                {`${labels.status[e.status]} · ${new Date(e.at).toLocaleDateString()}`}
              </Text>
            ))}
          </StandardCard>
          <View style={{ gap: theme.spacing.sm }}>
            {actions.includes('accepted') ? (
              <Button
                label={s.accept}
                variant="brand"
                disabled={change.isPending}
                onPress={() => run('accepted')}
              />
            ) : null}
            {actions.includes('rejected') ? (
              <Button
                label={s.reject}
                disabled={change.isPending}
                onPress={() => run('rejected')}
              />
            ) : null}
            {actions.includes('delivered') ? (
              <Button
                label={s.markDelivered}
                variant="brand"
                disabled={change.isPending}
                onPress={() => run('delivered')}
              />
            ) : null}
            {canEdit && !order.pending ? (
              <Button
                label={s.editOrder}
                onPress={() => router.push(`/group/${id}/company-vendor-order?orderId=${order.id}`)}
              />
            ) : null}
            {actions.includes('cancelled') ? (
              <Button
                label={s.cancelOrder}
                disabled={change.isPending}
                onPress={() =>
                  void confirm({
                    title: s.cancelOrderConfirm,
                    confirmLabel: s.cancelOrder,
                    tone: 'danger',
                  }).then((yes) => {
                    if (yes) run('cancelled');
                  })
                }
              />
            ) : null}
            <Button label={s.orderPdf} onPress={() => void pdf()} />
            {pdfError ? (
              <Text variant="caption" tone="negative">
                {s.pdfFailed}
              </Text>
            ) : null}
          </View>
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
