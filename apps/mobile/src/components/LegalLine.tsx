/**
 * The "by continuing you agree to our Terms and Privacy Policy" line, with both
 * documents underlined and tappable.
 *
 * The sentence carries `{terms}` and `{privacy}` placeholders (see
 * `t.entry.agreeTerms`) so word order survives translation. Each opens the
 * published page on the website (lib/legal.ts), which is what somebody agreeing
 * to it should be able to read — and it works before sign-in, where the app's
 * own settings screens do not. Nested `Text` with `onPress` keeps the links
 * inline rather than wrapping the whole line in one control.
 */

import { Text, type TextStyle } from 'react-native';

import { useStrings } from '@/i18n';
import { openLegal, type LegalDoc } from '@/lib/legal';

export function LegalLine({ textStyle }: { textStyle?: TextStyle }) {
  const { t, language } = useStrings();
  const link = (key: number, doc: LegalDoc, word: string) => (
    <Text
      key={key}
      accessibilityRole="link"
      onPress={() => openLegal(doc, language)}
      style={{ textDecorationLine: 'underline', fontWeight: '700' }}
    >
      {word}
    </Text>
  );
  const parts = t.entry.agreeTerms.split(/(\{terms\}|\{privacy\})/);

  return (
    <Text style={[{ textAlign: 'center' }, textStyle]}>
      {parts.map((part, index) => {
        if (part === '{privacy}') return link(index, 'privacy', t.entry.privacyWord);
        if (part === '{terms}') return link(index, 'terms', t.entry.termsWord);
        return part;
      })}
    </Text>
  );
}
