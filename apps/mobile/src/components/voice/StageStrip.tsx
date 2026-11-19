/** The two-step strip at the top of the voice screen: "Speak · Added" (amber "Saved" when it was kept to finish later). */

import { View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export function StageStrip({ step, kept }: { step: 0 | 1; kept?: boolean }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.voiceScreen;
  const done = kept ? theme.color.warning : theme.color.brand;
  const label = (text: string, on: boolean, color: string) => (
    <Text
      variant="micro"
      style={{ color: on ? color : theme.color.textFaint, fontWeight: on ? '800' : '600' }}
    >
      {text}
    </Text>
  );
  return (
    <View
      accessible
      accessibilityLabel={`${s.stripSpeak}, ${kept ? s.stripSaved : s.stripAdded}`}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
    >
      {label(s.stripSpeak, step === 0, theme.color.brand)}
      <View
        style={{
          width: 16,
          height: 2,
          borderRadius: 1,
          backgroundColor: step === 1 ? done : theme.color.border,
        }}
      />
      {label(kept ? s.stripSaved : s.stripAdded, step === 1, done)}
    </View>
  );
}
