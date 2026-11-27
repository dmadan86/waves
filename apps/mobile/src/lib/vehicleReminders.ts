/** Local reminders for vehicle renewals and the licence: one notification each, N days ahead at 10:00. Never asks permission. */

import { useEffect, useMemo } from 'react';
import * as Notifications from 'expo-notifications';

import { fill, useStrings } from '@/i18n';
import { decodeLicence, decodeVehicle } from '@waves/core';

import { useAllGroupRecords, usePersonalRecords } from '@/data/personal';
import { isFormer } from '@/e2ee/space';
import { useAuth } from '@/lib/auth';
import { ensureAndroidChannel, localNotificationsAllowed, pushSupported } from '@/lib/push';
import { planVehicleReminders, type InSpace, type VehicleReminder } from '@/lib/vehiclePlan';
import { kindName } from '@/lib/vehicleText';
import { regionOf } from '@/lib/wealthPlan';

const KEY = 'waves.vehicle.reminder';
let replacement = Promise.resolve();
let generation = 0;

async function replaceAll(
  items: { r: VehicleReminder; title: string; body: string }[],
  version: number,
): Promise<void> {
  if (!pushSupported) return;
  try {
    if (version !== generation) return;
    const held = await Notifications.getAllScheduledNotificationsAsync();
    if (version !== generation) return;
    for (const n of held) {
      if ((n.content.data as { key?: unknown } | undefined)?.key === KEY)
        await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
    if (items.length === 0 || !(await localNotificationsAllowed()) || version !== generation)
      return;
    await ensureAndroidChannel();
    for (const { r, title, body } of items) {
      if (version !== generation) return;
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { key: KEY, url: r.url } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(r.fireAt),
          channelId: 'default',
        },
      });
    }
  } catch {
    // The Upcoming list still says it.
  }
}

/** Re-plans the vehicle reminders whenever the records change. Mount once on the Personal home. */
export function useVehicleReminders(): void {
  const { t } = useStrings();
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  const personal = usePersonalRecords();
  const groups = useAllGroupRecords();
  // Every space the person is in, so a couple or family vehicle reminds too; a deleted or moved record
  // drops out of the plan and its old notification is cancelled by the full replace below.
  const { vehicles, licences } = useMemo(() => {
    const vehicles: InSpace<ReturnType<typeof decodeVehicle>>[] = [];
    const licences: InSpace<ReturnType<typeof decodeLicence>>[] = [];
    const add = (
      r: { id: string; record_kind: string; data: Record<string, unknown> },
      space?: string,
    ) => {
      if (r.record_kind === 'vehicle') vehicles.push({ ...decodeVehicle(r.id, r.data), space });
      else if (r.record_kind === 'licence')
        licences.push({ ...decodeLicence(r.id, r.data), space });
    };
    for (const r of personal) add(r);
    for (const r of groups) if (!isFormer(r.group_id)) add(r, r.group_id);
    return { vehicles, licences };
  }, [personal, groups]);
  useEffect(() => {
    const v = t.vehicles;
    const version = ++generation;
    const items = planVehicleReminders({ vehicles, licences, now: Date.now() }).map((r) => ({
      r,
      title: v.reminderTitle,
      // Names only a vehicle's own nickname: never a licence number or holder detail.
      body: fill(v.reminderBody, {
        name: r.kind === 'licence' ? v.licence : r.name,
        kind: kindName(v, r.kind, region, r.label),
        n: r.days,
      }),
    }));
    const work = replacement.then(() => replaceAll(items, version));
    replacement = replacement.then(
      () => work,
      () => work,
    );
  }, [vehicles, licences, t, region]);
}
