/**
 * The agent's question, with tappable answers. The agent could not settle
 * which of several amounts, groups or people was meant, so it offers 2-4
 * choices: each a tinted row (round icon, bold label, secondary line, radio), a
 * primary Continue that stays off until one is picked, and "Type instead", which
 * opens an inline field (with a mic to go back to speaking). When the agent
 * asked which group, "Another group" opens a searchable list of the reader's
 * other groups in the card itself; the one picked joins the options, selected.
 *
 * Nothing here animates, so reduced motion needs no special case. Selection is
 * state in this card only; Continue hands the chosen option's `answer` up.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, TextInput, View } from 'react-native';

import type { VoiceClarifyOption } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import { VoiceTypedAnswer } from '@/components/VoiceTypedAnswer';
import { useStrings } from '@/i18n';
import {
  clarifyOptionViews,
  filterGroupChoices,
  type ClarifyOptionView,
} from '@/lib/voiceClarifyPure';

const ART = require('../../assets/images/voice-consent-art.webp') as number;
// The art is 325x276; fixed sizes because a percentage width with an aspect
// ratio renders zoomed and cropped on Android.
const ART_W = 110;
const ART_H = 94;
/** Past this many groups the list gets a search field. */
const SEARCH_FROM = 6;

export interface VoiceClarifyCardProps {
  question: string;
  options: readonly VoiceClarifyOption[];
  /** The reader's other groups, for a which-group question (see otherGroupChoices). */
  moreChoices?: readonly ClarifyOptionView[];
  /** Continue: the chosen option's answer text. */
  onContinue: (answer: string) => void;
  /** The person typed an answer in their own words. */
  onTyped: (text: string) => void;
  /** Back to the mic from the typing field. */
  onVoice: () => void;
}

export function VoiceClarifyCard({
  question,
  options,
  moreChoices = [],
  onContinue,
  onTyped,
  onVoice,
}: VoiceClarifyCardProps) {
  const theme = useTheme();
  const { t } = useStrings();
  const offered = clarifyOptionViews(options);
  const [picked, setPicked] = useState<ClarifyOptionView | null>(null);
  const views = picked ? [...offered, picked] : offered;
  const [selected, setSelected] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState('');
  const others = moreChoices.filter((choice) => choice.answer !== picked?.answer);
  const shown = filterGroupChoices(others, query);
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

      {others.length > 0 ? (
        browsing ? (
          <View
            style={{
              gap: theme.spacing.xs,
              padding: theme.spacing.sm,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
            }}
          >
            {others.length > SEARCH_FROM ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoFocus
                placeholder={t.voice.agentSearchGroups}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.voice.agentSearchGroups}
                style={{
                  height: 44,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.surfaceMuted,
                  fontSize: 16,
                  color: theme.color.text,
                }}
              />
            ) : null}
            {shown.map((choice) => (
              <Pressable
                key={choice.answer}
                accessibilityRole="button"
                accessibilityLabel={
                  choice.detail ? `${choice.label}, ${choice.detail}` : choice.label
                }
                onPress={() => {
                  setPicked(choice);
                  setSelected(offered.length);
                  setBrowsing(false);
                  setQuery('');
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  minHeight: 44,
                  paddingHorizontal: theme.spacing.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: pressed ? theme.color.brandSoft : 'transparent',
                })}
              >
                <Ionicons
                  name="people-outline"
                  size={iconSize.base}
                  color={theme.color.textMuted}
                />
                <Text numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
                  {choice.label}
                </Text>
                {choice.detail ? (
                  <Text numberOfLines={1} tone="muted" style={{ maxWidth: '40%' }}>
                    {choice.detail}
                  </Text>
                ) : null}
              </Pressable>
            ))}
            {shown.length === 0 ? (
              <Text tone="muted" style={{ padding: theme.spacing.sm }}>
                {t.voice.agentNoGroupMatch}
              </Text>
            ) : null}
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.voice.agentOtherGroup}
            accessibilityState={{ expanded: false }}
            onPress={() => setBrowsing(true)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              minHeight: 48,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: theme.color.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="search-outline" size={iconSize.base} color={theme.color.brand} />
            <Text style={{ flex: 1, color: theme.color.brand, fontWeight: '700' }}>
              {t.voice.agentOtherGroup}
            </Text>
            <Ionicons name="chevron-down" size={iconSize.base} color={theme.color.brand} />
          </Pressable>
        )
      ) : null}

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

      {typing ? (
        <VoiceTypedAnswer onSubmit={onTyped} onVoice={onVoice} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.voice.agentTypeInstead}
          onPress={() => setTyping(true)}
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
          <Ionicons
            name="chatbox-ellipses-outline"
            size={iconSize.base}
            color={theme.color.brand}
          />
          <Text style={{ color: theme.color.brand, fontWeight: '700' }}>
            {t.voice.agentTypeInstead}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
