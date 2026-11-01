/** A small camera sheet that hands back the first QR it reads. Loaded lazily: `expo-camera` is native. */
import { useRef } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Modal, View } from 'react-native';

import { Button, MODAL_ORIENTATIONS, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export default function VendorQrScan({
  onRead,
  onClose,
}: {
  onRead: (data: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [permission, ask] = useCameraPermissions();
  const done = useRef(false);
  return (
    <Modal
      visible
      animationType="slide"
      supportedOrientations={MODAL_ORIENTATIONS}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'flex-end' }}>
        {permission?.granted ? (
          <CameraView
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (done.current) return;
              done.current = true;
              onRead(data);
            }}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl }}>
            <Button label={t.companyVendors.allowCamera} onPress={() => void ask()} />
          </View>
        )}
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
          <Text style={{ color: '#fff', textAlign: 'center' }}>{t.companyVendors.helpScan}</Text>
          <Button label={t.companyVendors.close} variant="onBrandOutline" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
