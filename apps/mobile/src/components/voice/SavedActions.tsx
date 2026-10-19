/**
 * What follows a save, in one place: Done as the one filled button and "Add
 * another" as a plain text link under it. The screen's foot and the agent's
 * list both use it, so the two never drift apart.
 */

import { View } from 'react-native';

import { Button, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

import { TextAction } from './SavedSummary';

export function SavedActions({
  onDone,
  onAddAnother,
}: {
  onDone: () => void;
  onAddAnother?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
      <Button label={t.voiceScreen.done} variant="brand" fullWidth onPress={onDone} />
      {onAddAnother ? <TextAction label={t.voiceScreen.addAnother} onPress={onAddAnother} /> : null}
    </View>
  );
}
