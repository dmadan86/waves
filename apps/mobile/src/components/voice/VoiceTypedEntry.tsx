import { View } from 'react-native';
import { AssistantComposer } from '@/components/AssistantComposer';
import { VoiceCreditRow } from './VoiceCreditRow';
import { useVoiceSuggestions, VoiceSuggestions, type Suggestion } from './VoiceSuggestions';

export function VoiceTypedEntry({
  value,
  onChangeText,
  onSend,
  onUseMic,
  groupNames,
  onPick,
  canPick,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (text: string) => void;
  onUseMic: () => void;
  groupNames: readonly string[];
  onPick: (suggestion: Suggestion) => void;
  canPick: (suggestion: Suggestion) => boolean;
}) {
  const suggestions = useVoiceSuggestions(groupNames);
  return (
    <View style={{ gap: 12 }}>
      <VoiceSuggestions suggestions={suggestions} onPick={onPick} canPick={canPick} />
      <VoiceCreditRow />
      <AssistantComposer
        value={value}
        onChangeText={onChangeText}
        onSend={onSend}
        onUseMic={onUseMic}
      />
    </View>
  );
}
