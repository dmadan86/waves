/**
 * The agent's question, with tappable answers. The agent could not settle
 * which of several amounts, groups or people was meant, so it offers 2-4
 * choices: each a tinted row (round icon, bold label, secondary line, radio), a
 * primary Continue that stays off until one is picked, and "Type instead" for
 * answering in the person's own words.
 *
 * Nothing here animates, so reduced motion needs no special case. Selection is
 * state in this card only; Continue hands the chosen option's `answer` up.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, View } from 'react-native';

import type { VoiceClarifyOption } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { clarifyOptionViews } from '@/lib/voiceClarifyPure';

const ART = require('../../assets/images/voice-consent-art.webp') as number;
// The art is 325x276; fixed sizes because a percentage width with an aspect
// ratio renders zoomed and cropped on Android.
const ART_W = 110;
const ART_H = 94;

export interface VoiceClarifyCardProps {
  question: string;
  options: readonly VoiceClarifyOption[];
  /** Continue: the chosen option's answer text. */
  onContinue: (answer: string) => void;
  /** Answer in the person's own words instead. */
  onTypeInstead: () => void;
}

export function VoiceClarifyCard({
  question,
  options,
  onContinue,
  onTypeInstead,
}: VoiceClarifyCardProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const views = clarifyOptionViews(options);
  const [selected, setSelected] = useState<number | null>(null);
  const chosen = selected === null ? undefined : views[selected];

  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.xl,
        backgroundColor: theme.color.surface,
      }}
    >
      <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
        <Image
          source={ART}
          accessibilityIgnoresInvertColors
          importantForAccessibility="no"
          resizeMode="contain"
          style={{ width: ART_W, height: ART_H }}
        />
        <Text variant="heading" style={{ textAlign: 'center' }}>
          {t.voice.agentClarifyTitle}
        </Text>
        <Text tone="muted" style={{ textAlign: 'center' }}>
          {question}
        </Text>
      </View>

      <View accessibilityRole="radiogroup" style={{ gap: theme.spacing.sm }}>
        {views.map((view, index) => {
          const tint = theme.tint[view.tint];
          const on = selected === index;
          return (
            <Pressable
              key={`${index}-${view.answer}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, checked: on }}
              accessibilityLabel={view.detail ? `${view.label}, ${view.detail}` : view.label}
              accessibilityHint={t.voice.agentOptionHint}
              onPress={() => setSelected(index)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.lg,
                borderWidth: on ? 2 : 1,
                borderColor: on ? theme.color.brand : theme.color.border,
                backgroundColor: tint.bg,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.surface,
                }}
              >
                <Ionicons
                  name={view.icon as React.ComponentProps<typeof Ionicons>['name']}
                  size={iconSize.xl}
                  color={tint.ink}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 20, fontWeight: '800', color: tint.ink }}
                >
                  {view.label}
                </Text>
                {view.detail ? (
                  <Text numberOfLines={1} style={{ color: tint.inkMuted }}>
                    {view.detail}
                  </Text>
                ) : null}
              </View>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: on ? theme.color.brand : theme.color.textMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on ? (
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: theme.color.brand,
                    }}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.voice.agentContinue}
        accessibilityState={{ disabled: !chosen }}
        disabled={!chosen}
        onPress={() => chosen && onContinue(chosen.answer)}
        style={({ pressed }) => ({
          height: 52,
          borderRadius: theme.radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brand,
          opacity: !chosen ? 0.4 : pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ color: theme.color.onBrand, fontWeight: '700', fontSize: 17 }}>
          {t.voice.agentContinue}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.voice.agentTypeInstead}
        onPress={onTypeInstead}
        style={({ pressed }) => ({
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.lg,
          height: 40,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.brandSoft,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="chatbox-ellipses-outline" size={iconSize.base} color={theme.color.brand} />
        <Text style={{ color: theme.color.brand, fontWeight: '700' }}>
          {t.voice.agentTypeInstead}
        </Text>
      </Pressable>
    </View>
  );
}
