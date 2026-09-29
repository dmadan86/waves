/**
 * The Personal tab's intro: five cards, met once per account the first time the
 * tab opens (after its lock, so the cards never stand in front of a prompt).
 *
 * The first-run intro sells the shared ledger; this one is for the private one
 * — everything that lives only here, and why it is worth opening the tab again.
 * Same cards, same controls, its own pictures and palettes.
 */

import { StatusBar } from 'expo-status-bar';
import { Modal } from 'react-native';

import { MODAL_ORIENTATIONS } from '@waves/ui';

import { IntroCards, type IntroSlide } from '@/components/Onboarding';
import { useStrings } from '@/i18n';

const PERSONAL_SLIDES: readonly IntroSlide[] = [
  {
    key: 'money',
    bg: ['#FFF5E8', '#FCEBD6'],
    ink: '#4A220C',
    inkMuted: '#8A5B35',
    glow: '#F8DDBC',
    art: require('../../assets/images/personal-money.webp') as number,
  },
  {
    key: 'expenses',
    bg: ['#EEF3FF', '#E1E9FD'],
    ink: '#13236B',
    inkMuted: '#4A5A8C',
    glow: '#D5E0FB',
    art: require('../../assets/images/personal-expenses.webp') as number,
  },
  {
    key: 'loans',
    bg: ['#F4EFFF', '#E9E1FC'],
    ink: '#2A1670',
    inkMuted: '#5A4C8C',
    glow: '#DFD4FA',
    art: require('../../assets/images/personal-loans.webp') as number,
  },
  {
    key: 'bills',
    bg: ['#FFF1E9', '#FCE3D8'],
    ink: '#5A1E10',
    inkMuted: '#8C4E3E',
    glow: '#F8D2C4',
    art: require('../../assets/images/personal-bills.webp') as number,
  },
  {
    key: 'insights',
    bg: ['#EDFAF5', '#DDF3EA'],
    ink: '#0F3A2C',
    inkMuted: '#3F6B5C',
    glow: '#CDEBDF',
    art: require('../../assets/images/personal-insights.webp') as number,
  },
];

export function PersonalIntro({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const { t } = useStrings();
  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onDone}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={MODAL_ORIENTATIONS}
    >
      {/* Pale cards under the status bar: its icons go dark while this is up. */}
      <StatusBar style="dark" />
      <IntroCards
        slides={PERSONAL_SLIDES}
        copy={t.personal.introCards}
        skipLabel={t.personal.introSkip}
        onDone={onDone}
      />
    </Modal>
  );
}
