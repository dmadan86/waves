/**
 * Pick the person a loan is shared with, out of the phone's contacts (people
 * Waves already knows float to the top). One tap chooses and closes. The
 * address book never leaves the device; only the chosen name, and the email or
 * number that lets Waves link an existing account, go into the shared debt.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, View } from 'react-native';

import { IconButton, iconSize, MODAL_ORIENTATIONS, Row, Screen, Text, useTheme } from '@waves/ui';

import { ContactPicker, type PickedContact } from '@/components/ContactPicker';
import { useKnownContacts } from '@/data/knownContacts';
import { useStrings } from '@/i18n';

export function LoanPersonPicker({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (contact: PickedContact) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { index: known } = useKnownContacts();
  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Screen edges={['top', 'bottom']} inModal>
        <View
          style={{
            flex: 1,
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: theme.spacing.md,
            gap: theme.spacing.lg,
          }}
        >
          <Row style={{ paddingTop: theme.spacing.md }}>
            <IconButton label={t.common.close} onPress={onClose}>
              <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
            </IconButton>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="heading">{t.tabs.fromContacts}</Text>
            </View>
            <View style={{ width: 44 }} />
          </Row>
          {/* Mounted only while open so a reopened picker starts empty. */}
          {visible ? (
            <ContactPicker
              single
              known={known}
              onConfirm={(chosen) => {
                const first = chosen[0];
                if (first) onPick(first);
                onClose();
              }}
            />
          ) : null}
        </View>
      </Screen>
    </Modal>
  );
}
