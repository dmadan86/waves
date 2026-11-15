/** Shared by the Clients and Vendors lists: a row of four stat tiles, and the ⋮ menu at the end of a row. */
import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Text, iconSize, useTheme } from '@waves/ui';

import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { type MenuAnchor } from '@/components/SortMenu';
import { measureAnchor } from '@/lib/measureAnchor';

export interface StatTile {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  label: string;
  fg: string;
  bg: string;
}

export function StatTiles({ tiles }: { tiles: readonly StatTile[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      {tiles.map((x) => (
        <View
          key={x.label}
          accessible
          accessibilityLabel={`${x.value} ${x.label}`}
          style={{
            flex: 1,
            minWidth: 0,
            alignItems: 'center',
            paddingVertical: theme.spacing.sm,
            borderRadius: theme.radius.md,
            backgroundColor: x.bg,
          }}
        >
          <Ionicons name={x.icon} size={iconSize.md} color={x.fg} />
          <Text tabular style={{ fontSize: 20, fontWeight: '800', color: x.fg }}>
            {x.value}
          </Text>
          <Text variant="micro" numberOfLines={1} style={{ color: x.fg, fontWeight: '600' }}>
            {x.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The ⋮ at the end of a row (or another icon, as the filter button); opens the house pop-up menu under itself. */
export function RowMenu({
  items,
  label,
  icon = 'ellipsis-vertical',
}: {
  items: OverflowMenuItem[];
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <View ref={ref} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={10}
        onPress={() =>
          measureAnchor(ref, (a) => {
            setAnchor(a);
            setOpen(true);
          })
        }
      >
        <Ionicons
          name={icon}
          size={icon === 'ellipsis-vertical' ? 18 : iconSize.md}
          color={theme.color.textMuted}
        />
      </Pressable>
      <OverflowMenu visible={open} onClose={() => setOpen(false)} items={items} anchor={anchor} />
    </View>
  );
}
