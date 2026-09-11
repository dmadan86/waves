/**
 * The app's settings list: a titled group of rows in one card.
 *
 * Extracted from the Settings screen, which is where it grew up, because the
 * account screen needed the same thing and the alternative was a second one.
 * Two list styles for two screens a tap apart is how an app starts to look like
 * it was assembled rather than designed — and it is the specific request this
 * was pulled out for.
 *
 * A row is a glyph in a soft circle, a title, an optional second line, and one
 * of two things at the end: a chevron when it leads somewhere, or the value it
 * currently holds when it is a setting you can read off the list. The value is
 * what makes this usable for an account screen: "Name · Madan" says what it is
 * set to without opening anything, which is the whole point of a list over a
 * page of form fields.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import {
  Card,
  directionalIcon,
  iconSize,
  ListRow,
  Row,
  SectionHeader,
  Text,
  useTheme,
} from '@waves/ui';

import { router } from '@/lib/navigation';

export interface SettingsRow {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  /**
   * What this setting is set to, drawn at the end of its own row.
   *
   * Distinct from `hint`, which explains the row; this *is* the answer. A row
   * with neither reads as a door and gets a chevron instead.
   */
  value?: string;
  /** Say a value is missing in the muted voice — "Add one" rather than a blank. */
  valueMuted?: boolean;
  route?: string;
  onPress?: () => void;
  /** Ends something. Red title, red icon. */
  destructive?: boolean;
}

export function SettingsSection({ title, rows }: { title?: string; rows: SettingsRow[] }) {
  const theme = useTheme();
  return (
    <View>
      {title ? <SectionHeader title={title} /> : null}
      <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
        {rows.map((item, index) => {
          const live = Boolean(item.route ?? item.onPress);
          return (
            <View key={item.label}>
              <ListRow
                title={item.label}
                subtitle={item.hint}
                destructive={item.destructive}
                onPress={
                  item.onPress ?? (item.route ? () => router.push(item.route as never) : undefined)
                }
                leading={
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: item.destructive
                        ? theme.color.negativeSoft
                        : live
                          ? theme.color.brandSoft
                          : theme.color.surfaceMuted,
                    }}
                  >
                    <Ionicons
                      name={item.icon}
                      size={iconSize.md}
                      color={
                        item.destructive
                          ? theme.color.negative
                          : live
                            ? theme.color.brand
                            : theme.color.textMuted
                      }
                    />
                  </View>
                }
                trailing={
                  item.value !== undefined ? (
                    // The value shares the row with the title, so it takes only
                    // what is left: `flexShrink` with a zero `minWidth` lets a
                    // long answer clip rather than push the chevron off the
                    // edge. A chevron still follows a value when the row opens
                    // something — a value alone would read as unchangeable.
                    <Row
                      style={{
                        gap: theme.spacing.xs,
                        flexShrink: 1,
                        minWidth: 0,
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        variant="caption"
                        tone={item.valueMuted ? 'faint' : 'muted'}
                        numberOfLines={1}
                        style={{ flexShrink: 1, minWidth: 0 }}
                      >
                        {item.value}
                      </Text>
                      {live ? (
                        <Ionicons
                          name={directionalIcon('chevron-forward')}
                          size={iconSize.md}
                          color={theme.color.textFaint}
                        />
                      ) : null}
                    </Row>
                  ) : item.route ? (
                    <Ionicons
                      name={directionalIcon('chevron-forward')}
                      size={iconSize.md}
                      color={theme.color.textFaint}
                    />
                  ) : null
                }
              />
              {index < rows.length - 1 ? (
                <View style={{ height: 1, backgroundColor: theme.color.border }} />
              ) : null}
            </View>
          );
        })}
      </Card>
    </View>
  );
}
