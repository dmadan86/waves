/**
 * All actions: every Personal, Family, Groups and Company action on one page. The catalogue,
 * who sees what and the search rules live in lib/allActions.ts; this draws it.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Href } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { Row, Screen, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { PlainHeader, SectionHeader } from '@/components/standard';
import { useAllGroupMembers, useGroups } from '@/data/hooks';
import { personalHomeIdentity } from '@/data/personalHomeIdentity';
import { groupLabel, isViewer } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { ACTION_COLORS, TILE_TINT } from '@/lib/actionPalette';
import {
  buildActionSections,
  filterActionSections,
  visibleChips,
  type ActionChip,
  type ActionTarget,
  type ActionTile,
} from '@/lib/allActions';
import { useViewerId } from '@/lib/auth';
import { COMPANIES_ENABLED } from '@/lib/companiesEnabled';
import { useDefaultCurrency } from '@/lib/currency';
import { router, switchTab } from '@/lib/navigation';
import { openPlanning } from '@/lib/openPlanning';
import { useProfileForDisplay } from '@/lib/profileCache';

const GAP = 8;
const PAD = 16;

function open(target: ActionTarget): void {
  switch (target.kind) {
    case 'planning':
      return openPlanning(target.segment);
    case 'tab':
      return switchTab(target.href as Href);
    case 'scan':
      return router.push(`/capture?scan=${Date.now()}` as Href);
    case 'route':
      return router.push(target.href as Href);
  }
}

export default function AllActionsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { width } = useWindowDimensions();
  const { t } = useStrings();
  const a = t.allActions;
  const viewerId = useViewerId();
  const defaultCurrency = useDefaultCurrency();
  const profile = useProfileForDisplay();
  const name = personalHomeIdentity(profile, [], [], defaultCurrency, t.account.you).name;
  const first = name.trim().split(/\s+/)[0] ?? '';

  const groups = useGroups().data;
  const members = useAllGroupMembers();
  const sections = useMemo(() => {
    const live = (groups ?? []).filter((g) => !g.archived_at && !g.deleted_at);
    const mine = (id: string) =>
      members.some((m) => m.group_id === id && m.left_at === null && isViewer(m, viewerId));
    return buildActionSections({
      family: live.flatMap((g) =>
        (g.type === 'couple' || g.type === 'home') && mine(g.id)
          ? [
              {
                id: g.id,
                type: g.type,
                name: groupLabel(
                  g,
                  members.filter((m) => m.group_id === g.id),
                  viewerId,
                ),
              },
            ]
          : [],
      ),
      companies: live.flatMap((g) => {
        const me = members.find(
          (m) => m.group_id === g.id && m.left_at === null && isViewer(m, viewerId),
        );
        return g.type === 'company' && me
          ? [{ id: g.id, name: groupLabel(g, [], viewerId), role: me.role }]
          : [];
      }),
      companiesEnabled: COMPANIES_ENABLED,
    });
  }, [groups, members, viewerId]);

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<ActionChip>('all');
  const label = (key: ActionTile['key']) => a.tiles[key];
  const shown = filterActionSections(sections, chip, query, label);
  const tileWidth = (width - 2 * PAD - 3 * GAP) / 4;
  const chipName: Record<ActionChip, string> = {
    all: a.chipAll,
    personal: a.chipPersonal,
    family: a.chipFamily,
    groups: a.chipGroups,
    company: a.chipCompany,
  };
  const sectionTitle = {
    quick: a.quick,
    personal: a.personal,
    family: a.family,
    groups: a.groups,
    company: a.company,
  };
  const sectionSub = { quick: a.quickSub, personal: a.personalSub, groups: a.groupsSub };

  return (
    <Screen edges={[]}>
      <PlainHeader title={fill(a.title, { name: first })} subtitle={a.subtitle} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: PAD,
          paddingBottom: clearance + 24,
          gap: theme.spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Row
          style={[
            styles.search,
            { backgroundColor: theme.color.surface, borderColor: theme.color.border },
          ]}
        >
          <Ionicons name="search" size={18} color={theme.color.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={a.search}
            placeholderTextColor={theme.color.textMuted}
            accessibilityLabel={a.search}
            returnKeyType="search"
            style={[styles.input, { color: theme.color.text }]}
          />
        </Row>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {visibleChips(sections).map((c) => {
            const on = c === chip;
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setChip(c)}
                style={[
                  styles.chip,
                  on
                    ? { backgroundColor: theme.color.brand, borderColor: theme.color.brand }
                    : { backgroundColor: theme.color.surface, borderColor: theme.color.border },
                ]}
              >
                <Text
                  variant="caption"
                  style={{ fontWeight: '600', color: on ? '#fff' : theme.color.text }}
                >
                  {chipName[c]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {shown.length === 0 ? (
          <Text tone="muted" style={{ textAlign: 'center', paddingVertical: theme.spacing.lg }}>
            {a.noMatch}
          </Text>
        ) : null}
        {shown.map((s) => {
          const sub = s.sub ?? sectionSub[s.space as keyof typeof sectionSub];
          return (
            <View key={s.id} style={{ gap: GAP }}>
              <SectionHeader
                title={sectionTitle[s.space]}
                trailing={
                  sub ? (
                    <Text
                      variant="caption"
                      tone="muted"
                      numberOfLines={1}
                      style={{ flexShrink: 1 }}
                    >
                      {sub}
                    </Text>
                  ) : undefined
                }
              />
              <View style={styles.grid}>
                {s.tiles.map((tile) => {
                  const color = ACTION_COLORS[tile.color];
                  return (
                    <Pressable
                      key={tile.key}
                      accessibilityRole="button"
                      accessibilityLabel={label(tile.key)}
                      onPress={() => open(tile.target)}
                      style={({ pressed }) => [
                        styles.tile,
                        {
                          width: tileWidth,
                          backgroundColor: theme.color.surface,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.disc, { backgroundColor: color + TILE_TINT }]}>
                        <Ionicons
                          name={tile.icon as keyof typeof Ionicons.glyphMap}
                          size={20}
                          color={color}
                        />
                      </View>
                      <Text variant="micro" numberOfLines={2} style={styles.label}>
                        {label(tile.key)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a.voiceTitle}
          onPress={() => router.push('/voice')}
          style={[styles.voice, { backgroundColor: ACTION_COLORS.purple + TILE_TINT }]}
        >
          <View style={[styles.voiceIcon, { backgroundColor: theme.color.surface }]}>
            <Ionicons name="sparkles-outline" size={20} color={ACTION_COLORS.purple} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{a.voiceTitle}</Text>
            <Text variant="caption" tone="muted">
              {a.voiceSub}
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={theme.color.text} />
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: {
    minHeight: 80,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6,
    shadowColor: '#14213D',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  disc: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11.5, lineHeight: 14, fontWeight: '600', textAlign: 'center' },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
  },
  voiceIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
