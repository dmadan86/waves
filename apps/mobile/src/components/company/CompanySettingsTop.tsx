/**
 * The top of Company Settings: the company card (logo, name, members, created) and a
 * row of compact tiles. A tile is drawn only when it goes somewhere.
 */

import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { GroupPhoto } from '@/components/GroupPhoto';
import { StandardCard } from '@/components/standard';

type Glyph = ComponentProps<typeof Ionicons>['name'];

export interface SettingsTile {
  key: string;
  icon: Glyph;
  title: string;
  subtitle: string;
  onPress: () => void;
}

export function CompanySettingsTop({
  photoPath,
  busy,
  name,
  meta,
  onEditName,
  onLogo,
  tiles,
}: {
  photoPath: string | null | undefined;
  busy: boolean;
  name: string;
  meta: string;
  onEditName: () => void;
  /** Only for someone who can change the logo; no badge otherwise. */
  onLogo?: () => void;
  tiles: SettingsTile[];
}) {
  const theme = useTheme();
  return (
    <>
      <StandardCard style={{ padding: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Pressable disabled={!onLogo} accessibilityRole="button" onPress={onLogo}>
            <GroupPhoto photoPath={photoPath} emoji="🏢" size={64} busy={busy} logo />
            {onLogo ? (
              <View
                style={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#2B2B3A',
                  borderWidth: 2,
                  borderColor: theme.color.surface,
                }}
              >
                <Ionicons name="camera" size={12} color="#FFFFFF" />
              </View>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={name}
            onPress={onEditName}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Text
                  variant="heading"
                  numberOfLines={1}
                  style={{ fontSize: 20, fontWeight: '800', flexShrink: 1 }}
                >
                  {name}
                </Text>
                <Ionicons name="create-outline" size={iconSize.md} color={theme.color.brand} />
              </View>
              <Text variant="caption" tone="muted" numberOfLines={2}>
                {meta}
              </Text>
            </View>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.textFaint}
            />
          </Pressable>
        </View>
      </StandardCard>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={`${tile.title}, ${tile.subtitle}`}
            onPress={tile.onPress}
            style={{ flex: 1 }}
          >
            <StandardCard
              style={{
                paddingHorizontal: 4,
                paddingVertical: theme.spacing.md,
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Ionicons name={tile.icon} size={iconSize.xl} color={theme.color.brand} />
              <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '800' }}>
                {tile.title}
              </Text>
              <Text
                variant="caption"
                tone="muted"
                numberOfLines={1}
                style={{ fontSize: 11, textAlign: 'center' }}
              >
                {tile.subtitle}
              </Text>
            </StandardCard>
          </Pressable>
        ))}
      </View>
    </>
  );
}
