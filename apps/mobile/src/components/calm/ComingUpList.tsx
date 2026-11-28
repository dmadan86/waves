/** "Coming up": the section header with See all and the one standard list card of rows. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { iconSize, useTheme } from '@waves/ui';

import { ListCard, ListItem, LIST_TILE, SectionHeader } from '@/components/standard';
import { useStrings } from '@/i18n';

export interface ComingUpRow {
  readonly key: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly caption: string;
  readonly income?: boolean;
  readonly onPress?: () => void;
}

/** Renders nothing when there is nothing coming up (Today's own empty treatment). */
export function ComingUpList({
  rows,
  onSeeAll,
}: {
  rows: readonly ComingUpRow[];
  onSeeAll: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader
        title={t.calendar.comingUp}
        action={{ label: t.calendar.seeAll, onPress: onSeeAll }}
      />
      <ListCard>
        {rows.map((row, i) => (
          <ListItem
            key={row.key}
            divider={i > 0}
            onPress={row.onPress}
            leading={
              <View
                style={{
                  width: LIST_TILE,
                  height: LIST_TILE,
                  borderRadius: theme.radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Ionicons
                  name={row.income ? 'arrow-down-outline' : 'calendar-outline'}
                  size={iconSize.md}
                  color={theme.color.brand}
                />
              </View>
            }
            title={row.title}
            subtitle={row.subtitle}
            caption={row.caption}
          />
        ))}
      </ListCard>
    </View>
  );
}
