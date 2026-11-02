import type { MutableRefObject } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';

import { Button, Text, useTheme } from '@waves/ui';

import { StandardCard } from '@/components/standard';
import { fill, useStrings } from '@/i18n';

/** "Pay by UPI": the client scans, pays the company's own UPI ID; the company then taps Mark received. */
export function UpiPayCard({
  link,
  vpa,
  note,
  amountText,
  qrRef,
}: {
  link: string;
  vpa: string;
  note: string;
  amountText: string;
  /** Holds the QR's native handle so the PDF can embed the same code. */
  qrRef: MutableRefObject<{ toDataURL: (cb: (b64: string) => void) => void } | null>;
}) {
  const theme = useTheme();
  const c = useStrings().t.companyDocs;
  const scan = fill(c.upiScan, { amount: amountText });
  return (
    <StandardCard>
      <Text variant="heading">{c.upiTitle}</Text>
      <View
        style={{ alignItems: 'center', gap: theme.spacing.xs, marginVertical: theme.spacing.md }}
      >
        <View style={{ backgroundColor: '#ffffff', padding: 10, borderRadius: theme.radius.sm }}>
          <QRCode value={link} size={176} getRef={(r) => (qrRef.current = r)} />
        </View>
        <Text style={{ fontWeight: '700' }}>{scan}</Text>
        <Text variant="caption" tone="muted" selectable>
          {vpa} · {note}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label={c.upiShare}
            variant="brand"
            onPress={() => void Share.share({ message: `${scan}\n${link}` }).catch(() => {})}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={c.upiCopy}
            variant="secondary"
            onPress={() => void Clipboard.setStringAsync(vpa)}
          />
        </View>
      </View>
    </StandardCard>
  );
}
