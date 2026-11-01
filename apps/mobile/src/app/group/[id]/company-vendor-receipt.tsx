import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';

import { buildReceipt, receiptLabel, receiptStatus } from '@waves/core';
import { Button, Screen, Text, useTheme } from '@waves/ui';

import { Pill, useMethodLabels, useVendorFormat } from '@/components/company/vendors/parts';
import { PlainHeader, ScenicBody, StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { reminderUrls } from '@/lib/paymentProof';
import { renderReceiptHtml, shareHtmlAsPdf } from '@/lib/vendorPdf';

export default function CompanyVendorReceiptScreen() {
  const { id = '', entryId = '' } = useLocalSearchParams<{ id: string; entryId?: string }>();
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const view = useCompanyVendors(id);
  const company = useCompanyEntries(id);
  const f = useVendorFormat(view.currency);
  const methods = useMethodLabels();
  const [error, setError] = useState(false);
  const line = view.lines.find((l) => l.id === entryId && l.kind === 'payment');
  const vendor = line ? view.vendors.find((v) => v.id === line.vendorId) : undefined;
  if (!line || !vendor)
    return (
      <Screen edges={[]}>
        <PlainHeader title={s.receiptTitle} />
        <ScenicBody flush>
          <Text tone="muted">{s.notFound}</Text>
        </ScenicBody>
      </Screen>
    );
  const r = buildReceipt(
    line,
    vendor,
    view.lines.filter((l) => l.vendorId === vendor.id),
  );
  const status = { pending: s.waitingSync, received: s.received, recorded: s.waitingVendor }[
    receiptStatus(r)
  ];
  const rows: [string, string][] = [
    [s.companyLabel, company.name],
    [s.vendorLabel, vendor.name],
    [s.dateLabel, f.date(r.date)],
    ...(r.method ? [[s.method, methods[r.method] ?? r.method] as [string, string]] : []),
    ...(r.reference ? [[s.reference, r.reference] as [string, string]] : []),
    [
      s.balanceAfter,
      r.balanceAfter < 0n ? `${f.money(-r.balanceAfter)} ${s.advance}` : f.money(r.balanceAfter),
    ],
  ];
  const share = async () => {
    setError(false);
    const html = renderReceiptHtml(
      r,
      company.name,
      {
        ...s,
        methods,
        recorded: s.recorded,
        received: s.received,
        waitingSync: s.waitingSync,
      },
      f,
    );
    try {
      if (!(await shareHtmlAsPdf(html, `${s.receipt} ${receiptLabel(r.receiptNo)}`)))
        setError(true);
    } catch {
      setError(true);
    }
  };
  const whatsapp = () => {
    const text = `${s.receiptTitle} ${receiptLabel(r.receiptNo)}: ${f.money(r.amount)} · ${company.name}`;
    const urls = reminderUrls(vendor.phone, text);
    if (urls.length) void Linking.openURL(urls[1]!);
  };
  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}>
        <PlainHeader title={s.receiptTitle} />
        <ScenicBody flush>
          <StandardCard style={{ gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.color.brand, fontWeight: '800' }}>waves</Text>
              <Text tone="muted">
                {s.receipt} {receiptLabel(r.receiptNo)}
              </Text>
            </View>
            <Text tabular style={{ fontSize: 30, fontWeight: '800' }}>
              {f.money(r.amount)}
            </Text>
            <Text tone="muted">{fill(s.paidTo, { name: vendor.name })}</Text>
            <Pill label={status} tone={r.received ? 'good' : undefined} />
            {rows.map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <Text tone="muted" style={{ width: '38%' }}>
                  {k}
                </Text>
                <Text style={{ flex: 1 }}>{v}</Text>
              </View>
            ))}
            <Text variant="caption" tone="muted">
              {s.receiptFooter}
            </Text>
          </StandardCard>
          <Button
            label={fill(s.openInVendor, { name: vendor.name })}
            onPress={() => router.replace(`/group/${id}/company-vendor?vendorId=${vendor.id}`)}
          />
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button label={s.downloadPdf} variant="brand" onPress={() => void share()} />
            {vendor.phone ? <Button label={s.shareWhatsapp} onPress={whatsapp} /> : null}
          </View>
          {error ? (
            <Text variant="caption" tone="negative">
              {s.pdfFailed}
            </Text>
          ) : null}
        </ScenicBody>
      </ScrollView>
    </Screen>
  );
}
