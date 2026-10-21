/**
 * The itinerary of a trip across borders — "Countries visited" in group
 * settings — as the body of one sheet.
 *
 * Three panes inside the one sheet, never a second modal (a modal opened from
 * a modal is a fight with Android, and the trip-rate editor settled this the
 * same way): the list of stops; which country; and when. Adding a stop walks
 * country → days → back to the list. Tapping a stop opens its days, with the
 * country changeable from there and a Remove under the calendar. Nothing
 * reaches the group until a stop is saved, and a stop that breaks a rule —
 * overlapping another, outside the trip's dates — is refused on the spot with
 * the reason, before anything is queued (`validateStops` is the same rule set
 * the server runs).
 *
 * The home country is not here. `country_code` still says where the group
 * settles up; this is where it went.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import {
  COUNTRIES,
  countryFlag,
  countryName,
  currencyForStop,
  validateStops,
  type TripStop,
} from '@waves/core';
import { Button, directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { DatesSheetBody } from '@/components/DatesSheetBody';
import { ListRow, RowTile } from '@/components/standard';
import { fill, plural, useStrings } from '@/i18n';
import { tripDateFromIso } from '@/lib/tripDateRange';
import { stopErrorText, stopLine } from '@/lib/tripStops';

type Pane = 'list' | 'country' | 'dates';

export function TripStopsBody({
  stops,
  tripStart,
  tripEnd,
  timeZone,
  canEdit,
  locale,
  pending,
  onSave,
  onClose,
}: {
  stops: readonly TripStop[];
  /** The trip's own dates, `YYYY-MM-DD` or null: a stop has to lie inside them. */
  tripStart: string | null;
  tripEnd: string | null;
  timeZone: string;
  canEdit: boolean;
  locale: string;
  pending: boolean;
  /** The whole itinerary, validated. Resolves once queued. */
  onSave: (stops: readonly TripStop[]) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const [pane, setPane] = useState<Pane>('list');
  /** Which stop is being edited, or null for a new one. */
  const [editing, setEditing] = useState<number | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const bounds = { start: tripDateFromIso(tripStart), end: tripDateFromIso(tripEnd) };
  const current = editing === null ? null : (stops[editing] ?? null);

  const startAdd = (): void => {
    setEditing(null);
    setCountry(null);
    setNotice(null);
    setPane('country');
  };

  const startEdit = (index: number): void => {
    setEditing(index);
    setCountry(stops[index]?.country ?? null);
    setNotice(null);
    setPane('dates');
  };

  const backToList = (): void => {
    setPane('list');
    setEditing(null);
    setCountry(null);
    setNotice(null);
  };

  /** Save the list, or show why it was refused and stay. */
  const commit = async (next: readonly TripStop[]): Promise<boolean> => {
    const verdict = validateStops(next, { start: tripStart, end: tripEnd });
    if (!verdict.ok) {
      setNotice(stopErrorText(verdict.code, t));
      return false;
    }
    setNotice(null);
    try {
      await onSave(verdict.stops);
      return true;
    } catch {
      setNotice(t.couldNotSave);
      return false;
    }
  };

  const saveStop = (patch: { start_date?: string | null; end_date?: string | null }): void => {
    if (!country || !patch.start_date || !patch.end_date) return;
    const stop: TripStop = { country, start: patch.start_date, end: patch.end_date };
    const next =
      editing === null ? [...stops, stop] : stops.map((s, i) => (i === editing ? stop : s));
    void commit(next).then((ok) => {
      if (ok) backToList();
    });
  };

  const removeStop = (): void => {
    if (editing === null) return;
    void commit(stops.filter((_, i) => i !== editing)).then((ok) => {
      if (ok) backToList();
    });
  };

  const heading = (title: string, subtitle: string, onBack?: () => void): React.JSX.Element => (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          hitSlop={10}
          onPress={onBack}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </Pressable>
      ) : (
        <RowTile tint={theme.color.brandSoft}>
          <Ionicons name="earth-outline" size={iconSize.lg} color={theme.color.brand} />
        </RowTile>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      {onBack ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          onPress={onClose}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
        >
          <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
        </Pressable>
      )}
    </Row>
  );

  if (pane === 'country') {
    return (
      <View style={{ flex: 1, gap: theme.spacing.md }}>
        {heading(
          t.stops.whichCountry,
          t.stops.addCountries,
          editing === null ? backToList : () => setPane('dates'),
        )}
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: theme.spacing.xl }}
        >
          {COUNTRIES.map((entry, index) => {
            const code = currencyForStop({ country: entry.code, start: '', end: '' });
            return (
              <ListRow
                key={entry.code}
                leading={
                  <RowTile tint={theme.scheme === 'dark' ? '#E5566D38' : '#FDE8EC'}>
                    <Text style={{ fontSize: 22 }}>{countryFlag(entry.code) ?? '🌐'}</Text>
                  </RowTile>
                }
                title={entry.name}
                subtitle={code ?? undefined}
                divider={index < COUNTRIES.length - 1}
                trailing={
                  entry.code === country ? (
                    <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                  ) : null
                }
                onPress={() => {
                  setCountry(entry.code);
                  setNotice(null);
                  setPane('dates');
                }}
              />
            );
          })}
        </ScrollView>
      </View>
    );
  }

  if (pane === 'dates' && country) {
    const name = countryName(country) ?? country;
    return (
      <DatesSheetBody
        group={{
          start_date: current?.start ?? null,
          end_date: current?.end ?? null,
          time_zone: timeZone,
        }}
        locale={locale}
        forEvent={false}
        title={fill(t.stops.whenThere, { country: `${countryFlag(country) ?? ''} ${name}`.trim() })}
        subtitle={t.stops.stopDatesSubtitle}
        bounds={bounds}
        saveLabel={t.stops.saveStop}
        canClear={false}
        notice={notice}
        onClose={backToList}
        onSave={saveStop}
        footer={
          <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Button
              label={t.stops.changeCountry}
              variant="ghost"
              size="sm"
              disabled={pending}
              onPress={() => setPane('country')}
            />
            {current ? (
              <Button
                label={t.stops.removeStop}
                variant="ghostDanger"
                size="sm"
                disabled={pending}
                onPress={removeStop}
              />
            ) : null}
          </Row>
        }
      />
    );
  }

  return (
    <View style={{ flex: 1, gap: theme.spacing.md }}>
      {heading(
        t.stops.countriesVisited,
        stops.length > 0 ? plural(locale, stops.length, t.stops.stopCount) : t.stops.addCountries,
      )}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: theme.spacing.xl }}
      >
        {stops.map((stop, index) => (
          <ListRow
            key={`${stop.country}:${stop.start}`}
            leading={
              <RowTile tint={theme.scheme === 'dark' ? '#E5566D38' : '#FDE8EC'}>
                <Text style={{ fontSize: 22 }}>{countryFlag(stop.country) ?? '🌐'}</Text>
              </RowTile>
            }
            title={countryName(stop.country) ?? stop.country}
            subtitle={stopLine(stop, locale)}
            divider={canEdit || index < stops.length - 1}
            trailing={
              canEdit ? (
                <Ionicons
                  name={directionalIcon('chevron-forward')}
                  size={iconSize.md}
                  color={theme.color.textMuted}
                />
              ) : null
            }
            onPress={canEdit ? () => startEdit(index) : undefined}
          />
        ))}
        {canEdit ? (
          <ListRow
            leading={
              <RowTile tint={theme.color.brandSoft}>
                <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
              </RowTile>
            }
            title={t.stops.addStop}
            onPress={pending ? undefined : startAdd}
          />
        ) : (
          <Text variant="caption" tone="muted" style={{ paddingTop: theme.spacing.sm }}>
            {t.stops.adminOnly}
          </Text>
        )}
        {notice ? (
          <Text variant="caption" tone="negative" style={{ paddingTop: theme.spacing.sm }}>
            {notice}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
