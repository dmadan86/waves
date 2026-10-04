/**
 * The "where did this happen" control the expense forms share (A43).
 *
 * Location is optional and opt-in: nothing is read until the person taps "Add
 * location", at which point the permission is asked for just-in-time (the same
 * deferred model push uses). A grant reads one fix, names it on the device, and
 * hands it back; a refusal says so and offers Settings, because on iOS a denied
 * location cannot be re-asked from inside the app. It never blocks saving — an
 * expense with no place is exactly what every expense was before this existed.
 *
 * Shared by the capture screen and the group add-expense screen so the two
 * present and behave identically rather than each carrying its own copy.
 */

import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import type { ExpenseLocation } from '@waves/core';
import { Button, Callout, Card, iconSize, Row, Text, useTheme } from '@waves/ui';

import { LocationPickerSheet } from '@/components/LocationPickerSheet';
import { MapPreview } from '@/components/MapPreview';
import { useStrings } from '@/i18n';
import {
  captureLocation,
  captureLocationIfGranted,
  coordLabel,
  LocationFailure,
  locationAvailable,
  locationUnchanged,
  reverseGeocode,
} from '@/lib/location';

export function LocationField({
  value,
  onChange,
  autoFill = false,
  busy: busyExternal = false,
  tiles = false,
  compact = false,
}: {
  value: ExpenseLocation | null;
  onChange: (location: ExpenseLocation | null) => void;
  /**
   * Fill the field in on its own, if the permission is already held.
   *
   * `captureLocationIfGranted` never *asks* — an undetermined or denied
   * permission comes back null and the field looks exactly as it did before.
   * So this is not a quieter way of prompting: it is only for the person who
   * has already said yes on some earlier expense, and whose answer to "where
   * was this?" is almost always "here".
   *
   * Off by default, and off on an edit: a saved expense already has its place,
   * and re-reading the phone's would quietly move a restaurant in Goa to the
   * reader's kitchen a week later.
   */
  autoFill?: boolean;
  /**
   * An owner is already reading a fix (the voice review reads the current place
   * on its own, up front). Shown as a "getting location" placeholder in place of
   * the buttons, so the field reads as working rather than empty while it lands.
   */
  busy?: boolean;
  /**
   * The Save an expense look: a "Location (optional)" heading with a pin, and
   * the two ways in as a pair of tiles side by side — the current place in the
   * brand's soft tint, the map outlined beside it — rather than two small
   * buttons.
   */
  tiles?: boolean;
  /**
   * The one-line look the voice review wants: a pin, the address, and a small
   * square map thumbnail that doubles as the disclosure — tapping the row
   * folds the full map (and the change/clear actions) open in place, the same
   * idiom the expense screen's own Location row uses. Mutually exclusive with
   * `tiles` in practice; a caller passing both gets this one.
   */
  compact?: boolean;
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const [working, setWorking] = useState(false);
  // Compact only: whether the full map (and its change/clear actions) is
  // folded open under the one-line row. Starts open the moment a place is
  // already on the field — before compact mode existed the map was never
  // behind a fold at all, so an edit opening on a saved location, or a voice
  // review reading one back, showed it immediately. Staying closed until an
  // explicit tap is only right for the field that opens with nothing in it,
  // where there is genuinely no map yet to show.
  const [expanded, setExpanded] = useState(value !== null);
  // `hadValue` is what `value !== null` was as of the last render — the same
  // "adjust state during render" shape `ratedFor` below uses — so a place
  // landing on a field that started with none (a fresh "Add location" tap, or
  // a voice capture arriving) re-opens the fold the instant it does, rather
  // than leaving the pin one more tap away. An explicit fold-away (the row's
  // own tap, or Remove, which already closes this) sticks, because nothing
  // here fires again until the next none-to-something transition.
  const [hadValue, setHadValue] = useState(value !== null);
  if ((value !== null) !== hadValue) {
    setHadValue(value !== null);
    if (value !== null) setExpanded(true);
  }
  // 'denied' offers Settings; 'unavailable' just invites another try. Cleared
  // the moment a fresh attempt starts.
  const [failure, setFailure] = useState<LocationFailure | null>(null);
  // The full-screen map: opened to adjust an existing pin, or to pick a spot
  // by hand when the person is not standing where the money was spent.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Once per mount, whatever happens next.
  //
  // Without this, clearing the place would hand `value: null` back to an effect
  // watching `value`, which would read the fix again and put it straight back —
  // a cross that does nothing, which is a worse control than no cross at all.
  const filled = useRef(false);
  /**
   * The automatic read, which begins true rather than being switched on.
   *
   * Its own state, and seeded from the props, for two reasons. The effect below
   * cannot call `setWorking(true)` in its body — setting state synchronously
   * inside an effect is a render the component did not need and a lint rule
   * this repo enforces. And starting from the prop means the very first frame
   * already shows "getting location" rather than a pair of buttons that vanish
   * a tick later, which is the flicker this was meant to avoid.
   *
   * A field that is already filled has nothing to read, so it never starts.
   */
  const [autoReading, setAutoReading] = useState(autoFill && value === null);
  // The latest `value`, for the background name patches below to check against
  // — they resolve well after the render that kicked them off, so a closure
  // over `value` would see a stale pin instead of whatever is there now.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!autoFill || filled.current) return;
    filled.current = true;
    // An expense that already knows where it was keeps that answer.
    if (value !== null) return;
    let live = true;
    void captureLocationIfGranted()
      .then((found) => {
        // `live` because a fix can land after the form is gone — on a cold GPS
        // this is seconds, and the person may well have saved and left.
        if (!live || !found) return;
        onChange(found);
        // The name is resolved separately and patched in if it beats the
        // reader to a change — never awaited, so it cannot delay this fix or
        // hold `autoReading` open. Dropped if the pin has since moved, been
        // cleared, or the form is gone.
        const { lat, lng } = found;
        void reverseGeocode(lat, lng).then((name) => {
          if (!live || !name) return;
          const current = valueRef.current;
          if (locationUnchanged(current, lat, lng)) onChange({ ...current, name });
        });
      })
      .finally(() => {
        if (live) setAutoReading(false);
      });
    return () => {
      live = false;
    };
    // Deliberately not watching `value` or `onChange`: this runs once, and
    // re-running it on a change is the loop the ref above exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFill]);

  // Web and a build with no location module have nothing to offer — the whole
  // field is absent rather than a button that can only fail.
  if (!locationAvailable()) return null;

  const add = async (): Promise<void> => {
    setFailure(null);
    setWorking(true);
    try {
      const result = await captureLocation();
      if (result.ok) {
        onChange(result.location);
        // Same best-effort, never-awaited name patch as the auto-fill above —
        // `working` clears right after the fix, not after this.
        const { lat, lng } = result.location;
        void reverseGeocode(lat, lng).then((name) => {
          if (!name) return;
          const current = valueRef.current;
          if (locationUnchanged(current, lat, lng)) onChange({ ...current, name });
        });
      } else if (result.why !== LocationFailure.Unsupported) {
        setFailure(result.why);
      }
    } finally {
      setWorking(false);
    }
  };

  // Either this field's own tap or an owner-driven read (the voice review) counts
  // as busy — both put the field in the same "getting location" state.
  const busy = working || autoReading || busyExternal;
  const label = value ? value.name?.trim() || coordLabel(value) : '';

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {tiles ? (
        <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Ionicons name="location-outline" size={iconSize.md} color={theme.color.textMuted} />
          <Text variant="body" style={{ fontWeight: '600' }}>
            {t.location.label}
            <Text variant="body" tone="muted">{` ${t.captureForm.optional}`}</Text>
          </Text>
        </Row>
      ) : compact ? null : (
        <Text variant="caption" tone="muted">
          {t.location.label}
        </Text>
      )}

      {value && compact ? (
        <View style={{ gap: theme.spacing.sm }}>
          {/* One line: a pin, the address, a thumbnail of the point. Tapping
              anywhere folds the full map (and the change/clear actions) open
              beneath it — the same disclosure the expense screen's own
              Location row uses, so a spoken place costs one line until asked
              to say more. */}
          <Pressable
            onPress={() => setExpanded((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${t.location.label}, ${label}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="location" size={iconSize.md} color={theme.color.brand} />
            <Text numberOfLines={1} style={{ flex: 1, color: theme.color.text }}>
              {label}
            </Text>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: theme.radius.md,
                overflow: 'hidden',
              }}
            >
              <MapPreview location={value} height={56} />
            </View>
          </Pressable>
          {expanded ? (
            <View style={{ gap: theme.spacing.sm }}>
              <MapPreview
                location={value}
                onPress={() => setPickerOpen(true)}
                accessibilityLabel={t.location.adjust}
              />
              <Row style={{ gap: theme.spacing.lg, justifyContent: 'flex-end' }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.location.adjust}
                  onPress={() => setPickerOpen(true)}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons name="create-outline" size={iconSize.sm} color={theme.color.brand} />
                  <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
                    {t.location.adjust}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.location.remove}
                  onPress={() => {
                    setExpanded(false);
                    onChange(null);
                  }}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={iconSize.sm}
                    color={theme.color.textFaint}
                  />
                  <Text variant="caption" tone="muted" style={{ fontWeight: '600' }}>
                    {t.location.remove}
                  </Text>
                </Pressable>
              </Row>
            </View>
          ) : null}
        </View>
      ) : value ? (
        <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.sm }}>
          {/* A little map of the point — tap it to open the picker and adjust. */}
          <MapPreview
            location={value}
            onPress={() => setPickerOpen(true)}
            accessibilityLabel={t.location.adjust}
          />
          <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
            <Ionicons name="location" size={iconSize.md} color={theme.color.brand} />
            <Text variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
              {label}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.location.adjust}
              onPress={() => setPickerOpen(true)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="create-outline" size={iconSize.md} color={theme.color.brand} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.location.remove}
              onPress={() => onChange(null)}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="close-circle" size={iconSize.md} color={theme.color.textFaint} />
            </Pressable>
          </Row>
        </Card>
      ) : busy ? (
        // A fix is on its way — read the current place rather than showing empty
        // buttons that look like nothing has happened.
        <Row
          style={{
            gap: theme.spacing.sm,
            alignItems: 'center',
            paddingVertical: compact ? 0 : theme.spacing.xs,
          }}
        >
          <ActivityIndicator size="small" color={theme.color.brand} />
          <Text tone="muted">{t.location.adding}</Text>
        </Row>
      ) : compact ? (
        // No pin yet: the same two ways in as the ordinary row, but as slim
        // inline text rather than a pair of bordered buttons.
        <Row style={{ gap: theme.spacing.lg, alignItems: 'center' }}>
          <Pressable
            onPress={() => void add()}
            accessibilityRole="button"
            accessibilityLabel={t.location.add}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="location-outline" size={iconSize.sm} color={theme.color.brand} />
            <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
              {t.location.add}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t.location.pick}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="map-outline" size={iconSize.sm} color={theme.color.brand} />
            <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
              {t.location.pick}
            </Text>
          </Pressable>
        </Row>
      ) : tiles ? (
        <Row style={{ gap: theme.spacing.sm }}>
          <LocationTile
            icon="location"
            title={t.location.add}
            subtitle={t.captureForm.addLocationSub}
            onPress={() => void add()}
            filled
          />
          <LocationTile
            icon="map-outline"
            title={t.location.pick}
            subtitle={t.captureForm.pickOnMapSub}
            onPress={() => setPickerOpen(true)}
          />
        </Row>
      ) : (
        <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          <Button
            label={t.location.add}
            variant="secondary"
            size="sm"
            onPress={() => void add()}
            icon={<Ionicons name="location-outline" size={iconSize.md} color={theme.color.brand} />}
          />
          {/* The manual path: choose a spot on the map when you are not there. */}
          <Button
            label={t.location.pick}
            variant="secondary"
            size="sm"
            onPress={() => setPickerOpen(true)}
            icon={<Ionicons name="map-outline" size={iconSize.md} color={theme.color.brand} />}
          />
        </Row>
      )}

      <LocationPickerSheet
        visible={pickerOpen}
        initial={value}
        onClose={() => setPickerOpen(false)}
        onConfirm={(picked) => {
          onChange(picked);
          setPickerOpen(false);
        }}
      />

      {failure === LocationFailure.Denied ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Callout tone="info">{t.location.blocked}</Callout>
          <Button
            label={t.location.openSettings}
            variant="ghost"
            size="sm"
            onPress={() => void Linking.openSettings().catch(() => undefined)}
          />
        </View>
      ) : failure === LocationFailure.Unavailable ? (
        <Callout tone="info">{t.location.unavailable}</Callout>
      ) : null}
    </View>
  );
}

/** One of the two ways in, as a tile: a glyph beside a title and a line under it. */
function LocationTile({
  icon,
  title,
  subtitle,
  onPress,
  filled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  /** The primary way in: filled in the brand's soft tint rather than outlined. */
  filled?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: filled ? theme.color.brandSoft : theme.color.surface,
        borderWidth: filled ? 0 : 1,
        borderColor: theme.color.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
      <View style={{ flex: 1 }}>
        <Text variant="body" tone="brand" numberOfLines={1} style={{ fontWeight: '700' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
