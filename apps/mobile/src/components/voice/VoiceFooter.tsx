/**
 * The screen's one action area: a primary button slot and an optional text-link
 * slot, padded at the bottom by the safe-area inset plus a small theme spacing.
 * With no actions, only the safe-area inset is reserved.
 * A panel that owns its own action (the agent's list or confirmation) reports it
 * up with {@link useReportFooter} and the screen draws it here.
 */

import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { Button, useTheme } from '@waves/ui';

import { TextAction } from './SavedSummary';

export interface FooterAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export interface FooterSpec {
  primary?: FooterAction;
  secondary?: FooterAction;
}

export function VoiceFooter({ spec, inset }: { spec: FooterSpec; inset: number }) {
  const theme = useTheme();
  const { primary, secondary } = spec;
  if (!primary && !secondary) return <View style={{ height: inset }} />;
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.sm,
        paddingBottom: inset + theme.spacing.xs,
        borderTopWidth: 1,
        borderTopColor: primary ? theme.color.border : 'transparent',
        backgroundColor: primary ? theme.color.surface : 'transparent',
      }}
    >
      <View style={{ height: 48, justifyContent: 'center' }}>
        {primary ? (
          <Button
            label={primary.label}
            variant="brand"
            fullWidth
            disabled={primary.disabled}
            onPress={primary.onPress}
          />
        ) : null}
      </View>
      {secondary ? (
        <View style={{ height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <TextAction label={secondary.label} onPress={secondary.onPress} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Tell the screen what the footer should hold. The handlers go through a ref, so
 * only a change of label or disabled state reaches the screen, never a render.
 */
export function useReportFooter(
  report: ((spec: FooterSpec | null) => void) | undefined,
  spec: FooterSpec | null,
): void {
  const latest = useRef(spec);
  useEffect(() => {
    latest.current = spec;
  });
  const primary = spec?.primary?.label;
  const disabled = spec?.primary?.disabled;
  const secondary = spec?.secondary?.label;
  useEffect(() => {
    report?.({
      ...(primary !== undefined
        ? {
            primary: {
              label: primary,
              disabled,
              onPress: () => latest.current?.primary?.onPress(),
            },
          }
        : null),
      ...(secondary !== undefined
        ? { secondary: { label: secondary, onPress: () => latest.current?.secondary?.onPress() } }
        : null),
    });
  }, [report, primary, disabled, secondary]);
  useEffect(() => () => report?.(null), [report]);
}
